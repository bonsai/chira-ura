use crate::frontmatter::{parse_front_matter, prepare_content_for_save};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Normal,
    Insert,
    Command,
    Search,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum YankType {
    Lines(Vec<String>),
    Chars(String),
}

#[derive(Debug, Clone)]
struct Snapshot {
    lines: Vec<String>,
    cursor_row: usize,
    cursor_col: usize,
}

pub struct Editor {
    pub file_path: Option<PathBuf>,
    pub lines: Vec<String>,
    pub cursor_row: usize,
    pub cursor_col: usize,
    pub mode: Mode,
    pub modified: bool,

    undo_stack: Vec<Snapshot>,
    redo_stack: Vec<Snapshot>,

    pub yank_buffer: Option<YankType>,
    pub pending_operator: Option<char>,

    pub cmd_input: String,
    pub cmd_cursor: usize,
    pub status_message: Option<String>,

    pub search_query: String,
    pub search_matches: Vec<(usize, usize)>,
    pub current_match_idx: Option<usize>,

    pub scroll_row: usize,
    pub scroll_col: usize,
}

impl Default for Editor {
    fn default() -> Self {
        Self::new()
    }
}

impl Editor {
    pub fn new() -> Self {
        Self {
            file_path: None,
            lines: vec![String::new()],
            cursor_row: 0,
            cursor_col: 0,
            mode: Mode::Normal,
            modified: false,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            yank_buffer: None,
            pending_operator: None,
            cmd_input: String::new(),
            cmd_cursor: 0,
            status_message: None,
            search_query: String::new(),
            search_matches: Vec::new(),
            current_match_idx: None,
            scroll_row: 0,
            scroll_col: 0,
        }
    }

    pub fn open_file<P: AsRef<Path>>(&mut self, path: P) -> std::io::Result<()> {
        let content = fs::read_to_string(&path)?;
        let lines: Vec<String> = content
            .split('\n')
            .map(|s| s.trim_end_matches('\r').to_string())
            .collect();
        self.file_path = Some(path.as_ref().to_path_buf());
        self.lines = if lines.is_empty() {
            vec![String::new()]
        } else {
            lines
        };
        self.cursor_row = 0;
        self.cursor_col = 0;
        self.scroll_row = 0;
        self.scroll_col = 0;
        self.modified = false;
        self.mode = Mode::Normal;
        self.pending_operator = None;
        self.undo_stack.clear();
        self.redo_stack.clear();
        self.search_matches.clear();
        self.current_match_idx = None;
        self.set_status(format!("Opened {}", path.as_ref().display()));
        Ok(())
    }

    pub fn set_status<S: Into<String>>(&mut self, msg: S) {
        self.status_message = Some(msg.into());
    }

    pub fn clear_status(&mut self) {
        self.status_message = None;
    }

    pub fn is_frontmatter_line(&self, row: usize) -> bool {
        if let Some(fm) = parse_front_matter(&self.lines) {
            row <= fm.end_line_index
        } else {
            false
        }
    }

    fn push_undo(&mut self) {
        self.undo_stack.push(Snapshot {
            lines: self.lines.clone(),
            cursor_row: self.cursor_row,
            cursor_col: self.cursor_col,
        });
        self.redo_stack.clear();
        self.modified = true;
    }

    pub fn undo(&mut self) {
        if let Some(snap) = self.undo_stack.pop() {
            self.redo_stack.push(Snapshot {
                lines: self.lines.clone(),
                cursor_row: self.cursor_row,
                cursor_col: self.cursor_col,
            });
            self.lines = snap.lines;
            self.cursor_row = snap.cursor_row;
            self.cursor_col = snap.cursor_col;
            self.clamp_cursor();
            self.modified = true;
            self.set_status("Undo");
        } else {
            self.set_status("Already at oldest change");
        }
    }

    pub fn redo(&mut self) {
        if let Some(snap) = self.redo_stack.pop() {
            self.undo_stack.push(Snapshot {
                lines: self.lines.clone(),
                cursor_row: self.cursor_row,
                cursor_col: self.cursor_col,
            });
            self.lines = snap.lines;
            self.cursor_row = snap.cursor_row;
            self.cursor_col = snap.cursor_col;
            self.clamp_cursor();
            self.modified = true;
            self.set_status("Redo");
        } else {
            self.set_status("Already at newest change");
        }
    }

