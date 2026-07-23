/**
 * @fileoverview Universal constants for fluent-idb
 */

/**
 * Standard IndexedDB transaction modes.
 */
export const TRANSACTION_MODES: Record<
  Uppercase<IDBTransactionMode>,
  IDBTransactionMode
> = {
  READONLY: "readonly",
  READWRITE: "readwrite",
  VERSIONCHANGE: "versionchange",
} as const;

/**
 * Regular expression to validate combinations of range query operators.
 * Ensures only valid pairs like 'gt-lt', 'gte-lte', etc., are used.
 */
export const RETEST_KEY_RANGES = /^(gt|lt|gte|lte)-(gt|lt|gte|lte)$/;
