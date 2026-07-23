/**
 * @fileoverview Public API for fluent-idb
 * @description Type-safe, fluent API wrapper for IndexedDB with batching and compression.
 *
 * @example
 * ```typescript
 * import {
 *   getDatabase,
 *   FluentTable,
 *   type Schema,
 *   type FluentConfig
 * } from 'fluent-idb';
 *
 * const mySchema: Schema = new Map([
 *   ['users', ['id', 'name', 'email']]
 * ]);
 *
 * const config: FluentConfig = {
 *   schema: mySchema,
 *   defaultValues: { name: 'Unknown', email: '' },
 *   debug: true
 * };
 *
 * async function init() {
 *   const db = await getDatabase('my_app_db', 1, config);
 *   const usersTable = new FluentTable<User>('users', db, config);
 *
 *   await usersTable.create({ id: '1', name: 'Alice', email: 'alice@example.com' });
 *
 *   const recentUsers = await usersTable
 *     .query('name')
 *     .range({ gte: 'A' })
 *     .asc()
 *     .limit(0, 10)
 *     .execute();
 * }
 * ```
 */

// ============================================================================
// CLASSES
// ============================================================================
export { FluentTable } from "./indexed-db";
export { FluentQueryBuilder } from "./indexed-db";

// ============================================================================
// FUNCTIONS
// ============================================================================
export {
  getDatabase,
  migrateDatabaseSchema,
  compressRecord,
  decompressRecord,
} from "./indexed-db";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================
export type {
  TableName,
  SchemaField,
  Schema,
  RecordItem,
  OperationType,
  Operation,
  IDBKeyRangeValue,
  KeyValuePair,
  RecordInput,
  OptionsKeyValuePair,
  IDBDatabaseStates,
} from "./types";

// Re-export FluentConfig explicitly if it was defined in indexed-db.ts,
// but to keep types centralized, let's ensure it's exported from types.ts or here.
// Since FluentConfig was defined in indexed-db.ts, we export it from there:
export type { FluentConfig } from "./indexed-db";

// ============================================================================
// CONSTANTS
// ============================================================================
export { TRANSACTION_MODES, RETEST_KEY_RANGES } from "./constants";
