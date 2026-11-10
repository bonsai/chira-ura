import Foundation

public struct Note: Codable, Identifiable, Equatable {
    public let id: String
    public var title: String
    public var content: String
    public var updatedAt: Int64

    public init(id: String = UUID().uuidString.lowercased(), title: String? = nil, content: String, updatedAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) {
        self.id = id
        self.content = content
        self.updatedAt = updatedAt
        self.title = title ?? Note.deriveTitle(from: content)
    }

    public static func deriveTitle(from content: String) -> String {
        let lines = content.components(separatedBy: .newlines)
        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                return String(trimmed.prefix(30))
            }
        }
        return "無題"
    }
}

public struct InboxPayload: Codable, Equatable {
    public let content: String
    public let updatedAt: Int64
    public let closed: Bool

    public init(content: String, updatedAt: Int64, closed: Bool = false) {
        self.content = content
        self.updatedAt = updatedAt
        self.closed = closed
    }
}
