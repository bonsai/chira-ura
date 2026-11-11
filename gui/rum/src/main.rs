mod app;
mod editor;
mod files;
mod frontmatter;
mod ui;

use app::App;
use crossterm::{
    event::{self, Event},
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use ratatui::Terminal;
use ratatui::backend::CrosstermBackend;
use std::env;
use std::io::{self, stdout};
use std::path::PathBuf;
use std::time::Duration;

fn main() -> io::Result<()> {
    let args: Vec<String> = env::args().collect();
    let target_path = args.get(1).map(PathBuf::from);

    let mut app = App::new(target_path)?;

    enable_raw_mode()?;
    let mut stdout = stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let res = run_app(&mut terminal, &mut app);

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    if let Err(err) = res {
        eprintln!("Error: {:?}", err);
    }

    Ok(())
}

fn run_app(terminal: &mut Terminal<CrosstermBackend<io::Stdout>>, app: &mut App) -> io::Result<()> {
    while app.running {
        terminal
            .draw(|f| {
                ui::render(f, &mut app.editor, &app.file_mgr);
            })
            .map_err(|e| io::Error::other(e.to_string()))?;

        #[allow(clippy::collapsible_if)]
        if event::poll(Duration::from_millis(100))? {
            if let Ok(Event::Key(key)) = event::read() {
                if key.kind == crossterm::event::KeyEventKind::Press {
                    app.handle_key_event(key)?;
                }
            }
        }
    }
    Ok(())
}
