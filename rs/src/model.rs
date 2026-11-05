use serde::{Deserialize, Serialize};

/// Canonical note data structure shared with crx and cli.
/// Keys and order: { id, title, content, updatedAt }
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
}

impl Note {
    pub fn new(content: &str) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        let rand_part = &uuid::Uuid::new_v4().to_string()[..4];
        let id = format!("note-{}-{}", now, rand_part);
        let title = derive_title(content);
        Self {
            id,
            title,
            content: content.to_string(),
            updated_at: now,
        }
    }

    pub fn update(&mut self, content: &str) {
        self.content = content.to_string();
        self.title = derive_title(content);
        self.updated_at = chrono::Utc::now().timestamp_millis();
    }
}

/// Derive title from the first non-empty line of content, max 30 chars.
/// Matches model.js: deriveTitle()
pub fn derive_title(content: &str) -> String {
    for line in content.lines() {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            let mut chars = trimmed.chars();
            let title: String = chars.by_ref().take(30).collect();
            return title;
        }
    }
    "無題".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_derive_title() {
        assert_eq!(derive_title(""), "無題");
        assert_eq!(derive_title("   \n\n  hello world"), "hello world");
        let long_line = "あ".repeat(40);
        assert_eq!(derive_title(&long_line), "あ".repeat(30));
    }

    #[test]
    fn test_note_canonical_json() {
        let note = Note {
            id: "note-12345-abcd".to_string(),
            title: "テストタイトル".to_string(),
            content: "テストタイトル\n本文2行目".to_string(),
            updated_at: 1730000000000,
        };
        let json_str = serde_json::to_string(&note).unwrap();
        assert!(json_str.contains("\"id\":\"note-12345-abcd\""));
        assert!(json_str.contains("\"title\":\"テストタイトル\""));
        assert!(json_str.contains("\"content\":\"テストタイトル\\n本文2行目\""));
        assert!(json_str.contains("\"updatedAt\":1730000000000"));

        let deserialized: Note = serde_json::from_str(&json_str).unwrap();
        assert_eq!(deserialized, note);
    }
}
