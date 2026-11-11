use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct FileItem {
    pub path: PathBuf,
    pub name: String,
}

pub struct FileManager {
    pub current_dir: PathBuf,
    pub items: Vec<FileItem>,
    pub selected_idx: usize,
}

impl FileManager {
    pub fn new<P: AsRef<Path>>(dir: P) -> Self {
        let mut fm = Self {
            current_dir: dir.as_ref().to_path_buf(),
            items: Vec::new(),
            selected_idx: 0,
        };
        fm.reload();
        fm
    }

    pub fn reload(&mut self) {
        let mut items = Vec::new();
        if let Ok(entries) = fs::read_dir(&self.current_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') {
                    continue;
                }
                let is_dir = p.is_dir();
                let is_match = p
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|ext| ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("txt"))
                    .unwrap_or(false);

                if is_match && !is_dir {
                    items.push(FileItem { path: p, name });
                }
            }
        }
        items.sort_by_key(|a| a.name.to_lowercase());
        self.items = items;
        if self.selected_idx >= self.items.len() && !self.items.is_empty() {
            self.selected_idx = self.items.len() - 1;
        }
    }

    pub fn select_path<P: AsRef<Path>>(&mut self, path: P) {
        let target = path.as_ref();
        for (i, item) in self.items.iter().enumerate() {
            if item.path == target {
                self.selected_idx = i;
                return;
            }
        }
    }

    pub fn selected_item(&self) -> Option<&FileItem> {
        self.items.get(self.selected_idx)
    }

    #[allow(clippy::should_implement_trait)]
    pub fn next(&mut self) -> Option<&FileItem> {
        if self.items.is_empty() {
            return None;
        }
        self.selected_idx = (self.selected_idx + 1) % self.items.len();
        self.items.get(self.selected_idx)
    }

    pub fn prev(&mut self) -> Option<&FileItem> {
        if self.items.is_empty() {
            return None;
        }
        if self.selected_idx == 0 {
            self.selected_idx = self.items.len() - 1;
        } else {
            self.selected_idx -= 1;
        }
        self.items.get(self.selected_idx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;

    #[test]
    fn test_file_manager_scan() {
        let tmp = std::env::temp_dir().join(format!("rum_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        File::create(tmp.join("b.md")).unwrap();
        File::create(tmp.join("a.txt")).unwrap();
        File::create(tmp.join("c.bin")).unwrap();

        let mut fm = FileManager::new(&tmp);
        assert_eq!(fm.items.len(), 2);
        assert_eq!(fm.items[0].name, "a.txt");
        assert_eq!(fm.items[1].name, "b.md");

        fm.next();
        assert_eq!(fm.selected_idx, 1);
        fm.prev();
        assert_eq!(fm.selected_idx, 0);

        let _ = fs::remove_dir_all(&tmp);
    }
}
