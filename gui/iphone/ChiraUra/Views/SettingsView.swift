import SwiftUI

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage("cloud_url") private var cloudUrl: String = ""
    @AppStorage("cloud_token") private var cloudToken: String = ""

    var body: some View {
        NavigationStack {
            Form {
                Section(header: Text("FE API 設定")) {
                    TextField("https://<worker>.workers.dev", text: $cloudUrl)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                        .keyboardType(.URL)

                    SecureField("CHIRA_TOKEN (オプション)", text: $cloudToken)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                }

                Section(footer: Text("Cloudflare Worker FE API (PUT /inbox/<name>) への同期に使用します。")) {
                    EmptyView()
                }
            }
            .navigationTitle("設定")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完了") {
                        dismiss()
                    }
                }
            }
        }
    }
}
