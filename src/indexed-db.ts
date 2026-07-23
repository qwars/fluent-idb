/**
 * @fileoverview Type-safe, fluent API wrapper for IndexedDB with batching and compression.
 * Public version of fluent-idb library.
 */
import { v4 as uuidv4, validate as validateUUID } from "uuid";
import { RETEST_KEY_RANGES, TRANSACTION_MODES } from "./constants";
import type {
  IDBDatabaseStates,
  IDBKeyRangeValue,
  KeyValuePair,
  Operation,
  OptionsKeyValuePair,
  RecordInput,
  Schema,
  TableName,
} from "./types";

const { IDBKeyRange, indexedDB } = globalThis;
const { READONLY, READWRITE } = TRANSACTION_MODES;

// ============================================================================
// CONFIGURATION AND ENVIRONMENT CHECKS
// ============================================================================

export interface FluentConfig {
  schema: Schema;
  defaultValues?: Record<string, unknown>;
  debug?: boolean;
}

const isCompressionSupported =
  typeof globalThis.CompressionStream !== "undefined" &&
  typeof globalThis.DecompressionStream !== "undefined";

let compressionWarningShown = false;
if (!isCompressionSupported && !compressionWarningShown) {
  console.warn(
    "[FluentIDB] CompressionStream is not supported in this environment. Data compression will be skipped.",
  );
  compressionWarningShown = true;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function isValidKey(key: IDBValidKey | IDBValidKey[]): boolean {
  if (key instanceof ArrayBuffer || ArrayBuffer.isView(key)) return true;
  if (key instanceof Date) return !Number.isNaN(key.getTime());
  if (Array.isArray(key)) return key.every(isValidKey);
  if (typeof key === "number" || typeof key === "string") {
    return !(typeof key === "number" && Number.isNaN(key));
  }
  return false;
}

function isKeyValuePair(obj: unknown): obj is KeyValuePair {
  if (typeof obj !== "object" || obj === null) return false;
  const VALID_KEYS = new Set(["eq", "gt", "gte", "lt", "lte"]);
  return Object.keys(obj).some((k) => VALID_KEYS.has(k));
}

function createKeyRangeFromOptions(options: KeyValuePair): IDBKeyRange {
  const sortedKeys = Object.keys(options).sort();
  if (sortedKeys.length === 1) {
    const [key] = sortedKeys;
    const value = options[key as keyof KeyValuePair];
    if (!value) throw new TypeError(`Empty value for condition "${key}"`);
    switch (key) {
      case "eq":
        return IDBKeyRange.only(value);
      case "gt":
        return IDBKeyRange.lowerBound(value, true);
      case "gte":
        return IDBKeyRange.lowerBound(value);
      case "lt":
        return IDBKeyRange.upperBound(value, true);
      case "lte":
        return IDBKeyRange.upperBound(value);
      default:
        throw new TypeError(`Unknown condition: ${key}`);
    }
  }
  if (sortedKeys.length === 2) {
    const pattern = sortedKeys.join("-");
    if (!RETEST_KEY_RANGES.test(pattern)) {
      throw new TypeError(
        `Invalid condition combination: ${pattern}. Allowed: gt-lt, gt-lte, gte-lt, gte-lte`,
      );
    }
    const lowerValue = options.gt ?? options.gte;
    const upperValue = options.lt ?? options.lte;
    const isLowerOpen = sortedKeys[0] === "gt";
    const isUpperOpen = sortedKeys[1] === "lt";
    if (!lowerValue || !upperValue) {
      throw new TypeError("Both range boundaries must be specified");
    }
    return IDBKeyRange.bound(lowerValue, upperValue, isLowerOpen, isUpperOpen);
  }
  throw new TypeError(
    `Invalid number of conditions: ${sortedKeys.length}. Expected 1 or 2 conditions for key range`,
  );
}

function normalizeKeyRange(
  key: IDBKeyRangeValue | KeyValuePair,
): IDBKeyRange | null {
  if (key instanceof IDBKeyRange) return key;
  if (isKeyValuePair(key)) return createKeyRangeFromOptions(key);
  return null;
}

// ============================================================================
// COMPRESSION UTILITIES
// ============================================================================

async function compressString(str: string): Promise<Uint8Array> {
  const stream = new Blob([str]).stream();
  const compressedStream = stream.pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(compressedStream).arrayBuffer());
}

async function decompressString(buffer: Uint8Array): Promise<string> {
  const stream = new Blob([buffer as BlobPart]).stream();
  const decompressedStream = stream.pipeThrough(
    new DecompressionStream("gzip"),
  );
  return new Response(decompressedStream).text();
}

