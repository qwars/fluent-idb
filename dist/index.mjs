// node_modules/uuid/dist-node/regex.js
var regex_default = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

// node_modules/uuid/dist-node/validate.js
function validate(uuid) {
  return typeof uuid === "string" && regex_default.test(uuid);
}
var validate_default = validate;

// node_modules/uuid/dist-node/stringify.js
var byteToHex = [];
for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 256).toString(16).slice(1));
}
function unsafeStringify(arr, offset = 0) {
  return (byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]).toLowerCase();
}

// node_modules/uuid/dist-node/rng.js
var rnds8 = new Uint8Array(16);
function rng() {
  return crypto.getRandomValues(rnds8);
}

// node_modules/uuid/dist-node/v4.js
function v4(options, buf, offset) {
  if (!buf && !options && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return _v4(options, buf, offset);
}
function _v4(options, buf, offset) {
  options = options || {};
  const rnds = options.random ?? options.rng?.() ?? rng();
  if (rnds.length < 16) {
    throw new Error("Random bytes length must be >= 16");
  }
  rnds[6] = rnds[6] & 15 | 64;
  rnds[8] = rnds[8] & 63 | 128;
  if (buf) {
    offset = offset || 0;
    if (offset < 0 || offset + 16 > buf.length) {
      throw new RangeError(`UUID byte range ${offset}:${offset + 15} is out of buffer bounds`);
    }
    for (let i = 0; i < 16; ++i) {
      buf[offset + i] = rnds[i];
    }
    return buf;
  }
  return unsafeStringify(rnds);
}
var v4_default = v4;

// src/constants.ts
var TRANSACTION_MODES = {
  READONLY: "readonly",
  READWRITE: "readwrite",
  VERSIONCHANGE: "versionchange"
};
var RETEST_KEY_RANGES = /^(gt|lt|gte|lte)-(gt|lt|gte|lte)$/;

// src/indexed-db.ts
var { IDBKeyRange, indexedDB } = globalThis;
var { READONLY, READWRITE } = TRANSACTION_MODES;
var isCompressionSupported = typeof globalThis.CompressionStream !== "undefined" && typeof globalThis.DecompressionStream !== "undefined";
var compressionWarningShown = false;
if (!isCompressionSupported && !compressionWarningShown) {
  console.warn(
    "[FluentIDB] CompressionStream is not supported in this environment. Data compression will be skipped."
  );
  compressionWarningShown = true;
}
function isValidKey(key) {
  if (key instanceof ArrayBuffer || ArrayBuffer.isView(key)) return true;
  if (key instanceof Date) return !Number.isNaN(key.getTime());
  if (Array.isArray(key)) return key.every(isValidKey);
  if (typeof key === "number" || typeof key === "string") {
    return !(typeof key === "number" && Number.isNaN(key));
  }
  return false;
}
function isKeyValuePair(obj) {
  if (typeof obj !== "object" || obj === null) return false;
  const VALID_KEYS = /* @__PURE__ */ new Set(["eq", "gt", "gte", "lt", "lte"]);
  return Object.keys(obj).some((k) => VALID_KEYS.has(k));
}
function createKeyRangeFromOptions(options) {
  const sortedKeys = Object.keys(options).sort();
  if (sortedKeys.length === 1) {
    const [key] = sortedKeys;
    const value = options[key];
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
        `Invalid condition combination: ${pattern}. Allowed: gt-lt, gt-lte, gte-lt, gte-lte`
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
    `Invalid number of conditions: ${sortedKeys.length}. Expected 1 or 2 conditions for key range`
  );
}
function normalizeKeyRange(key) {
  if (key instanceof IDBKeyRange) return key;
  if (isKeyValuePair(key)) return createKeyRangeFromOptions(key);
  return null;
}
async function compressString(str) {
  const stream = new Blob([str]).stream();
  const compressedStream = stream.pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(compressedStream).arrayBuffer());
}
async function decompressString(buffer) {
  const stream = new Blob([buffer]).stream();
  const decompressedStream = stream.pipeThrough(
    new DecompressionStream("gzip")
  );
  return new Response(decompressedStream).text();
}
async function compressRecord(tableName, record, schema) {
  if (!isCompressionSupported) return record;
  const fields = schema.get(tableName);
  if (!fields) return record;
  const cloned = { ...record };
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
  return needsCompression ? cloned : record;
}
async function decompressRecord(tableName, record, schema) {
  if (!record || !isCompressionSupported) return record;
  const fields = schema.get(tableName);
  if (!fields) return record;
  const cloned = { ...record };
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
  return needsDecompression ? cloned : record;
}
var FluentQueryBuilder = class {
  constructor(transaction, indexName = null, debug = false) {
    this.indexName = null;
    this.keyRange = null;
    this.options = {
      end: Infinity,
      mapFn: (item) => item,
      filterFn: (value) => !!value,
      orderBy: "next",
      start: 0
    };
    const { objectStoreNames } = transaction;
    const tableName = objectStoreNames[0];
    this.transaction = transaction;
    this.table = tableName;
    this.indexName = indexName;
    this.debug = debug;
  }
  asc() {
    if (this.options.desc && this.debug) {
      console.warn(
        "Sort conflict: cannot use asc() and desc() simultaneously. Applying asc()."
      );
    }
    this.options.orderBy = "next";
    if (this.options.distinct) this.options.distinct = "nextunique";
    this.options.asc = true;
    delete this.options.desc;
    return this;
  }
  count() {
    return new Promise((resolve, reject) => {
      const objectStore = this.transaction.objectStore(this.table);
      const index = this.indexName ? objectStore.index(this.indexName) : objectStore;
      const request = index.count(this.keyRange ?? void 0);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(
        new Error(
          `Failed to count records by index "${this.indexName ?? "primary"}". Table: "${this.table}"`
        )
      );
    });
  }
  desc() {
    if (this.options.asc && this.debug) {
      console.warn(
        "Sort conflict: cannot use asc() and desc() simultaneously. Applying desc()."
      );
    }
    this.options.orderBy = "prev";
    if (this.options.distinct) this.options.distinct = "prevunique";
    this.options.desc = true;
    delete this.options.asc;
    return this;
  }
  distinct() {
    this.options.distinct = this.options.orderBy === "prev" ? "prevunique" : "nextunique";
    return this;
  }
  execute() {
    return new Promise((resolve, reject) => {
      const objectStore = this.transaction.objectStore(this.table);
      const index = this.indexName ? objectStore.index(this.indexName) : objectStore;
      const request = index.openCursor(
        this.keyRange,
        this.options.distinct || this.options.orderBy
      );
      const results = [];
      const offset = this.options.start ?? 0;
      const limit = this.options.end ?? Infinity;
      const mapFunc = this.options.mapFn;
      const filterFn = this.options.filterFn;
      let skipped = 0;
      let collected = 0;
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          return resolve(results.map(mapFunc));
        }
        const value = cursor.value;
        const passesFilter = filterFn ? filterFn(value) : true;
        if (passesFilter) {
          if (skipped < offset) skipped++;
          else if (collected < limit) {
            results.push(value);
            collected++;
          } else {
            return resolve(results.map(mapFunc));
          }
        }
        cursor.continue();
      };
      request.onerror = () => {
        reject(
          new Error(
            `Query execution error by index "${this.indexName ?? "primary"}". Table: "${this.table}"`
          )
        );
      };
    });
  }
  executeKeys() {
    return new Promise((resolve, reject) => {
      const objectStore = this.transaction.objectStore(this.table);
      const index = this.indexName ? objectStore.index(this.indexName) : objectStore;
      const { distinct, end, keysOnly, orderBy, start } = this.options;
      const request = keysOnly ? index.openKeyCursor(this.keyRange, distinct || orderBy) : index.openCursor(this.keyRange, distinct || orderBy);
      const results = [];
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
            `Failed to get keys by index "${this.indexName ?? "primary"}". Table: "${this.table}"`
          )
        );
      };
    });
  }
  filter(filterFn = () => true) {
    this.options.filterFn = filterFn;
    return this;
  }
  keys() {
    this.options.keysOnly = true;
    return this;
  }
  limit(offset = 0, count = Infinity) {
    this.options.start = offset;
    this.options.end = count;
    return this;
  }
  lowerBound(value, open = false) {
    return this.throwErrorStringValue(value).setKeyRange(
      open ? { gt: value } : { gte: value }
    );
  }
  map(mapFn = (item) => item) {
    this.options.mapFn = mapFn;
    return this;
  }
  only(value) {
    return this.throwErrorStringValue(value).setKeyRange({ eq: value });
  }
  range(options) {
    return this.setKeyRange(options);
  }
  setKeyRange(options) {
    this.keyRange = normalizeKeyRange(options);
    return this;
  }
  upperBound(value, open = false) {
    return this.throwErrorStringValue(value).setKeyRange(
      open ? { lt: value } : { lte: value }
    );
  }
  throwErrorStringValue(value) {
    if (!isValidKey(value)) {
      let stringValue;
      if (Array.isArray(value))
        stringValue = `[array of ${value.length} elements]`;
      else if (value instanceof Date)
        stringValue = `Date(${value.toISOString()})`;
      else if (value instanceof ArrayBuffer || ArrayBuffer.isView(value))
        stringValue = `ArrayBuffer(${value.byteLength} bytes)`;
      else stringValue = String(value);
      throw new Error(
        `Invalid boundary value: ${stringValue}. Expected: string, number, Date, ArrayBuffer or their array`
      );
    }
    return this;
  }
};
var FluentTable = class {
  constructor(tableName, database, config) {
    this.autoFlush = true;
    this.commandQueue = /* @__PURE__ */ new Map();
    this.flushTimeout = null;
    this.database = database;
    this.tableName = tableName;
    this.config = config;
  }
  async add(...records) {
    try {
      const processedRecords = await Promise.all(
        records.map(
          async (record) => await compressRecord(this.tableName, record, this.config.schema)
        )
      );
      return new Promise((resolve, reject) => {
        const transaction = this.createTransaction(READWRITE);
        const objectStore = transaction.objectStore(this.tableName);
        this.handleTransaction(transaction, () => resolve(records), reject);
        processedRecords.forEach(
          (record) => objectStore.add(this.prepareRecordValue(objectStore, record))
        );
      });
    } catch (error) {
      return Promise.reject(this.createError(error, "Adding records"));
    }
  }
  clear() {
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
  close() {
    if (this.database.isClosed) throw new Error("Database is already closed");
    this.database.close();
    return this.database.isClosed = true;
  }
  count(property) {
    return new Promise((resolve, reject) => {
      const transaction = this.createTransaction(READONLY);
      const objectStore = transaction.objectStore(this.tableName);
      this.handleTransaction(transaction, () => {
      }, reject);
      try {
        const keyRange = normalizeKeyRange(property);
        if (keyRange instanceof IDBKeyRange) {
          const request = objectStore.count(keyRange);
          request.onsuccess = () => resolve(request.result);
        } else {
          resolve(0);
        }
      } catch (error) {
        reject(this.createError(error, "Counting records"));
      }
    });
  }
  async create(record) {
    if (this.config.debug)
      console.warn(`[FluentTable] create \u2192 ${this.tableName}`, record);
    this.queueCreate(record);
    await this.queueFlush();
    return record;
  }
  delete(record) {
    return this.remove([record]);
  }
  async get(property) {
    return new Promise((resolve, reject) => {
      if (!property)
        return reject(new Error("Key or conditions not specified"));
      const transaction = this.createTransaction(READONLY);
      const objectStore = transaction.objectStore(this.tableName);
      this.handleTransaction(transaction, () => {
      }, reject);
      try {
        const keyPath = objectStore.keyPath;
        const keyPathString = Array.isArray(keyPath) ? keyPath.join("") : keyPath ? keyPath : "";
        if (/uuid/i.test(keyPathString) && typeof property === "string" && validate_default(property)) {
          const request = objectStore.get(property);
          request.onsuccess = async () => {
            resolve(
              await decompressRecord(
                this.tableName,
                request.result,
                this.config.schema
              )
            );
          };
        } else {
          const keyRange = normalizeKeyRange(property);
          if (keyRange instanceof IDBKeyRange) {
            const request = objectStore.get(keyRange);
            request.onsuccess = async () => {
              resolve(
                await decompressRecord(
                  this.tableName,
                  request.result,
                  this.config.schema
                )
              );
            };
          } else {
            resolve(void 0);
          }
        }
      } catch (error) {
        reject(this.createError(error, "Getting record"));
      }
    });
  }
  async put(...records) {
    try {
      const processedRecords = await Promise.all(
        records.map(async (record) => {
          const recordData = record.item || record;
          const compressedData = await compressRecord(
            this.tableName,
            recordData,
            this.config.schema
          );
          return {
            data: compressedData,
            key: record.key
          };
        })
      );
      return new Promise((resolve, reject) => {
        const transaction = this.createTransaction(READWRITE);
        const objectStore = transaction.objectStore(this.tableName);
        this.handleTransaction(transaction, () => resolve(records), reject);
        processedRecords.forEach(({ data, key }) => objectStore.put(data, key));
      });
    } catch (error) {
      return Promise.reject(
        this.createError(error, "Updating/adding records (put)")
      );
    }
  }
  query(indexName) {
    return new FluentQueryBuilder(
      this.createTransaction(READONLY),
      indexName ?? null,
      this.config.debug
    );
  }
  queueCreate(record) {
    const key = this.extractKey(record);
    if (key === void 0) throw new Error("Failed to extract key for queue");
    const existing = this.commandQueue.get(key);
    if (!existing) {
      this.commandQueue.set(key, { key, record, type: "create" });
      if (this.config.debug)
        console.warn(
          `[Queue] create \u2192 added: ${this.formatKeyForLogging(key)}`
        );
    } else {
      this.commandQueue.set(key, { key, record, type: "create" });
      if (this.config.debug)
        console.warn(
          `[Queue] create \u2192 updated: ${this.formatKeyForLogging(key)}`
        );
    }
    this.queueScheduleFlush();
    return this;
  }
  queueDelete(record) {
    const key = this.extractKey(record);
    if (key === void 0) return this;
    const existing = this.commandQueue.get(key);
    if (!existing) {
      this.commandQueue.set(key, { key, type: "delete" });
      if (this.config.debug)
        console.warn(
          `[Queue] delete \u2192 added: ${this.formatKeyForLogging(key)}`
        );
    } else {
      if (existing.type === "create") {
        this.commandQueue.delete(key);
        if (this.config.debug)
          console.warn(
            `[Queue] delete after create \u2192 operation cancelled: ${this.formatKeyForLogging(key)}`
          );
      } else if (existing.type === "update") {
        this.commandQueue.set(key, { key, type: "delete" });
        if (this.config.debug)
          console.warn(
            `[Queue] delete \u2192 replaces update: ${this.formatKeyForLogging(key)}`
          );
      }
    }
    this.queueScheduleFlush();
    return this;
  }
  async queueFlush() {
    if (this.commandQueue.size === 0) {
      if (this.config.debug)
        console.warn(
          `[Flush] Nothing to execute for table "${this.tableName}"`
        );
      return;
    }
    const operations = Array.from(this.commandQueue.values());
    for (const op of operations) {
      if (op.record && (op.type === "create" || op.type === "update")) {
        op.record = await compressRecord(
          this.tableName,
          op.record,
          this.config.schema
        );
      }
    }
    if (this.config.debug) {
      console.warn(
        `[Flush] Executing ${operations.length} operations for "${this.tableName}"`
      );
    }
    const transaction = this.createTransaction(READWRITE);
    const objectStore = transaction.objectStore(this.tableName);
    return new Promise((resolve, reject) => {
      for (const op of operations) {
        switch (op.type) {
          case "create":
            objectStore.add(op.record);
            break;
          case "delete":
            objectStore.delete(op.key);
            break;
          case "update":
            objectStore.put(op.record);
            break;
        }
      }
      transaction.oncomplete = () => {
        this.commandQueue.clear();
        if (this.config.debug)
          console.warn(
            `[Flush] Successfully completed for "${this.tableName}"`
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
  queueScheduleFlush() {
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
  queueSetAutoFlush(enabled) {
    this.autoFlush = enabled;
    if (!enabled && this.flushTimeout !== null) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }
    return this;
  }
  queueUpdate(record) {
    const key = this.extractKey(record);
    if (key === void 0) throw new Error("Failed to extract key for queue");
    const existing = this.commandQueue.get(key);
    if (!existing) {
      this.commandQueue.set(key, { key, record, type: "update" });
      if (this.config.debug)
        console.warn(
          `[Queue] update \u2192 added: ${this.formatKeyForLogging(key)}`
        );
    } else {
      if (existing.type === "create" || existing.type === "update") {
        const merged = { ...existing.record, ...record };
        this.commandQueue.set(key, { key, record: merged, type: "update" });
        if (this.config.debug)
          console.warn(
            `[Queue] update \u2192 merged: ${this.formatKeyForLogging(key)}`
          );
      } else if (existing.type === "delete") {
        this.commandQueue.set(key, { key, record, type: "create" });
        if (this.config.debug)
          console.warn(
            `[Queue] update after delete \u2192 restoring as create: ${this.formatKeyForLogging(key)}`
          );
      }
    }
    this.queueScheduleFlush();
    return this;
  }
  async remove(...records) {
    if (records.length === 0) return true;
    const keysToDelete = [];
    let hasRangeConditions = false;
    for (const record of records) {
      if (isKeyValuePair(record)) hasRangeConditions = true;
      else {
        const key = this.extractKey(record);
        if (key !== void 0) keysToDelete.push(key);
      }
    }
    if (hasRangeConditions) {
      if (this.config.debug)
        console.warn(
          `[FluentTable] remove \u2192 direct deletion by range: ${this.tableName}`,
          records
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
              const key = this.extractKey(record);
              if (key !== void 0) objectStore.delete(key);
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
          `[FluentTable] remove \u2192 to queue: ${this.tableName}`,
          keysToDelete
        );
      for (const key of keysToDelete) this.queueDelete(key);
      await this.queueFlush();
    }
    return true;
  }
  async update(...records) {
    if (this.config.debug && records.length > 0)
      console.warn(
        `[FluentTable] update \xD7${records.length} \u2192 ${this.tableName}`,
        records
      );
    for (const record of records) {
      const key = this.extractKey(record);
      if (key === void 0)
        throw new Error(`Failed to extract key from record during update`);
      this.queueUpdate(record);
    }
    await this.queueFlush();
    return records;
  }
  createError(error, operation) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Error(
      `Operation error "${operation}" in table "${this.tableName}": ${errorMessage}`
    );
  }
  createTransaction(mode) {
    if (this.database.isClosed) {
      throw new Error("Cannot create transaction: database is closed");
    }
    return this.database.transaction([this.tableName], mode);
  }
  extractKey(record) {
    const transaction = this.createTransaction(READONLY);
    const objectStore = transaction.objectStore(this.tableName);
    const keyPath = objectStore.keyPath;
    if (!keyPath) return void 0;
    if (Array.isArray(keyPath))
      return keyPath.map(
        (path) => record[path]
      );
    return record[keyPath];
  }
  formatKeyForLogging(key) {
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
  handleTransaction(transaction, resolve, reject) {
    transaction.onerror = (event) => {
      const target = event.target;
      event.preventDefault();
      const error = transaction.error || target.error;
      console.error(`[IDB Error] ${error?.name}: ${error?.message}`);
      reject(this.createError(error, "Transaction"));
    };
    transaction.onabort = (event) => {
      const target = event.target;
      const error = transaction.error || target.error;
      console.error(`[IDB Abort] ${error?.name}: ${error?.message}`);
      reject(this.createError(error, "Transaction aborted"));
    };
    transaction.oncomplete = () => {
      if (transaction.mode === TRANSACTION_MODES.READWRITE && globalThis.navigator?.storage) {
        transaction.db.dispatchEvent(new CustomEvent("updatedDB"));
      }
      resolve();
    };
  }
  isUniqueIndex(objectStore, keyPath) {
    try {
      return objectStore.index(keyPath).unique;
    } catch {
      return false;
    }
  }
  isWrappedRecord(record) {
    return typeof record === "object" && record !== null && !Array.isArray(record) && "item" in record && "key" in record && !!record.key;
  }
  prepareRecordValue(objectStore, record) {
    const recordItem = this.isWrappedRecord(record) ? record.item : record;
    if (objectStore.autoIncrement) return recordItem;
    if (Array.isArray(recordItem)) {
      return recordItem.map(
        (item) => this.prepareSingleRecord(item, objectStore)
      );
    }
    return this.prepareSingleRecord(recordItem, objectStore);
  }
  prepareSingleRecord(recordItem, objectStore) {
    if (typeof objectStore.keyPath === "string" && this.isUniqueIndex(objectStore, objectStore.keyPath)) {
      try {
        return Object.defineProperty(recordItem, objectStore.keyPath, {
          enumerable: true,
          value: recordItem[objectStore.keyPath] ?? v4_default()
        });
      } catch {
        return recordItem;
      }
    }
    return recordItem;
  }
};
function isSchemaMatchingDatabase(schema, database) {
  for (const [tableName, fields] of schema.entries()) {
    if (!database.objectStoreNames.contains(tableName)) return false;
    const tx = database.transaction(tableName, READONLY);
    const store = tx.objectStore(tableName);
    const expected = new Set(
      fields.map((f) => {
        if (Array.isArray(f)) return f.join("_");
        if (typeof f === "object" && f !== null && "name" in f) return f.name;
        return f;
      })
    );
    const actual = new Set(store.indexNames);
    if (expected.size !== actual.size) return false;
    for (const name of expected) if (!actual.has(name)) return false;
  }
  return true;
}
async function normalizeData(db, schema, defaultValues) {
  const tx = db.transaction(Array.from(schema.keys()), READWRITE);
  for (const [tableName, fields] of schema) {
    const store = tx.objectStore(tableName);
    const expectedFields = new Set(
      fields.flatMap((f) => {
        if (Array.isArray(f)) return f;
        if (typeof f === "object" && f !== null && "name" in f) return [f.name];
        return [f];
      })
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
    tx.onerror = () => reject(new Error(`Normalization transaction failed: ${tx.error?.name}`));
    tx.onabort = () => reject(new Error("Normalization transaction aborted"));
  });
}
async function migrateDatabaseSchema(currentDb, targetSchema, defaultValues = {}, debug = false) {
  const dbName = currentDb.name;
  const currentVersion = currentDb.version;
  if (isSchemaMatchingDatabase(targetSchema, currentDb)) {
    if (debug)
      console.info(
        `[FluentIDB] Schema "${dbName}" is up to date (v${currentVersion})`
      );
    return reconnectToDatabase(dbName, debug);
  }
  if (debug)
    console.info(
      `[FluentIDB] Started migration "${dbName}" v${currentVersion} \u2192 v${currentVersion + 1}`
    );
  currentDb.close();
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, currentVersion + 1);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      const tx = event.target.transaction;
      if (debug)
        console.info(`[FluentIDB] onupgradeneeded: modifying structure...`);
      for (let i = db.objectStoreNames.length - 1; i >= 0; i--) {
        const name = db.objectStoreNames[i];
        if (!targetSchema.has(name)) {
          if (debug)
            console.info(`[FluentIDB] Deleting outdated table: "${name}"`);
          db.deleteObjectStore(name);
        }
      }
      for (const [tableName, fields] of targetSchema) {
        let store;
        if (db.objectStoreNames.contains(tableName)) {
          store = tx.objectStore(tableName);
        } else {
          const keyPath = fields[0];
          if (typeof keyPath !== "string") {
            reject(new Error(`Invalid keyPath for "${tableName}"`));
            return;
          }
          if (debug)
            console.info(
              `[FluentIDB] Creating table: "${tableName}" (keyPath: ${keyPath})`
            );
          store = db.createObjectStore(tableName, { keyPath });
        }
        const existing = new Set(store.indexNames);
        const expected = new Set(
          fields.map((f) => {
            if (typeof f === "object" && f !== null && "name" in f)
              return f.name;
            return Array.isArray(f) ? f.join("_") : f;
          }).filter((item) => !!item)
        );
        for (const name of existing) {
          if (!expected.has(name)) {
            if (debug)
              console.info(
                `[FluentIDB] Deleting index: "${name}" from "${tableName}"`
              );
            store.deleteIndex(name);
          }
        }
        for (const field of fields) {
          const name = typeof field === "object" && field !== null ? "name" in field ? field.name : field.join("_") : field;
          if (!existing.has(name)) {
            const keyPath = typeof field === "object" && field !== null && "name" in field ? field.name : field;
            const unique = field === fields[0];
            if (debug)
              console.info(
                `[FluentIDB] Creating index: "${name}" in "${tableName}"`
              );
            store.createIndex(name, keyPath, { unique });
          }
        }
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.isClosed = false;
      if (debug)
        console.info(
          `[FluentIDB] Structure migration completed (v${db.version}). Normalizing data...`
        );
      normalizeData(db, targetSchema, defaultValues).then(() => {
        if (debug)
          console.info(
            `[FluentIDB] Data normalization completed. Migration successful.`
          );
        resolve(db);
      }).catch((error) => {
        if (debug)
          console.error(`[FluentIDB] Data normalization error`, error);
        reconnectToDatabase(dbName, debug).then(resolve).catch(reject);
      });
    };
    req.onerror = () => reject(new Error(`Migration error: ${String(req.error)}`));
    req.onblocked = () => {
      if (debug)
        console.warn(`[FluentIDB] Migration blocked. Retrying in 1 sec...`);
      setTimeout(() => {
        openFluentDB(dbName, currentVersion, debug).then(
          (db) => migrateDatabaseSchema(db, targetSchema, defaultValues, debug)
        ).then(resolve).catch(reject);
      }, 1e3);
    };
  });
}
function reconnectToDatabase(dbName, debug = false) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName);
    req.onsuccess = () => {
      const db = req.result;
      db.isClosed = false;
      if (debug) console.info(`[FluentIDB] Reconnected to "${dbName}"`);
      resolve(db);
    };
    req.onerror = () => reject(new Error(`Failed to reconnect to "${dbName}"`));
    req.onblocked = () => reject(new Error(`Reconnection to "${dbName}" blocked`));
  });
}
function openFluentDB(databaseName, version, debug = false) {
  return new Promise((resolve, reject) => {
    if (debug)
      console.info(
        `[FluentIDB] Connecting to "${databaseName}"${version ? ` (v${version})` : " (current version)"}`
      );
    const req = version && version > 0 ? indexedDB.open(databaseName, version) : indexedDB.open(databaseName);
    req.onsuccess = () => {
      const db = req.result;
      db.isClosed = false;
      if (debug)
        console.info(
          `[FluentIDB] Connected to "${databaseName}" (v${db.version})`
        );
      db.onversionchange = () => {
        if (debug)
          console.warn(
            `[FluentIDB] Database "${databaseName}" version is changing. Reconnecting...`
          );
        db.close();
        db.isClosed = true;
        setTimeout(() => {
          openFluentDB(databaseName, void 0, debug).then(resolve).catch(reject);
        }, 500);
      };
      resolve(db);
    };
    req.onerror = () => reject(
      new Error(
        `[FluentIDB] Failed to open database "${databaseName}": ${req.error?.message}`
      )
    );
    req.onblocked = () => reject(
      new Error(`Database "${databaseName}" is blocked. Close other tabs.`)
    );
  });
}
async function getDatabase(name, version, config) {
  const currentDbName = `${name}_v${version}`;
  const db = await openFluentDB(currentDbName, version, config.debug);
  return await migrateDatabaseSchema(
    db,
    config.schema,
    config.defaultValues || {},
    config.debug
  );
}
export {
  FluentQueryBuilder,
  FluentTable,
  RETEST_KEY_RANGES,
  TRANSACTION_MODES,
  compressRecord,
  decompressRecord,
  getDatabase,
  migrateDatabaseSchema
};
