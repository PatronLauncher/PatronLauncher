//! Shared, checksum-verified version storage. Instance directories contain user data only.
use crate::{
    game::{self, Version},
    model::{Loader, Profile, ProfileKind},
    net, profiles,
};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Combination {
    pub mc: String,
    pub loader: Loader,
    pub loader_version: Option<String>,
}
impl Combination {
    pub fn of(p: &Profile) -> Self {
        Self {
            mc: p.version.clone(),
            loader: p.loader,
            loader_version: p.loader_version.clone(),
        }
    }
    pub fn validate(&self) -> Result<()> {
        crate::fabric::identifier(&self.mc)?;
        crate::loaders::validate(self.loader, self.loader_version.as_deref())
    }
    fn receipt(&self, root: &Path) -> Result<PathBuf> {
        self.validate()?;
        Ok(root.join("minecraft/installations").join(format!(
            "{}-{}-{}.json",
            self.mc,
            crate::loaders::name(self.loader).to_ascii_lowercase(),
            self.loader_version.as_deref().unwrap_or("none")
        )))
    }
    pub fn profile(&self) -> Profile {
        Profile {
            appearance: Default::default(),
            kind: ProfileKind::Quick,
            id: uuid::Uuid::new_v4(),
            name: format!("Minecraft {} · {:?}", self.mc, self.loader),
            version: self.mc.clone(),
            loader: self.loader,
            loader_version: self.loader_version.clone(),
        }
    }
}
#[derive(Serialize, Deserialize, PartialEq, Eq, Debug)]
struct File {
    path: String,
    sha1: String,
}
#[derive(Serialize, Deserialize)]
struct Receipt {
    combination: Combination,
    manifest_sha1: String,
    files: Vec<File>,
}
fn expected(root: &Path, c: &Combination, v: &Version) -> Result<Vec<File>> {
    c.validate()?;
    if v.id != c.mc {
        bail!("Sürüm eşleşmiyor.")
    }
    let mut files = vec![];
    let mut add = |path: String, sha1: String| -> Result<()> {
        net::safe_join(root, &path)?;
        if sha1.len() != 40 || !sha1.bytes().all(|b| b.is_ascii_hexdigit()) {
            bail!("Geçersiz dosya özeti.")
        }
        files.push(File { path, sha1 });
        Ok(())
    };
    let metadata = format!("minecraft/versions/{0}/{0}.json", c.mc);
    add(metadata.clone(), v.sha1.clone())?;
    let bytes = fs::read(net::safe_join(root, &metadata)?)?;
    if net::digest_file(&net::safe_join(root, &metadata)?, false)? != v.sha1 {
        bail!("Sürüm JSON bütünlüğü bozuk.")
    }
    let mut meta: Value = serde_json::from_slice(&bytes)?;
    if c.loader != Loader::Vanilla {
        let (path, raw) =
            crate::loaders::child(root, c.loader, &c.mc, c.loader_version.as_deref().unwrap_or(""))?;
        let relative = path
            .strip_prefix(root)
            .context("Yükleyici tanımı veri klasörünün dışında")?
            .to_string_lossy()
            .replace('\\', "/");
        add(relative, net::digest_file(&path, false)?)?;
        meta = crate::loaders::merge(c.loader, &meta, &raw, &c.mc)?;
    }
    let text = |value: &Value, key: &str| -> Result<String> {
        Ok(value[key].as_str().context("Dosya tanımı eksik")?.into())
    };
    add(
        format!("minecraft/versions/{0}/{0}.jar", c.mc),
        text(&meta["downloads"]["client"], "sha1")?,
    )?;
    for lib in meta["libraries"]
        .as_array()
        .context("Kütüphane listesi eksik")?
    {
        if !game::allowed(lib.get("rules")) {
            continue;
        }
        let mut artifacts = vec![];
        if !lib["downloads"]["artifact"].is_null() {
            artifacts.push(&lib["downloads"]["artifact"]);
        }
        if let Some(classifier) = lib["natives"]["windows"].as_str() {
            artifacts.push(&lib["downloads"]["classifiers"][classifier.replace("${arch}", "64")]);
        }
        for artifact in artifacts {
            // Kurulum adımlarının ürettiği yükleyici dosyalarının yayımlanmış özeti yoktur.
            let sha1 = artifact["sha1"].as_str().unwrap_or("");
            if sha1.is_empty() && lib["patronlauncher_loader"].is_string() {
                continue;
            }
            add(
                format!("minecraft/libraries/{}", text(artifact, "path")?),
                text(artifact, "sha1")?,
            )?;
        }
    }
    let index = &meta["assetIndex"];
    let path = format!("minecraft/assets/indexes/{}.json", text(index, "id")?);
    add(path.clone(), text(index, "sha1")?)?;
    let assets: Value = serde_json::from_slice(&fs::read(net::safe_join(root, &path)?)?)?;
    for object in assets["objects"]
        .as_object()
        .context("Kaynak listesi eksik")?
        .values()
    {
        let hash = text(object, "hash")?;
        if hash.len() != 40 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
            bail!("Geçersiz kaynak özeti.")
        }
        add(
            format!("minecraft/assets/objects/{}/{}", &hash[..2], hash),
            hash,
        )?;
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    files.dedup();
    Ok(files)
}
fn verify(root: &Path, files: &[File], cancel: &AtomicBool) -> Result<()> {
    // Değişmemiş dosyalar doğrulama önbelleğinden geçer (bkz. verified.rs); açılışta ve
    // her "Oyna"da yüzlerce MB'ın yeniden özetlenmesini önler.
    let _verified =
        crate::verified::Session::open(root.join("minecraft").join("verified-files.json"), root);
    for f in files {
        if cancel.load(Ordering::Relaxed) {
            bail!("İşlem iptal edildi.")
        }
        let path = net::safe_join(root, &f.path)?;
        if crate::verified::is_verified(&path, &f.sha1) {
            continue;
        }
        if net::digest_file(&path, false)? != f.sha1 {
            bail!("Bütünlük kontrolü başarısız: {}", f.path)
        }
        crate::verified::remember(&path, &f.sha1);
    }
    Ok(())
}
pub fn record(root: &Path, p: &Profile, v: &Version, cancel: &AtomicBool) -> Result<()> {
    let c = Combination::of(p);
    let files = expected(root, &c, v)?;
    verify(root, &files, cancel)?;
    profiles::atomic_write(
        &c.receipt(root)?,
        &serde_json::to_vec(&Receipt {
            combination: c.clone(),
            manifest_sha1: v.sha1.clone(),
            files,
        })?,
    )
}
pub fn installed(root: &Path, c: &Combination, v: &Version) -> bool {
    let Ok(files) = expected(root, c, v) else {
        return false;
    };
    if let Ok(bytes) = c.receipt(root).and_then(|p| Ok(fs::read(p)?)) {
        let Ok(receipt) = serde_json::from_slice::<Receipt>(&bytes) else {
            return false;
        };
        if receipt.combination != *c || receipt.manifest_sha1 != v.sha1 || receipt.files != files {
            return false;
        }
    }
    verify(root, &files, &AtomicBool::new(false)).is_ok()
}
#[derive(Serialize)]
pub struct InstalledVersion {
    #[serde(flatten)]
    pub combination: Combination,
    pub quick_id: Option<uuid::Uuid>,
}
pub fn list(root: &Path, profiles: &[Profile], versions: &[Version]) -> Vec<InstalledVersion> {
    let mut combinations: Vec<Combination> = profiles.iter().map(Combination::of).collect();
    if let Ok(entries) = fs::read_dir(root.join("minecraft/installations")) {
        for e in entries.flatten() {
            if let Ok(bytes) = fs::read(e.path()) {
                if let Ok(r) = serde_json::from_slice::<Receipt>(&bytes) {
                    combinations.push(r.combination)
                }
            }
        }
    }
    // Discover installations made by older builds, before shared receipts existed.
    if let Ok(entries) = fs::read_dir(root.join("minecraft/fabric")) {
        for entry in entries.flatten() {
            if let Ok(raw) = fs::read(entry.path())
                .and_then(|b| serde_json::from_slice::<Value>(&b).map_err(std::io::Error::other))
            {
                if let (Some(mc), Some(id)) = (raw["inheritsFrom"].as_str(), raw["id"].as_str()) {
                    if let Some(loader) = id
                        .strip_prefix("fabric-loader-")
                        .and_then(|s| s.strip_suffix(&format!("-{mc}")))
                    {
                        combinations.push(Combination {
                            mc: mc.into(),
                            loader: Loader::Fabric,
                            loader_version: Some(loader.into()),
                        });
                    }
                }
            }
        }
    }
    for v in versions {
        if net::safe_join(&root.join("minecraft/versions"), &v.id).is_ok_and(|p| p.is_dir()) {
            combinations.push(Combination {
                mc: v.id.clone(),
                loader: Loader::Vanilla,
                loader_version: None,
            })
        }
    }
    let mut result = vec![];
    for c in combinations {
        if result.iter().any(|r: &InstalledVersion| r.combination == c) {
            continue;
        }
        if let Some(v) = versions.iter().find(|v| v.id == c.mc) {
            if installed(root, &c, v) {
                result.push(InstalledVersion {
                    quick_id: profiles
                        .iter()
                        .find(|p| p.kind == ProfileKind::Quick && Combination::of(p) == c)
                        .map(|p| p.id),
                    combination: c,
                })
            }
        }
    }
    result
}
pub fn remove(root: &Path, c: &Combination) -> Result<()> {
    c.validate()?;
    let mut paths = vec![c.receipt(root)?];
    if c.loader != Loader::Vanilla {
        if let Ok((path, _)) =
            crate::loaders::child(root, c.loader, &c.mc, c.loader_version.as_deref().unwrap_or(""))
        {
            paths.push(path);
        }
    } else {
        for ext in ["jar", "json"] {
            paths.push(net::safe_join(
                &root.join("minecraft/versions"),
                &format!("{0}/{0}.{ext}", c.mc),
            )?)
        }
    }
    // Shared libraries/assets and all instance worlds/backups are retained.
    for path in paths {
        if path.is_file() {
            fs::remove_file(path)?
        }
    }
    Ok(())
}
#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use sha1::{Digest, Sha1};
    fn hash(bytes: &[u8]) -> String {
        format!("{:x}", Sha1::digest(bytes))
    }
    pub(crate) fn fixture() -> (PathBuf, Profile, Version) {
        let root = std::env::temp_dir().join(format!("shared-store-{}", uuid::Uuid::new_v4()));
        let p: Profile = serde_json::from_value(
            serde_json::json!({"id":uuid::Uuid::new_v4(),"name":"Legacy","version":"1.21.11"}),
        )
        .unwrap();
        let asset = hash(b"asset");
        let index =
            serde_json::to_vec(&serde_json::json!({"objects":{"sample":{"hash":asset}}})).unwrap();
        let meta=serde_json::to_vec(&serde_json::json!({"id":p.version,"mainClass":"net.minecraft.client.main.Main","arguments":{"jvm":[],"game":[]},"downloads":{"client":{"sha1":hash(b"jar"),"size":3}},"libraries":[{"name":"example:test:1","downloads":{"artifact":{"path":"example/test.jar","sha1":hash(b"library")}}}],"assetIndex":{"id":"test","sha1":hash(&index)}})).unwrap();
        for (path, bytes) in [
            (
                format!("minecraft/versions/{0}/{0}.json", p.version),
                meta.clone(),
            ),
            (
                format!("minecraft/versions/{0}/{0}.jar", p.version),
                b"jar".to_vec(),
            ),
            (
                "minecraft/libraries/example/test.jar".into(),
                b"library".to_vec(),
            ),
            ("minecraft/assets/indexes/test.json".into(), index),
            (
                format!("minecraft/assets/objects/{}/{}", &asset[..2], asset),
                b"asset".to_vec(),
            ),
        ] {
            profiles::atomic_write(&root.join(path), &bytes).unwrap();
        }
        let v = Version {
            id: p.version.clone(),
            url: String::new(),
            sha1: hash(&meta),
            kind: "release".into(),
        };
        (root, p, v)
    }
    #[test]
    fn legacy_custom_and_shared_integrity_cover_every_artifact() {
        let (root, p, v) = fixture();
        assert_eq!(p.kind, ProfileKind::Custom);
        let c = Combination::of(&p);
        assert!(installed(&root, &c, &v));
        let other = Profile {
            id: uuid::Uuid::new_v4(),
            name: "Other".into(),
            ..p.clone()
        };
        assert!(installed(&root, &Combination::of(&other), &v));
        let files = expected(&root, &c, &v).unwrap();
        for f in files {
            let path = root.join(f.path);
            let saved = fs::read(&path).unwrap();
            fs::write(&path, b"broken").unwrap();
            assert!(!installed(&root, &c, &v));
            fs::write(path, saved).unwrap();
        }
        assert!(record(&root, &p, &v, &AtomicBool::new(true)).is_err());
        assert!(!c.receipt(&root).unwrap().exists());
        record(&root, &p, &v, &AtomicBool::new(false)).unwrap();
        assert!(installed(&root, &c, &v));
        assert_eq!(list(&root, &[p, other], &[v]).len(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}
