import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import { api, type ApiResponse } from "./api";

type State = ApiResponse<typeof api, "getState">;
type Box = State["boxes"][number];
type Note = State["notes"][number];
type BoxColor = Box["color"];
type Zone = Box["zone"];

type Selection =
  | { type: "desk" }
  | { type: "box"; id: number }
  | { type: "trash" }
  | { type: "shelf" }
  | { type: "all" };

type Panel = "export" | "import" | null;

/* Drag & drop (UI-02 / UI-04 / UI-10): one pointer-based mechanism for
   paper and boxes alike, so touch and mouse behave the same. Pane rows
   carry data-pane-token attributes ("desk" | "box:<id>" | "trash" |
   "zone:work" | "zone:wiki"); while a drag is in flight we hit-test with
   elementFromPoint. Dropping a box on a place tab swaps it between
   机 and 棚; dropping paper on the 机 tab files it back to ◽️箱なし. */
type DragState =
  | { kind: "note"; uid: string; label: string; fromBoxId: number | null; x: number; y: number }
  | { kind: "box"; token: string; label: string; x: number; y: number };

type DropTarget = { token: string; before?: boolean };

/* UI-18: the whole UI is two kinds of label — objects carry a square
   mark (▢ colored box / ◽️ 箱なし, the box-less paper pile /
   ◼️ ゴミ箱), actions carry an emoji. Places are just two: the 机
   (desk, the work zone) holds at most 8 objects — up to 6 visible
   colored boxes plus ◽️ and ◼️ — and the 棚 (shelf, the wiki zone)
   holds everything else, hidden boxes included (hidden is a state
   within the shelf). Hand-written input is capped at 12 lines
   (imported long paper is exempt — it still displays in full). */
const DESK_BOXES_MAX = 6;
const DESK_OBJECTS_MAX = 8;
const MAX_LINES = 12;

function capNotice(zone: Zone): string {
  return zone === "work"
    ? "▢箱はいっぱいです（机の▢箱は6つまで）"
    : "▢箱はいっぱいです";
}

function cmdClass(active: boolean): string {
  return `font-display border px-3 py-1.5 text-sm font-black ${
    active
      ? "border-[var(--text)] bg-[var(--text)] text-[var(--bg)]"
      : "border-[var(--border)] bg-[var(--surface)]"
  }`;
}

/* UI-12/UI-18: marks distinguish the two kinds of label everywhere —
   action commands carry an emoji (✏書く / 🔍探す / 📤持ち出す /
   📥取り入れる / 🔀並び替える / 📦箱を作る), objects carry a square
   mark (▢ colored box / ◽️ 箱なし / ◼️ ゴミ箱). The box named
   設計相談 is the 交換日記: request paper and result paper alternate
   in it. Only the presentation marks it as a diary; its name and data
   stay untouched. */
const DIARY_BOX_NAME = "設計相談";

const COLORS: { value: BoxColor; label: string }[] = [
  { value: "plain", label: "生成り" },
  { value: "sage", label: "セージ" },
  { value: "sky", label: "空" },
  { value: "sand", label: "砂" },
  { value: "rose", label: "薔薇" },
];

