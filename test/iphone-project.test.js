import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(".");
const IPHONE_DIR = path.join(REPO_ROOT, "gui", "iphone");

test("gui/iphone: project structure exists and has required files", () => {
  const pbxprojPath = path.join(IPHONE_DIR, "ChiraUra.xcodeproj", "project.pbxproj");
  assert.ok(fs.existsSync(pbxprojPath), "project.pbxproj must exist");

  const requiredSwiftFiles = [
    "ChiraUra/ChiraUraApp.swift",
    "ChiraUra/Models/Note.swift",
    "ChiraUra/Models/OutboxItem.swift",
    "ChiraUra/Storage/NoteStore.swift",
    "ChiraUra/Network/ChiraApiClient.swift",
    "ChiraUra/Network/NetworkMonitor.swift",
    "ChiraUra/Sync/SyncService.swift",
    "ChiraUra/Views/StickyNoteView.swift",
    "ChiraUra/Views/SettingsView.swift",
    "ChiraUra/Info.plist",
    "ChiraUraTests/NoteTests.swift",
    "ChiraUraTests/SyncServiceTests.swift",
  ];

  for (const rel of requiredSwiftFiles) {
    const fullPath = path.join(IPHONE_DIR, rel);
    assert.ok(fs.existsSync(fullPath), `File ${rel} must exist`);
  }
});

test("gui/iphone: project.pbxproj references all Swift files and defines targets", () => {
  const pbxprojContent = fs.readFileSync(
    path.join(IPHONE_DIR, "ChiraUra.xcodeproj", "project.pbxproj"),
    "utf8"
  );

  // Targets
  assert.ok(pbxprojContent.includes("ChiraUra"), "Must contain ChiraUra target");
  assert.ok(pbxprojContent.includes("ChiraUraTests"), "Must contain ChiraUraTests target");
  assert.ok(pbxprojContent.includes("IPHONEOS_DEPLOYMENT_TARGET = 16.0;"), "Deployment target must be iOS 16.0");

  // Files referenced in project
  const expectedReferences = [
    "ChiraUraApp.swift",
    "Note.swift",
    "OutboxItem.swift",
    "NoteStore.swift",
    "ChiraApiClient.swift",
    "NetworkMonitor.swift",
    "SyncService.swift",
    "StickyNoteView.swift",
    "SettingsView.swift",
    "NoteTests.swift",
    "SyncServiceTests.swift",
  ];

  for (const ref of expectedReferences) {
    assert.ok(pbxprojContent.includes(ref), `project.pbxproj must reference ${ref}`);
  }
});

test("gui/iphone: Note and InboxPayload models match canonical note schema", () => {
  const noteSwift = fs.readFileSync(
    path.join(IPHONE_DIR, "ChiraUra", "Models", "Note.swift"),
    "utf8"
  );

  // Note schema fields: id, title, content, updatedAt
  assert.ok(noteSwift.includes("let id: String"), "Note must have id: String");
  assert.ok(noteSwift.includes("var title: String"), "Note must have title: String");
  assert.ok(noteSwift.includes("var content: String"), "Note must have content: String");
  assert.ok(noteSwift.includes("var updatedAt: Int64"), "Note must have updatedAt: Int64");

  // InboxPayload fields: content, updatedAt, closed
  assert.ok(noteSwift.includes("let content: String"), "InboxPayload must have content: String");
  assert.ok(noteSwift.includes("let updatedAt: Int64"), "InboxPayload must have updatedAt: Int64");
  assert.ok(noteSwift.includes("let closed: Bool"), "InboxPayload must have closed: Bool");
});

test("gui/iphone: SyncService enforces batch size of 10 and idempotency", () => {
  const syncSwift = fs.readFileSync(
    path.join(IPHONE_DIR, "ChiraUra", "Sync", "SyncService.swift"),
    "utf8"
  );

  assert.ok(syncSwift.includes("batchSize: Int = 10"), "SyncService must default to batchSize 10");
  assert.ok(syncSwift.includes("prefix(batchSize)"), "SyncService must process prefix up to batchSize");
  assert.ok(syncSwift.includes("store.removeOutboxItem"), "Must remove sent item from outbox");
});

test("gui/iphone: CI workflow is configured for macos", () => {
  const workflowPath = path.join(REPO_ROOT, ".github", "workflows", "ios.yml");
  assert.ok(fs.existsSync(workflowPath), ".github/workflows/ios.yml must exist");
  const content = fs.readFileSync(workflowPath, "utf8");
  assert.ok(content.includes("runs-on: macos"), "Must run on macos runner");
  assert.ok(content.includes("xcodebuild test"), "Must run xcodebuild test");
  assert.ok(content.includes("xcodebuild build"), "Must run xcodebuild build");
});
