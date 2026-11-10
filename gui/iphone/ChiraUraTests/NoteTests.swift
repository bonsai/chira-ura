import XCTest
@testable import ChiraUra

final class NoteTests: XCTestCase {
    func testDeriveTitle() {
        XCTAssertEqual(Note.deriveTitle(from: "1行目タイトル\n2行目本文"), "1行目タイトル")
        XCTAssertEqual(Note.deriveTitle(from: "\n  \n空白行の次\n"), "空白行の次")
        XCTAssertEqual(Note.deriveTitle(from: "   "), "無題")
        XCTAssertEqual(Note.deriveTitle(from: ""), "無題")

        let longText = String(repeating: "あ", count: 50)
        let derived = Note.deriveTitle(from: longText)
        XCTAssertEqual(derived.count, 30)
        XCTAssertEqual(derived, String(repeating: "あ", count: 30))
    }

    func testCanonicalJsonFormat() throws {
        let note = Note(id: "test-note-1", title: "タイトル", content: "本文内容", updatedAt: 1730000000000)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(note)
        let jsonString = String(data: data, encoding: .utf8)

        XCTAssertNotNil(jsonString)
        XCTAssertTrue(jsonString!.contains("\"id\":\"test-note-1\""))
        XCTAssertTrue(jsonString!.contains("\"title\":\"タイトル\""))
        XCTAssertTrue(jsonString!.contains("\"content\":\"本文内容\""))
        XCTAssertTrue(jsonString!.contains("\"updatedAt\":1730000000000"))

        let decoded = try JSONDecoder().decode(Note.self, from: data)
        XCTAssertEqual(decoded.id, note.id)
        XCTAssertEqual(decoded.title, note.title)
        XCTAssertEqual(decoded.content, note.content)
        XCTAssertEqual(decoded.updatedAt, note.updatedAt)
    }

    func testInboxPayloadFormat() throws {
        let payload = InboxPayload(content: "本文", updatedAt: 1730000000000, closed: true)
        let data = try JSONEncoder().encode(payload)
        let decoded = try JSONDecoder().decode(InboxPayload.self, from: data)

        XCTAssertEqual(decoded.content, "本文")
        XCTAssertEqual(decoded.updatedAt, 1730000000000)
        XCTAssertEqual(decoded.closed, true)
    }
}
