//! Read-only version discovery. Launch compatibility remains owned by the existing core.
use crate::game;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};
#[derive(Debug, Deserialize, Serialize)]
pub struct CatalogVersion {
    #[serde(flatten)]
    pub version: game::Version,
    #[serde(rename = "releaseTime", default)]
    pub release_time: String,
    #[serde(default)]
    pub installed: bool,
}
pub fn load(root: &Path) -> Result<Vec<CatalogVersion>> {
    let cache = root.join("version-manifest.json");
    let read = || -> Result<serde_json::Value> { Ok(serde_json::from_slice(&fs::read(&cache)?)?) };
    let value = match read() {
        Ok(v) => v,
        Err(_) => {
            refresh(root)?;
            read().context("Sürüm kataloğu okunamadı")?
        }
    };
    let entries: Vec<CatalogVersion> = serde_json::from_value(value["versions"].clone())?;
    // Metadata discovery must not hash game files. Verified installation badges
    // are supplied independently by list_installed_versions; launch/install
    // still run the original full integrity checks.
    Ok(entries)
}
#[cfg(test)]
mod tests {
    #[test]
    fn catalog_preserves_all_manifest_kinds_and_checks_actual_files() {
        let root =
            std::env::temp_dir().join(format!("patronlauncher-catalog-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("minecraft/versions/1.18.2")).unwrap();
        std::fs::write(root.join("version-manifest.json"),r#"{"versions":[{"id":"1.18.2","type":"release","url":"https://example.invalid/","sha1":""},{"id":"24w14a","type":"snapshot","url":"","sha1":""},{"id":"b1.7.3","type":"old_beta","url":"","sha1":""},{"id":"a1.2.6","type":"old_alpha","url":"","sha1":""},{"id":"../escape","type":"release","url":"","sha1":""}]}"#).unwrap();
        assert!(!super::load(&root).unwrap()[0].installed);
        for ext in ["jar", "json"] {
            std::fs::write(
                root.join(format!("minecraft/versions/1.18.2/1.18.2.{ext}")),
                b"test",
            )
            .unwrap();
        }
        let entries = super::load(&root).unwrap();
        assert_eq!(entries.len(), 5);
        assert!(!entries[0].installed); // Mere JSON/JAR presence never establishes integrity.
        assert!(!entries[4].installed);
        assert_eq!(entries[1].version.kind, "snapshot");
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod timing {
    #[test]
    #[ignore]
    fn catalog_read_only_benchmark() {
        let root = std::path::PathBuf::from(
            std::env::var("PATRON_CATALOG_BENCH_ROOT").expect("benchmark root"),
        );
        assert!(root.join("version-manifest.json").is_file());
        let start = std::time::Instant::now();
        let entries = super::load(&root).unwrap();
        println!(
            "CATALOG_BENCH: {} entries, {} ms",
            entries.len(),
            start.elapsed().as_millis()
        );
    }
}

pub fn refresh(root: &Path) -> Result<()> {
    use std::io::Read;
    let path = root.join("version-manifest.json");
    let validators = root.join("version-manifest-http.json");
    let headers: serde_json::Value = fs::read(&validators)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    let client = reqwest::blocking::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(crate::modrinth::user_agent())
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()?;
    let mut request = client.get("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
    if path.is_file() {
        if let Some(v) = headers["etag"].as_str() {
            request = request.header(reqwest::header::IF_NONE_MATCH, v);
        }
        if let Some(v) = headers["modified"].as_str() {
            request = request.header(reqwest::header::IF_MODIFIED_SINCE, v);
        }
    }
    let response = request.send()?;
    if response.status() == reqwest::StatusCode::NOT_MODIFIED && path.is_file() {
        return Ok(());
    }
    let response = response.error_for_status()?;
    let etag = response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let modified = response
        .headers()
        .get(reqwest::header::LAST_MODIFIED)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let mut bytes = Vec::new();
    response.take(8 * 1024 * 1024 + 1).read_to_end(&mut bytes)?;
    anyhow::ensure!(bytes.len() <= 8 * 1024 * 1024, "Sürüm manifesti çok büyük.");
    let value: serde_json::Value = serde_json::from_slice(&bytes)?;
    let _: Vec<CatalogVersion> = serde_json::from_value(value["versions"].clone())?;
    fs::create_dir_all(root)?;
    crate::profiles::atomic_write(&path, &bytes)?;
    crate::profiles::atomic_write(
        &validators,
        &serde_json::to_vec(&serde_json::json!({"etag":etag,"modified":modified}))?,
    )?;
    Ok(())
}
pub fn revalidate(app: tauri::AppHandle) {
    use std::sync::atomic::{AtomicBool, Ordering};
    use tauri::Emitter;
    static BUSY: AtomicBool = AtomicBool::new(false);
    if BUSY.swap(true, Ordering::AcqRel) {
        return;
    }
    std::thread::spawn(move || {
        let root = crate::model::data_root();
        let result = refresh(&root);
        let warning = result
            .as_ref()
            .err()
            .map(|_| "Sürüm listesi yenilenemedi; kayıtlı önbellek gösteriliyor.");
        if let Ok(versions) = load(&root) {
            let _ = app.emit_to(
                "main",
                "patronlauncher://catalog",
                serde_json::json!({"versions":versions,"warning":warning}),
            );
        }
        BUSY.store(false, Ordering::Release);
    });
}
