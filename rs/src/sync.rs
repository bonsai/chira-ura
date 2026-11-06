use crate::model::Note;
use crate::outbox::Outbox;
use chrono::{DateTime, Datelike, Timelike, Utc};
use serde_json::json;

pub struct SyncClient {
    api_url: String,
    token: Option<String>,
}

pub struct WikiSyncClient {
    api_base: String,
    owner: String,
    repo: String,
    branch: String,
    token: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum SyncResult {
    Synced(usize),
    NoPending,
    NoEndpointOrOffline(String),
}

#[derive(Debug, PartialEq, Eq)]
pub enum WikiSyncResult {
    Synced { count: usize, commit_sha: String },
    NoPending,
    FailedOrOffline(String),
}

impl SyncClient {
    pub fn new(api_url: String, token: Option<String>) -> Self {
        Self { api_url, token }
    }

    /// Synchronize pending notes from outbox to FE API: PUT /inbox/<id>.txt
    /// If successful, removes the sent note from outbox.
    pub fn sync_outbox(&self, outbox: &Outbox) -> SyncResult {
        let notes = match outbox.list_notes() {
            Ok(n) => n,
            Err(e) => return SyncResult::NoEndpointOrOffline(format!("Outbox error: {}", e)),
        };

        if notes.is_empty() {
            return SyncResult::NoPending;
        }

        let mut synced_count = 0;
        let mut last_err = None;

        for note in &notes {
            match self.send_note(note) {
                Ok(_) => {
                    let _ = outbox.remove_note(&note.id);
                    synced_count += 1;
                }
                Err(e) => {
                    last_err = Some(e);
                    // On network failure, break and preserve remaining in outbox
                    break;
                }
            }
        }

        if synced_count > 0 {
            SyncResult::Synced(synced_count)
        } else if let Some(err) = last_err {
            SyncResult::NoEndpointOrOffline(err)
        } else {
            SyncResult::NoPending
        }
    }

    /// Send a single note: PUT /inbox/<id>.txt
    pub fn send_note(&self, note: &Note) -> Result<(), String> {
        let base_url = self.api_url.trim_end_matches('/');
        let url = format!("{}/inbox/{}.txt", base_url, note.id);

        let mut req = ureq::put(&url)
            .set("Content-Type", "application/json")
            .timeout(std::time::Duration::from_secs(3));

        if let Some(token) = &self.token {
            req = req.set("Authorization", &format!("Bearer {}", token));
        }

        let body = serde_json::to_string(note).map_err(|e| e.to_string())?;

        match req.send_string(&body) {
            Ok(resp) => {
                if resp.status() >= 200 && resp.status() < 300 {
                    Ok(())
                } else {
                    Err(format!("Server returned HTTP {}", resp.status()))
                }
            }
            Err(e) => Err(e.to_string()),
        }
    }
}

impl WikiSyncClient {
    pub fn new(token: String) -> Self {
        Self {
            api_base: "https://api.github.com".to_string(),
            owner: "bonsai".to_string(),
            repo: "wiki".to_string(),
            branch: "master".to_string(),
            token,
        }
    }

    pub fn with_options(
        api_base: String,
        owner: String,
        repo: String,
        branch: String,
        token: String,
    ) -> Self {
        Self {
            api_base,
            owner,
            repo,
            branch,
            token,
        }
    }

    /// Batch push all notes from outbox into bonsai/wiki/raw/<MM>/<timestamp>.txt
    /// in 1 single commit using GitHub Git Data API.
    /// If successful, removes the sent notes from outbox.
    pub fn sync_outbox_to_wiki(&self, outbox: &Outbox) -> WikiSyncResult {
        let notes = match outbox.list_notes() {
            Ok(n) => n,
            Err(e) => return WikiSyncResult::FailedOrOffline(format!("Outbox error: {}", e)),
        };

        if notes.is_empty() {
            return WikiSyncResult::NoPending;
        }

        match self.push_notes_batch(&notes) {
            Ok(commit_sha) => {
                for note in &notes {
                    let _ = outbox.remove_note(&note.id);
                }
                WikiSyncResult::Synced {
                    count: notes.len(),
                    commit_sha,
                }
            }
            Err(e) => WikiSyncResult::FailedOrOffline(e),
        }
    }

