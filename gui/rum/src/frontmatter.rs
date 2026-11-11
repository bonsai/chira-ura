use std::time::{SystemTime, UNIX_EPOCH};

/// Front matter の情報
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FrontMatter {
    pub id: Option<String>,
    pub title: Option<String>,
    pub updated_at: Option<String>,
    pub extra_fields: Vec<(String, String)>,
    pub end_line_index: usize,
}

fn rand_suffix() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(12345);
    let s = format!("{:x}", nanos);
    if s.len() >= 4 {
        s[..4].to_string()
    } else {
        format!("{:0>4}", s)
    }
}

pub fn new_note_id() -> String {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("note-{}-{}", now_ms, rand_suffix())
}

pub fn parse_front_matter(lines: &[String]) -> Option<FrontMatter> {
    if lines.is_empty() || lines[0].trim() != "---" {
        return None;
    }

    let mut end_idx = None;
    for (i, line) in lines.iter().enumerate().skip(1) {
        if line.trim() == "---" {
            end_idx = Some(i);
            break;
        }
    }

    let end_idx = end_idx?;
    let mut id = None;
    let mut title = None;
    let mut updated_at = None;
    let mut extra_fields = Vec::new();

    for line in &lines[1..end_idx] {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some((key, val)) = trimmed.split_once(':') {
            let key = key.trim().to_string();
            let val = val.trim().trim_matches('"').trim_matches('\'').to_string();
            match key.as_str() {
                "id" => id = Some(val),
                "title" => title = Some(val),
                "updatedAt" => updated_at = Some(val),
                _ => extra_fields.push((key, val)),
            }
        }
    }

    Some(FrontMatter {
        id,
        title,
        updated_at,
        extra_fields,
        end_line_index: end_idx,
    })
}

pub fn derive_title(content_lines: &[String]) -> String {
    for line in content_lines {
        let t = line.trim();
        if !t.is_empty() {
            let s: String = t.chars().take(30).collect();
            return s;
        }
    }
    "無題".to_string()
}

pub fn prepare_content_for_save(lines: &[String]) -> String {
    if let Some(fm) = parse_front_matter(lines) {
        let body_lines = &lines[fm.end_line_index + 1..];
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);

        let note_id = fm.id.unwrap_or_else(new_note_id);
        let note_title = fm.title.unwrap_or_else(|| derive_title(body_lines));
        let updated_at_val = now_ms.to_string();

        let mut out = Vec::new();
        out.push("---".to_string());
        out.push(format!("id: {}", note_id));
        out.push(format!("title: {}", note_title));
        out.push(format!("updatedAt: {}", updated_at_val));
        for (k, v) in fm.extra_fields {
            out.push(format!("{}: {}", k, v));
        }
        out.push("---".to_string());
        out.extend_from_slice(body_lines);
        out.join("\n")
    } else {
        lines.join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_front_matter_none() {
        let lines = vec!["# Title".to_string(), "Hello world".to_string()];
        assert_eq!(parse_front_matter(&lines), None);
    }

    #[test]
    fn test_parse_front_matter_existing() {
        let lines = vec![
            "---".to_string(),
            "id: note-123".to_string(),
            "title: My Note".to_string(),
            "updatedAt: 100000".to_string(),
            "custom: val".to_string(),
            "---".to_string(),
            "Body content".to_string(),
        ];
        let fm = parse_front_matter(&lines).expect("should parse fm");
        assert_eq!(fm.id.as_deref(), Some("note-123"));
        assert_eq!(fm.title.as_deref(), Some("My Note"));
        assert_eq!(fm.updated_at.as_deref(), Some("100000"));
        assert_eq!(
            fm.extra_fields,
            vec![("custom".to_string(), "val".to_string())]
        );
        assert_eq!(fm.end_line_index, 5);
    }

    #[test]
    fn test_prepare_content_preserves_plain_text() {
        let lines = vec!["Just a plain text".to_string(), "Second line".to_string()];
        let saved = prepare_content_for_save(&lines);
        assert_eq!(saved, "Just a plain text\nSecond line");
        assert!(!saved.contains("---"));
    }

    #[test]
    fn test_prepare_content_updates_front_matter() {
        let lines = vec![
            "---".to_string(),
            "id: note-existing".to_string(),
            "title: Old Title".to_string(),
            "updatedAt: 12345".to_string(),
            "---".to_string(),
            "Hello world".to_string(),
        ];
        let saved = prepare_content_for_save(&lines);
        assert!(saved.starts_with("---\n"));
        assert!(saved.contains("id: note-existing\n"));
        assert!(saved.contains("title: Old Title\n"));
        assert!(!saved.contains("updatedAt: 12345\n"));
        assert!(saved.contains("Hello world"));
    }

    #[test]
    fn test_prepare_content_creates_id_if_missing_in_fm() {
        let lines = vec![
            "---".to_string(),
            "title: Only Title".to_string(),
            "---".to_string(),
            "Body line".to_string(),
        ];
        let saved = prepare_content_for_save(&lines);
        assert!(saved.contains("id: note-"));
        assert!(saved.contains("title: Only Title"));
        assert!(saved.contains("updatedAt: "));
        assert!(saved.ends_with("Body line"));
    }
}
