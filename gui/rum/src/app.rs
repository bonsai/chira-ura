use crate::editor::{Editor, Mode};
use crate::files::FileManager;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use std::path::{Path, PathBuf};
use std::process::Command;

pub struct App {
    pub editor: Editor,
    pub file_mgr: FileManager,
    pub running: bool,
}

impl App {
    pub fn new(target_path: Option<PathBuf>) -> std::io::Result<Self> {
        let default_dir = dirs::home_dir()
            .map(|h| h.join(".chira").join("md"))
            .unwrap_or_else(|| PathBuf::from("."));

        let target = target_path.unwrap_or(default_dir);

        let (dir, file_to_open) = if target.is_file() {
            let parent = target
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| PathBuf::from("."));
            (parent, Some(target))
        } else {
            (target, None)
        };

        if !dir.exists() {
            let _ = std::fs::create_dir_all(&dir);
        }

        let mut file_mgr = FileManager::new(&dir);
        let mut editor = Editor::new();

        if let Some(ref fp) = file_to_open {
            if fp.exists() {
                let _ = editor.open_file(fp);
                file_mgr.select_path(fp);
            } else {
                editor.file_path = Some(fp.clone());
            }
        } else if let Some(item) = file_mgr.selected_item() {
            let _ = editor.open_file(&item.path);
        }

