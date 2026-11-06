use crate::model::Note;
use crate::outbox::Outbox;

pub struct SyncClient {
    api_url: String,
    token: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum SyncResult {
    Synced(usize),
    NoPending,
    NoEndpointOrOffline(String),
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
        let path = std::env::temp_dir().join(format!("chira_test_sync_{}_{}", name, uuid::Uuid::new_v4()));
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
                let mut buf = [0u8; 1024];
                let _ = stream.read(&mut buf);
                let response = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK";
                let _ = stream.write_all(response.as_bytes());
            }
            running_clone.store(false, Ordering::SeqCst);
        });

        let dir = temp_test_dir("mock_srv");
        let outbox = Outbox::new(dir.clone()).unwrap();
        let note = Note::new("同期テストメモ");
        outbox.save_note(&note).unwrap();

        let client = SyncClient::new(format!("http://127.0.0.1:{}", port), Some("test-token".to_string()));
        let res = client.sync_outbox(&outbox);
        assert_eq!(res, SyncResult::Synced(1));

        // Note should be removed from outbox after success
        let remaining = outbox.list_notes().unwrap();
        assert_eq!(remaining.len(), 0);

        let _ = server_thread.join();
        let _ = fs::remove_dir_all(dir);
    }
}