function tapeVar(color: BoxColor): string {
  return `var(--tape-${color})`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `今日 ${time}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/x-ndjson;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* UI-06 default reading: a note's body shows at most 12 lines in the list;
   longer paper opens to full text. */
function isLongBody(body: string): boolean {
  return body.split("\n").length > MAX_LINES || body.length > 720;
}

/* UI-10: hand-written input stops at 12 lines. */
function clampLines(text: string): string {
  const lines = text.split("\n");
  return lines.length > MAX_LINES ? lines.slice(0, MAX_LINES).join("\n") : text;
}

export function App() {
  const queryClient = useQueryClient();
  const state = useQuery({ queryKey: ["state"], queryFn: () => api.getState({}) });

  const [zone, setZone] = useState<Zone>("work");
  const [selection, setSelection] = useState<Selection>({ type: "desk" });
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [sortMode, setSortMode] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["state"] });

  const trashMut = useMutation({
    mutationFn: async (uid: string) => await api.trashNote({ uid }),
    onSuccess: invalidate,
  });
  const restoreMut = useMutation({
    mutationFn: async (uid: string) => await api.restoreNote({ uid }),
    onSuccess: invalidate,
  });
  const moveMut = useMutation({
    mutationFn: async (v: { uid: string; box_id: number | null }) =>
      await api.moveNote(v),
    onSuccess: invalidate,
  });
  const purgeMut = useMutation({
    mutationFn: async () => await api.purgeTrash({}),
    onSuccess: invalidate,
  });
  const purgeNoteMut = useMutation({
    mutationFn: async (uid: string) => await api.purgeNote({ uid }),
    onSuccess: invalidate,
  });
  const reorderMut = useMutation({
    mutationFn: async (v: { box_ids: number[]; trash_index: number }) =>
      await api.reorderBoxes(v),
    onSuccess: invalidate,
  });
  const zoneMut = useMutation({
    mutationFn: async (v: { id: number; zone: Zone }) => await api.setBoxZone(v),
    onSuccess: invalidate,
    onError: (_e, v) => setNotice(capNotice(v.zone)),
  });
  const exportAllMut = useMutation({
    mutationFn: async () => await api.exportJsonl({}),
    onSuccess: (data) => {
      const stamp = new Date().toISOString().slice(0, 10);
      downloadText(`chira-ura-${stamp}.jsonl`, data.jsonl);
      setNotice(`全部の▢紙・手紙 ${data.count}枚を📤持ち出しました。`);
    },
    onError: () => setNotice("📤持ち出しに失敗しました。"),
  });

  const boxes = state.data?.boxes ?? [];
  const notes = state.data?.notes ?? [];
  const trash = state.data?.trash ?? [];
  const trashIndex = state.data?.trash_index ?? boxes.length;
  /* UI-18: the desk is the work zone's visible boxes (≤6); the shelf
     is everything else — the wiki zone's boxes and every hidden box. */
  const deskBoxes = boxes.filter((b) => b.zone === "work" && !b.hidden);
  const shelfBoxes = boxes.filter((b) => b.zone === "wiki" || b.hidden);
  const tabBoxes = zone === "work" ? deskBoxes : shelfBoxes;
  const deskCount = notes.filter((n) => n.box_id == null).length;
  const shelfIds = useMemo(
    () => new Set(shelfBoxes.map((b) => b.id)),
    [boxes],
  );
  const shelfNoteCount = notes.filter(
    (n) => n.box_id != null && shelfIds.has(n.box_id),
  ).length;

  /* Pane tokens in display order: the current tab's boxes. The trash
     ◼️ is a fixed desk object and is not a reorder token. */
  const paneTokens = useMemo(
    () => tabBoxes.map((b) => `box:${b.id}`),
    [tabBoxes],
  );
  const paneTokensRef = useRef<string[]>(paneTokens);
  paneTokensRef.current = paneTokens;
  const boxesRef = useRef<Box[]>(boxes);
  boxesRef.current = boxes;
  const trashIndexRef = useRef<number>(trashIndex);
  trashIndexRef.current = trashIndex;

  /* UI-10/UI-11 one-time layout: the five hand boxes onto the 机 shelf,
     every wiki* box into the WIKI drawers. Runs once, server-flagged. */
  const layoutMut = useMutation({
    mutationFn: async () => await api.applyLayout({ version: 1 }),
    onSuccess: (d) => {
      if (d.applied) {
        invalidate();
        setNotice(
          `▢箱を分けました（wiki の▢箱 ${d.moved} 個を非表示にしました）。`,
        );
      }
    },
  });
  const layoutTriedRef = useRef(false);
  useEffect(() => {
    if (state.data && state.data.layout_version < 1 && !layoutTriedRef.current) {
      layoutTriedRef.current = true;
      layoutMut.mutate();
    }
    // Runs once when the first state load reports the old layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.data]);

  /* ---------- drag & drop ---------- */
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const targetRef = useRef<DropTarget | null>(null);
  const dragging = drag != null;

  const startDrag = (e: ReactPointerEvent, payload: DragState) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    dragRef.current = payload;
    targetRef.current = null;
    setDropTarget(null);
    setDrag(payload);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (ev: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      const next = { ...cur, x: ev.clientX, y: ev.clientY };
      dragRef.current = next;
      setDrag(next);
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const row = el?.closest<HTMLElement>("[data-pane-token]");
      const token = row?.dataset.paneToken;
      let target: DropTarget | null = null;
      if (token && row) {
        if (next.kind === "note") {
          target = { token };
        } else if (token.startsWith("zone:")) {
          target = { token };
        } else if (token.startsWith("box:") && token !== next.token) {
          const rect = row.getBoundingClientRect();
          target = { token, before: ev.clientY < rect.top + rect.height / 2 };
        }
      }
      targetRef.current = target;
      setDropTarget(target);
    };
    const finish = (commit: boolean) => {
      const cur = dragRef.current;
      const target = targetRef.current;
      dragRef.current = null;
      targetRef.current = null;
      setDrag(null);
      setDropTarget(null);
      if (!commit || !cur || !target) return;
      if (cur.kind === "note") {
        if (target.token === "trash") {
          trashMut.mutate(cur.uid);
        } else if (target.token === "desk" || target.token === "zone:work") {
          if (cur.fromBoxId != null)
            moveMut.mutate({ uid: cur.uid, box_id: null });
        } else if (target.token.startsWith("box:")) {
          const id = Number(target.token.slice(4));
          if (cur.fromBoxId !== id) moveMut.mutate({ uid: cur.uid, box_id: id });
        }
      } else if (target.token.startsWith("zone:")) {
        const id = Number(cur.token.slice(4));
        const z = target.token === "zone:work" ? "work" : "wiki";
        const box = boxesRef.current.find((b) => b.id === id);
        if (box && box.zone !== z) zoneMut.mutate({ id, zone: z });
      } else {
        const tokens = paneTokensRef.current.filter((t) => t !== cur.token);
        let idx = tokens.length;
        const ti = tokens.indexOf(target.token);
        if (ti >= 0) idx = target.before ? ti : ti + 1;
        tokens.splice(idx, 0, cur.token);
        reorderMut.mutate({
          box_ids: tokens
            .filter((t) => t.startsWith("box:"))
            .map((t) => Number(t.slice(4))),
          trash_index: trashIndexRef.current,
        });
      }
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
    // Mutations are stable; the effect only needs to run when a drag starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  /* ---------- places ---------- */
  const switchZone = (z: Zone) => {
    setZone(z);
    setQuery("");
    setSelection(z === "work" ? { type: "desk" } : { type: "shelf" });
  };

  const focusWrite = () => {
    switchZone("work");
    window.setTimeout(() => {
      document.getElementById("capture-hero-desk")?.focus();
    }, 80);
  };

  /* ---------- which paper is on the right ---------- */
  const searching = query.trim().length > 0;
  const selectedBox =
    selection.type === "box" ? (boxes.find((b) => b.id === selection.id) ?? null) : null;

  const visibleNotes = useMemo(() => {
    if (searching) {
      const q = query.trim().toLowerCase();
      return notes.filter(
        (n) =>
          n.body.toLowerCase().includes(q) ||
          (n.box_name ?? "").toLowerCase().includes(q),
      );
    }
    if (selection.type === "desk") return notes.filter((n) => n.box_id == null);
    if (selection.type === "box") return notes.filter((n) => n.box_id === selection.id);
    if (selection.type === "shelf")
      return notes.filter((n) => n.box_id != null && shelfIds.has(n.box_id));
    if (selection.type === "all") return notes;
    return [];
  }, [notes, selection, searching, query, shelfIds]);

  const viewTitle = searching
    ? `「${query.trim()}」の▢紙・手紙`
    : selection.type === "desk"
      ? "◽️箱なし"
      : selection.type === "box"
        ? selectedBox?.name === DIARY_BOX_NAME
          ? `▢交換日記「${selectedBox?.name ?? ""}」`
          : `▢箱「${selectedBox?.name ?? ""}」`
        : selection.type === "trash"
          ? "◼️ゴミ箱"
          : selection.type === "shelf"
            ? "棚の▢紙・手紙"
            : "▢紙・手紙（すべて）";

  /* UI-12: in the 交換日記 box, paper alternates 要望 / 結果 in the
     order it was written (oldest first) — a request, then the reply,
     then the next request. */
  const diaryRoles = useMemo(() => {
    if (selection.type !== "box" || selectedBox?.name !== DIARY_BOX_NAME)
      return null;
    const boxId = selection.id;
    const map = new Map<string, "要望" | "結果">();
    [...notes]
      .filter((n) => n.box_id === boxId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .forEach((n, i) => map.set(n.uid, i % 2 === 0 ? "要望" : "結果"));
    return map;
  }, [notes, selection, selectedBox]);

  const showBoxLabel =
    searching ||
    selection.type === "all" ||
    selection.type === "desk" ||
    selection.type === "shelf";

  /* UI-09: the desk is write-first; a selected box is list-first with a
     writing slip attached at the very end of the list. */
  const isDeskWriteMode = selection.type === "desk" && !searching;
  const isBoxListMode = selection.type === "box" && !searching;
  const isAllListMode = selection.type === "all" && !searching;
  const isShelfHome = selection.type === "shelf" && !searching;

  const exportBoxMut = useMutation({
    mutationFn: async (box: Box) => await api.exportBox({ box_id: box.id }),
    onSuccess: (data) => {
      downloadText(`${data.name.replace(/[/\\]/g, "_")}.jsonl`, data.jsonl);
      setNotice(`▢箱「${data.name}」を📤持ち出しました（${data.count}枚）。`);
    },
    onError: () => setNotice("📤持ち出しに失敗しました。"),
  });

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />

      <div className="mx-auto flex w-full max-w-5xl pr-6">
        <LeftPane
          zone={zone}
          onZoneChange={switchZone}
          tabBoxes={tabBoxes}
          deskBoxCount={deskBoxes.length}
          shelfBoxCount={shelfBoxes.length}
          paneTokens={paneTokens}
          deskCount={deskCount}
          trashCount={trash.length}
          shelfNoteCount={shelfNoteCount}
          selection={selection}
          onSelect={setSelection}
          dropTarget={dropTarget}
          drag={drag}
          onGripDown={startDrag}
          onChanged={invalidate}
          onNotice={setNotice}
          sortMode={sortMode}
          onWrite={focusWrite}
          searchOpen={searchOpen}
          onToggleSearch={() => {
            setSearchOpen((v) => !v);
            if (searchOpen) setQuery("");
          }}
          panel={panel}
          onTogglePanel={(p) => setPanel(panel === p ? null : p)}
          onToggleSort={() => setSortMode((v) => !v)}
          onDeletedBox={(id) => {
            if (selection.type === "box" && selection.id === id)
              setSelection(zone === "work" ? { type: "desk" } : { type: "shelf" });
          }}
        />

        <main className="min-w-0 flex-1 px-3 pb-16 sm:px-4">
          <header className="pt-5 pb-1">
            <h1 className="font-display min-w-0 truncate text-xl font-black">
              {state.isPending ? "チラ裏" : viewTitle}
            </h1>
          </header>

          {searchOpen && (
            <div className="mt-1">
              <label htmlFor="search" className="sr-only">
                メモを探す
              </label>
              <input
                id="search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base outline-none focus:border-[var(--accent)]"
                style={{ borderRadius: "var(--radius)" }}
              />
            </div>
          )}

          {panel === "export" && (
            <section
              aria-label="📤持ち出す"
              className="mt-2 border border-[var(--border)] bg-[var(--surface)] px-3 py-3"
              style={{ borderRadius: "var(--radius)" }}
            >
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => exportAllMut.mutate()}
                  disabled={exportAllMut.isPending}
                  className="font-display bg-[var(--text)] px-4 py-2 text-sm font-black text-[var(--bg)] disabled:opacity-50"
                  style={{ borderRadius: "var(--radius)" }}
                >
                  📤全部の▢紙・手紙を .jsonl で持ち出す
                </button>
                {selectedBox && (
                  <button
                    type="button"
                    onClick={() => exportBoxMut.mutate(selectedBox)}
                    disabled={exportBoxMut.isPending}
                    className="font-display border border-[var(--text)] px-4 py-2 text-sm font-black disabled:opacity-50"
                    style={{ borderRadius: "var(--radius)" }}
                  >
                    📤▢箱「{selectedBox.name}」だけ持ち出す
                  </button>
                )}
              </div>
            </section>
          )}

          {panel === "import" && (
            <ImportPanel
              onImported={invalidate}
              onNotice={setNotice}
              onClose={() => setPanel(null)}
            />
          )}

          {notice && (
            <p role="status" className="mt-2 text-sm font-bold text-[var(--accent)]">
              {notice}
            </p>
          )}

          {/* UI-18: while 🔀並び替える is on, its manager owns every
              object's toggle — the desk's ▢ boxes sit in 6 slots
              (in = on the desk, out = hidden on the shelf) and every
              shelf box toggles between 出す and しまう. ◽️箱なし and
              ◼️ゴミ箱 are fixed desk objects; their positions never
              take part in reordering. */}
          {sortMode && !state.isPending && !state.isError && (
            <SortPanel
              deskSlots={deskBoxes}
              shelfList={shelfBoxes}
              trashIndex={trashIndex}
              onChanged={invalidate}
              onNotice={setNotice}
              onOpenBox={(id) => setSelection({ type: "box", id })}
            />
          )}

          {isDeskWriteMode && (
            <CaptureSlip
              key="capture-desk"
              variant="hero"
              boxId={null}
              boxName={null}
              onSaved={invalidate}
            />
          )}

          {/* UI-12: the 設計相談 box is the 交換日記 — a label strip at
              the top of its list, and each slip inside is chipped
              要望の手紙 / 結果の手紙 in the order the exchange piled up. */}
          {isBoxListMode && selectedBox?.name === DIARY_BOX_NAME && !state.isPending && !state.isError && (
            <div
              className="paper tape mt-5 px-4 pt-6 pb-3"
              style={{ borderRadius: "var(--radius)", ["--tape-color" as string]: "var(--tape-rose)" }}
            >
              <p className="font-display text-sm font-black">▢交換日記</p>
            </div>
          )}

          <section aria-label="メモ" className="mt-6">
            {isDeskWriteMode && !state.isPending && !state.isError && visibleNotes.length > 0 && (
              <p className="font-display px-1 pb-3 text-sm font-bold text-[var(--dim)]">
                ◽️箱なしの▢紙・手紙（{visibleNotes.length}枚）
              </p>
            )}
            {isShelfHome && !state.isPending && !state.isError && visibleNotes.length > 0 && (
              <p className="font-display px-1 pb-3 text-sm font-bold text-[var(--dim)]">
                棚の▢紙・手紙（{visibleNotes.length}枚）
              </p>
            )}
            {state.isPending ? (
              <p className="py-10 text-center text-sm text-[var(--dim)]">
                紙を広げています…
              </p>
            ) : state.isError ? (
              <div className="py-10 text-center">
                <p className="text-sm text-[var(--accent)]">
                  紙が取り出せませんでした。
                </p>
                <button
                  type="button"
                  onClick={() => state.refetch()}
                  className="font-display mt-3 border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-bold"
                  style={{ borderRadius: "var(--radius)" }}
                >
                  もう一度開く
                </button>
              </div>
            ) : selection.type === "trash" && !searching ? (
              <TrashList
                trash={trash}
                onRestore={(uid) => restoreMut.mutate(uid)}
                onPurgeOne={(uid) => purgeNoteMut.mutate(uid)}
                onPurgeAll={() => purgeMut.mutate()}
                purging={purgeMut.isPending}
              />
            ) : visibleNotes.length === 0 ? (
              <div
                className="paper mt-4 px-5 py-10 text-center"
                style={{ borderRadius: "var(--radius)" }}
              >
                <p className="font-display text-lg font-bold">まだ▢紙がありません</p>
              </div>
            ) : (
              <ul className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                {visibleNotes.map((n, i) => (
                  <NoteCard
                    key={n.uid}
                    note={n}
                    boxes={boxes}
                    tilt={i % 2 === 0 ? "-0.4deg" : "0.4deg"}
                    showBoxLabel={showBoxLabel}
                    diaryRole={diaryRoles?.get(n.uid)}
                    sortMode={sortMode}
                    onChanged={invalidate}
                    onTrash={(uid) => trashMut.mutate(uid)}
                    onGripDown={(e, note) =>
                      startDrag(e, {
                        kind: "note",
                        uid: note.uid,
                        label: note.body.split("\n")[0]?.slice(0, 40) ?? "",
                        fromBoxId: note.box_id,
                        x: e.clientX,
                        y: e.clientY,
                      })
                    }
                  />
                ))}
              </ul>
            )}
          </section>

          {/* UI-09: list modes carry their writing slip at the very end,
              so a new paper can be added to the open box without leaving
              the list. The "all" view files its tail slip to the desk. */}
          {!state.isPending && !state.isError && isBoxListMode && selectedBox && (
            <div className="mt-8">
              <p className="font-display px-1 pb-1 text-sm font-bold text-[var(--dim)]">
                {selectedBox.name === DIARY_BOX_NAME
                  ? "✏交換日記の続きを書く"
                  : "✏この▢箱に▢紙・手紙を書き足す"}
              </p>
              <CaptureSlip
                key={`capture-box-${selectedBox.id}`}
                variant="tail"
                boxId={selectedBox.id}
                boxName={selectedBox.name}
                diary={selectedBox.name === DIARY_BOX_NAME}
                onSaved={invalidate}
              />
            </div>
          )}
          {!state.isPending && !state.isError && isAllListMode && (
            <div className="mt-8">
              <p className="font-display px-1 pb-1 text-sm font-bold text-[var(--dim)]">
                ✏新しい▢紙・手紙を書く
              </p>
              <CaptureSlip
                key="capture-all"
                variant="tail"
                boxId={null}
                boxName={null}
                onSaved={invalidate}
              />
            </div>
          )}
        </main>
      </div>

      {/* UI-03: 「すべて」は右端の極薄の帯 */}
      <button
        type="button"
        aria-pressed={selection.type === "all" && !searching}
        aria-label={`すべての▢紙・手紙（${notes.length}枚）`}
        onClick={() => {
          setSelection({ type: "all" });
          setQuery("");
        }}
        className="fixed top-0 right-0 bottom-0 z-40 flex w-6 flex-col items-center justify-center gap-2"
        style={{
          background:
            selection.type === "all" && !searching
              ? "var(--accent)"
              : "color-mix(in srgb, var(--surface) 80%, var(--bg))",
          color:
            selection.type === "all" && !searching ? "#fff" : "var(--dim)",
        }}
      >
        <span
          aria-hidden
          className="font-display text-xs font-black tracking-widest"
          style={{ writingMode: "vertical-rl" }}
        >
          ▢すべて
        </span>
        <span aria-hidden className="text-[10px] font-bold">
          {notes.length}
        </span>
      </button>

      {/* Drag ghost */}
      {drag && (
        <div
          aria-hidden
          className="paper pointer-events-none fixed z-50 max-w-56 px-3 py-2"
          style={{
            left: drag.x + 12,
            top: drag.y + 12,
            borderRadius: "var(--radius)",
            transform: "rotate(-2deg)",
            opacity: 0.92,
          }}
        >
          <p className="truncate text-sm font-bold">{drag.label || "（▢紙・手紙）"}</p>
        </div>
      )}
    </div>
  );
}


/* ---------- drag grip ---------- */

function Grip({
  label,
  accent,
  onPointerDown,
}: {
  label: string;
  accent?: boolean;
  onPointerDown: (e: ReactPointerEvent) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={onPointerDown}
      className={`shrink-0 cursor-grab touch-none px-1 py-1 text-base leading-none select-none ${
        accent ? "font-black text-[var(--accent)]" : "text-[var(--dim)]"
      }`}
    >
      <span aria-hidden>⠿</span>
    </button>
  );
}

/* ---------- UI-18: the 🔀並び替える object manager ----------
   Shown only while 🔀並び替える is on. Every object toggles here:
   the desk's colored boxes sit in 6 slots (in a slot = on the desk,
   out of a slot = hidden on the shelf), and every shelf box — the
   wiki zone's boxes and hidden boxes alike, since hidden is a state
   within the shelf — toggles between 🔀出す and 🔀しまう. The desk's
   composition is 6 ▢ slots + ◽️箱なし + ◼️ゴミ箱 = 8 objects.
   Slot order is the desk order (reorderBoxes). */

function SortPanel({
  deskSlots,
  shelfList,
  trashIndex,
  onChanged,
  onNotice,
  onOpenBox,
}: {
  deskSlots: Box[];
  shelfList: Box[];
  trashIndex: number;
  onChanged: () => void;
  onNotice: (msg: string | null) => void;
  onOpenBox: (id: number) => void;
}) {
  const slotIds = deskSlots.map((b) => b.id);
  const full = deskSlots.length >= DESK_BOXES_MAX;

  const showMut = useMutation({
    mutationFn: async (box: Box) => {
      await api.setBoxHidden({ id: box.id, hidden: false });
      if (box.zone === "work") {
        await api.reorderBoxes({
          box_ids: [...slotIds, box.id],
          trash_index: trashIndex,
        });
      }
    },
    onSuccess: onChanged,
    onError: () => onNotice(capNotice("work")),
  });
  const hideMut = useMutation({
    mutationFn: async (id: number) => await api.setBoxHidden({ id, hidden: true }),
    onSuccess: onChanged,
    onError: () => onNotice("棚にしまえませんでした。"),
  });
  const swapMut = useMutation({
    mutationFn: async (ids: number[]) =>
      await api.reorderBoxes({ box_ids: ids, trash_index: trashIndex }),
    onSuccess: onChanged,
  });

  const moveSlot = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= slotIds.length) return;
    const ids = [...slotIds];
    const a = ids[i];
    const b = ids[j];
    if (a == null || b == null) return;
    ids[i] = b;
    ids[j] = a;
    swapMut.mutate(ids);
  };

  const slotBtn =
    "font-display shrink-0 border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs font-black disabled:opacity-40";

  return (
    <section
      aria-label="🔀並び替える：机のスロットと棚の▢箱"
      className="mt-3 border border-[var(--border)] bg-[var(--surface)] px-3 py-3"
      style={{ borderRadius: "var(--radius)" }}
    >
      <p className="font-display text-sm font-black">
        🔀 机のスロット（▢箱 {deskSlots.length}/{DESK_BOXES_MAX}・机は
        {deskSlots.length + 2}/{DESK_OBJECTS_MAX}）
      </p>
      <ol className="mt-2 space-y-1.5">
        {Array.from({ length: DESK_BOXES_MAX }, (_, i) => {
          const box = deskSlots[i];
          return (
            <li
              key={i}
              className="flex items-center gap-2 border border-dashed border-[var(--border)] px-2 py-1.5"
              style={{ borderRadius: "var(--radius)" }}
            >
              <span className="font-display w-6 shrink-0 text-center text-xs font-black text-[var(--dim)]">
                {i + 1}
              </span>
              {box ? (
                <>
                  <span
                    aria-hidden
                    className="h-3.5 w-5 shrink-0"
                    style={{ borderRadius: "2px", background: tapeVar(box.color) }}
                  />
                  <button
                    type="button"
                    onClick={() => onOpenBox(box.id)}
                    className="min-w-0 flex-1 truncate text-left text-sm font-bold break-all"
                  >
                    {box.name}
                    <span className="text-xs font-normal text-[var(--dim)]">
                      （{box.note_count}）
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`スロット${i + 1}の▢箱「${box.name}」を上へ`}
                    disabled={i === 0 || swapMut.isPending}
                    onClick={() => moveSlot(i, -1)}
                    className={slotBtn}
                    style={{ borderRadius: "var(--radius)" }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`スロット${i + 1}の▢箱「${box.name}」を下へ`}
                    disabled={i >= deskSlots.length - 1 || swapMut.isPending}
                    onClick={() => moveSlot(i, 1)}
                    className={slotBtn}
                    style={{ borderRadius: "var(--radius)" }}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`▢箱「${box.name}」をスロットから外して棚にしまう`}
                    disabled={hideMut.isPending}
                    onClick={() => hideMut.mutate(box.id)}
                    className="font-display shrink-0 px-2 py-1 text-xs font-black text-[var(--accent)]"
                  >
                    🔀しまう
                  </button>
                </>
              ) : (
                <span className="flex-1 text-sm text-[var(--dim)]">（空き）</span>
              )}
            </li>
          );
        })}
      </ol>

      <p className="font-display mt-4 text-sm font-black">
        棚の▢箱（{shelfList.length}）
      </p>
      {shelfList.length === 0 ? (
        <p className="mt-1 text-sm text-[var(--dim)]">なし</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {shelfList.map((b) => (
            <li key={b.id} className="flex items-center gap-2 px-1 py-1">
              <span
                aria-hidden
                className="h-3.5 w-5 shrink-0"
                style={{ borderRadius: "2px", background: tapeVar(b.color) }}
              />
              <button
                type="button"
                onClick={() => onOpenBox(b.id)}
                className="min-w-0 flex-1 truncate text-left text-sm break-all"
              >
                {b.name}
                <span className="text-xs text-[var(--dim)]">
                  （{b.note_count}・{b.hidden ? "非表示" : "棚"}）
                </span>
              </button>
              {b.hidden ? (
                <button
                  type="button"
                  aria-label={`▢箱「${b.name}」を出す`}
                  disabled={showMut.isPending || (b.zone === "work" && full)}
                  onClick={() => showMut.mutate(b)}
                  className="font-display shrink-0 px-2 py-1 text-xs font-black text-[var(--accent)] disabled:opacity-40"
                >
                  🔀出す
                </button>
              ) : (
                <button
                  type="button"
                  aria-label={`▢箱「${b.name}」を棚にしまう`}
                  disabled={hideMut.isPending}
                  onClick={() => hideMut.mutate(b.id)}
                  className="font-display shrink-0 px-2 py-1 text-xs font-black text-[var(--accent)]"
                >
                  🔀しまう
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {full && <p className="mt-2 text-xs font-bold text-[var(--accent)]">▢箱はいっぱいです（机の▢箱は6つまで）</p>}
    </section>
  );
}

/* ---------- left pane: two panels (UI-18) ----------
   The pane is split into two separate panels. The object panel holds
   the two places and the objects in them: the 机 (desk) tab carries
   ◽️箱なし, the ▢ colored boxes (at most 6) and ◼️ゴミ箱 — 8
   objects in total — and the 棚 (shelf) tab carries everything else,
   hidden boxes included. The action panel (emoji commands) is its
   own panel, fixed at the bottom-left. */

function LeftPane({
  zone,
  onZoneChange,
  tabBoxes,
  deskBoxCount,
  shelfBoxCount,
  paneTokens,
  deskCount,
  trashCount,
  shelfNoteCount,
  selection,
  onSelect,
  dropTarget,
  drag,
  onGripDown,
  onChanged,
  onNotice,
  onDeletedBox,
  sortMode,
  onWrite,
  searchOpen,
  onToggleSearch,
  panel,
  onTogglePanel,
  onToggleSort,
}: {
  zone: Zone;
  onZoneChange: (z: Zone) => void;
  tabBoxes: Box[];
  deskBoxCount: number;
  shelfBoxCount: number;
  paneTokens: string[];
  deskCount: number;
  trashCount: number;
  shelfNoteCount: number;
  selection: Selection;
  onSelect: (s: Selection) => void;
  dropTarget: DropTarget | null;
  drag: DragState | null;
  onGripDown: (e: ReactPointerEvent, payload: DragState) => void;
  onChanged: () => void;
  onNotice: (msg: string | null) => void;
  onDeletedBox: (id: number) => void;
  sortMode: boolean;
  onWrite: () => void;
  searchOpen: boolean;
  onToggleSearch: () => void;
  panel: Panel;
  onTogglePanel: (p: "export" | "import") => void;
  onToggleSort: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const boxByToken = new Map(tabBoxes.map((b) => [`box:${b.id}`, b]));

  const rowStyle = (token: string, active: boolean): CSSProperties => {
    const targeted = dropTarget?.token === token;
    return {
      borderRadius: "var(--radius)",
      background: targeted
        ? "var(--accent-soft)"
        : active
          ? "var(--surface)"
          : "transparent",
      boxShadow: targeted
        ? "inset 0 0 0 2px var(--accent)"
        : active
          ? "0 1px 3px rgb(38 32 25 / 0.15)"
          : "none",
      borderTop:
        drag?.kind === "box" && targeted && dropTarget?.before
          ? "2px solid var(--accent)"
          : undefined,
      borderBottom:
        drag?.kind === "box" && targeted && dropTarget?.before === false
          ? "2px solid var(--accent)"
          : undefined,
    };
  };

  const zoneTabStyle = (z: Zone): CSSProperties => {
    const targeted = dropTarget?.token === `zone:${z}`;
    const active = zone === z;
    return {
      borderRadius: "var(--radius)",
      background: targeted
        ? "var(--accent-soft)"
        : active
          ? "var(--text)"
          : "var(--surface)",
      color: active && !targeted ? "var(--bg)" : "var(--text)",
      boxShadow: targeted ? "inset 0 0 0 2px var(--accent)" : undefined,
    };
  };

  return (
    <aside
      aria-label="オブジェクトとアクション"
      className="sticky top-0 flex h-dvh w-36 shrink-0 flex-col gap-2 px-1.5 py-3 sm:w-52 sm:px-2"
    >
      <p className="font-display px-1 text-base font-black tracking-wide">
        チラ裏
      </p>

      {/* Object panel: the two places and their objects. The tabs are
          also drop targets: a box dropped here swaps places between
          机 and 棚, paper dropped on 机 goes back to ◽️箱なし. */}
      <section
        aria-label="オブジェクト"
        className="min-h-0 flex-1 overflow-y-auto border border-[var(--border)] bg-[var(--space-surface-alt)] px-1 py-2"
        style={{ borderRadius: "var(--radius)" }}
      >
      <div className="mb-2 grid grid-cols-2 gap-1" role="group" aria-label="机か棚を選ぶ">
        {(["work", "wiki"] as Zone[]).map((z) => (
          <button
            key={z}
            type="button"
            data-pane-token={`zone:${z}`}
            aria-pressed={zone === z}
            onClick={() => onZoneChange(z)}
            className="font-display border border-[var(--border)] px-1 py-1.5 text-center"
            style={zoneTabStyle(z)}
          >
            <span className="block text-base leading-5 font-black">
              {z === "work" ? "机" : "棚"}
              {sortMode && (
                <span aria-hidden className="ml-1 text-xs text-[var(--accent)]">⤵</span>
              )}
            </span>
            <span className="block text-[10px] leading-3 font-bold opacity-70">
              {z === "work"
                ? `${deskBoxCount + 2}/${DESK_OBJECTS_MAX}`
                : `${shelfBoxCount}`}
            </span>
          </button>
        ))}
      </div>

      {zone === "work" ? (
        /* ◽️箱なし: pinned at the top of the desk, dropping paper
           here takes it out of its box */
        <div
          data-pane-token="desk"
          className="flex items-center"
          style={rowStyle("desk", selection.type === "desk")}
        >
          <button
            type="button"
            aria-pressed={selection.type === "desk"}
            onClick={() => onSelect({ type: "desk" })}
            className="flex min-w-0 flex-1 items-baseline gap-1.5 px-1.5 py-2 text-left"
          >
            <span className="font-display min-w-0 flex-1 truncate text-sm font-bold">
              ◽️箱なし
            </span>
            {sortMode && (
              <span aria-hidden className="shrink-0 text-sm font-black text-[var(--accent)]">⤵</span>
            )}
            <span className="text-xs text-[var(--dim)]">{deskCount}</span>
          </button>
        </div>
      ) : (
        /* Shelf home: every paper that lives in a shelf box */
        <div
          className="flex items-center"
          style={rowStyle("shelf-home", selection.type === "shelf")}
        >
          <button
            type="button"
            aria-pressed={selection.type === "shelf"}
            onClick={() => onSelect({ type: "shelf" })}
            className="flex min-w-0 flex-1 items-baseline gap-1.5 px-1.5 py-2 text-left"
          >
            <span className="font-display min-w-0 flex-1 truncate text-sm font-bold">
              棚の▢紙・手紙
            </span>
            {sortMode && (
              <span aria-hidden className="shrink-0 text-sm font-black text-[var(--accent)]">⤵</span>
            )}
            <span className="text-xs text-[var(--dim)]">{shelfNoteCount}</span>
          </button>
        </div>
      )}

      <p className="font-display px-1 pt-3 pb-1 text-xs font-black tracking-wide text-[var(--dim)]">
        {zone === "work"
          ? `▢箱（${tabBoxes.length}/${DESK_BOXES_MAX}）`
          : `▢箱（${tabBoxes.length}）`}
      </p>

      {/* The current tab's boxes, drag-reorderable */}
      {paneTokens.map((token) => {
        const box = boxByToken.get(token);
        if (!box) return null;
        return (
          <PaneBoxRow
            key={token}
            box={box}
            active={selection.type === "box" && selection.id === box.id}
            style={rowStyle(token, selection.type === "box" && selection.id === box.id)}
            sortMode={sortMode}
            onSelect={() => onSelect({ type: "box", id: box.id })}
            onGripDown={(e) =>
              onGripDown(e, {
                kind: "box",
                token,
                label: box.name,
                x: e.clientX,
                y: e.clientY,
              })
            }
            onChanged={onChanged}
            onNotice={onNotice}
            onDeleted={() => onDeletedBox(box.id)}
          />
        );
      })}

      {/* ◼️ゴミ箱: a fixed desk object on the same layer as the ▢箱
          and ◽️箱なし — its position here never changes; reordering
          moves contents and assignments only. Hidden boxes are not
          listed here: they sit on the 棚 (UI-18), and their
          出す・しまう・順序 is managed by 🔀並び替える. */}
      <div className="mt-6">
        <div
          data-pane-token="trash"
          className="flex items-center"
          style={rowStyle("trash", selection.type === "trash")}
        >
          <button
            type="button"
            aria-pressed={selection.type === "trash"}
            onClick={() => onSelect({ type: "trash" })}
            className="flex min-w-0 flex-1 items-baseline gap-1.5 px-1.5 py-2 text-left"
          >
            <span className="font-display min-w-0 flex-1 truncate text-sm font-bold">
              ◼️ゴミ箱
            </span>
            {sortMode && (
              <span aria-hidden className="shrink-0 text-sm font-black text-[var(--accent)]">⤵</span>
            )}
            <span className="text-xs text-[var(--dim)]">{trashCount}</span>
          </button>
        </div>
      </div>
      </section>

      {/* Action panel: the emoji commands in their own panel, fixed
          at the bottom-left of the pane — 📦箱を作る included (making
          a box is an action, so it lives here, not beside the boxes).
          Their panels and the search field open in the main area. */}
      <div className="shrink-0">
      {creating && (
        <div className="mb-2">
          <CreateBoxForm
            zone={zone}
            onDone={(id) => {
              setCreating(false);
              onChanged();
              if (id != null) onSelect({ type: "box", id });
            }}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}
      <section
        aria-label="アクション"
        className="border border-[var(--border)] bg-[var(--space-surface-alt)] px-1.5 py-2"
        style={{ borderRadius: "var(--radius)" }}
      >
      <nav
        aria-label="アクション"
        className="flex flex-col gap-1.5"
      >
        <button
          type="button"
          onClick={onWrite}
          className={`${cmdClass(false)} text-left`}
          style={{ borderRadius: "var(--radius)" }}
        >
          ✏書く
        </button>
        <button
          type="button"
          aria-expanded={searchOpen}
          onClick={onToggleSearch}
          className={`${cmdClass(searchOpen)} text-left`}
          style={{ borderRadius: "var(--radius)" }}
        >
          🔍探す
        </button>
        <button
          type="button"
          aria-expanded={panel === "export"}
          onClick={() => onTogglePanel("export")}
          className={`${cmdClass(panel === "export")} text-left`}
          style={{ borderRadius: "var(--radius)" }}
        >
          📤持ち出す
        </button>
        <button
          type="button"
          aria-expanded={panel === "import"}
          onClick={() => onTogglePanel("import")}
          className={`${cmdClass(panel === "import")} text-left`}
          style={{ borderRadius: "var(--radius)" }}
        >
          📥取り入れる
        </button>
        <button
          type="button"
          aria-pressed={sortMode}
          onClick={onToggleSort}
          className={`${cmdClass(sortMode)} text-left`}
          style={{ borderRadius: "var(--radius)" }}
        >
          🔀並び替える
        </button>
        <button
          type="button"
          aria-expanded={creating}
          onClick={() => setCreating((v) => !v)}
          className={`${cmdClass(creating)} text-left`}
          style={{ borderRadius: "var(--radius)" }}
        >
          📦箱を作る
        </button>
      </nav>
      </section>
      </div>

      <span className="sr-only">箱は全部で{deskBoxCount + shelfBoxCount}個です</span>
    </aside>
  );
}

function PaneBoxRow({
  box,
  active,
  style,
  sortMode,
  onSelect,
  onGripDown,
  onChanged,
  onNotice,
  onDeleted,
}: {
  box: Box;
  active: boolean;
  style: CSSProperties;
  sortMode: boolean;
  onSelect: () => void;
  onGripDown: (e: ReactPointerEvent) => void;
  onChanged: () => void;
  onNotice: (msg: string | null) => void;
  onDeleted: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  return (
    <div
      data-pane-token={`box:${box.id}`}
      style={box.hidden ? { ...style, opacity: 0.72 } : style}
    >
      <div className="flex items-center">
        {sortMode && (
          <Grip
            label={`▢箱「${box.name}」をドラッグで移動・🔀並び替える`}
            accent={sortMode}
            onPointerDown={onGripDown}
          />
        )}
        <button
          type="button"
          aria-pressed={active}
          onClick={onSelect}
          className="flex min-w-0 flex-1 items-center gap-1.5 px-1 py-2 text-left"
        >
          <span
            aria-hidden
            className="h-3.5 w-5 shrink-0"
            style={{ borderRadius: "2px", background: tapeVar(box.color) }}
          />
          <span className="min-w-0 flex-1">
            <span className="font-display block truncate text-sm font-bold break-all">
              {box.name}
            </span>
            {box.name === DIARY_BOX_NAME && (
              <span className="block text-[10px] leading-3 font-bold text-[var(--accent)]">
                ▢交換日記
              </span>
            )}
            {box.hidden && (
              <span className="block text-[10px] leading-3 font-bold text-[var(--dim)]">
                非表示
              </span>
            )}
          </span>
          <span className="text-xs text-[var(--dim)]">{box.note_count}</span>
        </button>
        <button
          type="button"
          aria-label={`▢箱「${box.name}」のメニュー`}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className="shrink-0 px-1.5 py-1 text-base leading-none font-bold text-[var(--dim)]"
        >
          <span aria-hidden>…</span>
        </button>
      </div>
      {menuOpen && (
        <BoxMenu
          box={box}
          onClose={() => setMenuOpen(false)}
          onEdit={() => {
            setEditing(true);
            setMenuOpen(false);
          }}
          onChanged={onChanged}
          onNotice={onNotice}
          onDeleted={() => {
            setMenuOpen(false);
            onDeleted();
          }}
        />
      )}
      {editing && (
        <BoxEditForm
          box={box}
          onDone={() => {
            setEditing(false);
            onChanged();
          }}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
}

/* The box's minimal menu: everything here folds into the commands —
   📤持ち出す (export) and 🔀並び替える's family (place swap between
   机 and 棚). Showing and hiding a box is NOT here: UI-18 gathers
   every object's toggle into the 🔀並び替える manager. */
function BoxMenu({
  box,
  onClose,
  onEdit,
  onChanged,
  onNotice,
  onDeleted,
}: {
  box: Box;
  onClose: () => void;
  onEdit: () => void;
  onChanged: () => void;
  onNotice: (msg: string | null) => void;
  onDeleted: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const zoneMut = useMutation({
    mutationFn: async (z: Zone) => await api.setBoxZone({ id: box.id, zone: z }),
    onSuccess: () => {
      onNotice(
        box.zone === "work"
          ? `▢箱「${box.name}」を棚へ移しました。`
          : `▢箱「${box.name}」を机へ移しました。`,
      );
      onClose();
      onChanged();
    },
    onError: () => onNotice(capNotice(box.zone === "work" ? "wiki" : "work")),
  });
  const exportMut = useMutation({
    mutationFn: async () => await api.exportBox({ box_id: box.id }),
    onSuccess: (data) => {
      downloadText(`${data.name.replace(/[/\\]/g, "_")}.jsonl`, data.jsonl);
      onNotice(`▢箱「${data.name}」を📤持ち出しました（${data.count}枚）。`);
      onClose();
    },
    onError: () => onNotice("持ち出しに失敗しました。"),
  });
  const deleteMut = useMutation({
    mutationFn: async () => await api.deleteBox({ id: box.id }),
    onSuccess: () => {
      onChanged();
      onDeleted();
    },
  });

  const item =
    "font-display block w-full px-2 py-1.5 text-left text-sm font-bold";

  return (
    <div
      className="mx-1 mb-2 border border-[var(--border)] bg-[var(--paper)] px-1 py-1"
      style={{ borderRadius: "var(--radius)" }}
    >
      <button type="button" className={item} onClick={onEdit}>
        ✏名前と色を直す
      </button>
      <button
        type="button"
        className={item}
        disabled={exportMut.isPending}
        onClick={() => exportMut.mutate()}
      >
        📤▢箱を持ち出す（.jsonl）
      </button>
      <button
        type="button"
        className={item}
        disabled={zoneMut.isPending}
        onClick={() => zoneMut.mutate(box.zone === "work" ? "wiki" : "work")}
      >
        {box.zone === "work" ? "🔀棚へ移す" : "🔀机へ移す"}
      </button>
      {confirmDelete ? (
        <span className="flex flex-wrap items-center gap-2 px-2 py-1.5 text-sm">
          <button
            type="button"
            disabled={deleteMut.isPending}
            onClick={() => deleteMut.mutate()}
            className="font-display border border-[var(--accent)] px-2 py-0.5 font-bold text-[var(--accent)]"
            style={{ borderRadius: "var(--radius)" }}
          >
            消す
          </button>
          <button type="button" onClick={() => setConfirmDelete(false)} className="text-[var(--dim)]">
            もどる
          </button>
        </span>
      ) : (
        <button
          type="button"
          className={`${item} text-[var(--accent)]`}
          onClick={() => setConfirmDelete(true)}
        >
          🗑この▢箱を消す
        </button>
      )}
    </div>
  );
}

function BoxEditForm({
  box,
  onDone,
  onCancel,
}: {
  box: Box;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(box.name);
  const [color, setColor] = useState<BoxColor>(box.color);
  const renameMut = useMutation({
    mutationFn: async (v: { id: number; name: string; color: BoxColor }) =>
      await api.renameBox(v),
    onSuccess: onDone,
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim())
          renameMut.mutate({ id: box.id, name: name.trim(), color });
      }}
      className="mx-1 mb-2 space-y-2 border border-[var(--border)] bg-[var(--paper)] px-2 py-2"
      style={{ borderRadius: "var(--radius)" }}
    >
      <label htmlFor={`box-edit-${box.id}`} className="sr-only">
        箱の名前
      </label>
      <input
        id={`box-edit-${box.id}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
        style={{ borderRadius: "var(--radius)" }}
      />
      <ColorPick value={color} onChange={setColor} name={`edit-${box.id}`} />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!name.trim() || renameMut.isPending}
          className="font-display bg-[var(--accent)] px-3 py-1 text-sm font-black text-white disabled:opacity-40"
          style={{ borderRadius: "var(--radius)" }}
        >
          保存
        </button>
        <button type="button" onClick={onCancel} className="px-2 py-1 text-sm text-[var(--dim)]">
          やめる
        </button>
      </div>
    </form>
  );
}

