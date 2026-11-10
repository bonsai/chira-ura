import SwiftUI

struct StickyNoteView: View {
    @StateObject private var networkMonitor = NetworkMonitor.shared
    @State private var currentNote: Note = Note(content: "")
    @State private var statusEmoji: String = "📝"
    @State private var statusMessage: String = "白紙"
    @State private var pendingCount: Int = 0
    @State private var showSettings: Bool = false
    @FocusState private var isEditorFocused: Bool

    let store: NoteStoreProtocol
    let syncService: SyncService

    // Sticky note color
    private let yellowStickyBackground = Color(red: 254 / 255.0, green: 250 / 255.0, blue: 215 / 255.0)

    var body: some View {
        VStack(spacing: 0) {
            // Header: Status and Quick Actions
            HStack {
                HStack(spacing: 6) {
                    Text(statusEmoji)
                    Text(statusMessage)
                        .font(.system(size: 13, weight: .medium, design: .monospaced))
                        .foregroundColor(.secondary)
                }

                Spacer()

                if pendingCount > 0 {
                    Button(action: {
                        Task { await triggerManualSync() }
                    }) {
                        HStack(spacing: 2) {
                            Text("☁️")
                            Text("\(pendingCount)")
                                .font(.system(size: 12, weight: .bold))
                        }
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.orange.opacity(0.2))
                        .cornerRadius(6)
                    }
                }

                Button(action: {
                    showSettings = true
                }) {
                    Image(systemName: "gearshape")
                        .foregroundColor(.secondary)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(Color(UIColor.secondarySystemBackground))

            // Body: Sticky note text editor
            ZStack(alignment: .topLeading) {
                yellowStickyBackground
                    .ignoresSafeArea(.container, edges: .bottom)

                if currentNote.content.isEmpty {
                    Text("何か書く...")
                        .foregroundColor(Color.black.opacity(0.35))
                        .padding(.horizontal, 20)
                        .padding(.vertical, 16)
                        .allowsHitTesting(false)
                }

                TextEditor(text: Binding(
                    get: { currentNote.content },
                    set: { newText in
                        currentNote.content = newText
                        currentNote.updatedAt = Int64(Date().timeIntervalSince1970 * 1000)
                        currentNote.title = Note.deriveTitle(from: newText)
                        handleContentChanged()
                    }
                ))
                .focused($isEditorFocused)
                .scrollContentBackground(.hidden)
                .background(Color.clear)
                .foregroundColor(.black)
                .font(.system(size: 16, design: .default))
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }

            // Footer: 3-column action bar (📝 ｜ ＋ ｜ ☁️)
            HStack(spacing: 0) {
                Button(action: {
                    // Force immediate save & sync
                    Task {
                        await saveCurrentNote(closed: false)
                    }
                }) {
                    VStack(spacing: 2) {
                        Text("📝")
                            .font(.system(size: 20))
                        Text("保存")
                            .font(.system(size: 11))
                            .foregroundColor(.primary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }

                Divider()
                    .frame(height: 36)

                Button(action: {
                    // Finish current note as closed and start a new blank note
                    Task {
                        await finishAndNewNote()
                    }
                }) {
                    VStack(spacing: 2) {
                        Text("＋")
                            .font(.system(size: 22, weight: .bold))
                        Text("新規")
                            .font(.system(size: 11))
                            .foregroundColor(.primary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }

                Divider()
                    .frame(height: 36)

                Button(action: {
                    Task {
                        await triggerManualSync()
                    }
                }) {
                    VStack(spacing: 2) {
                        Text(networkMonitor.isConnected ? "☁️" : "📡")
                            .font(.system(size: 20))
                        Text(networkMonitor.isConnected ? "送信" : "オフライン")
                            .font(.system(size: 11))
                            .foregroundColor(.primary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .frame(height: 60)
            .background(Color(UIColor.secondarySystemBackground))
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
        .onAppear {
            updatePendingCount()
            // High speed: auto-focus keyboard immediately (<300ms)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                isEditorFocused = true
            }
        }
        .onChange(of: networkMonitor.isConnected) { connected in
            if connected {
                Task {
                    await triggerManualSync()
                }
            }
        }
    }

    private func handleContentChanged() {
        statusEmoji = "✏️"
        statusMessage = "編集中"
        // Immediate local save
        store.saveNote(currentNote)
    }

    private func saveCurrentNote(closed: Bool) async {
        guard !currentNote.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            statusEmoji = "📝"
            statusMessage = "白紙"
            return
        }

        let sent = await syncService.saveAndSync(note: currentNote, closed: closed)
        updatePendingCount()

        if sent {
            statusEmoji = "☁️"
            statusMessage = "送信完了"
        } else {
            statusEmoji = "💾"
            statusMessage = "ローカル保存済"
        }
    }

    private func finishAndNewNote() async {
        if !currentNote.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            await saveCurrentNote(closed: true)
        }
        // Open fresh blank note
        currentNote = Note(content: "")
        statusEmoji = "📝"
        statusMessage = "白紙"
        isEditorFocused = true
    }

    private func triggerManualSync() async {
        let sent = await syncService.flushOutbox()
        updatePendingCount()
        if sent > 0 {
            statusEmoji = "☁️"
            statusMessage = "\(sent)件 送信完了"
        }
    }

    private func updatePendingCount() {
        pendingCount = store.getPendingOutbox().count
    }
}
