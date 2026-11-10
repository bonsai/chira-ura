import Foundation

public struct OutboxItem: Codable, Identifiable, Equatable {
    public let id: String
    public let noteId: String
    public let fileName: String
    public let payloadJson: String
    public let createdAt: Int64
    public var retryCount: Int

    public init(
        id: String = UUID().uuidString.lowercased(),
        noteId: String,
        fileName: String,
        payloadJson: String,
        createdAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000),
        retryCount: Int = 0
    ) {
        self.id = id
        self.noteId = noteId
        self.fileName = fileName
        self.payloadJson = payloadJson
        self.createdAt = createdAt
        self.retryCount = retryCount
    }
}
