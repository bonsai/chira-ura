import XCTest
@testable import ChiraUra

final class MockApiClient: ChiraApiClientProtocol {
    var shouldSucceed: Bool = true
    var sentCalls: [(fileName: String, payload: InboxPayload)] = []

    func sendInboxPayload(fileName: String, payload: InboxPayload) async throws -> Bool {
        if shouldSucceed {
            sentCalls.append((fileName, payload))
            return true
        } else {
            return false
        }
    }
}

final class MockNoteStore: NoteStoreProtocol {
    var notes: [String: Note] = [:]
    var outbox: [OutboxItem] = []

    func getAllNotes() -> [Note] { Array(notes.values) }
    func getNote(by id: String) -> Note? { notes[id] }
    func saveNote(_ note: Note) { notes[note.id] = note }
    func deleteNote(by id: String) { notes.removeValue(forKey: id) }
    func getPendingOutbox() -> [OutboxItem] { outbox }
    func enqueueOutbox(_ item: OutboxItem) {
        outbox.removeAll { $0.noteId == item.noteId }
        outbox.append(item)
    }
    func removeOutboxItem(by id: String) { outbox.removeAll { $0.id == id } }
    func clearOutbox() { outbox.removeAll() }
}

final class SyncServiceTests: XCTestCase {
    func testSaveAndSyncOnline() async {
        let store = MockNoteStore()
        let client = MockApiClient()
        let service = SyncService(store: store, apiClient: client)

        let note = Note(id: "n-1", content: "テストメモ", updatedAt: 1000)
        let success = await service.saveAndSync(note: note, closed: false)

        XCTAssertTrue(success)
        XCTAssertEqual(store.notes["n-1"]?.content, "テストメモ")
        XCTAssertEqual(client.sentCalls.count, 1)
        XCTAssertEqual(client.sentCalls.first?.fileName, "n-1.txt")
        XCTAssertEqual(store.outbox.count, 0)
    }

    func testSaveAndSyncOfflineFallsBackToOutbox() async {
        let store = MockNoteStore()
        let client = MockApiClient()
        client.shouldSucceed = false
        let service = SyncService(store: store, apiClient: client)

        let note = Note(id: "n-2", content: "オフラインメモ", updatedAt: 2000)
        let success = await service.saveAndSync(note: note, closed: true)

        XCTAssertFalse(success)
        XCTAssertEqual(store.notes["n-2"]?.content, "オフラインメモ")
        XCTAssertEqual(store.outbox.count, 1)
        XCTAssertEqual(store.outbox.first?.noteId, "n-2")
    }

    func testFlushOutboxBatchesTenAndIsIdempotent() async {
        let store = MockNoteStore()
        let client = MockApiClient()
        let service = SyncService(store: store, apiClient: client, batchSize: 10)

        // Queue 25 items
        for i in 1...25 {
            let note = Note(id: "note-\(i)", content: "メモ\(i)", updatedAt: Int64(i * 1000))
            let payload = InboxPayload(content: note.content, updatedAt: note.updatedAt, closed: false)
            let json = try! String(data: JSONEncoder().encode(payload), encoding: .utf8)!
            store.enqueueOutbox(OutboxItem(id: "out-\(i)", noteId: note.id, fileName: "\(note.id).txt", payloadJson: json, createdAt: Int64(i * 1000)))
        }

        XCTAssertEqual(store.outbox.count, 25)

        // First flush: sends 10 items
        let sent1 = await service.flushOutbox()
        XCTAssertEqual(sent1, 10)
        XCTAssertEqual(store.outbox.count, 15)

        // Second flush: sends next 10 items
        let sent2 = await service.flushOutbox()
        XCTAssertEqual(sent2, 10)
        XCTAssertEqual(store.outbox.count, 5)

        // Third flush: sends remaining 5 items
        let sent3 = await service.flushOutbox()
        XCTAssertEqual(sent3, 5)
        XCTAssertEqual(store.outbox.count, 0)

        // Fourth flush: 0 items sent (idempotent, nothing left)
        let sent4 = await service.flushOutbox()
        XCTAssertEqual(sent4, 0)
        XCTAssertEqual(client.sentCalls.count, 25)
    }
}
