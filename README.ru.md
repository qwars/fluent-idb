# fluent-idb

[![npm version](https://img.shields.io/npm/v/fluent-idb.svg)](https://www.npmjs.com/package/fluent-idb)
[![license](https://img.shields.io/npm/l/fluent-idb.svg)](https://github.com/your-repo/fluent-idb/blob/main/LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/fluent-idb)](https://bundlephobia.com/package/fluent-idb)

Легковесная, типобезопасная обёртка над IndexedDB с поддержкой fluent-API, пакетной обработки (batching), встроенного gzip-сжатия и надёжной автоматической миграции схем.

## ✨ Почему `fluent-idb`?

Нативный IndexedDB мощный, но многословный и подвержен ошибкам при управлении транзакциями, версиями и курсорами. `fluent-idb` решает эти проблемы, предоставляя:

- **Fluent API**: Интуитивные цепочки вызовов для сложных запросов (`.query().range().desc().limit().execute()`).
- **Умная очередь и пакетная обработка**: Группировка множества CRUD-операций в одну транзакцию (`queueCreate`, `queueUpdate`, `queueFlush`), что радикально снижает нагрузку на ввод-вывод.
- **Встроенное сжатие**: Автоматическое gzip-сжатие и распаковка больших текстовых полей (например, содержимого документов или JSON) через нативный `CompressionStream` API браузера.
- **Типобезопасность**: Полноценная поддержка TypeScript со строгим определением схем, гарантирующая корректность типов ключей и записей.
- **Авто-восстановление и миграции**: Глубокие проверки целостности, автоматическая миграция схем при изменении версии и механизмы восстановления для предотвращения повреждения БД или блокировок при работе в нескольких вкладках.

---

## 📦 Установка

```bash
npm install fluent-idb
# или
yarn add fluent-idb
# или
pnpm add fluent-idb
```

---

## 🚀 Быстрый старт

### 1. Определение схемы и индексов

Схема описывается с помощью `Map`. Порядок и тип элементов в массиве полей имеют значение:

1. **Первый элемент** всегда является `keyPath` (первичным ключом, primary key). Он должен быть уникальным (обычно `uuid` или `id`).
2. **Последующие строки** автоматически становятся обычными индексами для ускорения поиска.
3. **Массивы строк** (например, `['documentUUID', 'updated']`) создают **составные индексы** (composite indexes).
4. **Объекты с флагом `compress`** (например, `{ compress: true, name: 'content' }`) указывают, что это поле должно автоматически сжиматься при записи и распаковываться при чтении.

```typescript
import type { Schema } from "fluent-idb";

export const MY_SCHEMA: Schema = new Map([
  [
    "Documents",
    [
      "uuid", // 1. Первичный ключ (keyPath)
      "updated", // 2. Обычный индекс
      "dealUUID", // 3. Обычный индекс
      "value", // 4. Обычный индекс
      { compress: true, name: "content" }, // 5. Поле с автоматическим gzip-сжатием
    ],
  ],
  [
    "History",
    [
      "uuid", // Первичный ключ
      "updated", // Индекс
      "documentUUID", // Индекс
      "value", // Индекс
      ["documentUUID", "updated"], // Составной индекс для сложных выборок
    ],
  ],
]);
```

### 2. Инициализация базы данных

Используйте встроенную функцию `getDatabase`. Она управляет открытием, проверками безопасности и **автоматической миграцией** схемы (добавляет новые таблицы/индексы или удаляет устаревшие при изменении версии).

```typescript
import { getDatabase, FluentTable } from "fluent-idb";

// Подключение и миграция при необходимости (версия 1)
const db = await getDatabase("my_app_db", 1);

// Инициализация экземпляра таблицы с строгой типизацией
const documentsTable = new FluentTable<"Documents">("Documents", db);
```

---

## 📝 CRUD-операции

### Создание (Create)

```typescript
await documentsTable.create({
  uuid: "123e4567-e89b-12d3-a456-426614174000",
  dealUUID: "deal-999",
  content:
    "Очень длинный текст, который будет автоматически сжат перед записью в БД...",
  updated: new Date(),
  value: { status: "draft" },
});

// Массовое создание (в одной транзакции)
await documentsTable.add(
  { uuid: "1", content: "Doc 1", updated: new Date() },
  { uuid: "2", content: "Doc 2", updated: new Date() },
);
```

### Чтение (Read)

```typescript
// 1. Чтение по первичному ключу (самый быстрый способ)
const doc = await documentsTable.get("123e4567-e89b-12d3-a456-426614174000");
// Поле `content` будет автоматически распаковано в строку.

// 2. Чтение по условию (диапазону)
const firstMatch = await documentsTable.get({
  gte: "deal-500",
  lte: "deal-999",
});
```

### Обновление (Update / Upsert)

```typescript
// Обновляет существующую запись или создаёт новую, если ключа нет (upsert)
await documentsTable.update({
  uuid: "123e4567-e89b-12d3-a456-426614174000",
  value: { status: "approved" }, // Остальные поля (например, content) сохранятся, если не перезаписываются явно через put
});

// Альтернатива: put для полной замены записи
await documentsTable.put({
  uuid: "123e4567-e89b-12d3-a456-426614174000",
  content: "Полностью новый контент",
  updated: new Date(),
});
```

### Удаление (Delete)

```typescript
// 1. Удаление по первичному ключу
await documentsTable.delete({ uuid: "123e4567-e89b-12d3-a456-426614174000" });
// или просто: await documentsTable.remove("123e4567-e89b-12d3-a456-426614174000");

// 2. Удаление по диапазону (немедленное, без очереди)
await documentsTable.remove({ gte: "2023-01-01", lt: "2024-01-01" });

// 3. Очистка всей таблицы
await documentsTable.clear();
```

---

## 🔍 Продвинутые выборки (Query Builder)

Fluent API позволяет строить сложные запросы с фильтрацией, сортировкой и пагинацией, используя созданные индексы.

```typescript
// Пример 1: Получить 10 последних обновлённых документов за последнюю неделю
const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

const recentDocs = await documentsTable
  .query("updated") // Используем индекс 'updated'
  .range({ gte: oneWeekAgo })
  .desc() // Сортировка по убыванию (сначала новые)
  .limit(0, 10) // Пропустить 0, взять 10 (пагинация)
  .execute(); // Вернёт массив распакованных записей

// Пример 2: Подсчёт количества записей в диапазоне (быстрее, чем execute().length)
const count = await documentsTable
  .query("dealUUID")
  .range({ eq: "deal-999" })
  .count();

// Пример 3: Получение только ключей (экономит память, не загружая сами данные)
const keys = await documentsTable
  .query("updated")
  .range({ gte: oneWeekAgo })
  .keys() // Указываем, что нужны только ключи
  .limit(0, 100)
  .executeKeys();

// Пример 4: Уникальные значения по составному индексу
const uniqueHistory = await historyTable
  .query(["documentUUID", "updated"])
  .distinct() // Вернёт только уникальные комбинации
  .execute();
```

---

## 🗜️ Встроенное сжатие (Compression)

Библиотека автоматически сжимает поля, помеченные в схеме как `{ compress: true, name: 'fieldName' }`.

- **Как это работает**: При вызове `create`, `update` или `queueFlush` строковое значение поля преобразуется в `Uint8Array` с помощью нативного браузерного `CompressionStream('gzip')`. При чтении (`get`, `execute`) происходит обратная распаковка через `DecompressionStream`.
- **Зачем это нужно**: Идеально подходит для хранения больших текстовых блоков, HTML-контента или сериализованных JSON-объектов, позволяя сэкономить до 70-90% места в квоте IndexedDB.
- **Требования**: Поддерживается во всех современных браузерах (Chrome 80+, Firefox 113+, Safari 16.4+). В старых браузерах поле будет сохранено как есть (graceful degradation), но рекомендуется проверять поддержку.

---

## ⚡ Высокопроизводительная очередь (Batching & Queue)

Каждая отдельная операция в IndexedDB создаёт новую транзакцию, что медленно при массовых операциях. `fluent-idb` предоставляет умную очередь, которая группирует изменения.

```typescript
// 1. Отключаем автоматический сброс (по умолчанию он включён с задержкой 100мс)
documentsTable.queueSetAutoFlush(false);

// 2. Накапливаем операции (они не выполняются немедленно)
for (let i = 0; i < 1000; i++) {
  documentsTable.queueUpdate({
    uuid: `doc-${i}`,
    value: { status: "processed" },
    updated: new Date(),
  });

  // Умная оптимизация: если вы вызовете queueDelete для того же ключа,
  // операция создания/обновления будет автоматически отменена до момента flush.
}

// 3. Выполнить все 1000 операций в ОДНОЙ транзакции readwrite
await documentsTable.queueFlush();

// 4. (Опционально) Включаем авто-сброс обратно для обычных операций
documentsTable.queueSetAutoFlush(true);
```

---

## ⚙️ Совместимость и миграции

- **Браузеры**: Современные браузеры с поддержкой IndexedDB и `CompressionStream` API.
- **Фреймворки**: Полностью совместим с React, Vue, Svelte, Vite, Imba и чистым JS/TS.
- **Миграции**: При изменении `MY_SCHEMA` и увеличении версии в `getDatabase("my_app_db", 2)`, библиотека автоматически:
  1. Создаст новые таблицы или индексы.
  2. Удалит устаревшие индексы, которых нет в новой схеме.
  3. Выполнит "нормализацию" данных: добавит недостающие поля в существующие записи со значениями по умолчанию, чтобы избежать ошибок `undefined`.

---

## 📄 Лицензия

MIT © [Alexandr Selunin](mailto:aka.qwars@gmail.com)
