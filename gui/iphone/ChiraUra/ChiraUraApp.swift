import SwiftUI

@main
struct ChiraUraApp: App {
    private let store: NoteStoreProtocol
    private let apiClient: ChiraApiClientProtocol
    private let syncService: SyncService

    init() {
        let localStore = LocalNoteStore()
        let client = ChiraApiClient()
        self.store = localStore
        self.apiClient = client
        self.syncService = SyncService(store: localStore, apiClient: client)
    }

    var body: some Scene {
        WindowGroup {
            StickyNoteView(store: store, syncService: syncService)
        }
    }
}
