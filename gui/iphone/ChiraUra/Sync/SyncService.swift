import Foundation

public final class SyncService {
    public let store: NoteStoreProtocol
    public let apiClient: ChiraApiClientProtocol
    public let batchSize: Int

    public init(
        store: NoteStoreProtocol,
        apiClient: ChiraApiClientProtocol,
        batchSize: Int = 10
    ) {
        self.store = store
        self.apiClient = apiClient
        self.batchSize = batchSize
    }

    /// Saves note locally and attempts to send to FE API.
    /// If network is offline or fails, note is enqueued to outbox.
    @discardableResult
    public func saveAndSync(note: Note, closed: Bool = false) async -> Bool {
        store.saveNote(note)

        let fileName = "\(note.id).txt"
        let payload = InboxPayload(content: note.content, updatedAt: note.updatedAt, closed: closed)

        do {
            let sent = try await apiClient.sendInboxPayload(fileName: fileName, payload: payload)
            if sent {
                // Sent successfully - remove from outbox if pending
                let pending = store.getPendingOutbox()
                for item in pending where item.noteId == note.id {
                    store.removeOutboxItem(by: item.id)
                }
                return true
            } else {
                enqueueNoteToOutbox(note: note, fileName: fileName, payload: payload)
                return false
            }
        } catch {
            enqueueNoteToOutbox(note: note, fileName: fileName, payload: payload)
            return false
        }
    }

    private func enqueueNoteToOutbox(note: Note, fileName: String, payload: InboxPayload) {
        if let json = try? String(data: JSONEncoder().encode(payload), encoding: .utf8) {
            let item = OutboxItem(noteId: note.id, fileName: fileName, payloadJson: json)
            store.enqueueOutbox(item)
        }
    }

    /// Flushes pending outbox notes in batches of up to `batchSize` (default 10).
    /// Ensures idempotency: successfully sent items are removed, failed items remain for next retry.
    @discardableResult
    public func flushOutbox() async -> Int {
        let pending = store.getPendingOutbox()
        if pending.isEmpty { return 0 }

        let batch = Array(pending.prefix(batchSize))
        var sentCount = 0

        for item in batch {
            guard let data = item.payloadJson.data(using: .utf8),
                  let payload = try? JSONDecoder().decode(InboxPayload.self, from: data) else {
                // Corrupt payload, remove to avoid blocking queue
                store.removeOutboxItem(by: item.id)
                continue
            }

            do {
                let sent = try await apiClient.sendInboxPayload(fileName: item.fileName, payload: payload)
                if sent {
                    store.removeOutboxItem(by: item.id)
                    sentCount += 1
                }
            } catch {
                // Retain in outbox for retry
                break // Stop on connection failure to avoid repeated timeouts
            }
        }

        return sentCount
    }
}
