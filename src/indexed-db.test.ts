import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";

import {
  getDatabase,
  FluentTable,
  compressRecord,
  decompressRecord,
  type Schema,
  type FluentConfig,
  type KeyValuePair,
  type IDBDatabaseStates,
} from "./index";

interface TestUser {
  id: string;
  name: string;
  age?: number;
}

interface TestDocument {
  uuid: string;
  updated: Date;
  content: string;
}

const testSchema: Schema = new Map([
  ["users", ["id", "name", "age"]],
  ["documents", ["uuid", "updated", { name: "content", compress: true }]],
]);

const testConfig: FluentConfig = {
  schema: testSchema,
  defaultValues: { name: "Unknown", age: 0, content: "" },
  debug: false,
};

describe("FluentIDB Core", () => {
  let db: IDBDatabaseStates;

  beforeEach(async () => {
    const req = indexedDB.deleteDatabase("test_fluent_db_v1");
    await new Promise((resolve) => {
      req.onsuccess = resolve;
      req.onerror = resolve;
    });

    db = await getDatabase("test_fluent_db", 1, testConfig);
  });

  afterEach(() => {
    if (db && !db.isClosed) {
      db.close();
    }
  });

  describe("Инициализация и схема", () => {
    it("должна успешно создать базу данных с правильной схемой", () => {
      expect(db).toBeDefined();
      expect(db.objectStoreNames.contains("users")).toBe(true);
      expect(db.objectStoreNames.contains("documents")).toBe(true);

      const tx = db.transaction("users", "readonly");
      const store = tx.objectStore("users");
      expect(store.indexNames.contains("id")).toBe(true);
      expect(store.indexNames.contains("name")).toBe(true);
    });
  });

  describe("CRUD операции (FluentTable)", () => {
    it("должна создавать и получать запись", async () => {
      const table = new FluentTable<TestUser>("users", db, testConfig);
      const record: TestUser = { id: "user-1", name: "Alice" };

      await table.create(record);

      const result = await table.get({ eq: "user-1" });

      expect(result).toBeDefined();
      expect(result?.name).toBe("Alice");
    });

    it("должна выбрасывать ошибку при создании записи с существующим ключом", async () => {
      const table = new FluentTable<TestUser>("users", db, testConfig);
      await table.create({ id: "user-dup", name: "Alice" });

      await expect(
        table.create({ id: "user-dup", name: "Bob" }),
      ).rejects.toThrow("Duplicate key for create operation");
    });

    it("должна обновлять запись через update", async () => {
      const table = new FluentTable<TestUser>("users", db, testConfig);
      await table.create({ id: "user-2", name: "Bob" });

      await table.update({ id: "user-2", name: "Bob", age: 30 });

      const result = await table.get({ eq: "user-2" });
      expect(result?.age).toBe(30);
      expect(result?.name).toBe("Bob");
    });

    it("должна удалять запись через remove", async () => {
      const table = new FluentTable<TestUser>("users", db, testConfig);
      await table.create({ id: "user-3", name: "Charlie" });

      const deleteCondition: KeyValuePair = { eq: "user-3" };
      await table.remove(deleteCondition);

      const result = await table.get({ eq: "user-3" });
      expect(result).toBeUndefined();
    });
  });

  describe("Fluent Query Builder", () => {
    it("должен фильтровать и сортировать записи", async () => {
      const table = new FluentTable<TestUser>("users", db, testConfig);

      await table.create({ id: "u1", age: 25, name: "A" });
      await table.create({ id: "u2", age: 30, name: "B" });
      await table.create({ id: "u3", age: 35, name: "C" });

      const results = await table
        .query("age")
        .range({ gte: 26, lte: 35 })
        .desc()
        .execute();

      expect(results).toHaveLength(2);
      expect(results[0].age).toBe(35);
      expect(results[1].age).toBe(30);
    });

    it("должен поддерживать limit и offset", async () => {
      const table = new FluentTable<TestUser>("users", db, testConfig);

      await table.create({ id: "u1", age: 10, name: "A" });
      await table.create({ id: "u2", age: 20, name: "B" });
      await table.create({ id: "u3", age: 30, name: "C" });

      const results = await table.query("age").asc().limit(1, 1).execute();

      expect(results).toHaveLength(1);
      expect(results[0].age).toBe(20);
    });
  });

  describe("Очередь операций (Queue / Batching)", () => {
    it("должна объединять операции в одну транзакцию при queueFlush", async () => {
      const table = new FluentTable<TestUser>("users", db, testConfig);

      table.queueSetAutoFlush(false);

      table.queueCreate({ id: "q1", name: "Queue1" });
      table.queueUpdate({ id: "q1", name: "Queue1_Updated", age: 25 });
      table.queueCreate({ id: "q2", name: "Queue2" });
      table.queueDelete({ id: "q2", name: "Queue2" });

      await table.queueFlush();

      const r1 = await table.get({ eq: "q1" });
      const r2 = await table.get({ eq: "q2" });

      expect(r1?.name).toBe("Queue1_Updated");
      expect(r1?.age).toBe(25);
      expect(r2).toBeUndefined();
    });
  });

  describe("Сжатие данных (Compression)", () => {
    it("должна сжимать и распаковывать строку", async () => {
      if (typeof globalThis.CompressionStream === "undefined") {
        console.warn("CompressionStream не поддерживается, тест пропущен");
        return;
      }

      const originalRecord: TestDocument = {
        uuid: "doc-1",
        updated: new Date(),
        content:
          "Очень длинный текст для сжатия, который должен стать меньше в байтах",
      };

      const compressed = await compressRecord(
        "documents",
        originalRecord,
        testSchema,
      );
      expect(compressed.content).toBeInstanceOf(Uint8Array);

      const decompressed = await decompressRecord(
        "documents",
        compressed,
        testSchema,
      );
      expect(decompressed?.content).toBe(
        "Очень длинный текст для сжатия, который должен стать меньше в байтах",
      );
    });
  });
});