export async function compressRecord<T>(
  tableName: string,
  record: T,
  schema: Schema,
): Promise<T> {
  if (!isCompressionSupported) return record;
  const fields = schema.get(tableName as TableName);
  if (!fields) return record;

  const cloned = { ...record } as any;
  let needsCompression = false;

  for (const f of fields) {
    if (typeof f === "object" && f !== null && "name" in f && f.compress) {
      const fieldName = f.name;
      if (typeof cloned[fieldName] === "string") {
        cloned[fieldName] = await compressString(cloned[fieldName]);
        needsCompression = true;
      }
    }
  }
  return needsCompression ? (cloned as T) : record;
}

export async function decompressRecord<T>(
  tableName: string,
  record: T | undefined,
  schema: Schema,
): Promise<T | undefined> {
  if (!record || !isCompressionSupported) return record;
  const fields = schema.get(tableName as TableName);
  if (!fields) return record;

  const cloned = { ...record } as any;
  let needsDecompression = false;

  for (const f of fields) {
    if (typeof f === "object" && f !== null && "name" in f && f.compress) {
      const fieldName = f.name;
      if (cloned[fieldName] instanceof Uint8Array) {
        cloned[fieldName] = await decompressString(cloned[fieldName]);
        needsDecompression = true;
      }
    }
  }
  return needsDecompression ? (cloned as T) : record;
}

// ============================================================================
// QUERY BUILDER CLASS
// ============================================================================

export class FluentQueryBuilder<T> {
  public indexName: null | string = null;
  public keyRange: IDBKeyRange | null = null;
  public options: OptionsKeyValuePair<T> = {
    end: Infinity,
    mapFn: (item: T) => item,
    orderBy: "next",
    start: 0,
  };
  public table: string;
  public transaction: IDBTransaction;
  public debug: boolean;

  constructor(
    transaction: IDBTransaction,
    indexName: null | string = null,
    debug: boolean = false,
  ) {
    const { objectStoreNames } = transaction;
    const tableName = objectStoreNames[0];
    this.transaction = transaction;
    this.table = tableName;
    this.indexName = indexName;
    this.debug = debug;
  }

  asc(): this {
    if (this.options.desc && this.debug) {
      console.warn(
        "Sort conflict: cannot use asc() and desc() simultaneously. Applying asc().",
      );
    }
    this.options.orderBy = "next";
    if (this.options.distinct) this.options.distinct = "nextunique";
    this.options.asc = true;
    delete this.options.desc;
    return this;
  }

