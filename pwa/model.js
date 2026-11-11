// chira-ura PWA — model re-export
// 拡張（crx/scripts/model.js）と同じメモ JSON 定義・関数を直接 re-export する。
// 重複コピーせず単一の正として参照。
export {
  STORAGE_KEYS,
  BOXES,
  NOTE_KEYS,
  deriveTitle,
  newNoteId,
  makeNote,
  toNote,
  noteJson,
  toJsonl,
  parseJsonLines,
  parseJsonl,
  DB_SCHEMA
} from "../crx/scripts/model.js";