        Ok(Self {
            editor,
            file_mgr,
            running: true,
        })
    }

    pub fn handle_key_event(&mut self, key: KeyEvent) -> std::io::Result<()> {
        match self.editor.mode {
            Mode::Normal => self.handle_normal_key(key)?,
            Mode::Insert => self.handle_insert_key(key),
            Mode::Command => self.handle_command_key(key)?,
            Mode::Search => self.handle_search_key(key),
        }
        Ok(())
    }

    fn handle_normal_key(&mut self, key: KeyEvent) -> std::io::Result<()> {
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('s') {
            let _ = self.editor.save(None);
            self.file_mgr.reload();
            return Ok(());
        }

        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('n') {
            self.open_next_file();
            return Ok(());
        }

        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('p') {
            self.open_prev_file();
            return Ok(());
        }

        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('r') {
            self.editor.redo();
            return Ok(());
        }

        if let Some(op) = self.editor.pending_operator {
            self.editor.pending_operator = None;
            match (op, key.code) {
                ('d', KeyCode::Char('d')) => {
                    self.editor.delete_line();
                    return Ok(());
                }
                ('y', KeyCode::Char('y')) => {
                    self.editor.yank_line();
                    return Ok(());
                }
                ('g', KeyCode::Char('g')) => {
                    self.editor.move_top();
                    return Ok(());
                }
                _ => {}
            }
        }

        match key.code {
            KeyCode::Char('i') => {
                self.editor.mode = Mode::Insert;
                self.editor.clear_status();
            }
            KeyCode::Char('a') => {
                self.editor.mode = Mode::Insert;
                self.editor.move_right();
                self.editor.clear_status();
            }
            KeyCode::Char('I') => {
                self.editor.mode = Mode::Insert;
                self.editor.move_line_start();
                self.editor.clear_status();
            }
            KeyCode::Char('A') => {
                self.editor.append_line_end();
                self.editor.clear_status();
            }
            KeyCode::Char('o') => {
                self.editor.mode = Mode::Insert;
                self.editor.insert_newline();
                self.editor.clear_status();
            }
            KeyCode::Char('O') => {
                self.editor.mode = Mode::Insert;
                let cur = self.editor.cursor_row;
                self.editor.lines.insert(cur, String::new());
                self.editor.cursor_col = 0;
                self.editor.clear_status();
            }
            KeyCode::Char(':') => {
                self.editor.mode = Mode::Command;
                self.editor.cmd_input.clear();
                self.editor.cmd_cursor = 0;
            }
            KeyCode::Char('/') => {
                self.editor.mode = Mode::Search;
                self.editor.cmd_input.clear();
                self.editor.cmd_cursor = 0;
            }

            KeyCode::Char('h') | KeyCode::Left => self.editor.move_left(),
            KeyCode::Char('l') | KeyCode::Right => self.editor.move_right(),
            KeyCode::Char('k') | KeyCode::Up => self.editor.move_up(),
            KeyCode::Char('j') | KeyCode::Down => self.editor.move_down(),
            KeyCode::Char('w') => self.editor.move_word_forward(),
            KeyCode::Char('b') => self.editor.move_word_backward(),
            KeyCode::Char('0') => self.editor.move_line_start(),
            KeyCode::Char('$') => self.editor.move_line_end(),
            KeyCode::Char('G') => self.editor.move_bottom(),

            KeyCode::Char('d') => self.editor.pending_operator = Some('d'),
            KeyCode::Char('y') => self.editor.pending_operator = Some('y'),
            KeyCode::Char('g') => self.editor.pending_operator = Some('g'),

            KeyCode::Char('x') => self.editor.delete_current_char(),
            KeyCode::Char('p') => self.editor.paste_after(),
            KeyCode::Char('u') => self.editor.undo(),

            KeyCode::Char('n') => self.editor.next_match(),
            KeyCode::Char('N') => self.editor.prev_match(),

            _ => {}
        }

        Ok(())
    }

    fn handle_insert_key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Esc => {
                self.editor.mode = Mode::Normal;
                self.editor.clamp_cursor();
            }
            KeyCode::Char(c) => {
                self.editor.insert_char(c);
            }
            KeyCode::Enter => {
                self.editor.insert_newline();
            }
            KeyCode::Backspace => {
                self.editor.backspace();
            }
            KeyCode::Delete => {
                self.editor.delete_char();
            }
            KeyCode::Tab => {
                self.editor.insert_tab();
            }
            KeyCode::Left => self.editor.move_left(),
            KeyCode::Right => self.editor.move_right(),
            KeyCode::Up => self.editor.move_up(),
            KeyCode::Down => self.editor.move_down(),
            _ => {}
        }
    }

    fn handle_command_key(&mut self, key: KeyEvent) -> std::io::Result<()> {
        match key.code {
            KeyCode::Esc => {
                self.editor.mode = Mode::Normal;
                self.editor.cmd_input.clear();
            }
            KeyCode::Enter => {
                let cmd = self.editor.cmd_input.trim().to_string();
                self.editor.mode = Mode::Normal;
                self.execute_command(&cmd)?;
            }
            KeyCode::Char(c) => {
                self.editor.cmd_input.insert(self.editor.cmd_cursor, c);
                self.editor.cmd_cursor += 1;
            }
            KeyCode::Backspace => {
                if self.editor.cmd_cursor > 0 {
                    self.editor.cmd_cursor -= 1;
                    self.editor.cmd_input.remove(self.editor.cmd_cursor);
                } else if self.editor.cmd_input.is_empty() {
                    self.editor.mode = Mode::Normal;
                }
            }
            KeyCode::Left => {
                if self.editor.cmd_cursor > 0 {
                    self.editor.cmd_cursor -= 1;
                }
            }
            KeyCode::Right if self.editor.cmd_cursor < self.editor.cmd_input.len() => {
                self.editor.cmd_cursor += 1;
            }
            _ => {}
        }
        Ok(())
    }

    fn handle_search_key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Esc => {
                self.editor.mode = Mode::Normal;
                self.editor.cmd_input.clear();
            }
            KeyCode::Enter => {
                let query = self.editor.cmd_input.clone();
                self.editor.mode = Mode::Normal;
                self.editor.execute_search(&query);
            }
            KeyCode::Char(c) => {
                self.editor.cmd_input.insert(self.editor.cmd_cursor, c);
                self.editor.cmd_cursor += 1;
            }
            KeyCode::Backspace => {
                if self.editor.cmd_cursor > 0 {
                    self.editor.cmd_cursor -= 1;
                    self.editor.cmd_input.remove(self.editor.cmd_cursor);
                } else if self.editor.cmd_input.is_empty() {
                    self.editor.mode = Mode::Normal;
                }
            }
            KeyCode::Left => {
                if self.editor.cmd_cursor > 0 {
                    self.editor.cmd_cursor -= 1;
                }
            }
            KeyCode::Right if self.editor.cmd_cursor < self.editor.cmd_input.len() => {
                self.editor.cmd_cursor += 1;
            }
            _ => {}
        }
    }

    pub fn execute_command(&mut self, cmd: &str) -> std::io::Result<()> {
        let parts: Vec<&str> = cmd.split_whitespace().collect();
        if parts.is_empty() {
            return Ok(());
        }

        match parts[0] {
            "w" => {
                let explicit = parts.get(1).map(Path::new);
                match self.editor.save(explicit) {
                    Ok(path) => {
                        self.file_mgr.reload();
                        self.file_mgr.select_path(&path);
                    }
                    Err(e) => {
                        self.editor.set_status(format!("Error writing: {}", e));
                    }
                }
            }
            "q" => {
                if self.editor.modified {
                    self.editor
                        .set_status("No write since last change (add ! to override)");
                } else {
                    self.running = false;
                }
            }
            "q!" => {
                self.running = false;
            }
            "wq" => {
                if let Ok(path) = self.editor.save(None) {
                    self.file_mgr.reload();
                    self.file_mgr.select_path(&path);
                    self.running = false;
                }
            }
            "x" => {
                if self.editor.modified {
                    if let Ok(path) = self.editor.save(None) {
                        self.file_mgr.reload();
                        self.file_mgr.select_path(&path);
                        self.running = false;
                    }
                } else {
                    self.running = false;
                }
            }
            "e" => {
                if let Some(path_str) = parts.get(1) {
                    if self.editor.modified {
                        self.editor
                            .set_status("No write since last change (add ! to override)");
                    } else {
                        let path = PathBuf::from(path_str);
                        if let Err(e) = self.editor.open_file(&path) {
                            self.editor.set_status(format!("Cannot open: {}", e));
                        } else {
                            self.file_mgr.reload();
                            self.file_mgr.select_path(&path);
                        }
                    }
                } else {
                    self.editor.set_status("Usage: :e <path>");
                }
            }
            "e!" => {
                if let Some(path_str) = parts.get(1) {
                    let path = PathBuf::from(path_str);
                    if let Err(e) = self.editor.open_file(&path) {
                        self.editor.set_status(format!("Cannot open: {}", e));
                    } else {
                        self.file_mgr.reload();
                        self.file_mgr.select_path(&path);
                    }
                } else if let Some(ref path) = self.editor.file_path.clone() {
                    let _ = self.editor.open_file(path);
                }
            }
            "new" => {
                self.editor = Editor::new();
                self.editor.set_status("New buffer");
            }
            "next" => {
                self.open_next_file();
            }
            "prev" => {
                self.open_prev_file();
            }
            "md" => {
                let dir_arg = parts.get(1).copied();
                self.run_external_md(dir_arg);
            }
            "sync" => {
                let dir_arg = parts.get(1).copied();
                self.run_external_sync(dir_arg);
            }
            _ => {
                self.editor
                    .set_status(format!("Not an editor command: {}", cmd));
            }
        }

        Ok(())
    }

    fn open_next_file(&mut self) {
        if self.editor.modified {
            self.editor
                .set_status("No write since last change (add ! or save)");
            return;
        }
        if let Some(item) = self.file_mgr.next().cloned() {
            let _ = self.editor.open_file(&item.path);
        }
    }

    fn open_prev_file(&mut self) {
        if self.editor.modified {
            self.editor
                .set_status("No write since last change (add ! or save)");
            return;
        }
        if let Some(item) = self.file_mgr.prev().cloned() {
            let _ = self.editor.open_file(&item.path);
        }
    }

    fn run_external_md(&mut self, dir_arg: Option<&str>) {
        let mut cmd = Command::new("chira");
        cmd.arg("md");
        if let Some(dir) = dir_arg {
            cmd.arg(dir);
        }
        match cmd.output() {
            Ok(output) => {
                if output.status.success() {
                    self.file_mgr.reload();
                    self.editor.set_status("chira md completed");
                } else {
                    let err = String::from_utf8_lossy(&output.stderr);
                    self.editor
                        .set_status(format!("chira md failed: {}", err.trim()));
                }
            }
            Err(e) => {
                self.editor
                    .set_status(format!("Failed to execute chira: {}", e));
            }
        }
    }

    fn run_external_sync(&mut self, dir_arg: Option<&str>) {
        let mut cmd = Command::new("chira");
        cmd.arg("md");
        cmd.arg("import");
        if let Some(dir) = dir_arg {
            cmd.arg(dir);
        }
        match cmd.output() {
            Ok(output) => {
                if output.status.success() {
                    self.file_mgr.reload();
                    self.editor.set_status("chira md import completed");
                } else {
                    let err = String::from_utf8_lossy(&output.stderr);
                    self.editor
                        .set_status(format!("chira md import failed: {}", err.trim()));
                }
            }
            Err(e) => {
                self.editor
                    .set_status(format!("Failed to execute chira: {}", e));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_app_command_flow() {
        let tmp = std::env::temp_dir().join(format!("rum_app_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        let file_a = tmp.join("note1.md");
        fs::write(&file_a, "---\ntitle: Note 1\n---\nHello").unwrap();

        let mut app = App::new(Some(tmp.clone())).unwrap();
        assert_eq!(app.file_mgr.items.len(), 1);

        let file_b = tmp.join("note2.md");
        app.execute_command(&format!("w {}", file_b.display()))
            .unwrap();
        assert!(file_b.exists());

        app.execute_command("q").unwrap();
        assert!(!app.running);

        let _ = fs::remove_dir_all(&tmp);
    }
}
