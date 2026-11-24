// chira-ura schema: 箱 (boxes) と 紙 (notes).
// Every note carries a stable string uid so a JSONL export/import round-trip
// preserves identity across devices and tools — the JSONL file is the
// portable canonical record; these tables are its working copy.

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const boxes = sqliteTable("boxes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  color: text("color", {
    enum: ["sage", "sky", "sand", "rose", "plain"],
  })
    .notNull()
    .default("plain"),
  sortOrder: integer("sort_order").notNull().default(0),
  // UI-08: hidden boxes keep their paper but leave the left pane.
  hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
  // UI-18: the two places. "work" = 机 (the desk; at most 6 visible
  // colored boxes — the desk totals 8 objects with the fixed ◽️箱なし
  // and ◼️ゴミ箱）, "wiki" = 棚 (the shelf; everything else lives
  // here, uncapped). Hidden boxes belong to the shelf: hidden is a
  // state within the shelf, not a separate place.
  zone: text("zone", { enum: ["work", "wiki"] }).notNull().default("work"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Small key/value store for pane layout state that is not a box attribute —
// currently just the trash pseudo-box's position in the left pane (UI-04:
// the trash is one of the boxes and takes part in drag reorder).
export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  uid: text("uid").notNull().unique(),
  body: text("body").notNull(),
  boxId: integer("box_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
});
