pub mod app;
pub mod config;
pub mod model;
pub mod outbox;
pub mod sync;

use std::time::Instant;

fn main() -> eframe::Result<()> {
    let start_instant = Instant::now();
    let bench_mode = std::env::args().any(|arg| arg == "--bench");

    let options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default()
            .with_inner_size([320.0, 360.0])
            .with_min_inner_size([200.0, 200.0])
            .with_title("chira-ura")
            .with_active(true)
            .with_decorations(true),
        ..Default::default()
    };

    eframe::run_native(
        "chira-ura",
        options,
        Box::new(move |cc| {
            Ok(Box::new(app::ChiraApp::new(cc, start_instant, bench_mode)))
        }),
    )
}
