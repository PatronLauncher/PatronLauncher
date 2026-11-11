//! Doğrulanmış dosya önbelleği.
//!
//! Bir dosya SHA özetiyle bir kez doğrulandığında boyutu ve son değişme zamanı kaydedilir.
//! Sonraki başlatmalarda ikisi de aynıysa dosya yeniden okunmaz; böylece yüzlerce MB'lık
//! oyun kaynağı her "Oyna"da baştan özetlenmez. Boyutu/zamanı değişen, silinen ya da
//! kayıtta olmayan dosya her zaman tam doğrulanır (gerekirse yeniden indirilir).
//!
//! Önbellek yalnızca bir [`Session`] açıkken etkindir; açık değilse eski davranış
//! (her seferinde tam doğrulama) aynen sürer.
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};

#[derive(Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct Entry {
    len: u64,
    /// UNIX zamanından beri nanosaniye.
    modified: u64,
    hash: String,
}

#[derive(Default, serde::Serialize, serde::Deserialize)]
struct Stored {
    version: u32,
    entries: HashMap<String, Entry>,
}

struct Cache {
    file: PathBuf,
    /// Bu önbelleğin kapsadığı klasör (küçük harfli yol öneki).
    scope: String,
    entries: HashMap<String, Entry>,
    dirty: bool,
    sessions: usize,
}

/// Kök klasör başına bir önbellek; farklı veri kökleri birbirini etkilemez.
static CACHES: Mutex<Vec<Cache>> = Mutex::new(Vec::new());
const VERSION: u32 = 1;

/// Windows yolları büyük/küçük harf duyarsızdır.
fn key(path: &Path) -> String {
    path.to_string_lossy().to_lowercase()
}

fn stamp(path: &Path) -> Option<(u64, u64)> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let modified = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_nanos();
    Some((meta.len(), u64::try_from(modified).ok()?))
}

fn lock() -> std::sync::MutexGuard<'static, Vec<Cache>> {
    CACHES.lock().unwrap_or_else(|e| e.into_inner())
}

/// Açık oturum boyunca önbellek etkindir; son oturum kapanınca kayıt diske yazılır.
pub struct Session(PathBuf);

impl Session {
    /// file: kayıt dosyası; scope: önbelleğin geçerli olduğu kök klasör.
    pub fn open(file: PathBuf, scope: &Path) -> Self {
        let mut caches = lock();
        if let Some(cache) = caches.iter_mut().find(|c| c.file == file) {
            cache.sessions += 1;
        } else {
            let entries = fs::read(&file)
                .ok()
                .and_then(|b| serde_json::from_slice::<Stored>(&b).ok())
                .filter(|s| s.version == VERSION)
                .map(|s| s.entries)
                .unwrap_or_default();
            caches.push(Cache {
                file: file.clone(),
                scope: key(scope),
                entries,
                dirty: false,
                sessions: 1,
            });
        }
        Session(file)
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        let mut caches = lock();
        let Some(i) = caches.iter().position(|c| c.file == self.0) else { return };
        flush(&mut caches[i]);
        caches[i].sessions = caches[i].sessions.saturating_sub(1);
        if caches[i].sessions == 0 {
            caches.remove(i);
        }
    }
}

fn flush(cache: &mut Cache) {
    if !cache.dirty {
        return;
    }
    let stored = Stored {
        version: VERSION,
        entries: std::mem::take(&mut cache.entries),
    };
    // Önbelleğe yazılamaması yalnızca bir sonraki açılışı yavaşlatır; hata yükseltilmez.
    if let Ok(bytes) = serde_json::to_vec(&stored) {
        if let Some(parent) = cache.file.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = crate::profiles::atomic_write(&cache.file, &bytes);
    }
    cache.entries = stored.entries;
    cache.dirty = false;
}

/// Dosya bu özetle daha önce doğrulandı ve o günden beri değişmedi mi?
pub fn is_verified(path: &Path, hash: &str) -> bool {
    let k = key(path);
    let caches = lock();
    let Some(entry) = caches
        .iter()
        .filter(|c| k.starts_with(&c.scope))
        .find_map(|c| c.entries.get(&k))
    else {
        return false;
    };
    stamp(path).is_some_and(|(len, modified)| {
        entry.len == len && entry.modified == modified && entry.hash.eq_ignore_ascii_case(hash)
    })
}

/// Özeti doğrulanmış dosyayı kaydeder (kapsayan bir oturum açık değilse hiçbir şey yapmaz).
pub fn remember(path: &Path, hash: &str) {
    let k = key(path);
    let mut caches = lock();
    let Some(cache) = caches.iter_mut().find(|c| k.starts_with(&c.scope)) else {
        return;
    };
    let Some((len, modified)) = stamp(path) else {
        return;
    };
    cache.entries.insert(
        k,
        Entry {
            len,
            modified,
            hash: hash.to_ascii_lowercase(),
        },
    );
    cache.dirty = true;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("patronlauncher-verified-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn verified_only_while_unchanged_and_persisted() {
        let dir = temp();
        let file = dir.join("a.bin");
        let store = dir.join("verified.json");
        fs::write(&file, b"abc").unwrap();
        // Oturum yokken hiçbir şey hatırlanmaz.
        remember(&file, "AA");
        assert!(!is_verified(&file, "aa"));
        {
            let _s = Session::open(store.clone(), &dir);
            assert!(!is_verified(&file, "aa"));
            remember(&file, "AA");
            assert!(is_verified(&file, "aa"));
            assert!(!is_verified(&file, "bb"), "farklı özet kabul edilmemeli");
        }
        assert!(store.is_file(), "oturum kapanınca kayıt yazılmalı");
        assert!(!is_verified(&file, "aa"), "oturum kapalıyken önbellek kullanılmamalı");
        {
            let _s = Session::open(store.clone(), &dir);
            assert!(is_verified(&file, "aa"), "kayıt diskten okunmalı");
            // İçerik ve boyut değişince yeniden doğrulama gerekir.
            fs::write(&file, b"abcd").unwrap();
            assert!(!is_verified(&file, "aa"));
            fs::remove_file(&file).unwrap();
            assert!(!is_verified(&file, "aa"));
        }
    }

    #[test]
    fn corrupt_store_is_ignored() {
        let dir = temp();
        let store = dir.join("verified.json");
        fs::write(&store, b"{bozuk").unwrap();
        let file = dir.join("b.bin");
        fs::write(&file, b"x").unwrap();
        let _s = Session::open(store, &dir);
        assert!(!is_verified(&file, "aa"));
        remember(&file, "aa");
        assert!(is_verified(&file, "aa"));
    }
}