  count(): Promise<number> {
    return new Promise((resolve, reject) => {
      const objectStore = this.transaction.objectStore(this.table);
      const index = this.indexName
        ? objectStore.index(this.indexName)
        : objectStore;
      const request = index.count(this.keyRange ?? undefined);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          new Error(
            `Failed to count records by index "${this.indexName ?? "primary"}". Table: "${this.table}"`,
          ),
        );
    });
  }

  desc(): this {
    if (this.options.asc && this.debug) {
      console.warn(
        "Sort conflict: cannot use asc() and desc() simultaneously. Applying desc().",
      );
    }
    this.options.orderBy = "prev";
    if (this.options.distinct) this.options.distinct = "prevunique";
    this.options.desc = true;
    delete this.options.asc;
    return this;
  }

  distinct(): this {
    this.options.distinct =
      this.options.orderBy === "prev" ? "prevunique" : "nextunique";
    return this;
  }

  execute(): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const objectStore = this.transaction.objectStore(this.table);
      const index = this.indexName
        ? objectStore.index(this.indexName)
        : objectStore;
      const request: IDBRequest<IDBCursorWithValue | null> = index.openCursor(
        this.keyRange,
        this.options.distinct || this.options.orderBy,
      );
      const results: T[] = [];
      const offset = this.options.start ?? 0;
      const limit = this.options.end ?? Infinity;
      const mapFunc = this.options.mapFn;
      let hasAdvanced = false;
      const tableName = this.table;

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return resolve(results.map(mapFunc));

        if (offset > 0 && !hasAdvanced) {
          hasAdvanced = true;
          try {
            cursor.advance(offset);
          } catch {
            resolve(results.map(mapFunc));
          }
          return;
        }

        if (results.length < limit) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results.map(mapFunc));
        }
      };
      request.onerror = () => {
        reject(
          new Error(
            `Query execution error by index "${this.indexName ?? "primary"}". Table: "${this.table}"`,
          ),
        );
      };
    });
  }

  executeKeys(): Promise<IDBValidKey[]> {
    return new Promise((resolve, reject) => {
      const objectStore = this.transaction.objectStore(this.table);
      const index = this.indexName
        ? objectStore.index(this.indexName)
        : objectStore;
      const { distinct, end, keysOnly, orderBy, start } = this.options;
      const request = keysOnly
        ? index.openKeyCursor(this.keyRange, distinct || orderBy)
        : index.openCursor(this.keyRange, distinct || orderBy);
      const results: IDBValidKey[] = [];
      let progressCount = start;

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return resolve(results);
        results.push(cursor.key);
        if (start && progressCount === start) return cursor.advance(start);
        if (progressCount >= end) return resolve(results);
        progressCount++;
        cursor.continue();
      };
      request.onerror = () => {
        reject(
          new Error(
            `Failed to get keys by index "${this.indexName ?? "primary"}". Table: "${this.table}"`,
          ),
        );
      };
    });
  }

  keys(): this {
    this.options.keysOnly = true;
    return this;
  }

  limit(offset: number = 0, count: number = Infinity): this {
    this.options.start = offset;
    this.options.end = count;
    return this;
  }

  lowerBound(value: IDBValidKey, open: boolean = false): this {
    return this.throwErrorStringValue(value).setKeyRange(
      open ? { gt: value } : { gte: value },
    );
  }

  map(mapFn: (value: T) => T = (item) => item): this {
    this.options.mapFn = mapFn;
    return this;
  }

  only(value: IDBValidKey | IDBValidKey[]): this {
    return this.throwErrorStringValue(value).setKeyRange({ eq: value });
  }

  range(options: KeyValuePair): this {
    return this.setKeyRange(options);
  }

  setKeyRange(options: KeyValuePair): this {
    this.keyRange = normalizeKeyRange(options);
    return this;
  }

  upperBound(value: IDBValidKey, open: boolean = false): this {
    return this.throwErrorStringValue(value).setKeyRange(
      open ? { lt: value } : { lte: value },
    );
  }

  private throwErrorStringValue(value: IDBValidKey | IDBValidKey[]): this {
    if (!isValidKey(value)) {
      let stringValue: string;
      if (Array.isArray(value))
        stringValue = `[array of ${value.length} elements]`;
      else if (value instanceof Date)
        stringValue = `Date(${value.toISOString()})`;
      else if (value instanceof ArrayBuffer || ArrayBuffer.isView(value))
        stringValue = `ArrayBuffer(${value.byteLength} bytes)`;
      else stringValue = String(value);

      throw new Error(
        `Invalid boundary value: ${stringValue}. Expected: string, number, Date, ArrayBuffer or their array`,
      );
    }
    return this;
  }
}

// ============================================================================
// TABLE CLASS (CRUD OPERATIONS)
// ============================================================================

export class FluentTable<T> {
  private autoFlush = true;
  private commandQueue = new Map<IDBValidKey, Operation<T>>();
  private database: IDBDatabaseStates;
  private flushTimeout: ReturnType<typeof setTimeout> | null = null;
  private tableName: string;
  private config: FluentConfig;

  constructor(
    tableName: string,
    database: IDBDatabaseStates,
    config: FluentConfig,
  ) {
    this.database = database;
    this.tableName = tableName;
    this.config = config;
  }

  async add(...records: T[]): Promise<T[]> {
    try {
      const processedRecords = await Promise.all(
        records.map(
          async (record) =>
            await compressRecord(this.tableName, record, this.config.schema),
        ),
      );
      return new Promise((resolve, reject) => {
        const transaction = this.createTransaction(READWRITE);
        const objectStore = transaction.objectStore(this.tableName);
        this.handleTransaction(transaction, () => resolve(records), reject);
        processedRecords.forEach((record) =>
          objectStore.add(this.prepareRecordValue(objectStore, record)),
        );
      });
    } catch (error) {
      return Promise.reject(this.createError(error, "Adding records"));
    }
  }