    pub fn push_notes_batch(&self, notes: &[Note]) -> Result<String, String> {
        let base = self.api_base.trim_end_matches('/');
        let auth_header = format!("Bearer {}", self.token);

        // 1. Get branch ref
        let ref_url = format!(
            "{}/repos/{}/{}/git/ref/heads/{}",
            base, self.owner, self.repo, self.branch
        );
        let ref_resp = ureq::get(&ref_url)
            .set("Authorization", &auth_header)
            .set("Accept", "application/vnd.github+json")
            .set("User-Agent", "chira-ura-rs")
            .timeout(std::time::Duration::from_secs(5))
            .call()
            .map_err(|e| format!("Ref request failed: {}", e))?;

        let ref_json: serde_json::Value = ref_resp
            .into_json()
            .map_err(|e| format!("Failed to parse ref response: {}", e))?;
        let latest_commit_sha = ref_json["object"]["sha"]
            .as_str()
            .ok_or_else(|| "Missing commit sha in git ref".to_string())?;

        // 2. Get commit to find base_tree
        let commit_url = format!(
            "{}/repos/{}/{}/git/commits/{}",
            base, self.owner, self.repo, latest_commit_sha
        );
        let commit_resp = ureq::get(&commit_url)
            .set("Authorization", &auth_header)
            .set("Accept", "application/vnd.github+json")
            .set("User-Agent", "chira-ura-rs")
            .timeout(std::time::Duration::from_secs(5))
            .call()
            .map_err(|e| format!("Commit request failed: {}", e))?;

        let commit_json: serde_json::Value = commit_resp
            .into_json()
            .map_err(|e| format!("Failed to parse commit response: {}", e))?;
        let base_tree_sha = commit_json["tree"]["sha"]
            .as_str()
            .ok_or_else(|| "Missing tree sha in commit".to_string())?;

        // 3. Prepare tree items: raw/<MM>/<timestamp>.txt
        let mut tree_items = Vec::new();
        let mut file_names = Vec::new();

        for note in notes {
            let dt =
                DateTime::<Utc>::from_timestamp_millis(note.updated_at).unwrap_or_else(Utc::now);
            let mm = format!("{:02}", dt.month());
            let timestamp_file = format!(
                "{:04}{:02}{:02}_{:02}{:02}{:02}.txt",
                dt.year(),
                dt.month(),
                dt.day(),
                dt.hour(),
                dt.minute(),
                dt.second()
            );
            let path = format!("raw/{}/{}", mm, timestamp_file);
            file_names.push(timestamp_file);

            tree_items.push(json!({
                "path": path,
                "mode": "100644",
                "type": "blob",
                "content": note.content
            }));
        }

        // 4. Create new tree
        let tree_url = format!("{}/repos/{}/{}/git/trees", base, self.owner, self.repo);
        let tree_body = json!({
            "base_tree": base_tree_sha,
            "tree": tree_items
        });
        let tree_resp = ureq::post(&tree_url)
            .set("Authorization", &auth_header)
            .set("Accept", "application/vnd.github+json")
            .set("User-Agent", "chira-ura-rs")
            .timeout(std::time::Duration::from_secs(5))
            .send_json(tree_body)
            .map_err(|e| format!("Tree creation failed: {}", e))?;

        let tree_json: serde_json::Value = tree_resp
            .into_json()
            .map_err(|e| format!("Failed to parse tree response: {}", e))?;
        let new_tree_sha = tree_json["sha"]
            .as_str()
            .ok_or_else(|| "Missing sha in created tree".to_string())?;

        // 5. Create new commit
        let commits_url = format!("{}/repos/{}/{}/git/commits", base, self.owner, self.repo);
        let commit_msg = format!(
            "chore(wiki): archive {} memo(s) [{}]",
            notes.len(),
            file_names.join(", ")
        );
        let commit_body = json!({
            "message": commit_msg,
            "tree": new_tree_sha,
            "parents": [latest_commit_sha]
        });
        let new_commit_resp = ureq::post(&commits_url)
            .set("Authorization", &auth_header)
            .set("Accept", "application/vnd.github+json")
            .set("User-Agent", "chira-ura-rs")
            .timeout(std::time::Duration::from_secs(5))
            .send_json(commit_body)
            .map_err(|e| format!("Commit creation failed: {}", e))?;

        let new_commit_json: serde_json::Value = new_commit_resp
            .into_json()
            .map_err(|e| format!("Failed to parse created commit response: {}", e))?;
        let new_commit_sha = new_commit_json["sha"]
            .as_str()
            .ok_or_else(|| "Missing sha in created commit".to_string())?
            .to_string();

        // 6. Update branch ref
        let patch_body = json!({ "sha": new_commit_sha });
        let update_ref_resp = ureq::patch(&ref_url)
            .set("Authorization", &auth_header)
            .set("Accept", "application/vnd.github+json")
            .set("User-Agent", "chira-ura-rs")
            .timeout(std::time::Duration::from_secs(5))
            .send_json(patch_body)
            .map_err(|e| format!("Ref update failed: {}", e))?;

        if update_ref_resp.status() >= 200 && update_ref_resp.status() < 300 {
            Ok(new_commit_sha)
        } else {
            Err(format!(
                "Update ref returned status {}",
                update_ref_resp.status()
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::thread;

    fn temp_test_dir(name: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("chira_test_sync_{}_{}", name, uuid::Uuid::new_v4()));
        let _ = fs::create_dir_all(&path);
        path
    }

    #[test]
    fn test_sync_client_offline_handling() {
        let dir = temp_test_dir("offline");
        let outbox = Outbox::new(dir.clone()).unwrap();

        let note = Note::new("オフライン時のメモ");
        outbox.save_note(&note).unwrap();

        // Target an unused port to simulate offline
        let client = SyncClient::new("http://127.0.0.1:59999".to_string(), None);
        let res = client.sync_outbox(&outbox);

        match res {
            SyncResult::NoEndpointOrOffline(msg) => {
                assert!(!msg.is_empty());
            }
            _ => panic!("Expected offline result"),
        }

        // Outbox note must still be preserved
        let remaining = outbox.list_notes().unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, note.id);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_sync_client_mock_server_success() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let running = Arc::new(AtomicBool::new(true));
        let running_clone = running.clone();

        let server_thread = thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut req_bytes = Vec::new();
                let mut buf = [0u8; 1024];
                loop {
                    let n = stream.read(&mut buf).unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    req_bytes.extend_from_slice(&buf[..n]);
                    if req_bytes.windows(4).any(|w| w == b"\r\n\r\n") {
                        let s = String::from_utf8_lossy(&req_bytes);
                        if let Some(pos) = s.find("Content-Length:") {
                            let len_part = &s[pos + 15..];
                            let len_str = len_part.split("\r\n").next().unwrap_or("0").trim();
                            let content_length: usize = len_str.parse().unwrap_or(0);
                            let header_len = s.find("\r\n\r\n").unwrap() + 4;
                            if req_bytes.len() >= header_len + content_length {
                                break;
                            }
                        } else {
                            break;
                        }
                    }
                }
                let response =
                    "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK";
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
            running_clone.store(false, Ordering::SeqCst);
        });

        let dir = temp_test_dir("mock_srv");
        let outbox = Outbox::new(dir.clone()).unwrap();
        let note = Note::new("同期テストメモ");
        outbox.save_note(&note).unwrap();

        let client = SyncClient::new(
            format!("http://127.0.0.1:{}", port),
            Some("test-token".to_string()),
        );
        let res = client.sync_outbox(&outbox);
        assert_eq!(res, SyncResult::Synced(1));

        // Note should be removed from outbox after success
        let remaining = outbox.list_notes().unwrap();
        assert_eq!(remaining.len(), 0);

        let _ = server_thread.join();
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_wiki_sync_client_batch_push_mock_server() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let server_thread = thread::spawn(move || {
            for step in 0..4 {
                if let Ok((mut stream, _)) = listener.accept() {
                    let mut req_bytes = Vec::new();
                    let mut buf = [0u8; 1024];
                    loop {
                        let n = stream.read(&mut buf).unwrap_or(0);
                        if n == 0 {
                            break;
                        }
                        req_bytes.extend_from_slice(&buf[..n]);
                        if req_bytes.windows(4).any(|w| w == b"\r\n\r\n") {
                            let s = String::from_utf8_lossy(&req_bytes);
                            if let Some(pos) = s.find("Content-Length:") {
                                let len_part = &s[pos + 15..];
                                let len_str = len_part.split("\r\n").next().unwrap_or("0").trim();
                                let content_length: usize = len_str.parse().unwrap_or(0);
                                let header_len = s.find("\r\n\r\n").unwrap() + 4;
                                if req_bytes.len() >= header_len + content_length {
                                    break;
                                }
                            } else {
                                break;
                            }
                        }
                    }
                    let req_str = String::from_utf8_lossy(&req_bytes);

                    let (status, body) = match step {
                        0 => ("200 OK", r#"{"object":{"sha":"commit111"}}"#),
                        1 => ("200 OK", r#"{"tree":{"sha":"tree111"}}"#),
                        2 => {
                            // Tree creation
                            assert!(req_str.contains("raw/"));
                            assert!(req_str.contains("テストWiki本文"));
                            ("201 Created", r#"{"sha":"tree222"}"#)
                        }
                        3 => {
                            // Commit creation
                            assert!(req_str.contains("chore(wiki): archive 1 memo(s)"));
                            ("201 Created", r#"{"sha":"commit222"}"#)
                        }
                        _ => ("200 OK", "{}"),
                    };

                    let response = format!(
                        "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        status,
                        body.len(),
                        body
                    );
                    let _ = stream.write_all(response.as_bytes());
                    let _ = stream.flush();

                    // Step 4 is the PATCH ref update
                    if step == 3 {
                        if let Ok((mut stream2, _)) = listener.accept() {
                            let mut buf2 = [0u8; 4096];
                            let _ = stream2.read(&mut buf2);
                            let resp2 = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK";
                            let _ = stream2.write_all(resp2.as_bytes());
                            let _ = stream2.flush();
                        }
                        break;
                    }
                }
            }
        });

        let dir = temp_test_dir("wiki_mock");
        let outbox = Outbox::new(dir.clone()).unwrap();
        let note = Note::new("テストWiki本文");
        outbox.save_note(&note).unwrap();

        let wiki_client = WikiSyncClient::with_options(
            format!("http://127.0.0.1:{}", port),
            "bonsai".to_string(),
            "wiki".to_string(),
            "master".to_string(),
            "test-token".to_string(),
        );

        let res = wiki_client.sync_outbox_to_wiki(&outbox);
        assert_eq!(
            res,
            WikiSyncResult::Synced {
                count: 1,
                commit_sha: "commit222".to_string(),
            }
        );

        // Note should be removed from outbox after success
        let remaining = outbox.list_notes().unwrap();
        assert_eq!(remaining.len(), 0);

        let _ = server_thread.join();
        let _ = fs::remove_dir_all(dir);
    }
}
