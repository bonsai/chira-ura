// chira-ura actions: 箱 (boxes) と 紙 (notes), plus the JSONL lifeline.
//
// The JSONL format is the artifact's promise of permanence: one JSON object
// per line — {"uid","body","box","created_at","updated_at","deleted_at"} —
// the same shape chira-ura has always used (text = one pane = one prompt).
// Export writes every note including trashed ones (with deleted_at set) so
// nothing is silently lost; import upserts by uid and never deletes.

import { defineAction, z, type ActionsModule } from "@hatch/space-sdk";
import { asc, desc, eq, isNotNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import * as schema from "./schema";

const boxColor = z.enum(["sage", "sky", "sand", "rose", "plain"]);
const boxZone = z.enum(["work", "wiki"]);

const boxOut = z.object({
  id: z.number(),
  name: z.string(),
  color: boxColor,
  hidden: z.boolean(),
  zone: boxZone,
  note_count: z.number(),
});

/* UI-18 (supersedes the UI-10〜UI-17 caps and naming): the 机 (desk,
   the work zone) holds at most 8 objects — up to 6 visible colored
   boxes (▢) plus the two fixed objects ◽️箱なし and ◼️ゴミ箱. The
   棚 (shelf, the wiki zone) holds everything else and is uncapped;
   hidden boxes belong to the shelf too (hidden is a state within the
   shelf, not a separate place). Only the desk's colored-box count is
   capped, enforced here. */
const DESK_BOXES_MAX = 6;
const DESK_FULL_MESSAGE = "箱はいっぱいです（机の▢箱は6つまで）";

function shelfCapError(
  rows: { zone: string; hidden: boolean; id: number }[],
  zone: "work" | "wiki",
  exceptId?: number,
): string | null {
  if (zone !== "work") return null;
  const onDesk = rows.filter(
    (b) => b.zone === "work" && !b.hidden && b.id !== exceptId,
  ).length;
  if (onDesk < DESK_BOXES_MAX) return null;
  return DESK_FULL_MESSAGE;
}

const noteOut = z.object({
  uid: z.string(),
  body: z.string(),
  box_id: z.number().nullable(),
  box_name: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const okResponse = z.object({ ok: z.literal(true) });

function newUid(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `n_${Date.now().toString(36)}${rand}`;
}

export const Actions = {
  getState: defineAction({
    description:
      "Returns all boxes with live note counts (in saved pane order, hidden flag included), all live notes (newest first), the trashed notes, and the trash pseudo-box's position in the pane.",
    request: z.object({}),
    response: z.object({
      boxes: z.array(boxOut),
      notes: z.array(noteOut),
      trash: z.array(noteOut),
      trash_index: z.number(),
      layout_version: z.number(),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const boxRows = await db
        .select()
        .from(schema.boxes)
        .orderBy(asc(schema.boxes.sortOrder), asc(schema.boxes.id));
      const metaRows = await db.select().from(schema.meta);
      const trashRaw = metaRows.find((m) => m.key === "trash_index")?.value;
      const trashParsed = trashRaw != null ? Number.parseInt(trashRaw, 10) : NaN;
      const trashIndex = Number.isNaN(trashParsed)
        ? boxRows.length
        : Math.min(Math.max(trashParsed, 0), boxRows.length);
      const layoutRaw = metaRows.find((m) => m.key === "layout_version")?.value;
      const layoutParsed = layoutRaw != null ? Number.parseInt(layoutRaw, 10) : NaN;
      const layoutVersion = Number.isNaN(layoutParsed) ? 0 : layoutParsed;
      const noteRows = await db
        .select()
        .from(schema.notes)
        .orderBy(desc(schema.notes.createdAt), desc(schema.notes.id));

      const nameById = new Map(boxRows.map((b) => [b.id, b.name]));
      const counts = new Map<number, number>();
      for (const n of noteRows) {
        if (n.deletedAt == null && n.boxId != null) {
          counts.set(n.boxId, (counts.get(n.boxId) ?? 0) + 1);
        }
      }
      const toOut = (n: (typeof noteRows)[number]): z.infer<typeof noteOut> => ({
        uid: n.uid,
        body: n.body,
        box_id: n.boxId,
        box_name: n.boxId != null ? (nameById.get(n.boxId) ?? null) : null,
        created_at: n.createdAt.toISOString(),
        updated_at: n.updatedAt.toISOString(),
      });
      return {
        boxes: boxRows.map((b) => ({
          id: b.id,
          name: b.name,
          color: b.color,
          hidden: b.hidden,
          zone: b.zone,
          note_count: counts.get(b.id) ?? 0,
        })),
        notes: noteRows.filter((n) => n.deletedAt == null).map(toOut),
        trash: noteRows.filter((n) => n.deletedAt != null).map(toOut),
        trash_index: trashIndex,
        layout_version: layoutVersion,
      };
    },
  }),

  addNote: defineAction({
    description: "Files a new paper slip with the given body into a box (or the desk when box_id is null).",
    request: z.object({
      body: z.string().min(1).max(100000),
      box_id: z.number().int().positive().nullable().default(null),
    }),
    response: z.object({ uid: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const uid = newUid();
      await db.insert(schema.notes).values({ uid, body: args.body, boxId: args.box_id });
      ctx.invalidateQueries();
      return { uid };
    },
  }),

  updateNote: defineAction({
    description: "Rewrites the body of one note and bumps its updated_at.",
    request: z.object({ uid: z.string().min(1), body: z.string().min(1).max(100000) }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db
        .update(schema.notes)
        .set({ body: args.body, updatedAt: new Date() })
        .where(eq(schema.notes.uid, args.uid));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  moveNote: defineAction({
    description: "Moves one note to another box, or back to the desk when box_id is null.",
    request: z.object({
      uid: z.string().min(1),
      box_id: z.number().int().positive().nullable(),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db
        .update(schema.notes)
        .set({ boxId: args.box_id, updatedAt: new Date() })
        .where(eq(schema.notes.uid, args.uid));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  trashNote: defineAction({
    description: "Throws one note into the trash (soft delete; it stays in JSONL exports with deleted_at set).",
    request: z.object({ uid: z.string().min(1) }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const now = new Date();
      await db
        .update(schema.notes)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(schema.notes.uid, args.uid));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  restoreNote: defineAction({
    description: "Pulls one note back out of the trash.",
    request: z.object({ uid: z.string().min(1) }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db
        .update(schema.notes)
        .set({ deletedAt: null, updatedAt: new Date() })
        .where(eq(schema.notes.uid, args.uid));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  purgeTrash: defineAction({
    description: "Permanently deletes every trashed note. The only destructive action in chira-ura.",
    request: z.object({}),
    response: z.object({ purged: z.number() }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const gone = await db
        .delete(schema.notes)
        .where(isNotNull(schema.notes.deletedAt))
        .returning({ id: schema.notes.id });
      ctx.invalidateQueries();
      return { purged: gone.length };
    },
  }),

  createBox: defineAction({
    description:
      "Creates a new box with a name and a washi-tape color, on the 机 (work) by default or on the 棚 (wiki). The desk holds at most 6 visible colored boxes (8 objects in total with ◽️箱なし and ◼️ゴミ箱）; the shelf is uncapped.",
    request: z.object({
      name: z.string().min(1).max(60),
      color: boxColor.default("plain"),
      zone: boxZone.default("work"),
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const existing = await db
        .select({ id: schema.boxes.id, zone: schema.boxes.zone, hidden: schema.boxes.hidden })
        .from(schema.boxes);
      const capError = shelfCapError(existing, args.zone);
      if (capError) throw new Error(capError);
      const inserted = await db
        .insert(schema.boxes)
        .values({
          name: args.name,
          color: args.color,
          zone: args.zone,
          sortOrder: existing.length,
        })
        .returning({ id: schema.boxes.id });
      const row = inserted[0];
      if (!row) throw new Error("createBox: insert returned no rows");
      ctx.invalidateQueries();
      return { id: row.id };
    },
  }),

  renameBox: defineAction({
    description: "Renames a box and/or changes its washi-tape color.",
    request: z.object({
      id: z.number().int().positive(),
      name: z.string().min(1).max(60),
      color: boxColor,
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db
        .update(schema.boxes)
        .set({ name: args.name, color: args.color })
        .where(eq(schema.boxes.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deleteBox: defineAction({
    description: "Removes a box; its notes fall back onto the desk (they are never deleted with the box).",
    request: z.object({ id: z.number().int().positive() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const detach = db
        .update(schema.notes)
        .set({ boxId: null })
        .where(eq(schema.notes.boxId, args.id));
      const remove = db.delete(schema.boxes).where(eq(schema.boxes.id, args.id));
      await db.batch([detach, remove]);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  exportJsonl: defineAction({
    description:
      "Exports every note (including trashed) as JSONL text: one JSON object per line with uid, body, box name, created_at, updated_at, deleted_at.",
    request: z.object({}),
    response: z.object({ jsonl: z.string(), count: z.number() }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const boxRows = await db.select().from(schema.boxes);
      const nameById = new Map(boxRows.map((b) => [b.id, b.name]));
      const rows = await db
        .select()
        .from(schema.notes)
        .orderBy(asc(schema.notes.createdAt), asc(schema.notes.id));
      const lines = rows.map((n) =>
        JSON.stringify({
          uid: n.uid,
          body: n.body,
          box: n.boxId != null ? (nameById.get(n.boxId) ?? null) : null,
          created_at: n.createdAt.toISOString(),
          updated_at: n.updatedAt.toISOString(),
          deleted_at: n.deletedAt ? n.deletedAt.toISOString() : null,
        }),
      );
      return { jsonl: lines.join("\n"), count: rows.length };
    },
  }),

  importJsonl: defineAction({
    description:
      "Imports JSONL text (one note object per line), upserting by uid; boxes named in the file are created when missing (hidden when hidden_new_boxes is set, e.g. for sync imports). Never deletes anything.",
    request: z.object({
      jsonl: z.string().max(20_000_000),
      hidden_new_boxes: z.boolean().default(false),
    }),
    response: z.object({
      imported: z.number(),
      created_boxes: z.number(),
      skipped: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const boxRows = await db.select().from(schema.boxes);
      const idByName = new Map(boxRows.map((b) => [b.name, b.id]));
      let nextSort = boxRows.length;
      let createdBoxes = 0;

      type Parsed = {
        uid: string;
        body: string;
        box: string | null;
        created_at: Date;
        updated_at: Date;
        deleted_at: Date | null;
      };
      const parsed: Parsed[] = [];
      let skipped = 0;
      for (const rawLine of args.jsonl.split("\n")) {
        const line = rawLine.trim();
        if (!line) continue;
        try {
          const obj = JSON.parse(line) as Record<string, unknown>;
          const body = typeof obj.body === "string" ? obj.body : null;
          if (body == null || body.length === 0) {
            skipped++;
            continue;
          }
          const asDate = (v: unknown, fallback: Date): Date => {
            if (typeof v === "string") {
              const d = new Date(v);
              if (!Number.isNaN(d.getTime())) return d;
            }
            return fallback;
          };
          const now = new Date();
          const created = asDate(obj.created_at, now);
          parsed.push({
            uid: typeof obj.uid === "string" && obj.uid ? obj.uid : newUid(),
            body,
            box: typeof obj.box === "string" && obj.box ? obj.box : null,
            created_at: created,
            updated_at: asDate(obj.updated_at, created),
            deleted_at:
              typeof obj.deleted_at === "string" ? asDate(obj.deleted_at, now) : null,
          });
        } catch {
          skipped++;
        }
      }

      // Create any boxes the file names that we don't have yet.
      for (const p of parsed) {
        if (p.box != null && !idByName.has(p.box)) {
          const inserted = await db
            .insert(schema.boxes)
            .values({
              name: p.box,
              color: "plain",
              sortOrder: nextSort++,
              hidden: args.hidden_new_boxes,
              // Sync-style imports (hidden) land on the WIKI side (UI-11).
              zone: args.hidden_new_boxes ? ("wiki" as const) : ("work" as const),
            })
            .returning({ id: schema.boxes.id });
          const row = inserted[0];
          if (row) {
            idByName.set(p.box, row.id);
            createdBoxes++;
          }
        }
      }

      let imported = 0;
      for (const p of parsed) {
        const boxId = p.box != null ? (idByName.get(p.box) ?? null) : null;
        const existing = await db
          .select({ id: schema.notes.id })
          .from(schema.notes)
          .where(eq(schema.notes.uid, p.uid))
          .limit(1);
        if (existing.length > 0) {
          await db
            .update(schema.notes)
            .set({
              body: p.body,
              boxId,
              createdAt: p.created_at,
              updatedAt: p.updated_at,
              deletedAt: p.deleted_at,
            })
            .where(eq(schema.notes.uid, p.uid));
        } else {
          await db.insert(schema.notes).values({
            uid: p.uid,
            body: p.body,
            boxId,
            createdAt: p.created_at,
            updatedAt: p.updated_at,
            deletedAt: p.deleted_at,
          });
        }
        imported++;
      }
      ctx.invalidateQueries();
      return { imported, created_boxes: createdBoxes, skipped };
    },
  }),

  reorderBoxes: defineAction({
    description:
      "Saves the left-pane order: box_ids lists every box in display order (hidden boxes not listed keep their relative order after the listed ones), and trash_index is the trash pseudo-box's position among those boxes.",
    request: z.object({
      box_ids: z.array(z.number().int().positive()).max(10000),
      trash_index: z.number().int().min(0),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const all = await db
        .select({ id: schema.boxes.id })
        .from(schema.boxes)
        .orderBy(asc(schema.boxes.sortOrder), asc(schema.boxes.id));
      const listed = new Set(args.box_ids);
      const tail = all.map((b) => b.id).filter((id) => !listed.has(id));
      const order = [...args.box_ids, ...tail];
      const statements: BatchItem<"sqlite">[] = order.map((id, i) =>
        db.update(schema.boxes).set({ sortOrder: i }).where(eq(schema.boxes.id, id)),
      );
      statements.push(
        db
          .insert(schema.meta)
          .values({ key: "trash_index", value: String(args.trash_index) })
          .onConflictDoUpdate({
            target: schema.meta.key,
            set: { value: String(args.trash_index) },
          }),
      );
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  setBoxHidden: defineAction({
    description:
      "Shows or hides one box (UI-18: every object toggles). A hidden box sits on the 棚 (shelf) — hiding never deletes the box or its paper. Showing a work box puts it back on the 机， which holds at most 6 visible colored boxes.",
    request: z.object({
      id: z.number().int().positive(),
      hidden: z.boolean(),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      if (!args.hidden) {
        // Putting a box back out respects its zone's cap.
        const rows = await db
          .select({ id: schema.boxes.id, zone: schema.boxes.zone, hidden: schema.boxes.hidden })
          .from(schema.boxes);
        const self = rows.find((b) => b.id === args.id);
        if (self) {
          const capError = shelfCapError(rows, self.zone, args.id);
          if (capError) throw new Error(capError);
        }
      }
      await db
        .update(schema.boxes)
        .set({ hidden: args.hidden })
        .where(eq(schema.boxes.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  setBoxZone: defineAction({
    description:
      "Moves one box between the two places: 机 (work) and 棚 (wiki). The box lands in the destination place (hidden is cleared), respecting the desk cap of 6 visible colored boxes; the shelf is uncapped.",
    request: z.object({
      id: z.number().int().positive(),
      zone: boxZone,
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      {
        const rows = await db
          .select({ id: schema.boxes.id, zone: schema.boxes.zone, hidden: schema.boxes.hidden })
          .from(schema.boxes);
        const capError = shelfCapError(rows, args.zone, args.id);
        if (capError) throw new Error(capError);
      }
      await db
        .update(schema.boxes)
        .set({ zone: args.zone, hidden: false })
        .where(eq(schema.boxes.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  applyLayout: defineAction({
    description:
      "One-time UI-10/UI-11 layout migration, idempotent via the layout_version meta flag: the five hand boxes (設計相談 / handoverbod / サブちゃんストーリー / pwa / kaggle) go on the 机 (work) shelf in that order, and every wiki* box moves to the 棚 (wiki) zone's 引き出し (hidden). No notes are touched.",
    request: z.object({ version: z.number().int().min(1) }),
    response: z.object({ applied: z.boolean(), moved: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const metaRows = await db.select().from(schema.meta);
      const raw = metaRows.find((m) => m.key === "layout_version")?.value;
      const current = raw != null ? Number.parseInt(raw, 10) : 0;
      if (!Number.isNaN(current) && current >= args.version) {
        return { applied: false, moved: 0 };
      }
      const WORKING = ["設計相談", "handoverbod", "サブちゃんストーリー", "pwa", "kaggle"];
      const boxRows = await db
        .select()
        .from(schema.boxes)
        .orderBy(asc(schema.boxes.sortOrder), asc(schema.boxes.id));
      const rank = (name: string): number => {
        const i = WORKING.indexOf(name);
        return i >= 0 ? i : WORKING.length + boxRows.findIndex((b) => b.name === name);
      };
      const ordered = [...boxRows].sort((a, b) => rank(a.name) - rank(b.name));
      let moved = 0;
      const statements: BatchItem<"sqlite">[] = ordered.map((b, i) => {
        const isWorking = WORKING.includes(b.name);
        const isWiki = b.name.startsWith("wiki");
        if (isWiki) moved++;
        return db
          .update(schema.boxes)
          .set({
            sortOrder: i,
            zone: isWiki ? ("wiki" as const) : ("work" as const),
            hidden: isWorking ? false : isWiki ? true : b.hidden,
          })
          .where(eq(schema.boxes.id, b.id));
      });
      statements.push(
        db
          .insert(schema.meta)
          .values({ key: "layout_version", value: String(args.version) })
          .onConflictDoUpdate({
            target: schema.meta.key,
            set: { value: String(args.version) },
          }),
      );
      const [first, ...rest] = statements;
      if (first) await db.batch([first, ...rest]);
      ctx.invalidateQueries();
      return { applied: true, moved };
    },
  }),

  purgeNote: defineAction({
    description: "Permanently deletes one single trashed note (unlike purgeTrash, which empties the whole trash).",
    request: z.object({ uid: z.string().min(1) }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db
        .delete(schema.notes)
        .where(eq(schema.notes.uid, args.uid));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  exportBox: defineAction({
    description:
      "Exports one box's notes (including its trashed ones) as JSONL in the same line format as exportJsonl, so the file can be taken elsewhere and brought back with importBox.",
    request: z.object({ box_id: z.number().int().positive() }),
    response: z.object({ jsonl: z.string(), count: z.number(), name: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const boxRows = await db
        .select()
        .from(schema.boxes)
        .where(eq(schema.boxes.id, args.box_id))
        .limit(1);
      const box = boxRows[0];
      if (!box) throw new Error("exportBox: box not found");
      const rows = await db
        .select()
        .from(schema.notes)
        .where(eq(schema.notes.boxId, args.box_id))
        .orderBy(asc(schema.notes.createdAt), asc(schema.notes.id));
      const lines = rows.map((n) =>
        JSON.stringify({
          uid: n.uid,
          body: n.body,
          box: box.name,
          created_at: n.createdAt.toISOString(),
          updated_at: n.updatedAt.toISOString(),
          deleted_at: n.deletedAt ? n.deletedAt.toISOString() : null,
        }),
      );
      return { jsonl: lines.join("\n"), count: rows.length, name: box.name };
    },
  }),

  importBox: defineAction({
    description:
      "Brings one file in as a new box. JSONL content (one note object per line) is upserted by uid into the box; any other text (txt/md/csv/yaml…) is split into paper — CSV by line, other text by blank-line paragraphs. The box name comes from the file's own box field, else suggested_name, else a default.",
    request: z.object({
      content: z.string().min(1).max(20_000_000),
      suggested_name: z.string().max(120).optional(),
      format: z.enum(["jsonl", "text", "csv"]).default("text"),
      hidden: z.boolean().default(false),
      zone: boxZone.default("wiki"),
    }),
    response: z.object({
      box_id: z.number(),
      name: z.string(),
      imported: z.number(),
      skipped: z.number(),
      format: z.enum(["jsonl", "text", "csv"]),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();

      type Parsed = {
        uid: string;
        body: string;
        box: string | null;
        created_at: Date;
        updated_at: Date;
        deleted_at: Date | null;
      };
      const parsed: Parsed[] = [];
      let skipped = 0;
      let format = args.format;
      const now = new Date();

      if (format === "jsonl") {
        for (const rawLine of args.content.split("\n")) {
          const line = rawLine.trim();
          if (!line) continue;
          try {
            const obj = JSON.parse(line) as Record<string, unknown>;
            if (typeof obj.body !== "string" || obj.body.length === 0) {
              skipped++;
              continue;
            }
            const asDate = (v: unknown, fallback: Date): Date => {
              if (typeof v === "string") {
                const d = new Date(v);
                if (!Number.isNaN(d.getTime())) return d;
              }
              return fallback;
            };
            const created = asDate(obj.created_at, now);
            parsed.push({
              uid: typeof obj.uid === "string" && obj.uid ? obj.uid : newUid(),
              body: obj.body,
              box: typeof obj.box === "string" && obj.box ? obj.box : null,
              created_at: created,
              updated_at: asDate(obj.updated_at, created),
              deleted_at:
                typeof obj.deleted_at === "string" ? asDate(obj.deleted_at, now) : null,
            });
          } catch {
            skipped++;
          }
        }
        // A ".jsonl" file with no parseable note lines is really plain text.
        if (parsed.length === 0) format = "text";
      }
      if (format !== "jsonl") {
        const chunks =
          format === "csv"
            ? args.content.split(/\r?\n/)
            : args.content.split(/\r?\n\s*\r?\n/);
        for (const chunk of chunks) {
          const body = chunk.trim();
          if (!body) continue;
          parsed.push({
            uid: newUid(),
            body,
            box: null,
            created_at: now,
            updated_at: now,
            deleted_at: null,
          });
        }
      }

      const embeddedName = parsed.find((p) => p.box != null)?.box ?? null;
      let name = (embeddedName ?? args.suggested_name ?? "取り入れた箱").slice(0, 60);
      const existingNames = new Set(
        (await db.select({ name: schema.boxes.name }).from(schema.boxes)).map(
          (b) => b.name,
        ),
      );
      if (existingNames.has(name)) {
        let n = 2;
        while (existingNames.has(`${name} ${n}`)) n++;
        name = `${name} ${n}`;
      }

      const boxCount = (await db.select({ id: schema.boxes.id }).from(schema.boxes)).length;
      const insertedBox = await db
        .insert(schema.boxes)
        .values({
          name,
          color: "plain",
          sortOrder: boxCount,
          hidden: args.hidden,
          zone: args.zone,
        })
        .returning({ id: schema.boxes.id });
      const boxRow = insertedBox[0];
      if (!boxRow) throw new Error("importBox: box insert returned no rows");
      const boxId = boxRow.id;

      let imported = 0;
      for (const p of parsed) {
        const existing = await db
          .select({ id: schema.notes.id })
          .from(schema.notes)
          .where(eq(schema.notes.uid, p.uid))
          .limit(1);
        if (existing.length > 0) {
          await db
            .update(schema.notes)
            .set({
              body: p.body,
              boxId,
              createdAt: p.created_at,
              updatedAt: p.updated_at,
              deletedAt: p.deleted_at,
            })
            .where(eq(schema.notes.uid, p.uid));
        } else {
          await db.insert(schema.notes).values({
            uid: p.uid,
            body: p.body,
            boxId,
            createdAt: p.created_at,
            updatedAt: p.updated_at,
            deletedAt: p.deleted_at,
          });
        }
        imported++;
      }
      ctx.invalidateQueries();
      return { box_id: boxId, name, imported, skipped, format };
    },
  }),

} satisfies ActionsModule;