  clear(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const transaction = this.createTransaction(READWRITE);
      const objectStore = transaction.objectStore(this.tableName);
      this.handleTransaction(transaction, () => resolve(true), reject);
      try {
        objectStore.clear();
      } catch (error) {
        reject(this.createError(error, "Clearing table"));
      }
    });
  }

  close(): boolean {
    if (this.database.isClosed) throw new Error("Database is already closed");
    this.database.close();
    return (this.database.isClosed = true);
  }

  count(property: KeyValuePair): Promise<number> {
    return new Promise((resolve, reject) => {
      const transaction = this.createTransaction(READONLY);
      const objectStore = transaction.objectStore(this.tableName);
      this.handleTransaction(transaction, () => {}, reject);
      try {
        const keyRange = normalizeKeyRange(property);
        if (keyRange instanceof IDBKeyRange) {
          const request: IDBRequest<number> = objectStore.count(keyRange);
          request.onsuccess = () => resolve(request.result);
        } else {
          resolve(0);
        }
      } catch (error) {
        reject(this.createError(error, "Counting records"));
      }
    });
  }

  async create(record: T): Promise<T> {
    if (this.config.debug)
      console.warn(`[FluentTable] create → ${this.tableName}`, record);
    this.queueCreate(record);
    await this.queueFlush();
    return record;
  }

  delete(record: KeyValuePair | T): Promise<boolean> {
    return this.remove([record] as KeyValuePair | RecordInput<T>);
  }

  async get(
    property?: IDBKeyRangeValue | KeyValuePair | number | string,
  ): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      if (!property)
        return reject(new Error("Key or conditions not specified"));
      const transaction = this.createTransaction(READONLY);
      const objectStore = transaction.objectStore(this.tableName);
      this.handleTransaction(transaction, () => {}, reject);
      try {
        const keyPath = objectStore.keyPath;
        const keyPathString = Array.isArray(keyPath)
          ? keyPath.join("")
          : keyPath
            ? keyPath
            : "";

        if (
          /uuid/i.test(keyPathString) &&
          typeof property === "string" &&
          validateUUID(property)
        ) {
          const request: IDBRequest<T> = objectStore.get(property);
          request.onsuccess = async () => {
            resolve(
              await decompressRecord(
                this.tableName,
                request.result,
                this.config.schema,
              ),
            );
          };
        } else {
          const keyRange = normalizeKeyRange(property);
          if (keyRange instanceof IDBKeyRange) {
            const request: IDBRequest<T> = objectStore.get(keyRange);
            request.onsuccess = async () => {
              resolve(
                await decompressRecord(
                  this.tableName,
                  request.result,
                  this.config.schema,
                ),
              );
            };
          } else {
            resolve(undefined);
          }
        }
      } catch (error) {
        reject(this.createError(error, "Getting record"));
      }
    });
  }

  async put(...records: Array<T>): Promise<Array<T>> {
    try {
      const processedRecords = await Promise.all(
        records.map(async (record) => {
          const recordData =
            (record as { item?: T; key?: IDBValidKey }).item || record;
          const compressedData = await compressRecord(
            this.tableName,
            recordData,
            this.config.schema,
          );
          return {
            data: compressedData,
            key: (record as { key?: IDBValidKey }).key,
          };
        }),
      );
      return new Promise((resolve, reject) => {
        const transaction = this.createTransaction(READWRITE);
        const objectStore = transaction.objectStore(this.tableName);
        this.handleTransaction(transaction, () => resolve(records), reject);
        processedRecords.forEach(({ data, key }) => objectStore.put(data, key));
      });
    } catch (error) {
      return Promise.reject(
        this.createError(error, "Updating/adding records (put)"),
      );
    }
  }

  query(indexName?: string): FluentQueryBuilder<T> {
    return new FluentQueryBuilder(
      this.createTransaction(READONLY),
      indexName ?? null,
      this.config.debug,
    );
  }

  queueCreate(record: T): this {
    const key = this.extractKey(record);
    if (key === undefined) throw new Error("Failed to extract key for queue");
    const existing = this.commandQueue.get(key);
    if (!existing) {
      this.commandQueue.set(key, { key, record, type: "create" });
      if (this.config.debug)
        console.warn(
          `[Queue] create → added: ${this.formatKeyForLogging(key)}`,
        );
    } else {
      this.commandQueue.set(key, { key, record, type: "create" });
      if (this.config.debug)
        console.warn(
          `[Queue] create → updated: ${this.formatKeyForLogging(key)}`,
        );
    }
    this.queueScheduleFlush();
    return this;
  }

  queueDelete(record: T): this {
    const key = this.extractKey(record);
    if (key === undefined) return this;
    const existing = this.commandQueue.get(key);
    if (!existing) {
      this.commandQueue.set(key, { key, type: "delete" });
      if (this.config.debug)
        console.warn(
          `[Queue] delete → added: ${this.formatKeyForLogging(key)}`,
        );
    } else {
      if (existing.type === "create") {
        this.commandQueue.delete(key);
        if (this.config.debug)
          console.warn(
            `[Queue] delete after create → operation cancelled: ${this.formatKeyForLogging(key)}`,
          );
      } else if (existing.type === "update") {
        this.commandQueue.set(key, { key, type: "delete" });
        if (this.config.debug)
          console.warn(
            `[Queue] delete → replaces update: ${this.formatKeyForLogging(key)}`,
          );
      }
    }
    this.queueScheduleFlush();
    return this;
  }

  async queueFlush(): Promise<void> {
    if (this.commandQueue.size === 0) {
      if (this.config.debug)
        console.warn(
          `[Flush] Nothing to execute for table "${this.tableName}"`,
        );
      return;
    }
    const operations = Array.from(this.commandQueue.values());
    for (const op of operations) {
      if (op.record && (op.type === "create" || op.type === "update")) {
        op.record = await compressRecord(
          this.tableName,
          op.record,
          this.config.schema,
        );
      }
    }
    if (this.config.debug) {
      console.warn(
        `[Flush] Executing ${operations.length} operations for "${this.tableName}"`,
      );
    }
    const transaction = this.createTransaction(READWRITE);
    const objectStore = transaction.objectStore(this.tableName);
    return new Promise((resolve, reject) => {
      for (const op of operations) {
        switch (op.type) {
          case "create":
            objectStore.add(op.record!);
            break;
          case "delete":
            objectStore.delete(op.key);
            break;
          case "update":
            objectStore.put(op.record!);
            break;
        }
      }
      transaction.oncomplete = () => {
        this.commandQueue.clear();
        if (this.config.debug)
          console.warn(
            `[Flush] Successfully completed for "${this.tableName}"`,
          );
        resolve();
      };
      transaction.onerror = () => {
        this.commandQueue.clear();
        reject(new Error(`[Flush] Transaction error ${transaction.error}`));
      };
      transaction.onabort = () => {
        this.commandQueue.clear();
        reject(new Error("[Flush] Transaction aborted"));
      };
    });
  }

  queueScheduleFlush(): void {
    if (!this.autoFlush) return;
    if (this.flushTimeout !== null) clearTimeout(this.flushTimeout);
    this.flushTimeout = globalThis.setTimeout(() => {
      if (this.commandQueue.size > 0) {
        if (this.config.debug)
          console.warn(`[FluentIDB] Auto-flush for table "${this.tableName}"`);
        this.queueFlush().catch(console.error);
      }
    }, 100);
  }

  queueSetAutoFlush(enabled: boolean): this {
    this.autoFlush = enabled;
    if (!enabled && this.flushTimeout !== null) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }
    return this;
  }

  queueUpdate(record: T): this {
    const key = this.extractKey(record);
    if (key === undefined) throw new Error("Failed to extract key for queue");
    const existing = this.commandQueue.get(key);
    if (!existing) {
      this.commandQueue.set(key, { key, record, type: "update" });
      if (this.config.debug)
        console.warn(
          `[Queue] update → added: ${this.formatKeyForLogging(key)}`,
        );
    } else {
      if (existing.type === "create" || existing.type === "update") {
        const merged = { ...existing.record, ...record };
        this.commandQueue.set(key, { key, record: merged, type: "update" });
        if (this.config.debug)
          console.warn(
            `[Queue] update → merged: ${this.formatKeyForLogging(key)}`,
          );
      } else if (existing.type === "delete") {
        this.commandQueue.set(key, { key, record, type: "create" });
        if (this.config.debug)
          console.warn(
            `[Queue] update after delete → restoring as create: ${this.formatKeyForLogging(key)}`,
          );
      }
    }
    this.queueScheduleFlush();
    return this;
  }

  async remove(
    ...records: Array<KeyValuePair | RecordInput<T>>
  ): Promise<boolean> {
    if (records.length === 0) return true;
    const keysToDelete: IDBValidKey[] = [];
    let hasRangeConditions = false;

    for (const record of records) {
      if (isKeyValuePair(record)) hasRangeConditions = true;
      else {
        const key = this.extractKey(record as T);
        if (key !== undefined) keysToDelete.push(key);
      }
    }

    if (hasRangeConditions) {
      if (this.config.debug)
        console.warn(
          `[FluentTable] remove → direct deletion by range: ${this.tableName}`,
          records,
        );
      return new Promise((resolve, reject) => {
        const transaction = this.createTransaction(READWRITE);
        const objectStore = transaction.objectStore(this.tableName);
        this.handleTransaction(transaction, () => resolve(true), reject);
        try {
          records.forEach((record) => {
            if (isKeyValuePair(record)) {
              const keyRange = normalizeKeyRange(record);
              if (keyRange instanceof IDBKeyRange) objectStore.delete(keyRange);
            } else {
              const key = this.extractKey(record as T);
              if (key !== undefined) objectStore.delete(key);
            }
          });
        } catch (error) {
          reject(this.createError(error, "Deleting records"));
        }
      });
    }

    if (keysToDelete.length > 0) {
      if (this.config.debug)
        console.warn(
          `[FluentTable] remove → to queue: ${this.tableName}`,
          keysToDelete,
        );
      for (const key of keysToDelete) this.queueDelete(key as T);
      await this.queueFlush();
    }
    return true;
  }

  async update(...records: RecordInput<T>[]): Promise<T[]> {
    if (this.config.debug && records.length > 0)
      console.warn(
        `[FluentTable] update ×${records.length} → ${this.tableName}`,
        records,
      );
    for (const record of records) {
      const key = this.extractKey(record as T);
      if (key === undefined)
        throw new Error(`Failed to extract key from record during update`);
      this.queueUpdate(record as T);
    }
    await this.queueFlush();
    return records as T[];
  }

  private createError(error: unknown, operation: string): Error {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Error(
      `Operation error "${operation}" in table "${this.tableName}": ${errorMessage}`,
    );
  }

  private createTransaction(mode: IDBTransactionMode): IDBTransaction {
    if (this.database.isClosed) {
      throw new Error("Cannot create transaction: database is closed");
    }
    return this.database.transaction([this.tableName], mode);
  }

  private extractKey(
    record: Record<string, IDBValidKey> | T,
  ): IDBValidKey | IDBValidKey[] | undefined {
    const transaction = this.createTransaction(READONLY);
    const objectStore = transaction.objectStore(this.tableName);
    const keyPath = objectStore.keyPath;
    if (!keyPath) return undefined;
    if (Array.isArray(keyPath))
      return keyPath.map(
        (path) => (record as Record<string, IDBValidKey>)[path],
      );
    return (record as Record<string, IDBValidKey>)[keyPath];
  }

  private formatKeyForLogging(key: IDBValidKey | IDBValidKey[]): string {
    if (Array.isArray(key)) return JSON.stringify(key);
    if (typeof key === "string") return `"${key}"`;
    if (typeof key === "number" || typeof key === "bigint") return String(key);
    if (key instanceof Date) return `Date(${key.toISOString()})`;
    if (key instanceof ArrayBuffer)
      return `ArrayBuffer(${key.byteLength} bytes)`;
    if (ArrayBuffer.isView(key))
      return `ArrayBufferView(${key.byteLength} bytes)`;
    return String(key);
  }

  private handleTransaction(
    transaction: IDBTransaction,
    resolve: () => void,
    reject: (error: Error) => void,
  ): void {
    transaction.onerror = (event: Event) => {
      const target = event.target as IDBTransaction;
      event.preventDefault();
      const error = transaction.error || target.error;
      console.error(`[IDB Error] ${error?.name}: ${error?.message}`);
      reject(this.createError(error, "Transaction"));
    };
    transaction.onabort = (event: Event) => {
      const target = event.target as IDBTransaction;
      const error = transaction.error || target.error;
      console.error(`[IDB Abort] ${error?.name}: ${error?.message}`);
      reject(this.createError(error, "Transaction aborted"));
    };
    transaction.oncomplete = () => {
      if (
        transaction.mode === TRANSACTION_MODES.READWRITE &&
        globalThis.navigator?.storage
      ) {
        transaction.db.dispatchEvent(new CustomEvent("updatedDB"));
      }
      resolve();
    };
  }

  private isUniqueIndex(objectStore: IDBObjectStore, keyPath: string): boolean {
    try {
      return objectStore.index(keyPath).unique;
    } catch {
      return false;
    }
  }

  private isWrappedRecord<T>(
    record: RecordInput<T>,
  ): record is { item: T; key?: IDBValidKey } {
    return (
      typeof record === "object" &&
      record !== null &&
      !Array.isArray(record) &&
      "item" in record &&
      "key" in record &&
      !!record.key
    );
  }

  private prepareRecordValue(
    objectStore: IDBObjectStore,
    record: T | T[],
  ): T | T[] {
    const recordItem = this.isWrappedRecord(record) ? record.item : record;
    if (objectStore.autoIncrement) return recordItem;
    if (Array.isArray(recordItem)) {
      return recordItem.map((item) =>
        this.prepareSingleRecord(item, objectStore),
      );
    }
    return this.prepareSingleRecord(recordItem, objectStore);
  }

  private prepareSingleRecord(recordItem: T, objectStore: IDBObjectStore): T {
    if (
      typeof objectStore.keyPath === "string" &&
      this.isUniqueIndex(objectStore, objectStore.keyPath)
    ) {
      try {
        return Object.defineProperty(recordItem, objectStore.keyPath, {
          enumerable: true,
          value:
            (recordItem as Record<string, unknown>)[objectStore.keyPath] ??
            uuidv4(),
        });
      } catch {
        return recordItem;
      }
    }
    return recordItem;
  }
}

