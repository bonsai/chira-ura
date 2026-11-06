use crate::model::Note;
use std::fs;
use std::path::{Path, PathBuf};

pub struct Outbox {
    dir: PathBuf,
}

impl Outbox {
    pub fn default_dir() -> PathBuf {
        if let Ok(custom) = std::env::var("CHIRA_OUTBOX_DIR") {
            return PathBuf::from(custom);
        }
        if let Some(home) = dirs::home_dir() {
            home.join(".chira").join("outbox")
        } else {
            PathBuf::from("./outbox")
        }
    }

    pub fn new(dir: PathBuf) -> std::io::Result<Self> {
        fs::create_dir_all(&dir)?;
        Ok(Self { dir })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Save or overwrite note in outbox as canonical JSON file: <id>.json
    pub fn save_note(&self, note: &Note) -> std::io::Result<PathBuf> {
        let path = self.dir.join(format!("{}.json", note.id));
        let json = serde_json::to_string_pretty(note).map_err(std::io::Error::other)?;
        fs::write(&path, json)?;
        Ok(path)
    }

    /// List all notes in outbox
    pub fn list_notes(&self) -> std::io::Result<Vec<Note>> {
        let mut notes = Vec::new();
        if !self.dir.exists() {
            return Ok(notes);
        }

        for entry in fs::read_dir(&self.dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(note) = serde_json::from_str::<Note>(&content) {
                        notes.push(note);
                    }
                }
            }
        }
        notes.sort_by_key(|n| n.updated_at);
        Ok(notes)
    }

    /// Remove a note from outbox upon successful sync
    pub fn remove_note(&self, id: &str) -> std::io::Result<()> {
        let path = self.dir.join(format!("{}.json", id));
        if path.exists() {
            fs::remove_file(path)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_test_dir() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("chira_test_outbox_{}", nanos));
        let _ = fs::create_dir_all(&path);
        path
    }

    #[test]
    fn test_outbox_save_and_list_and_remove() {
        let dir = temp_test_dir();
        let outbox = Outbox::new(dir.clone()).unwrap();

        let mut note = Note::new("テストメモ1");
        outbox.save_note(&note).unwrap();

        let list = outbox.list_notes().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, note.id);
        assert_eq!(list[0].title, "テストメモ1");

        // Update note
        note.update("テストメモ1 更新版");
        outbox.save_note(&note).unwrap();
        let list2 = outbox.list_notes().unwrap();
        assert_eq!(list2.len(), 1);
        assert_eq!(list2[0].title, "テストメモ1 更新版");

        // Remove note
        outbox.remove_note(&note.id).unwrap();
        let list3 = outbox.list_notes().unwrap();
        assert_eq!(list3.len(), 0);

        let _ = fs::remove_dir_all(dir);
    }
}
