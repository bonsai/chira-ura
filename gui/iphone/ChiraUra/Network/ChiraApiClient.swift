import Foundation

public protocol ChiraApiClientProtocol {
    func sendInboxPayload(fileName: String, payload: InboxPayload) async throws -> Bool
}

public final class ChiraApiClient: ChiraApiClientProtocol {
    private let session: URLSession
    private let getBaseURL: () -> URL?
    private let getToken: () -> String?

    public init(
        session: URLSession = .shared,
        getBaseURL: @escaping () -> URL? = {
            if let str = UserDefaults.standard.string(forKey: "cloud_url"), let url = URL(string: str) {
                return url
            }
            return nil
        },
        getToken: @escaping () -> String? = {
            UserDefaults.standard.string(forKey: "cloud_token")
        }
    ) {
        self.session = session
        self.getBaseURL = getBaseURL
        self.getToken = getToken
    }

    public func sendInboxPayload(fileName: String, payload: InboxPayload) async throws -> Bool {
        guard let baseURL = getBaseURL() else {
            return false
        }

        let encodedName = fileName.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? fileName
        let endpoint = baseURL.appendingPathComponent("inbox").appendingPathComponent(encodedName)

        var request = URLRequest(url: endpoint)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let token = getToken(), !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.setValue(token, forHTTPHeaderField: "X-Chira-Token")
        }

        let encoder = JSONEncoder()
        request.httpBody = try encoder.encode(payload)

        let (_, response) = try await session.data(for: request)
        if let httpResponse = response as? HTTPURLResponse {
            return (200...299).contains(httpResponse.statusCode)
        }
        return false
    }
}