    pub fn clamp_cursor(&mut self) {
        if self.lines.is_empty() {
            self.lines.push(String::new());
        }
        if self.cursor_row >= self.lines.len() {
            self.cursor_row = self.lines.len() - 1;
        }
        let line_len = self.lines[self.cursor_row].chars().count();
        if self.mode == Mode::Insert {
            if self.cursor_col > line_len {
                self.cursor_col = line_len;
            }
        } else if line_len == 0 {
            self.cursor_col = 0;
        } else if self.cursor_col >= line_len {
            self.cursor_col = line_len - 1;
        }
    }

    pub fn save(&mut self, explicit_path: Option<&Path>) -> std::io::Result<PathBuf> {
        let path = if let Some(p) = explicit_path {
            p.to_path_buf()
        } else if let Some(ref p) = self.file_path {
            p.clone()
        } else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "No file name",
            ));
        };

        let content = prepare_content_for_save(&self.lines);
        fs::write(&path, content)?;
        let new_lines: Vec<String> = fs::read_to_string(&path)?
            .split('\n')
            .map(|s| s.trim_end_matches('\r').to_string())
            .collect();
        self.lines = if new_lines.is_empty() {
            vec![String::new()]
        } else {
            new_lines
        };
        self.file_path = Some(path.clone());
        self.modified = false;
        self.clamp_cursor();
        self.set_status(format!("\"{}\" written", path.display()));
        Ok(path)
    }

    pub fn insert_char(&mut self, c: char) {
        self.push_undo();
        let row = self.cursor_row;
        let col = self.cursor_col;
        let mut chars: Vec<char> = self.lines[row].chars().collect();
        if col >= chars.len() {
            chars.push(c);
        } else {
            chars.insert(col, c);
        }
        self.lines[row] = chars.into_iter().collect();
        self.cursor_col += 1;
    }

    pub fn insert_tab(&mut self) {
        self.insert_char(' ');
        self.insert_char(' ');
    }

    pub fn insert_newline(&mut self) {
        self.push_undo();
        let row = self.cursor_row;
        let col = self.cursor_col;
        let chars: Vec<char> = self.lines[row].chars().collect();
        let (left, right) = chars.split_at(col.min(chars.len()));
        let left_str: String = left.iter().collect();
        let right_str: String = right.iter().collect();

        self.lines[row] = left_str;
        self.lines.insert(row + 1, right_str);
        self.cursor_row += 1;
        self.cursor_col = 0;
    }

    pub fn backspace(&mut self) {
        if self.cursor_col > 0 {
            self.push_undo();
            let row = self.cursor_row;
            let col = self.cursor_col;
            let mut chars: Vec<char> = self.lines[row].chars().collect();
            chars.remove(col - 1);
            self.lines[row] = chars.into_iter().collect();
            self.cursor_col -= 1;
        } else if self.cursor_row > 0 {
            self.push_undo();
            let row = self.cursor_row;
            let prev_len = self.lines[row - 1].chars().count();
            let cur_line = self.lines.remove(row);
            self.lines[row - 1].push_str(&cur_line);
            self.cursor_row -= 1;
            self.cursor_col = prev_len;
        }
    }

    pub fn delete_char(&mut self) {
        let row = self.cursor_row;
        let col = self.cursor_col;
        let mut chars: Vec<char> = self.lines[row].chars().collect();
        if col < chars.len() {
            self.push_undo();
            chars.remove(col);
            self.lines[row] = chars.into_iter().collect();
            self.clamp_cursor();
        } else if row + 1 < self.lines.len() {
            self.push_undo();
            let next_line = self.lines.remove(row + 1);
            self.lines[row].push_str(&next_line);
            self.clamp_cursor();
        }
    }

    pub fn move_left(&mut self) {
        if self.cursor_col > 0 {
            self.cursor_col -= 1;
        }
    }

    pub fn move_right(&mut self) {
        let limit = if self.mode == Mode::Insert {
            self.lines[self.cursor_row].chars().count()
        } else {
            self.lines[self.cursor_row]
                .chars()
                .count()
                .saturating_sub(1)
        };
        if self.cursor_col < limit {
            self.cursor_col += 1;
        }
    }

    pub fn move_up(&mut self) {
        if self.cursor_row > 0 {
            self.cursor_row -= 1;
            self.clamp_cursor();
        }
    }

    pub fn move_down(&mut self) {
        if self.cursor_row + 1 < self.lines.len() {
            self.cursor_row += 1;
            self.clamp_cursor();
        }
    }

    pub fn move_line_start(&mut self) {
        self.cursor_col = 0;
    }

    pub fn move_line_end(&mut self) {
        let len = self.lines[self.cursor_row].chars().count();
        self.cursor_col = if self.mode == Mode::Insert {
            len
        } else {
            len.saturating_sub(1)
        };
    }

    pub fn append_line_end(&mut self) {
        self.mode = Mode::Insert;
        self.cursor_col = self.lines[self.cursor_row].chars().count();
    }

    pub fn move_top(&mut self) {
        self.cursor_row = 0;
        self.cursor_col = 0;
    }

    pub fn move_bottom(&mut self) {
        if !self.lines.is_empty() {
            self.cursor_row = self.lines.len() - 1;
            self.cursor_col = 0;
            self.clamp_cursor();
        }
    }

    pub fn move_word_forward(&mut self) {
        let chars: Vec<char> = self.lines[self.cursor_row].chars().collect();
        let mut col = self.cursor_col;
        if col < chars.len() {
            let is_ws = chars[col].is_whitespace();
            while col < chars.len() && chars[col].is_whitespace() == is_ws {
                col += 1;
            }
            while col < chars.len() && chars[col].is_whitespace() {
                col += 1;
            }
        }
        if col >= chars.len() {
            if self.cursor_row + 1 < self.lines.len() {
                self.cursor_row += 1;
                self.cursor_col = 0;
                let next_chars: Vec<char> = self.lines[self.cursor_row].chars().collect();
                let mut c = 0;
                while c < next_chars.len() && next_chars[c].is_whitespace() {
                    c += 1;
                }
                self.cursor_col = c;
            } else {
                self.cursor_col = chars.len().saturating_sub(1);
            }
        } else {
            self.cursor_col = col;
        }
        self.clamp_cursor();
    }

    pub fn move_word_backward(&mut self) {
        if self.cursor_col == 0 {
            if self.cursor_row > 0 {
                self.cursor_row -= 1;
                let len = self.lines[self.cursor_row].chars().count();
                self.cursor_col = len.saturating_sub(1);
            }
            return;
        }
        let chars: Vec<char> = self.lines[self.cursor_row].chars().collect();
        let mut col = self.cursor_col.min(chars.len());
        if col > 0 {
            col -= 1;
            while col > 0 && chars[col].is_whitespace() {
                col -= 1;
            }
            let is_ws = chars[col].is_whitespace();
            while col > 0 && chars[col - 1].is_whitespace() == is_ws {
                col -= 1;
            }
        }
        self.cursor_col = col;
        self.clamp_cursor();
    }

    pub fn delete_current_char(&mut self) {
        let row = self.cursor_row;
        let col = self.cursor_col;
        let mut chars: Vec<char> = self.lines[row].chars().collect();
        if col < chars.len() {
            self.push_undo();
            let c = chars.remove(col);
            self.yank_buffer = Some(YankType::Chars(c.to_string()));
            self.lines[row] = chars.into_iter().collect();
            self.clamp_cursor();
        }
    }

    pub fn delete_line(&mut self) {
        self.push_undo();
        let row = self.cursor_row;
        let deleted = self.lines.remove(row);
        self.yank_buffer = Some(YankType::Lines(vec![deleted]));
        if self.lines.is_empty() {
            self.lines.push(String::new());
        }
        self.clamp_cursor();
    }

    pub fn yank_line(&mut self) {
        let row = self.cursor_row;
        let line = self.lines[row].clone();
        self.yank_buffer = Some(YankType::Lines(vec![line]));
        self.set_status("1 line yanked");
    }

    pub fn paste_after(&mut self) {
        if let Some(ref yk) = self.yank_buffer.clone() {
            self.push_undo();
            match yk {
                YankType::Lines(lines) => {
                    let insert_pos = self.cursor_row + 1;
                    for (i, line) in lines.iter().enumerate() {
                        self.lines.insert(insert_pos + i, line.clone());
                    }
                    self.cursor_row = insert_pos;
                    self.cursor_col = 0;
                }
                YankType::Chars(chars) => {
                    let row = self.cursor_row;
                    let col = (self.cursor_col + 1).min(self.lines[row].chars().count());
                    let mut line_chars: Vec<char> = self.lines[row].chars().collect();
                    for (i, c) in chars.chars().enumerate() {
                        line_chars.insert(col + i, c);
                    }
                    self.lines[row] = line_chars.into_iter().collect();
                    self.cursor_col = col + chars.chars().count() - 1;
                }
            }
            self.clamp_cursor();
        }
    }

    pub fn execute_search(&mut self, query: &str) {
        self.search_query = query.to_string();
        self.search_matches.clear();
        if query.is_empty() {
            self.current_match_idx = None;
            return;
        }

        for (r, line) in self.lines.iter().enumerate() {
            let mut start = 0;
            while let Some(idx) = line[start..].find(query) {
                let char_idx = line[..start + idx].chars().count();
                self.search_matches.push((r, char_idx));
                start += idx + query.len().max(1);
            }
        }

        if self.search_matches.is_empty() {
            self.current_match_idx = None;
            self.set_status(format!("Pattern not found: {}", query));
        } else {
            let cur = (self.cursor_row, self.cursor_col);
            let mut found_idx = 0;
            for (i, &m) in self.search_matches.iter().enumerate() {
                if m >= cur {
                    found_idx = i;
                    break;
                }
            }
            self.current_match_idx = Some(found_idx);
            self.jump_to_current_match();
        }
    }

    pub fn next_match(&mut self) {
        if self.search_matches.is_empty() {
            return;
        }
        let next_idx = match self.current_match_idx {
            Some(i) => (i + 1) % self.search_matches.len(),
            None => 0,
        };
        self.current_match_idx = Some(next_idx);
        self.jump_to_current_match();
    }

    pub fn prev_match(&mut self) {
        if self.search_matches.is_empty() {
            return;
        }
        let prev_idx = match self.current_match_idx {
            Some(i) => {
                if i == 0 {
                    self.search_matches.len() - 1
                } else {
                    i - 1
                }
            }
            None => 0,
        };
        self.current_match_idx = Some(prev_idx);
        self.jump_to_current_match();
    }

    fn jump_to_current_match(&mut self) {
        let match_pos = self
            .current_match_idx
            .and_then(|idx| self.search_matches.get(idx).copied());
        if let Some((r, c)) = match_pos {
            self.cursor_row = r;
            self.cursor_col = c;
            self.clamp_cursor();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_editor_insert_and_normal_navigation() {
        let mut ed = Editor::new();
        ed.mode = Mode::Insert;
        for c in "hello world".chars() {
            ed.insert_char(c);
        }
        assert_eq!(ed.lines[0], "hello world");
        assert_eq!(ed.cursor_col, 11);

        ed.mode = Mode::Normal;
        ed.clamp_cursor();
        assert_eq!(ed.cursor_col, 10);

        ed.move_left();
        assert_eq!(ed.cursor_col, 9);
        ed.move_line_start();
        assert_eq!(ed.cursor_col, 0);
        ed.move_word_forward();
        assert_eq!(ed.cursor_col, 6);
        ed.move_word_backward();
        assert_eq!(ed.cursor_col, 0);
    }

    #[test]
    fn test_editor_delete_and_yank_paste() {
        let mut ed = Editor::new();
        ed.lines = vec!["line 1".to_string(), "line 2".to_string()];
        ed.cursor_row = 0;
        ed.yank_line();
        assert_eq!(
            ed.yank_buffer,
            Some(YankType::Lines(vec!["line 1".to_string()]))
        );

        ed.paste_after();
        assert_eq!(ed.lines.len(), 3);
        assert_eq!(ed.lines[1], "line 1");

        ed.delete_line();
        assert_eq!(ed.lines.len(), 2);
    }

    #[test]
    fn test_editor_undo_redo() {
        let mut ed = Editor::new();
        ed.mode = Mode::Insert;
        ed.insert_char('a');
        ed.insert_char('b');
        assert_eq!(ed.lines[0], "ab");

        ed.undo();
        assert_eq!(ed.lines[0], "a");
        ed.redo();
        assert_eq!(ed.lines[0], "ab");
    }

    #[test]
    fn test_editor_search() {
        let mut ed = Editor::new();
        ed.lines = vec!["foo bar".to_string(), "bar baz".to_string()];
        ed.execute_search("bar");
        assert_eq!(ed.search_matches, vec![(0, 4), (1, 0)]);
        assert_eq!(ed.current_match_idx, Some(0));

        ed.next_match();
        assert_eq!(ed.current_match_idx, Some(1));
        assert_eq!(ed.cursor_row, 1);
        assert_eq!(ed.cursor_col, 0);

        ed.prev_match();
        assert_eq!(ed.current_match_idx, Some(0));
        assert_eq!(ed.cursor_row, 0);
        assert_eq!(ed.cursor_col, 4);
    }
}
