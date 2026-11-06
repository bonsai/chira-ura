use serde::Deserialize;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub api_url: Option<String>,
    pub token: Option<String>,
}

impl Config {
    pub fn load() -> Self {
        // 1. Env vars take precedence
        let env_api_url = std::env::var("CHIRA_API_URL").ok();
        let env_token = std::env::var("CHIRA_TOKEN")
            .or_else(|_| std::env::var("API_TOKEN"))
            .ok();

        // 2. Load from ~/.config/chira-ura/config.json or keys.json
        let file_config = Self::load_from_file();

        Self {
            api_url: env_api_url
                .or(file_config.as_ref().and_then(|c| c.api_url.clone()))
                .or_else(|| Some("http://127.0.0.1:8787".to_string())),
            token: env_token.or(file_config.as_ref().and_then(|c| c.token.clone())),
        }
    }

    fn config_path() -> Option<PathBuf> {
        let config_dir = dirs::config_dir()?.join("chira-ura");
        let primary = config_dir.join("config.json");
        if primary.exists() {
            return Some(primary);
        }
        let secondary = config_dir.join("keys.json");
        if secondary.exists() {
            return Some(secondary);
        }
        Some(primary)
    }

    fn load_from_file() -> Option<Self> {
        let path = Self::config_path()?;
        if !path.exists() {
            return None;
        }
        let data = fs::read_to_string(path).ok()?;
        serde_json::from_str(&data).ok()
    }
}