// ============================================================================
// DATABASE MANAGEMENT FUNCTIONS (Parameterized)
// ============================================================================

function isSchemaMatchingDatabase(
  schema: Schema,
  database: IDBDatabase,
): boolean {
  for (const [tableName, fields] of schema.entries()) {
    if (!database.objectStoreNames.contains(tableName as string)) return false;
    const tx = database.transaction(tableName as string, READONLY);
    const store = tx.objectStore(tableName as string);
    const expected = new Set(
      fields.map((f): string => {
        if (Array.isArray(f)) return f.join("_");
        if (typeof f === "object" && f !== null && "name" in f) return f.name;
        return f as string;
      }),
    );
    const actual = new Set(store.indexNames);
    if (expected.size !== actual.size) return false;
    for (const name of expected) if (!actual.has(name)) return false;
  }
  return true;
}

async function normalizeData(
  db: IDBDatabaseStates,
  schema: Schema,
  defaultValues: Record<string, unknown>,
): Promise<void> {
  const tx = db.transaction(Array.from(schema.keys()) as string[], READWRITE);
  for (const [tableName, fields] of schema) {
    const store = tx.objectStore(tableName as string);
    const expectedFields = new Set(
      fields.flatMap((f) => {
        if (Array.isArray(f)) return f;
        if (typeof f === "object" && f !== null && "name" in f) return [f.name];
        return [f];
      }),
    );
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const cur = cursor.result;
      if (!cur) return;
      const record = cur.value;
      let changed = false;
      for (const field of expectedFields) {
        if (!(field in record)) {
          record[field] = defaultValues[field] ?? null;
          changed = true;
        }
      }
      if (changed) cur.update(record);
      cur.continue();
    };
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(new Error(`Normalization transaction failed: ${tx.error?.name}`));
    tx.onabort = () => reject(new Error("Normalization transaction aborted"));
  });
}

