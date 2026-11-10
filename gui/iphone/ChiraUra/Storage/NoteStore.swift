import Foundation

public protocol NoteStoreProtocol {
    func getAllNotes() -> [Note]
    func getNote(by id: String) -> Note?
    func saveNote(_ note: Note)
    func deleteNote(by id: String)
    func getPendingOutbox() -> [OutboxItem]
    func enqueueOutbox(_ item: OutboxItem)
    func removeOutboxItem(by id: String)
    func clearOutbox()
}

/// Thread-safe local storage for Notes and Outbox items
/// Backed by JSON persistence in the app's Application Support directory (iOS 16+ compatible, SwiftData optional)
public final class LocalNoteStore: NoteStoreProtocol {
    private let queue = DispatchQueue(label: "net.kamicopi.chiraura.notestore", attributes: .concurrent)
    private let fileManager: FileManager
    private let notesFileURL: URL
    private let outboxFileURL: URL

    private var inMemoryNotes: [String: Note] = [:]
    private var inMemoryOutbox: [OutboxItem] = []

    public init(fileManager: FileManager = .default, directory: URL? = nil) {
        self.fileManager = fileManager

        let baseDir: URL
        if let directory = directory {
            baseDir = directory
        } else {
            let appSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first ?? fileManager.temporaryDirectory
            baseDir = appSupport.appendingPathComponent("ChiraUra", isDirectory: true)
        }

        try? fileManager.createDirectory(at: baseDir, withIntermediateDirectories: true)
        self.notesFileURL = baseDir.appendingPathComponent("notes.json")
        self.outboxFileURL = baseDir.appendingPathComponent("outbox.json")

        loadFromDisk()
    }

    private func loadFromDisk() {
        if let data = try? Data(contentsOf: notesFileURL),
           let list = try? JSONDecoder().decode([Note].self, from: data) {
            for note in list {
                inMemoryNotes[note.id] = note
            }
        }

        if let data = try? Data(contentsOf: outboxFileURL),
           let list = try? JSONDecoder().decode([OutboxItem].self, from: data) {
            inMemoryOutbox = list
        }
    }

    private func persistNotesLocked() {
        let list = Array(inMemoryNotes.values)
        if let data = try? JSONEncoder().encode(list) {
            try? data.write(to: notesFileURL, options: .atomic)
        }
    }

    private func persistOutboxLocked() {
        if let data = try? JSONEncoder().encode(inMemoryOutbox) {
            try? data.write(to: outboxFileURL, options: .atomic)
        }
    }

    public func getAllNotes() -> [Note] {
        queue.sync {
            Array(inMemoryNotes.values).sorted { $0.updatedAt > $1.updatedAt }
        }
    }

    public func getNote(by id: String) -> Note? {
        queue.sync {
            inMemoryNotes[id]
        }
    }

    public func saveNote(_ note: Note) {
        queue.async(flags: .barrier) {
            self.inMemoryNotes[note.id] = note
            self.persistNotesLocked()
        }
    }

    public func deleteNote(by id: String) {
        queue.async(flags: .barrier) {
            self.inMemoryNotes.removeValue(forKey: id)
            self.persistNotesLocked()
        }
    }

    public func getPendingOutbox() -> [OutboxItem] {
        queue.sync {
            inMemoryOutbox.sorted { $0.createdAt < $1.createdAt }
        }
    }

    public func enqueueOutbox(_ item: OutboxItem) {
        queue.async(flags: .barrier) {
            // Avoid duplicate noteId in outbox if identical
            self.inMemoryOutbox.removeAll { $0.noteId == item.noteId }
            self.inMemoryOutbox.append(item)
            self.persistOutboxLocked()
        }
    }

    public func removeOutboxItem(by id: String) {
        queue.async(flags: .barrier) {
            self.inMemoryOutbox.removeAll { $0.id == id }
            self.persistOutboxLocked()
        }
    }

    public func clearOutbox() {
        queue.async(flags: .barrier) {
            self.inMemoryOutbox.removeAll()
            self.persistOutboxLocked()
        }
    }
}
