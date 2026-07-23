# fluent-idb

[![npm version](https://img.shields.io/npm/v/fluent-idb.svg)](https://www.npmjs.com/package/fluent-idb)
[![license](https://img.shields.io/npm/l/fluent-idb.svg)](https://github.com/qwars/fluent-idb/blob/main/LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/fluent-idb)](https://bundlephobia.com/package/fluent-idb)

A lightweight, type-safe wrapper over IndexedDB featuring a fluent API, batch processing, built-in gzip compression, and reliable automatic schema migrations.

## ✨ Why `fluent-idb`?

Native IndexedDB is powerful but verbose and prone to errors when managing transactions, versions, and cursors. `fluent-idb` solves these problems by providing:

- **Fluent API**: Intuitive method chaining for complex queries (e.g., `.query().range().desc().limit().execute()`).
- **Smart Queue & Batching**: Groups multiple CRUD operations into a single transaction (`queueCreate`, `queueUpdate`, `queueFlush`), drastically reducing I/O overhead.
- **Built-in Compression**: Automatic gzip compression and decompression of large text fields (e.g., document content or JSON) via the browser's native `CompressionStream` API.
- **Type Safety**: Full TypeScript support with strict schema definitions, guaranteeing type correctness for keys and records.
- **Auto-Recovery & Migrations**: Deep integrity checks, automatic schema migrations, and recovery mechanisms to prevent database corruption or locking issues across multiple tabs.

---

## 📦 Installation

```bash
npm install fluent-idb
# or
yarn add fluent-idb
# or
pnpm add fluent-idb
```

---

## 🚀 Quick Start

### 1. Define the Schema and Indexes

The schema is defined using a `Map`. The order and type of elements in the field array are significant:

1. **The first element** is always the `keyPath` (primary key). It must be unique (typically `uuid` or `id`).
2. **Subsequent strings** automatically become regular indexes to accelerate searches.
3. **Arrays of strings** (e.g., `['documentUUID', 'updated']`) create **composite indexes** for complex queries.
4. **Objects with a `compress` flag** (e.g., `{ compress: true, name: 'content' }`) indicate that this field should be automatically compressed on write and decompressed on read.

```typescript
import type { Schema } from "fluent-idb";

export const MY_SCHEMA: Schema = new Map([
  [
    "Documents",
    [
      "uuid", // 1. Primary key (keyPath)
      "updated", // 2. Regular index
      "dealUUID", // 3. Regular index
      "value", // 4. Regular index
      { compress: true, name: "content" }, // 5. Auto-compressed field
    ],
  ],
  [
    "History",
    [
      "uuid", // Primary key
      "updated", // Regular index
      "documentUUID", // Regular index
      "value", // Regular index
      ["documentUUID", "updated"], // Composite index for complex queries
    ],
  ],
]);
```

### 2. Initialize the Database

Use the built-in `getDatabase` function. It handles opening, security checks, and **automatic schema migration** (adds new tables/indexes or removes obsolete ones when the version changes).

```typescript
import { getDatabase, FluentTable } from "fluent-idb";

// Connect and migrate if necessary (version 1)
const db = await getDatabase("my_app_db", 1);

// Initialize a strictly typed table instance
const documentsTable = new FluentTable<"Documents">("Documents", db);
```

---

## 📝 CRUD Operations

### Create

```typescript
// Single record creation
await documentsTable.create({
  uuid: "123e4567-e89b-12d3-a456-426614174000",
  dealUUID: "deal-999",
  content:
    "Very long text that will be automatically compressed before writing to DB...",
  updated: new Date(),
  value: { status: "draft" },
});

// Batch creation (in a single transaction)
await documentsTable.add(
  { uuid: "1", content: "Doc 1", updated: new Date() },
  { uuid: "2", content: "Doc 2", updated: new Date() },
);
```

### Read

```typescript
// 1. Read by primary key (fastest method)
const doc = await documentsTable.get("123e4567-e89b-12d3-a456-426614174000");
// The `content` field will be automatically decompressed into a string.

// 2. Read by range condition
const firstMatch = await documentsTable.get({
  gte: "deal-500",
  lte: "deal-999",
});
```

### Update / Upsert

```typescript
// Updates an existing record or creates a new one if the key doesn't exist (upsert)
await documentsTable.update({
  uuid: "123e4567-e89b-12d3-a456-426614174000",
  value: { status: "approved" }, // Other fields (e.g., content) are preserved unless explicitly overwritten via put
});

// Alternative: `put` for complete record replacement
await documentsTable.put({
  uuid: "123e4567-e89b-12d3-a456-426614174000",
  content: "Completely new content",
  updated: new Date(),
});
```

### Delete

```typescript
// 1. Delete by primary key
await documentsTable.delete({ uuid: "123e4567-e89b-12d3-a456-426614174000" });
// or simply: await documentsTable.remove("123e4567-e89b-12d3-a456-426614174000");

// 2. Delete by range (immediate, bypassing the queue)
await documentsTable.remove({ gte: "2023-01-01", lt: "2024-01-01" });

// 3. Clear the entire table
await documentsTable.clear();
```

---

## 🔍 Advanced Queries (Query Builder)

The Fluent API allows you to build complex queries with filtering, sorting, and pagination, leveraging the defined indexes.

```typescript
// Example 1: Get the 10 most recently updated documents from the last week
const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

const recentDocs = await documentsTable
  .query("updated") // Use the 'updated' index
  .range({ gte: oneWeekAgo })
  .desc() // Sort descending (newest first)
  .limit(0, 10) // Skip 0, take 10 (pagination)
  .execute(); // Returns an array of decompressed records

// Example 2: Count records in a range (much faster than execute().length)
const count = await documentsTable
  .query("dealUUID")
  .range({ eq: "deal-999" })
  .count();

// Example 3: Fetch only keys (saves memory by not loading the actual data)
const keys = await documentsTable
  .query("updated")
  .range({ gte: oneWeekAgo })
  .keys() // Specify that only keys are needed
  .limit(0, 100)
  .executeKeys();

// Example 4: Unique values via composite index
const uniqueHistory = await historyTable
  .query(["documentUUID", "updated"])
  .distinct() // Returns only unique combinations
  .execute();
```

---

## 🗜️ Built-in Compression

The library automatically compresses fields marked in the schema as `{ compress: true, name: 'fieldName' }`.

- **How it works**: When calling `create`, `update`, or `queueFlush`, the string value of the field is converted into a `Uint8Array` using the browser's native `CompressionStream('gzip')`. Upon reading (`get`, `execute`), it is seamlessly decompressed via `DecompressionStream`.
- **Why it matters**: Perfect for storing large text blocks, HTML content, or serialized JSON objects, saving up to 70–90% of space in the IndexedDB quota.
- **Requirements**: Supported in all modern browsers (Chrome 80+, Firefox 113+, Safari 16.4+). In older environments, the field is saved as-is (graceful degradation).

---

## ⚡ High-Performance Queue (Batching)

Every individual operation in IndexedDB creates a new transaction, which is slow for bulk operations. `fluent-idb` provides a smart queue that groups changes.

```typescript
// 1. Disable automatic flushing for manual control over large batches
documentsTable.queueSetAutoFlush(false);

// 2. Accumulate operations (they are NOT executed immediately)
for (let i = 0; i < 1000; i++) {
  documentsTable.queueUpdate({
    uuid: `doc-${i}`,
    value: { status: "processed" },
    updated: new Date(),
  });

  // Smart optimization: if you call queueDelete for the same key,
  // the previous create/update operation is automatically canceled before flush.
}

// 3. Execute all 1000 operations in a SINGLE readwrite transaction
await documentsTable.queueFlush();

// 4. (Optional) Re-enable auto-flush for standard operations
documentsTable.queueSetAutoFlush(true);
```

---

## ⚙️ Compatibility & Migrations

- **Browsers**: Modern browsers with support for IndexedDB and the `CompressionStream` API.
- **Frameworks**: Fully compatible with React, Vue, Svelte, Vite, Imba, and vanilla JS/TS.
- **Migrations**: When you update `MY_SCHEMA` and increment the version in `getDatabase("my_app_db", 2)`, the library automatically:
  1. Creates new tables or indexes.
  2. Removes obsolete indexes not present in the new schema.
  3. Performs data "normalization": adds missing fields to existing records with default values to prevent `undefined` errors.

---

## 📄 License

MIT © [Alexandr Selunin](mailto:aka.qwars@gmail.com)