export async function migrateDatabaseSchema(
  currentDb: IDBDatabase,
  targetSchema: Schema,
  defaultValues: Record<string, unknown> = {},
  debug = false,
): Promise<IDBDatabaseStates> {
  const dbName = currentDb.name;
  const currentVersion = currentDb.version;

  if (isSchemaMatchingDatabase(targetSchema, currentDb)) {
    if (debug)
      console.info(
        `[FluentIDB] Schema "${dbName}" is up to date (v${currentVersion})`,
      );
    return reconnectToDatabase(dbName, debug);
  }

  if (debug)
    console.info(
      `[FluentIDB] Started migration "${dbName}" v${currentVersion} → v${currentVersion + 1}`,
    );
  currentDb.close();

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, currentVersion + 1);
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const tx = (event.target as IDBOpenDBRequest).transaction!;
      if (debug)
        console.info(`[FluentIDB] onupgradeneeded: modifying structure...`);

      for (let i = db.objectStoreNames.length - 1; i >= 0; i--) {
        const name = db.objectStoreNames[i] as string;
        if (!targetSchema.has(name as any)) {
          if (debug)
            console.info(`[FluentIDB] Deleting outdated table: "${name}"`);
          db.deleteObjectStore(name);
        }
      }

      for (const [tableName, fields] of targetSchema) {
        let store: IDBObjectStore;
        if (db.objectStoreNames.contains(tableName as string)) {
          store = tx.objectStore(tableName as string);
        } else {
          const keyPath = fields[0];
          if (typeof keyPath !== "string") {
            reject(new Error(`Invalid keyPath for "${tableName}"`));
            return;
          }
          if (debug)
            console.info(
              `[FluentIDB] Creating table: "${tableName}" (keyPath: ${keyPath})`,
            );
          store = db.createObjectStore(tableName as string, { keyPath });
        }

        const existing = new Set(store.indexNames);
        const expected = new Set<string>(
          fields
            .map((f) => {
              if (typeof f === "object" && f !== null && "name" in f)
                return f.name;
              return Array.isArray(f) ? f.join("_") : f;
            })
            .filter((item): item is string => !!item),
        );

        for (const name of existing) {
          if (!expected.has(name)) {
            if (debug)
              console.info(
                `[FluentIDB] Deleting index: "${name}" from "${tableName}"`,
              );
            store.deleteIndex(name);
          }
        }

        for (const field of fields) {
          const name: string =
            typeof field === "object" && field !== null
              ? "name" in field
                ? field.name
                : (field as string[]).join("_")
              : (field as string);
          if (!existing.has(name)) {
            const keyPath =
              typeof field === "object" && field !== null && "name" in field
                ? field.name
                : field;
            const unique = field === fields[0];
            if (debug)
              console.info(
                `[FluentIDB] Creating index: "${name}" in "${tableName}"`,
              );
            store.createIndex(name, keyPath as string | string[], { unique });
          }
        }
      }
    };

    req.onsuccess = () => {
      const db = req.result as IDBDatabaseStates;
      db.isClosed = false;
      if (debug)
        console.info(
          `[FluentIDB] Structure migration completed (v${db.version}). Normalizing data...`,
        );
      normalizeData(db, targetSchema, defaultValues)
        .then(() => {
          if (debug)
            console.info(
              `[FluentIDB] Data normalization completed. Migration successful.`,
            );
          resolve(db);
        })
        .catch((error) => {
          if (debug)
            console.error(`[FluentIDB] Data normalization error`, error);
          reconnectToDatabase(dbName, debug).then(resolve).catch(reject);
        });
    };

    req.onerror = () =>
      reject(new Error(`Migration error: ${String(req.error)}`));
    req.onblocked = () => {
      if (debug)
        console.warn(`[FluentIDB] Migration blocked. Retrying in 1 sec...`);
      setTimeout(() => {
        openFluentDB(dbName, currentVersion, debug)
          .then((db) =>
            migrateDatabaseSchema(db, targetSchema, defaultValues, debug),
          )
          .then(resolve)
          .catch(reject);
      }, 1000);
    };
  });
}