function CreateBoxForm({
  zone,
  onDone,
  onCancel,
}: {
  zone: Zone;
  onDone: (id: number | null) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<BoxColor>("plain");
  const [error, setError] = useState<string | null>(null);
  const createMut = useMutation({
    mutationFn: async (v: { name: string; color: BoxColor; zone: Zone }) =>
      await api.createBox(v),
    onSuccess: (data) => onDone(data.id),
    onError: (e) =>
      setError(e instanceof Error ? e.message : "箱を作れませんでした。"),
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) createMut.mutate({ name: name.trim(), color, zone });
      }}
      className="mt-2 space-y-2 border border-[var(--border)] bg-[var(--paper)] px-2 py-2"
      style={{ borderRadius: "var(--radius)" }}
    >
      <label htmlFor="box-new-name" className="sr-only">
        新しい箱の名前
      </label>
      <input
        id="box-new-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="箱の名前"
        autoFocus
        className="w-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
        style={{ borderRadius: "var(--radius)" }}
      />
      <ColorPick value={color} onChange={setColor} name="new" />
      {error && <p className="text-xs font-bold text-[var(--accent)]">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!name.trim() || createMut.isPending}
          className="font-display bg-[var(--accent)] px-3 py-1 text-sm font-black text-white disabled:opacity-40"
          style={{ borderRadius: "var(--radius)" }}
        >
          作る
        </button>
        <button type="button" onClick={onCancel} className="px-2 py-1 text-sm text-[var(--dim)]">
          やめる
        </button>
      </div>
    </form>
  );
}

