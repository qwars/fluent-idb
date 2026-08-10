/**
 * @fileoverview Type definitions for fluent-idb
 */
/**
 * Generic table name type.
 * Users can extend this via declaration merging if they want strict table names,
 * but by default, it accepts any string.
 */
type TableName = string;
/**
 * Defines a single field in the schema.
 * - string: simple index name
 * - string[]: compound index
 * - object: field with additional options (e.g., compression)
 */
type SchemaField = string | string[] | {
    name: string;
    compress?: boolean;
    unique?: boolean;
};
/**
 * Database schema definition.
 * Maps a table name to an array of its fields/indexes.
 * The first field is typically treated as the primary keyPath.
 */
type Schema = Map<TableName, readonly SchemaField[]>;
/**
 * Generic record item type for flexible data storage.
 */
type RecordItem = Record<string, unknown>;
/**
 * Type of queue operation.
 */
type OperationType = "create" | "delete" | "update";
/**
 * Represents a queued operation before it is flushed to IndexedDB.
 */
interface Operation<T> {
    key: IDBValidKey;
    type: OperationType;
    record?: T;
}
/**
 * Valid key range values for IndexedDB queries.
 */
type IDBKeyRangeValue = number | string | Date | ArrayBuffer | ArrayBufferView | IDBValidKey[];
/**
 * Key-value pair for building query ranges.
 */
type KeyValuePair = {
    eq?: IDBKeyRangeValue;
    gt?: IDBKeyRangeValue;
    gte?: IDBKeyRangeValue;
    lt?: IDBKeyRangeValue;
    lte?: IDBKeyRangeValue;
};
/**
 * Input type for record operations, allowing wrapped records with explicit keys.
 */
type RecordInput<T> = {
    item: T;
    key?: IDBValidKey;
} | T | T[];
/**
 * Options for query execution.
 */
interface OptionsKeyValuePair<T> extends KeyValuePair {
    end: number;
    mapFn: (value: T) => T;
    filterFn?: (value: T) => boolean;
    orderBy: IDBCursorDirection;
    start: number;
    asc?: boolean;
    desc?: boolean;
    distinct?: IDBCursorDirection;
    keysOnly?: boolean;
}
/**
 * Extended IDBDatabase interface with a custom state flag.
 */
interface IDBDatabaseStates extends IDBDatabase {
    isClosed: boolean;
}

interface FluentConfig {
    schema: Schema;
    defaultValues?: Record<string, unknown>;
    debug?: boolean;
}
declare function compressRecord<T>(tableName: string, record: T, schema: Schema): Promise<T>;
declare function decompressRecord<T>(tableName: string, record: T | undefined, schema: Schema): Promise<T | undefined>;
declare class FluentQueryBuilder<T> {
    indexName: null | string;
    keyRange: IDBKeyRange | null;
    options: OptionsKeyValuePair<T>;
    table: string;
    transaction: IDBTransaction;
    debug: boolean;
    constructor(transaction: IDBTransaction, indexName?: null | string, debug?: boolean);
    asc(): this;
    count(): Promise<number>;
    desc(): this;
    distinct(): this;
    execute(): Promise<T[]>;
    executeKeys(): Promise<IDBValidKey[]>;
    filter(filterFn?: (value: T) => boolean): this;
    keys(): this;
    limit(offset?: number, count?: number): this;
    lowerBound(value: IDBValidKey, open?: boolean): this;
    map(mapFn?: (value: T) => T): this;
    only(value: IDBValidKey | IDBValidKey[]): this;
    range(options: KeyValuePair): this;
    setKeyRange(options: KeyValuePair): this;
    upperBound(value: IDBValidKey, open?: boolean): this;
    private throwErrorStringValue;
}
declare class FluentTable<T> {
    private autoFlush;
    private commandQueue;
    private database;
    private flushTimeout;
    private tableName;
    private config;
    constructor(tableName: string, database: IDBDatabaseStates, config: FluentConfig);
    add(...records: T[]): Promise<T[]>;
    clear(): Promise<boolean>;
    close(): boolean;
    count(property: KeyValuePair): Promise<number>;
    create(record: T): Promise<T>;
    delete(record: KeyValuePair | T): Promise<boolean>;
    get(property?: IDBKeyRangeValue | KeyValuePair | number | string): Promise<T | undefined>;
    put(...records: Array<T>): Promise<Array<T>>;
    query(indexName?: string): FluentQueryBuilder<T>;
    queueCreate(record: T): this;
    queueDelete(record: T): this;
    queueFlush(): Promise<void>;
    queueScheduleFlush(): void;
    queueSetAutoFlush(enabled: boolean): this;
    queueUpdate(record: T): this;
    remove(...records: Array<KeyValuePair | RecordInput<T>>): Promise<boolean>;
    update(...records: RecordInput<T>[]): Promise<T[]>;
    private createError;
    private createTransaction;
    private extractKey;
    private formatKeyForLogging;
    private handleTransaction;
    private isUniqueIndex;
    private isWrappedRecord;
    private prepareRecordValue;
    private prepareSingleRecord;
}
declare function migrateDatabaseSchema(currentDb: IDBDatabase, targetSchema: Schema, defaultValues?: Record<string, unknown>, debug?: boolean): Promise<IDBDatabaseStates>;
declare function getDatabase(name: string, version: number, config: FluentConfig): Promise<IDBDatabaseStates>;

/**
 * @fileoverview Universal constants for fluent-idb
 */
/**
 * Standard IndexedDB transaction modes.
 */
declare const TRANSACTION_MODES: Record<Uppercase<IDBTransactionMode>, IDBTransactionMode>;
/**
 * Regular expression to validate combinations of range query operators.
 * Ensures only valid pairs like 'gt-lt', 'gte-lte', etc., are used.
 */
declare const RETEST_KEY_RANGES: RegExp;

export { type FluentConfig, FluentQueryBuilder, FluentTable, type IDBDatabaseStates, type IDBKeyRangeValue, type KeyValuePair, type Operation, type OperationType, type OptionsKeyValuePair, RETEST_KEY_RANGES, type RecordInput, type RecordItem, type Schema, type SchemaField, TRANSACTION_MODES, type TableName, compressRecord, decompressRecord, getDatabase, migrateDatabaseSchema };
