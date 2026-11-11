import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as pwaModel from "../pwa/model.js";
import * as crxModel from "../crx/scripts/model.js";

test("pwa/model re-exports match crx/scripts/model", () => {
  assert.equal(pwaModel.deriveTitle, crxModel.deriveTitle);
  assert.equal(pwaModel.toJsonl, crxModel.toJsonl);
  assert.equal(pwaModel.parseJsonl, crxModel.parseJsonl);
  assert.equal(pwaModel.noteJson, crxModel.noteJson);
  assert.equal(pwaModel.newNoteId, crxModel.newNoteId);

  // Test note schema consistency
  const note = pwaModel.makeNote("First line\nSecond line");
  assert.equal(note.title, "First line");
  assert.ok(note.id.startsWith("note-"));
  assert.equal(typeof note.updatedAt, "number");

  const jsonl = pwaModel.toJsonl([note]);
  const parsed = pwaModel.parseJsonl(jsonl);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, note.id);
  assert.equal(parsed[0].title, note.title);
  assert.equal(parsed[0].content, note.content);
});

test("pwa/manifest.webmanifest validity", () => {
  const content = fs.readFileSync(path.resolve("pwa/manifest.webmanifest"), "utf8");
  const manifest = JSON.parse(content);
  assert.equal(manifest.name, "chira-ura / チラ裏");
  assert.equal(manifest.short_name, "chira-ura");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./index.html");
  assert.equal(manifest.theme_color, "#faf7f0");
  assert.equal(manifest.background_color, "#faf7f0");

  assert.ok(Array.isArray(manifest.icons));
  assert.ok(manifest.icons.some(i => i.sizes === "192x192" && i.purpose === "any"));
  assert.ok(manifest.icons.some(i => i.sizes === "512x512" && i.purpose === "any"));
  assert.ok(manifest.icons.some(i => i.sizes === "512x512" && i.purpose === "maskable"));
});

test("pwa/sw.js cache configuration", () => {
  const swCode = fs.readFileSync(path.resolve("pwa/sw.js"), "utf8");
  assert.match(swCode, /const CACHE_NAME = "chira-ura-v1";/);
  assert.match(swCode, /"\.\/index\.html"/);
  assert.match(swCode, /"\.\/manifest\.webmanifest"/);
  assert.match(swCode, /"\.\/app\.js"/);
  assert.match(swCode, /"\.\/style\.css"/);
  assert.match(swCode, /"\.\/model\.js"/);
});