function ColorPick({
  value,
  onChange,
  name,
}: {
  value: BoxColor;
  onChange: (c: BoxColor) => void;
  name: string;
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-1">
      <legend className="sr-only">テープの色</legend>
      {COLORS.map((c) => (
        <label key={c.value} className="flex cursor-pointer items-center p-0.5" title={c.label}>
          <input
            type="radio"
            name={`tape-${name}`}
            value={c.value}
            checked={value === c.value}
            onChange={() => onChange(c.value)}
            className="sr-only"
          />
          <span
            aria-hidden
            className="block h-4 w-6"
            style={{
              borderRadius: "2px",
              background: tapeVar(c.value),
              outline: value === c.value ? "2px solid var(--text)" : "1px solid var(--border)",
              outlineOffset: "1px",
            }}
          />
          <span className="sr-only">{c.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

/* ---------- 取り入れる panel (UI-05 / UI-07 / UI-10) ----------
   One command, two doors: a file becomes a new box on the 棚,
   or a whole-collection JSONL comes back in. Day-to-day reads/writes by
   path or URL still go through Muse; this panel is the in-app door. */

function ImportPanel({
  onImported,
  onNotice,
  onClose,
}: {
  onImported: () => void;
  onNotice: (msg: string | null) => void;
  onClose: () => void;
}) {
  const [importText, setImportText] = useState("");
  const [hiddenNew, setHiddenNew] = useState(true);
  const boxFileRef = useRef<HTMLInputElement>(null);
  const jsonlFileRef = useRef<HTMLInputElement>(null);

  const importBoxMut = useMutation({
    mutationFn: async (v: {
      content: string;
      suggested_name?: string;
      format: "jsonl" | "text" | "csv";
      hidden: boolean;
      zone: Zone;
    }) => await api.importBox(v),
    onSuccess: (data) => {
      onNotice(
        `▢箱「${data.name}」を📥取り入れました（${data.imported}枚）。`,
      );
      onImported();
      onClose();
    },
    onError: () => onNotice("箱の取り入れに失敗しました。"),
  });

  const importJsonlMut = useMutation({
    mutationFn: async (jsonl: string) =>
      await api.importJsonl({ jsonl, hidden_new_boxes: hiddenNew }),
    onSuccess: (data) => {
      onNotice(
        `${data.imported}枚を取り込みました（新しい箱 ${data.created_boxes}個、読み飛ばし ${data.skipped}行）。`,
      );
      setImportText("");
      onImported();
      onClose();
    },
    onError: () => onNotice("取り込みに失敗しました。形式を確認してください。"),
  });

  const onBoxFile = async (file: File | undefined) => {
    if (!file) return;
    const content = await file.text();
    const lower = file.name.toLowerCase();
    const format = lower.endsWith(".jsonl") || lower.endsWith(".ndjson")
      ? "jsonl"
      : lower.endsWith(".csv")
        ? "csv"
        : "text";
    const suggested = file.name.replace(/\.[^.]+$/, "");
    importBoxMut.mutate({
      content,
      suggested_name: suggested,
      format,
      hidden: true,
      zone: "wiki",
    });
  };

  const onJsonlFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    importJsonlMut.mutate(text);
  };

  const btn =
    "font-display border border-[var(--text)] px-4 py-2 text-sm font-black disabled:opacity-50";

  return (
    <section
      aria-label="📥取り入れる"
      className="mt-2 space-y-3 border border-[var(--border)] bg-[var(--surface)] px-3 py-3"
      style={{ borderRadius: "var(--radius)" }}
    >
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={importBoxMut.isPending}
          onClick={() => boxFileRef.current?.click()}
          className={btn}
          style={{ borderRadius: "var(--radius)" }}
        >
          📥ファイルを▢箱として取り入れる
        </button>
        <input
          ref={boxFileRef}
          type="file"
          accept=".jsonl,.ndjson,.txt,.md,.csv,.yaml,.yml,.json,text/plain,text/csv"
          aria-label="箱として取り入れるファイルを選ぶ"
          className="hidden"
          onChange={(e) => {
            void onBoxFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={importJsonlMut.isPending}
          onClick={() => jsonlFileRef.current?.click()}
          className={btn}
          style={{ borderRadius: "var(--radius)" }}
        >
          📥.jsonl ファイルを取り入れる
        </button>
        <input
          ref={jsonlFileRef}
          type="file"
          accept=".jsonl,.txt,.ndjson,application/x-ndjson"
          aria-label="JSONLファイルを選ぶ"
          className="hidden"
          onChange={(e) => {
            void onJsonlFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={hiddenNew}
          onChange={(e) => setHiddenNew(e.target.checked)}
          className="h-4 w-4"
        />
        取り込みで新しくできる▢箱は、非表示にする
      </label>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (importText.trim()) importJsonlMut.mutate(importText);
        }}
      >
        <label htmlFor="import-paste" className="text-sm font-bold">
          JSONL を貼って📥取り入れる
        </label>
        <textarea
          id="import-paste"
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          rows={4}
          className="mt-1 w-full border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-xs leading-5 outline-none focus:border-[var(--accent)]"
          style={{ borderRadius: "var(--radius)" }}
        />
        <button
          type="submit"
          disabled={!importText.trim() || importJsonlMut.isPending}
          className="font-display mt-2 border border-[var(--accent)] px-4 py-2 text-sm font-black text-[var(--accent)] disabled:opacity-40"
          style={{ borderRadius: "var(--radius)" }}
        >
          📥貼った分を取り入れる
        </button>
      </form>
    </section>
  );
}

/* ---------- capture slip ----------
   UI-09: two placements of the same writing paper.
   - hero (the desk, the default view): the writing slip is the main
     element — tall, autofocused, ready to write the moment the page opens.
     New paper lands on the desk (UI-07: filing is drag & drop by hand,
     or Muse's sorting pass — the writer never has to pick a box).
   - tail (a selected box, or the all view): the same slip attached at
     the very end of the list, filing straight into the open box so the
     list stays in view while writing.
   UI-10: input is capped at 12 lines. */

function CaptureSlip({
  onSaved,
  boxId,
  boxName,
  variant,
}: {
  onSaved: () => void;
  boxId: number | null;
  boxName: string | null;
  variant: "hero" | "tail";
  /* UI-12: the 交換日記's tail slip writes the next letter of the diary. */
  diary?: boolean;
}) {
  const [body, setBody] = useState("");
  const hero = variant === "hero";
  const fieldId = `capture-${variant}-${boxId ?? "desk"}`;
  const lineCount = body === "" ? 0 : body.split("\n").length;

  const addMut = useMutation({
    mutationFn: async (v: { body: string; box_id: number | null }) =>
      await api.addNote(v),
    onSuccess: () => {
      setBody("");
      onSaved();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if (!text || addMut.isPending) return;
    addMut.mutate({ body: text, box_id: boxId });
  };

  return (
    <form
      onSubmit={submit}
      aria-label={
        hero
          ? "新しいメモを書く（箱なし）"
          : boxName
            ? `箱「${boxName}」に新しいメモを書き足す`
            : "新しいメモを書く（箱なし）"
      }
      className={
        hero
          ? "paper tape mt-5 px-4 pt-7 pb-4 sm:px-5"
          : "paper tape mt-3 px-4 pt-6 pb-3"
      }
      style={{ borderRadius: "var(--radius)", ["--tape-color" as string]: "var(--tape-sand)" }}
    >
      <label htmlFor={fieldId} className="sr-only">
        {boxName ? `箱「${boxName}」への新しいメモ` : "新しいメモ"}
      </label>
      <textarea
        id={fieldId}
        value={body}
        onChange={(e) => setBody(clampLines(e.target.value))}
        rows={hero ? 12 : 3}
        autoFocus={hero}
        className="w-full resize-y bg-transparent text-base leading-7 outline-none placeholder:text-[var(--dim)]"
      />
      {addMut.isError && (
        <p className="text-sm text-[var(--accent)]">置けませんでした。</p>
      )}
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--dim)]">
          {lineCount >= 10 && `${lineCount}/${MAX_LINES}行`}
        </span>
        <button
          type="submit"
          disabled={!body.trim() || addMut.isPending}
          className="font-display ml-auto bg-[var(--accent)] px-5 py-2 text-base font-black text-white disabled:opacity-40"
          style={{ borderRadius: "var(--radius)" }}
        >
          {boxName ? "✏ちぎって入れる" : "✏ちぎって置く"}
        </button>
      </div>
    </form>
  );
}

/* ---------- one paper slip ---------- */

function NoteCard({
  note,
  boxes,
  tilt,
  showBoxLabel,
  diaryRole,
  sortMode,
  onChanged,
  onTrash,
  onGripDown,
}: {
  note: Note;
  boxes: Box[];
  tilt: string;
  showBoxLabel: boolean;
  /* UI-12: set only inside the 交換日記 box — this slip's turn in the
     alternating 要望 / 結果 exchange. */
  diaryRole?: "要望" | "結果";
  sortMode: boolean;
  onChanged: () => void;
  onTrash: (uid: string) => void;
  onGripDown: (e: ReactPointerEvent, note: Note) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [expanded, setExpanded] = useState(false);
  const box = boxes.find((b) => b.id === note.box_id) ?? null;
  const long = isLongBody(note.body);
  /* Imported long paper is exempt from the 12-line input cap (UI-10). */
  const importedLong = note.body.split("\n").length > MAX_LINES;

  const updateMut = useMutation({
    mutationFn: async (v: { uid: string; body: string }) =>
      await api.updateNote(v),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
  });

  return (
    <li
      className="paper tape flex flex-col px-4 pt-6 pb-3"
      style={{
        borderRadius: "var(--radius)",
        transform: `rotate(${tilt})`,
        ["--tape-color" as string]: tapeVar(box?.color ?? "plain"),
      }}
    >
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim())
              updateMut.mutate({ uid: note.uid, body: draft.trim() });
          }}
          className="flex flex-1 flex-col"
        >
          <label htmlFor={`edit-${note.uid}`} className="sr-only">
            メモを書き直す
          </label>
          <textarea
            id={`edit-${note.uid}`}
            value={draft}
            onChange={(e) =>
              setDraft(importedLong ? e.target.value : clampLines(e.target.value))
            }
            rows={8}
            className="w-full flex-1 resize-y bg-transparent text-base leading-7 outline-none"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="submit"
              disabled={!draft.trim() || updateMut.isPending}
              className="font-display bg-[var(--accent)] px-3 py-1.5 text-sm font-black text-white disabled:opacity-40"
              style={{ borderRadius: "var(--radius)" }}
            >
              ✏書き直す
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(note.body);
                setEditing(false);
              }}
              className="px-2 py-1.5 text-sm text-[var(--dim)]"
            >
              やめる
            </button>
          </div>
        </form>
      ) : (
        <>
          {diaryRole && (
            <p className="pb-2">
              <span
                className="font-display inline-block px-2 py-0.5 text-xs font-black"
                style={{
                  borderRadius: "var(--radius)",
                  background:
                    diaryRole === "要望"
                      ? "var(--accent-soft)"
                      : "color-mix(in srgb, var(--tape-sage) 40%, transparent)",
                  color: diaryRole === "要望" ? "var(--accent)" : "var(--text)",
                }}
              >
                {diaryRole === "要望" ? "要望の手紙" : "結果の手紙"}
              </span>
            </p>
          )}
          <p
            className={`flex-1 text-base leading-7 whitespace-pre-wrap break-words ${
              expanded ? "" : "line-clamp-[12]"
            }`}
          >
            {note.body}
          </p>
          {long && (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              className="font-display mt-1 self-start text-sm font-bold text-[var(--accent)]"
            >
              {expanded ? "📖閉じる" : "📖全文を開く"}
            </button>
          )}
          <div className="mt-4 flex items-start gap-1">
            {sortMode && (
              <Grip
                label="▢紙・手紙をつまんで▢箱へ移動"
                accent={sortMode}
                onPointerDown={(e) => onGripDown(e, note)}
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs text-[var(--dim)]">
                {showBoxLabel && <>{box ? `▢箱「${box.name}」` : "◽️箱なし"} ・ </>}
                {fmtDate(note.created_at)}
                {note.updated_at !== note.created_at &&
                  ` ・ 直し ${fmtDate(note.updated_at)}`}
              </p>
              <div className="mt-0.5 flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setDraft(note.body);
                    setEditing(true);
                  }}
                  className="px-1 py-1 text-sm font-bold"
                >
                  ✏書く
                </button>
                <button
                  type="button"
                  onClick={() => onTrash(note.uid)}
                  className="ml-auto px-1 py-1 text-sm font-bold text-[var(--accent)]"
                >
                  🗑捨てる
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </li>
  );
}

/* ---------- the trash box's contents (UI-04 / P3) ---------- */

function TrashList({
  trash,
  onRestore,
  onPurgeOne,
  onPurgeAll,
  purging,
}: {
  trash: Note[];
  onRestore: (uid: string) => void;
  onPurgeOne: (uid: string) => void;
  onPurgeAll: () => void;
  purging: boolean;
}) {
  const [confirmPurgeAll, setConfirmPurgeAll] = useState(false);
  if (trash.length === 0) {
    return (
      <div
        className="paper mt-4 px-5 py-10 text-center"
        style={{ borderRadius: "var(--radius)" }}
      >
        <p className="font-display text-lg font-bold">◼️ゴミ箱は空です</p>
      </div>
    );
  }
  return (
    <div>
      <ul className="space-y-2">
        {trash.map((n) => (
          <TrashRow
            key={n.uid}
            note={n}
            onRestore={() => onRestore(n.uid)}
            onPurge={() => onPurgeOne(n.uid)}
          />
        ))}
      </ul>
      {confirmPurgeAll ? (
        <p className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-bold text-[var(--accent)]">{trash.length}枚</span>
          <button
            type="button"
            disabled={purging}
            onClick={onPurgeAll}
            className="font-display border border-[var(--accent)] px-3 py-1 font-bold text-[var(--accent)] disabled:opacity-50"
            style={{ borderRadius: "var(--radius)" }}
          >
            空にする
          </button>
          <button
            type="button"
            onClick={() => setConfirmPurgeAll(false)}
            className="text-[var(--dim)]"
          >
            もどる
          </button>
        </p>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmPurgeAll(true)}
          className="font-display mt-4 border border-[var(--accent)] px-3 py-1.5 text-sm font-bold text-[var(--accent)]"
          style={{ borderRadius: "var(--radius)" }}
        >
          🗑◼️ゴミ箱を空にする
        </button>
      )}
    </div>
  );
}

function TrashRow({
  note,
  onRestore,
  onPurge,
}: {
  note: Note;
  onRestore: () => void;
  onPurge: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <li
      className="flex items-center gap-2 border border-dashed border-[var(--border)] bg-[var(--surface)] px-3 py-2 opacity-90"
      style={{ borderRadius: "var(--radius)" }}
    >
      <span className="min-w-0 flex-1 truncate text-sm">
        {note.body.split("\n")[0]}
      </span>
      <span className="hidden shrink-0 text-xs text-[var(--dim)] sm:block">
        {fmtDate(note.updated_at)}
      </span>
      <button
        type="button"
        onClick={onRestore}
        className="font-display shrink-0 text-sm font-bold text-[var(--accent)]"
      >
        ↩拾い直す
      </button>
      {confirm ? (
        <span className="flex shrink-0 items-center gap-1 text-sm">
          <button
            type="button"
            onClick={onPurge}
            className="font-display border border-[var(--accent)] px-2 py-0.5 font-bold text-[var(--accent)]"
            style={{ borderRadius: "var(--radius)" }}
          >
            消す
          </button>
          <button type="button" onClick={() => setConfirm(false)} className="text-[var(--dim)]">
            もどる
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setConfirm(true)}
          className="shrink-0 px-1 text-sm font-bold text-[var(--dim)]"
        >
          🗑完全に消す
        </button>
      )}
    </li>
  );
}
