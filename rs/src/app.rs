use eframe::egui;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::thread;
use std::time::Instant;

use crate::config::Config;
use crate::model::Note;
use crate::outbox::Outbox;
use crate::sync::{SyncClient, SyncResult};

enum SyncMsg {
    Result(SyncResult),
}

pub struct ChiraApp {
    content: String,
    current_note: Note,
    outbox: Outbox,
    status_emoji: String,
    status_tooltip: String,
    sync_rx: Receiver<SyncMsg>,
    sync_tx: Sender<SyncMsg>,
    is_syncing: bool,
    start_instant: Instant,
    first_frame_rendered: bool,
    bench_mode: bool,
}

impl ChiraApp {
    pub fn new(cc: &eframe::CreationContext<'_>, start_instant: Instant, bench_mode: bool) -> Self {
        // Visual theme: Sticky note feel (warm light yellow background or clean dark)
        let mut visuals = egui::Visuals::light();
        visuals.panel_fill = egui::Color32::from_rgb(254, 252, 232); // #fefce8 sticky yellow
        visuals.window_fill = egui::Color32::from_rgb(254, 252, 232);
        cc.egui_ctx.set_visuals(visuals);

        let outbox = Outbox::new(Outbox::default_dir()).unwrap_or_else(|_| {
            Outbox::new(std::env::temp_dir().join("chira_outbox")).unwrap()
        });

        let (sync_tx, sync_rx) = channel();

        // Check if there is an active note in outbox to resume, or create new
        let existing = outbox.list_notes().ok().and_then(|list| list.into_iter().last());
        let current_note = existing.unwrap_or_else(|| Note::new(""));
        let content = current_note.content.clone();

        let app = Self {
            content,
            current_note,
            outbox,
            status_emoji: "📝".to_string(),
            status_tooltip: "ローカル保存済み".to_string(),
            sync_rx,
            sync_tx,
            is_syncing: false,
            start_instant,
            first_frame_rendered: false,
            bench_mode,
        };

        // Trigger initial sync of pending outbox
        app.trigger_sync();

        app
    }

    fn trigger_sync(&self) {
        let tx = self.sync_tx.clone();
        let api_url = self.sync_client_api_url();
        let token = self.sync_client_token();
        let outbox_dir = self.outbox.dir().to_path_buf();

        thread::spawn(move || {
            if let Ok(ob) = Outbox::new(outbox_dir) {
                let client = SyncClient::new(api_url, token);
                let res = client.sync_outbox(&ob);
                let _ = tx.send(SyncMsg::Result(res));
            }
        });
    }

    fn sync_client_api_url(&self) -> String {
        let config = Config::load();
        config.api_url.unwrap_or_else(|| "http://127.0.0.1:8787".to_string())
    }

    fn sync_client_token(&self) -> Option<String> {
        let config = Config::load();
        config.token
    }
}

impl eframe::App for ChiraApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        if !self.first_frame_rendered {
            self.first_frame_rendered = true;
            let elapsed = self.start_instant.elapsed();
            if self.bench_mode {
                println!("BENCHMARK_COLD_START_MS: {:.2}", elapsed.as_secs_f64() * 1000.0);
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                return;
            }
        }

        // Process async sync results
        while let Ok(msg) = self.sync_rx.try_recv() {
            self.is_syncing = false;
            match msg {
                SyncMsg::Result(SyncResult::Synced(count)) => {
                    self.status_emoji = "☁️".to_string();
                    self.status_tooltip = format!("{} 件送信済み", count);
                }
                SyncMsg::Result(SyncResult::NoPending) => {
                    self.status_emoji = "📝".to_string();
                    self.status_tooltip = "ローカル保存済み".to_string();
                }
                SyncMsg::Result(SyncResult::NoEndpointOrOffline(err)) => {
                    self.status_emoji = "💾".to_string();
                    self.status_tooltip = format!("未送信 (次回再送): {}", err);
                }
            }
        }

        // Top bar / header: Minimal status icon and action
        egui::TopBottomPanel::top("top_panel")
            .frame(egui::Frame::none().fill(egui::Color32::from_rgb(254, 240, 138)).inner_margin(4.0))
            .show(ctx, |ui| {
                ui.horizontal(|ui| {
                    ui.label(egui::RichText::new("チラ裏").size(11.0).strong().color(egui::Color32::from_rgb(113, 63, 18)));
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        let status_label = ui.label(egui::RichText::new(&self.status_emoji).size(13.0))
                            .on_hover_text(&self.status_tooltip);

                        if status_label.clicked() && !self.is_syncing {
                            self.is_syncing = true;
                            self.status_emoji = "⏳".to_string();
                            self.status_tooltip = "送信中...".to_string();
                            self.trigger_sync();
                        }

                        if ui.small_button("＋ NEW").on_hover_text("新しい付箋メモを作成").clicked() {
                            self.current_note = Note::new("");
                            self.content.clear();
                            self.status_emoji = "✏️".to_string();
                            self.status_tooltip = "未保存".to_string();
                        }

                        if ui.small_button("📋 コピー").on_hover_text("本文をクリップボードにコピー").clicked() {
                            ui.output_mut(|o| o.copied_text = self.content.clone());
                            self.status_emoji = "📋".to_string();
                            self.status_tooltip = "コピー完了".to_string();
                        }
                    });
                });
            });

        // Main editing area: full window sticky text area
        egui::CentralPanel::default()
            .frame(egui::Frame::none().fill(egui::Color32::from_rgb(254, 252, 232)).inner_margin(8.0))
            .show(ctx, |ui| {
                let id = egui::Id::new("memo_editor");
                let response = ui.add_sized(
                    ui.available_size(),
                    egui::TextEdit::multiline(&mut self.content)
                        .id(id)
                        .font(egui::TextStyle::Body)
                        .text_color(egui::Color32::from_rgb(28, 25, 23))
                        .frame(false)
                        .hint_text("ここに書き殴る... (自動保存)")
                );

                // Auto-focus immediately
                if !response.has_focus() {
                    response.request_focus();
                }

                // Instant auto-save to outbox on text change
                if response.changed() {
                    self.current_note.update(&self.content);
                    if let Err(e) = self.outbox.save_note(&self.current_note) {
                        self.status_emoji = "⚠️".to_string();
                        self.status_tooltip = format!("保存失敗: {}", e);
                    } else {
                        self.status_emoji = "📝".to_string();
                        self.status_tooltip = "ローカル保存済み".to_string();
                    }
                }
            });
    }
}
