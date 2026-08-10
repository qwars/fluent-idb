/**
 * @fileoverview Type definitions for fluent-idb
 */

/**
 * Generic table name type.
 * Users can extend this via declaration merging if they want strict table names,
 * but by default, it accepts any string.
 */
export type TableName = string;

/**
 * Defines a single field in the schema.
 * - string: simple index name
 * - string[]: compound index
 * - object: field with additional options (e.g., compression)
 */
export type SchemaField =
  | string
  | string[]
  | { name: string; compress?: boolean; unique?: boolean };

/**
 * Database schema definition.
 * Maps a table name to an array of its fields/indexes.
 * The first field is typically treated as the primary keyPath.
 */
export type Schema = Map<TableName, readonly SchemaField[]>;

/**
 * Generic record item type for flexible data storage.
 */
export type RecordItem = Record<string, unknown>;

/**
 * Type of queue operation.
 */
export type OperationType = "create" | "delete" | "update";

/**
 * Represents a queued operation before it is flushed to IndexedDB.
 */
export interface Operation<T> {
  key: IDBValidKey;
  type: OperationType;
  record?: T;
}

/**
 * Valid key range values for IndexedDB queries.
 */
export type IDBKeyRangeValue =
  | number
  | string
  | Date
  | ArrayBuffer
  | ArrayBufferView
  | IDBValidKey[];

/**
 * Key-value pair for building query ranges.
 */
export type KeyValuePair = {
  eq?: IDBKeyRangeValue;
  gt?: IDBKeyRangeValue;
  gte?: IDBKeyRangeValue;
  lt?: IDBKeyRangeValue;
  lte?: IDBKeyRangeValue;
};

/**
 * Input type for record operations, allowing wrapped records with explicit keys.
 */
export type RecordInput<T> = { item: T; key?: IDBValidKey } | T | T[];

/**
 * Options for query execution.
 */
export interface OptionsKeyValuePair<T> extends KeyValuePair {
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
export interface IDBDatabaseStates extends IDBDatabase {
  isClosed: boolean;
}
