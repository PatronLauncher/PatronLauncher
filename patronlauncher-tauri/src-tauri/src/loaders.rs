//! Yükleyicilerin ortak girişi: sürüm listesi, doğrulama, kurulum ve vanilla ile birleştirme.
use crate::{
    fabric::{self, FABRIC, Flavor, LoaderVersions, QUILT},
    forge, model::Loader, model::Profile, optifine,
};
use anyhow::{Result, bail};
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
};

fn flavor(loader: Loader) -> Option<&'static Flavor> {
    match loader {
        Loader::Fabric => Some(&FABRIC),
        Loader::Quilt => Some(&QUILT),
        _ => None,
    }
}
fn forge_kind(loader: Loader) -> Option<forge::Kind> {
    match loader {
        Loader::Forge => Some(forge::Kind::Forge),
        Loader::NeoForge => Some(forge::Kind::NeoForge),
        _ => None,
    }
}
pub fn name(loader: Loader) -> &'static str {
    match loader {
        Loader::Vanilla => "Vanilla",
        Loader::Fabric => "Fabric",
        Loader::Quilt => "Quilt",
        Loader::Forge => "Forge",
        Loader::NeoForge => "NeoForge",
        Loader::OptiFine => "OptiFine",
    }
}
/// Mod klasörü kullanan yükleyiciler.
pub fn uses_mods(loader: Loader) -> bool {
    matches!(loader, Loader::Fabric | Loader::Quilt | Loader::Forge | Loader::NeoForge)
}
/// Kayıtlı yükleyici/sürüm çiftinin biçimini denetler (ağ kullanmaz).
pub fn validate(loader: Loader, version: Option<&str>) -> Result<()> {
    match (loader, version) {
        (Loader::Vanilla, None) => Ok(()),
        (Loader::Vanilla, Some(_)) => bail!("Vanilla için yükleyici sürümü verilmez."),
        (Loader::OptiFine, Some(v)) => optifine::child_name("1", v).map(|_| ()),
        (_, Some(v)) => fabric::identifier(v),
        (_, None) => bail!("Yükleyici sürümü eksik."),
    }
}
pub fn versions(loader: Loader, mc: &str) -> Result<LoaderVersions> {
    if let Some(f) = flavor(loader) {
        return fabric::versions_for(f, mc);
    }
    if let Some(k) = forge_kind(loader) {
        return forge::versions(k, mc);
    }
    match loader {
        Loader::OptiFine => optifine::versions(mc),
        _ => bail!("Vanilla için yükleyici sürümü yoktur."),
    }
}
/// İstenen sürümü doğrular veya önerileni seçer. Vanilla için None döner.
pub fn resolve(loader: Loader, mc: &str, requested: Option<&str>) -> Result<Option<String>> {
    if loader == Loader::Vanilla {
        if requested.is_some() {
            bail!("Vanilla için yükleyici sürümü verilmez.");
        }
        return Ok(None);
    }
    Ok(Some(if let Some(f) = flavor(loader) {
        fabric::resolve_for(f, mc, requested)?
    } else if let Some(k) = forge_kind(loader) {
        forge::resolve(k, mc, requested)?
    } else {
        optifine::resolve(mc, requested)?
    }))
}
/// Kurulu yükleyicinin önbellekteki sürüm tanımı (yol, içerik).
pub fn child(root: &Path, loader: Loader, mc: &str, version: &str) -> Result<(PathBuf, Value)> {
    if let Some(f) = flavor(loader) {
        fabric::identifier(mc)?;
        fabric::identifier(version)?;
        let path = crate::net::safe_join(
            &root.join("minecraft").join(f.dir),
            &format!("{}-{version}-{mc}.json", f.prefix),
        )?;
        let value = serde_json::from_slice(&fs::read(&path)?)?;
        return Ok((path, value));
    }
    if let Some(k) = forge_kind(loader) {
        return forge::cached_child(root, k, mc, version);
    }
    match loader {
        Loader::OptiFine => optifine::cached_child(root, mc, version),
        _ => bail!("Vanilla için yükleyici tanımı yoktur."),
    }
}
pub fn merge(loader: Loader, vanilla: &Value, child: &Value, mc: &str) -> Result<Value> {
    if let Some(f) = flavor(loader) {
        return fabric::merge_for(f, vanilla, child, mc);
    }
    if let Some(k) = forge_kind(loader) {
        return forge::merge(k, vanilla, child, mc);
    }
    match loader {
        Loader::OptiFine => optifine::merge(vanilla, child, mc),
        _ => Ok(vanilla.clone()),
    }
}
/// Gerekirse indirip kurar, birleştirilmiş sürüm tanımını döndürür.
pub fn prepare(
    root: &Path,
    profile: &Profile,
    vanilla: &Value,
    java: &dyn Fn() -> Result<PathBuf>,
    cancel: &AtomicBool,
    notify: &dyn Fn(String),
) -> Result<Value> {
    if profile.loader != Loader::Vanilla {
        notify(format!("{} hazırlanıyor…", name(profile.loader)));
    }
    if let Some(f) = flavor(profile.loader) {
        return fabric::prepare_for(f, root, profile, vanilla, cancel);
    }
    if let Some(k) = forge_kind(profile.loader) {
        return forge::prepare(k, root, profile, vanilla, java, cancel, notify);
    }
    match profile.loader {
        Loader::OptiFine => optifine::prepare(root, profile, vanilla, java, cancel, notify),
        _ => Ok(vanilla.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validation_follows_loader_kind() {
        assert!(validate(Loader::Vanilla, None).is_ok());
        assert!(validate(Loader::Vanilla, Some("1")).is_err());
        assert!(validate(Loader::Quilt, Some("0.29.2")).is_ok());
        assert!(validate(Loader::NeoForge, None).is_err());
        assert!(validate(Loader::OptiFine, Some("HD_U+J1")).is_ok());
        assert!(validate(Loader::OptiFine, Some("../x")).is_err());
        assert!(uses_mods(Loader::NeoForge) && !uses_mods(Loader::OptiFine));
    }
}
