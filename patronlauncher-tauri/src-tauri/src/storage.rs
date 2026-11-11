//! Salt okunur disk kullanımı ve sistem belleği özeti. Hiçbir dosyayı değiştirmez.
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct Entry {
    pub key: &'static str,
    pub bytes: u64,
}
#[derive(Debug, Serialize)]
pub struct ProfileUsage {
    pub id: String,
    pub name: String,
    pub bytes: u64,
    pub folders: Vec<Entry>,
}
#[derive(Debug, Serialize)]
pub struct Memory {
    pub total_mb: u64,
    pub available_mb: u64,
}
#[derive(Debug, Serialize)]
pub struct Usage {
    pub total: u64,
    pub categories: Vec<Entry>,
    pub profiles: Vec<ProfileUsage>,
}

/// Bağlantıları/reparse point'leri izlemeden klasör boyutunu toplar.
pub fn size(path: &Path) -> u64 {
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return 0;
    };
    if meta.file_type().is_symlink() {
        return 0;
    }
    if meta.is_file() {
        return meta.len();
    }
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    entries.flatten().map(|e| size(&e.path())).sum()
}

const PROFILE_FOLDERS: [&str; 9] = [
    "saves",
    "mods",
    "resourcepacks",
    "shaderpacks",
    "screenshots",
    "logs",
    "config",
    "schematics",
    "crash-reports",
];

pub fn usage(root: &Path, profiles: &[crate::model::Profile]) -> Usage {
    let total = size(root);
    let shared = root.join("minecraft");
    let mut categories = vec![
        Entry { key: "profiles", bytes: size(&root.join("instances")) },
        Entry { key: "assets", bytes: size(&shared.join("assets")) },
        Entry { key: "libraries", bytes: size(&shared.join("libraries")) },
        Entry { key: "versions", bytes: size(&shared.join("versions")) },
        Entry { key: "java", bytes: size(&root.join("runtimes")) },
        Entry { key: "backups", bytes: size(&root.join("backups")) },
    ];
    let known: u64 = categories.iter().map(|e| e.bytes).sum();
    categories.push(Entry { key: "other", bytes: total.saturating_sub(known) });
    let mut profiles: Vec<ProfileUsage> = profiles
        .iter()
        .map(|p| {
            let dir = crate::profiles::dir(root, p);
            ProfileUsage {
                id: p.id.to_string(),
                name: p.name.clone(),
                bytes: size(&dir),
                folders: PROFILE_FOLDERS
                    .iter()
                    .map(|key| Entry { key, bytes: size(&dir.join(key)) })
                    .collect(),
            }
        })
        .collect();
    profiles.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    Usage { total, categories, profiles }
}

#[cfg(windows)]
pub fn memory() -> Option<Memory> {
    #[repr(C)]
    struct MemoryStatusEx {
        length: u32,
        load: u32,
        total_phys: u64,
        avail_phys: u64,
        total_page: u64,
        avail_page: u64,
        total_virtual: u64,
        avail_virtual: u64,
        avail_extended: u64,
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GlobalMemoryStatusEx(status: *mut MemoryStatusEx) -> i32;
    }
    let mut status = MemoryStatusEx {
        length: std::mem::size_of::<MemoryStatusEx>() as u32,
        load: 0,
        total_phys: 0,
        avail_phys: 0,
        total_page: 0,
        avail_page: 0,
        total_virtual: 0,
        avail_virtual: 0,
        avail_extended: 0,
    };
    // SAFETY: yapı Win32 MEMORYSTATUSEX düzeniyle aynı ve uzunluğu doğru ayarlı.
    let ok = unsafe { GlobalMemoryStatusEx(&mut status) } != 0;
    ok.then(|| Memory {
        total_mb: status.total_phys / 1024 / 1024,
        available_mb: status.avail_phys / 1024 / 1024,
    })
}
#[cfg(not(windows))]
pub fn memory() -> Option<Memory> {
    None
}

#[cfg(test)]
mod tests {
    #[test]
    fn sums_nested_files_and_reports_other() {
        let root = std::env::temp_dir().join(format!("pl-storage-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("minecraft/assets/a")).unwrap();
        std::fs::write(root.join("minecraft/assets/a/x.bin"), [0u8; 100]).unwrap();
        std::fs::write(root.join("settings.json"), [0u8; 7]).unwrap();
        let usage = super::usage(&root, &[]);
        assert_eq!(usage.total, 107);
        let get = |k| usage.categories.iter().find(|e| e.key == k).unwrap().bytes;
        assert_eq!(get("assets"), 100);
        assert_eq!(get("other"), 7);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn reads_physical_memory() {
        let memory = super::memory().unwrap();
        assert!(memory.total_mb > 0 && memory.available_mb <= memory.total_mb);
    }
}