function reconnectToDatabase(
  dbName: string,
  debug = false,
): Promise<IDBDatabaseStates> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName);
    req.onsuccess = () => {
      const db = req.result as IDBDatabaseStates;
      db.isClosed = false;
      if (debug) console.info(`[FluentIDB] Reconnected to "${dbName}"`);
      resolve(db);
    };
    req.onerror = () => reject(new Error(`Failed to reconnect to "${dbName}"`));
    req.onblocked = () =>
      reject(new Error(`Reconnection to "${dbName}" blocked`));
  });
}

function openFluentDB(
  databaseName: string,
  version?: number,
  debug = false,
): Promise<IDBDatabaseStates> {
  return new Promise((resolve, reject) => {
    if (debug)
      console.info(
        `[FluentIDB] Connecting to "${databaseName}"${version ? ` (v${version})` : " (current version)"}`,
      );
    const req =
      version && version > 0
        ? indexedDB.open(databaseName, version)
        : indexedDB.open(databaseName);

    req.onsuccess = () => {
      const db = req.result as IDBDatabaseStates;
      db.isClosed = false;
      if (debug)
        console.info(
          `[FluentIDB] Connected to "${databaseName}" (v${db.version})`,
        );
      db.onversionchange = () => {
        if (debug)
          console.warn(
            `[FluentIDB] Database "${databaseName}" version is changing. Reconnecting...`,
          );
        db.close();
        db.isClosed = true;
        setTimeout(() => {
          openFluentDB(databaseName, undefined, debug)
            .then(resolve)
            .catch(reject);
        }, 500);
      };
      resolve(db);
    };
    req.onerror = () =>
      reject(
        new Error(
          `[FluentIDB] Failed to open database "${databaseName}": ${req.error?.message}`,
        ),
      );
    req.onblocked = () =>
      reject(
        new Error(`Database "${databaseName}" is blocked. Close other tabs.`),
      );
  });
}

export async function getDatabase(
  name: string,
  version: number,
  config: FluentConfig,
): Promise<IDBDatabaseStates> {
  const currentDbName = `${name}_v${version}`;
  const db = await openFluentDB(currentDbName, version, config.debug);
  return await migrateDatabaseSchema(
    db,
    config.schema,
    config.defaultValues || {},
    config.debug,
  );
}
