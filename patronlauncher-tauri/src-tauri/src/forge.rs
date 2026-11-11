//! NeoForge ve Forge. Resmî Maven'deki kurulum programı SHA-1 ile doğrulanarak indirilir,
//! istemci tarafı işlemcileri (binary patch vb.) yerel Java ile çalıştırılır ve ortaya
//! çıkan sürüm tanımı vanilla ile birleştirilir.
use crate::{fabric::LoaderVersion, fabric::LoaderVersions, net, profiles, runtime};
use anyhow::{Context, Result, bail, ensure};
use reqwest::blocking::Client;
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Forge,
    NeoForge,
}
impl Kind {
    pub fn name(self) -> &'static str {
        match self {
            Self::Forge => "Forge",
            Self::NeoForge => "NeoForge",
        }
    }
    pub fn dir(self) -> &'static str {
        match self {
            Self::Forge => "forge",
            Self::NeoForge => "neoforge",
        }
    }
}

const HOSTS: [&str; 6] = [
    "maven.minecraftforge.net",
    "files.minecraftforge.net",
    "maven.neoforged.net",
    "libraries.minecraft.net",
    "piston-data.mojang.com",
    "piston-meta.mojang.com",
];
pub fn approved(url: &str) -> bool {
    reqwest::Url::parse(url).is_ok_and(|u| {
        u.scheme() == "https"
            && u.username().is_empty()
            && u.password().is_none()
            && u.port().is_none()
            && u.host_str().is_some_and(|h| HOSTS.contains(&h))
    })
}
pub fn client() -> Result<Client> {
    Ok(Client::builder()
        .https_only(true)
        .user_agent(concat!("PatronLauncher/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(300))
        .redirect(reqwest::redirect::Policy::custom(|a| {
            if a.previous().len() >= 5 || !approved(a.url().as_str()) {
                a.error("Yükleyici yönlendirmesi izin verilen alan adlarının dışında.")
            } else {
                a.follow()
            }
        }))
        .build()?)
}
fn text(client: &Client, url: &str, limit: u64) -> Result<String> {
    ensure!(approved(url), "Yükleyici adresi izin verilen alan adlarının dışında.");
    let response = client.get(url).send()?.error_for_status()?;
    let mut bytes = Vec::new();
    response.take(limit + 1).read_to_end(&mut bytes)?;
    ensure!(bytes.len() as u64 <= limit, "Yükleyici yanıtı çok büyük.");
    Ok(String::from_utf8(bytes)?)
}
fn numeric(v: &str) -> Vec<u64> {
    v.split(|c: char| !c.is_ascii_digit()).filter_map(|p| p.parse().ok()).collect()
}
/// NeoForge sürümünden hedef Minecraft sürümü: 21.1.77 → 1.21.1, 21.0.3 → 1.21, 26.3.0.101 → 26.3.
pub fn neoforge_mc(version: &str) -> Option<String> {
    let base = version.split('-').next()?;
    let parts: Vec<u64> = base.split('.').map(|p| p.parse().ok()).collect::<Option<_>>()?;
    match parts.as_slice() {
        [a, b, c, _] if *a >= 26 => Some(if *c == 0 { format!("{a}.{b}") } else { format!("{a}.{b}.{c}") }),
        [a, b, _] if (20..26).contains(a) => Some(if *b == 0 { format!("1.{a}") } else { format!("1.{a}.{b}") }),
        _ => None,
    }
}
pub fn versions(kind: Kind, mc: &str) -> Result<LoaderVersions> {
    crate::fabric::identifier(mc)?;
    let client = client()?;
    let mut list: Vec<LoaderVersion> = match kind {
        Kind::Forge => {
            let xml = text(
                &client,
                "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml",
                4 * 1024 * 1024,
            )?;
            let prefix = format!("{mc}-");
            xml.split("<version>")
                .skip(1)
                .filter_map(|s| s.split("</version>").next())
                .filter_map(|v| v.strip_prefix(&prefix))
                .filter(|v| crate::fabric::identifier(v).is_ok() && !v.contains('-'))
                .map(|v| LoaderVersion { version: v.to_string(), stable: true })
                .collect()
        }
        Kind::NeoForge => {
            let raw: Value = serde_json::from_str(&text(
                &client,
                "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge",
                4 * 1024 * 1024,
            )?)?;
            raw["versions"]
                .as_array()
                .context("NeoForge sürüm listesi geçersiz")?
                .iter()
                .filter_map(Value::as_str)
                .filter(|v| crate::fabric::identifier(v).is_ok() && neoforge_mc(v).as_deref() == Some(mc))
                .map(|v| LoaderVersion { version: v.to_string(), stable: !v.contains('-') })
                .collect()
        }
    };
    list.sort_by(|a, b| numeric(&b.version).cmp(&numeric(&a.version)));
    list.dedup_by(|a, b| a.version == b.version);
    let mut default_version = list.iter().find(|v| v.stable).map(|v| v.version.clone());
    if kind == Kind::Forge
        && let Ok(promos) = text(
            &client,
            "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json",
            1024 * 1024,
        )
        && let Ok(promos) = serde_json::from_str::<Value>(&promos)
    {
        let promo = |k: &str| promos["promos"][format!("{mc}-{k}")].as_str().map(str::to_string);
        if let Some(v) = promo("recommended").or_else(|| promo("latest"))
            && list.iter().any(|l| l.version == v)
        {
            default_version = Some(v);
        }
    }
    Ok(LoaderVersions { versions: list, default_version })
}
pub fn resolve(kind: Kind, mc: &str, requested: Option<&str>) -> Result<String> {
    if let Some(v) = requested {
        crate::fabric::identifier(v)?;
    }
    let options = versions(kind, mc)?;
    match requested {
        Some(v) if options.versions.iter().any(|o| o.version == v) => Ok(v.to_string()),
        Some(_) => bail!("{} sürümü bu Minecraft sürümüyle uyumlu değil.", kind.name()),
        None => options
            .default_version
            .with_context(|| format!("Bu Minecraft sürümü için {} bulunamadı.", kind.name())),
    }
}

/// "grup:ad:sürüm[:sınıflandırıcı][@uzantı]" → Maven yolu.
pub fn maven_path(coordinate: &str) -> Result<String> {
    let (body, ext) = coordinate.split_once('@').unwrap_or((coordinate, "jar"));
    let parts: Vec<&str> = body.split(':').collect();
    ensure!((3..=4).contains(&parts.len()), "Maven koordinatı geçersiz: {coordinate}");
    for part in parts.iter().chain([&ext]) {
        crate::fabric::identifier(part).with_context(|| format!("Maven koordinatı geçersiz: {coordinate}"))?;
    }
    let classifier = parts.get(3).map(|c| format!("-{c}")).unwrap_or_default();
    let path = format!(
        "{}/{}/{}/{}-{}{classifier}.{ext}",
        parts[0].replace('.', "/"),
        parts[1],
        parts[2],
        parts[1],
        parts[2]
    );
    net::safe_join(Path::new("libraries"), &path)?;
    Ok(path)
}
fn library_key(name: &str) -> String {
    let parts: Vec<&str> = name.split('@').next().unwrap_or(name).split(':').collect();
    format!("{}:{}:{}", parts.first().unwrap_or(&""), parts.get(1).unwrap_or(&""), parts.get(3).unwrap_or(&""))
}

pub fn child_name(kind: Kind, mc: &str, version: &str) -> Result<String> {
    crate::fabric::identifier(mc)?;
    crate::fabric::identifier(version)?;
    Ok(format!("{}-{mc}-{version}.json", kind.dir()))
}
fn child_path(root: &Path, kind: Kind, mc: &str, version: &str) -> Result<PathBuf> {
    net::safe_join(&root.join("minecraft").join(kind.dir()), &child_name(kind, mc, version)?)
}

/// Kurulum programının ürettiği sürüm tanımını vanilla ile birleştirir.
pub fn merge(kind: Kind, vanilla: &Value, child: &Value, mc: &str) -> Result<Value> {
    ensure!(
        child["inheritsFrom"].as_str() == Some(mc) && vanilla["id"].as_str() == Some(mc),
        "{} sürüm tanımı vanilla ile eşleşmiyor.",
        kind.name()
    );
    let main = child["mainClass"].as_str().context("Yükleyici giriş sınıfı eksik")?;
    ensure!(
        !main.is_empty() && main.split('.').all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'$')),
        "Yükleyici giriş sınıfı geçersiz."
    );
    let mut result = vanilla.clone();
    // Kimlik vanilla kalır: ${version_name} ile oluşan ignoreList istemci JAR'ının adıyla eşleşir.
    result["mainClass"] = json!(main);
    for kind_name in ["jvm", "game"] {
        let mut args = vanilla["arguments"][kind_name].as_array().cloned().unwrap_or_default();
        if let Some(extra) = child["arguments"][kind_name].as_array() {
            args.extend(extra.iter().cloned());
        }
        result["arguments"][kind_name] = json!(args);
    }
    let mut libs = Vec::new();
    let mut keys = HashSet::new();
    for lib in child["libraries"].as_array().context("Yükleyici kütüphaneleri eksik")? {
        let name = lib["name"].as_str().context("Kütüphane adı eksik")?;
        let artifact = &lib["downloads"]["artifact"];
        let path = artifact["path"].as_str().map(str::to_string).map_or_else(|| maven_path(name), Ok)?;
        net::safe_join(Path::new("libraries"), &path)?;
        let url = artifact["url"].as_str().unwrap_or("");
        ensure!(url.is_empty() || approved(url), "Yükleyici kütüphanesi izin verilen adreste değil: {name}");
        if keys.insert(library_key(name)) {
            let mut normalized = lib.clone();
            normalized["downloads"]["artifact"]["path"] = json!(path);
            normalized["downloads"]["artifact"]["url"] = json!(url);
            normalized["patronlauncher_loader"] = json!(kind.dir());
            libs.push(normalized);
        }
    }
    for lib in vanilla["libraries"].as_array().context("Vanilla kütüphaneleri eksik")? {
        let key = library_key(lib["name"].as_str().unwrap_or_default());
        if !keys.contains(&key) {
            libs.push(lib.clone());
        }
    }
    result["libraries"] = json!(libs);
    Ok(result)
}

fn read_entry(zip: &mut zip::ZipArchive<fs::File>, name: &str, limit: u64) -> Result<Vec<u8>> {
    let entry = zip.by_name(name).with_context(|| format!("Kurulum programında {name} yok"))?;
    let mut bytes = Vec::new();
    entry.take(limit + 1).read_to_end(&mut bytes)?;
    ensure!(bytes.len() as u64 <= limit, "{name} çok büyük.");
    Ok(bytes)
}
fn main_class(jar: &Path) -> Result<String> {
    let mut zip = zip::ZipArchive::new(fs::File::open(jar)?)?;
    let manifest = String::from_utf8(read_entry(&mut zip, "META-INF/MANIFEST.MF", 1024 * 1024)?)?;
    manifest
        .lines()
        .find_map(|l| l.strip_prefix("Main-Class:"))
        .map(|m| m.trim().to_string())
        .context("İşlemci giriş sınıfı bulunamadı")
}
fn sha1_ok(value: &str) -> bool {
    value.len() == 40 && value.bytes().all(|b| b.is_ascii_hexdigit())
}
fn download_library(client: &Client, libraries: &Path, lib: &Value, cancel: &AtomicBool) -> Result<()> {
    let artifact = &lib["downloads"]["artifact"];
    let url = artifact["url"].as_str().unwrap_or("");
    if url.is_empty() {
        return Ok(());
    }
    ensure!(approved(url), "Kütüphane adresi izin verilen alan adlarının dışında: {url}");
    let path = net::safe_join(libraries, artifact["path"].as_str().context("Kütüphane yolu eksik")?)?;
    let sha1 = match artifact["sha1"].as_str() {
        Some(h) if sha1_ok(h) => h.to_ascii_lowercase(),
        _ => text(client, &format!("{url}.sha1"), 512)?.split_whitespace().next().unwrap_or("").to_ascii_lowercase(),
    };
    ensure!(sha1_ok(&sha1), "Kütüphane özeti eksik: {url}");
    net::download_cancellable(client, url, &path, &sha1, false, cancel)
}

#[allow(clippy::too_many_arguments)]
fn install(
    kind: Kind,
    root: &Path,
    mc: &str,
    version: &str,
    vanilla: &Value,
    java: &Path,
    cancel: &AtomicBool,
    notify: &dyn Fn(String),
) -> Result<Value> {
    let client = client()?;
    let shared = root.join("minecraft");
    let libraries = shared.join("libraries");
    let stage = shared.join(kind.dir()).join(format!(".install-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&stage)?;
    let result = (|| -> Result<Value> {
        notify(format!("{} {version} kurulum programı indiriliyor…", kind.name()));
        let url = match kind {
            Kind::Forge => format!(
                "https://maven.minecraftforge.net/net/minecraftforge/forge/{mc}-{version}/forge-{mc}-{version}-installer.jar"
            ),
            Kind::NeoForge => format!(
                "https://maven.neoforged.net/releases/net/neoforged/neoforge/{version}/neoforge-{version}-installer.jar"
            ),
        };
        let sha1 = text(&client, &format!("{url}.sha1"), 512)?.split_whitespace().next().unwrap_or("").to_ascii_lowercase();
        ensure!(sha1_ok(&sha1), "Kurulum programı özeti alınamadı.");
        let installer = stage.join("installer.jar");
        net::download_cancellable(&client, &url, &installer, &sha1, false, cancel)?;
        let mut zip = zip::ZipArchive::new(fs::File::open(&installer)?)?;
        let profile: Value = serde_json::from_slice(&read_entry(&mut zip, "install_profile.json", 4 * 1024 * 1024)?)?;
        let child: Value = serde_json::from_slice(&read_entry(&mut zip, "version.json", 4 * 1024 * 1024)?)?;
        ensure!(
            profile["minecraft"].as_str() == Some(mc) && child["inheritsFrom"].as_str() == Some(mc),
            "Kurulum programı farklı bir Minecraft sürümü için."
        );
        ensure!(profile["processors"].is_array(), "Bu {} sürümü desteklenmiyor (eski kurulum biçimi).", kind.name());
        // Kurulum programının kendi Maven klasörü kütüphanelere açılır.
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i)?;
            let Some(rel) = entry.name().strip_prefix("maven/").map(str::to_string) else { continue };
            if entry.is_dir() || rel.is_empty() {
                continue;
            }
            let target = net::safe_join(&libraries, &rel)?;
            if !target.exists() {
                fs::create_dir_all(target.parent().context("Geçersiz yol")?)?;
                let mut out = fs::File::create(&target)?;
                std::io::copy(&mut (&mut entry).take(256 * 1024 * 1024), &mut out)?;
            }
        }
        notify(format!("{} kütüphaneleri indiriliyor…", kind.name()));
        let all: Vec<&Value> = profile["libraries"]
            .as_array()
            .into_iter()
            .flatten()
            .chain(child["libraries"].as_array().into_iter().flatten())
            .collect();
        for (i, lib) in all.iter().enumerate() {
            ensure!(!cancel.load(Ordering::Relaxed), "İşlem iptal edildi.");
            download_library(&client, &libraries, lib, cancel)?;
            notify(format!("{} kütüphaneleri: {} / {}", kind.name(), i + 1, all.len()));
        }
        let client_jar = net::safe_join(&shared.join("versions"), mc)?.join(format!("{mc}.jar"));
        let jar = &vanilla["downloads"]["client"];
        net::download_cancellable(
            &crate::net::client()?,
            jar["url"].as_str().context("İstemci adresi eksik")?,
            &client_jar,
            jar["sha1"].as_str().context("İstemci özeti eksik")?,
            false,
            cancel,
        )?;
        let mut data: HashMap<String, String> = HashMap::from([
            ("SIDE".into(), "client".into()),
            ("MINECRAFT_JAR".into(), client_jar.to_string_lossy().into_owned()),
            ("MINECRAFT_VERSION".into(), mc.into()),
            ("ROOT".into(), shared.to_string_lossy().into_owned()),
            ("INSTALLER".into(), installer.to_string_lossy().into_owned()),
            ("LIBRARY_DIR".into(), libraries.to_string_lossy().into_owned()),
        ]);
        if let Some(map) = profile["data"].as_object() {
            for (key, value) in map {
                let Some(raw) = value["client"].as_str() else { continue };
                let resolved = if let Some(coord) = raw.strip_prefix('[').and_then(|r| r.strip_suffix(']')) {
                    net::safe_join(&libraries, &maven_path(coord)?)?.to_string_lossy().into_owned()
                } else if let Some(lit) = raw.strip_prefix('\'').and_then(|r| r.strip_suffix('\'')) {
                    lit.to_string()
                } else if let Some(entry) = raw.strip_prefix('/') {
                    let out = net::safe_join(&stage.join("data"), entry)?;
                    fs::create_dir_all(out.parent().context("Geçersiz yol")?)?;
                    fs::write(&out, read_entry(&mut zip, entry, 512 * 1024 * 1024)?)?;
                    out.to_string_lossy().into_owned()
                } else {
                    raw.to_string()
                };
                data.insert(key.clone(), resolved);
            }
        }
        let substitute = |arg: &str| -> Result<String> {
            if let Some(coord) = arg.strip_prefix('[').and_then(|r| r.strip_suffix(']')) {
                return Ok(net::safe_join(&libraries, &maven_path(coord)?)?.to_string_lossy().into_owned());
            }
            let mut out = arg.to_string();
            for (key, value) in &data {
                out = out.replace(&format!("{{{key}}}"), value);
            }
            Ok(out)
        };
        let processors: Vec<&Value> = profile["processors"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|p| p["sides"].as_array().is_none_or(|s| s.iter().any(|v| v == "client")))
            .collect();
        for (i, processor) in processors.iter().enumerate() {
            ensure!(!cancel.load(Ordering::Relaxed), "İşlem iptal edildi.");
            let outputs: Vec<(String, String)> = processor["outputs"]
                .as_object()
                .into_iter()
                .flatten()
                .map(|(k, v)| Ok((substitute(k)?, substitute(v.as_str().unwrap_or(""))?.trim_matches('\'').to_string())))
                .collect::<Result<_>>()?;
            let done = !outputs.is_empty()
                && outputs.iter().all(|(path, sha)| {
                    net::digest_file(Path::new(path), false).is_ok_and(|d| d.eq_ignore_ascii_case(sha))
                });
            if done {
                continue;
            }
            notify(format!("{} hazırlanıyor: adım {} / {}", kind.name(), i + 1, processors.len()));
            let jar = net::safe_join(&libraries, &maven_path(processor["jar"].as_str().context("İşlemci JAR eksik")?)?)?;
            let mut classpath = vec![jar.clone()];
            for coord in processor["classpath"].as_array().into_iter().flatten() {
                classpath.push(net::safe_join(&libraries, &maven_path(coord.as_str().context("Sınıf yolu geçersiz")?)?)?);
            }
            let args: Vec<String> = processor["args"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|a| substitute(a.as_str().unwrap_or("")))
                .collect::<Result<_>>()?;
            let output = runtime::quiet_command(java)
                .arg("-cp")
                .arg(std::env::join_paths(&classpath)?)
                .arg(main_class(&jar)?)
                .args(&args)
                .current_dir(&stage)
                .output()
                .context("Yükleyici işlemcisi başlatılamadı")?;
            if !output.status.success() {
                let log = String::from_utf8_lossy(&output.stderr);
                let tail: String = log.lines().rev().take(6).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
                bail!("{} kurulum adımı başarısız ({}):\n{tail}", kind.name(), output.status);
            }
            for (path, sha) in &outputs {
                ensure!(
                    net::digest_file(Path::new(path), false).is_ok_and(|d| d.eq_ignore_ascii_case(sha)),
                    "{} kurulum çıktısı doğrulanamadı.",
                    kind.name()
                );
            }
        }
        Ok(child)
    })();
    let _ = fs::remove_dir_all(&stage);
    result
}

/// Gerekirse kurar, sonra vanilla ile birleşmiş sürüm tanımını döndürür.
pub fn prepare(
    kind: Kind,
    root: &Path,
    profile: &crate::model::Profile,
    vanilla: &Value,
    java: &dyn Fn() -> Result<PathBuf>,
    cancel: &AtomicBool,
    notify: &dyn Fn(String),
) -> Result<Value> {
    let version = match profile.loader_version.as_deref() {
        Some(v) => {
            crate::fabric::identifier(v)?;
            v.to_string()
        }
        None => resolve(kind, &profile.version, None)?,
    };
    let cache = child_path(root, kind, &profile.version, &version)?;
    let cached = fs::read(&cache).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok());
    let libraries = root.join("minecraft/libraries");
    let complete = cached.as_ref().is_some_and(|child| {
        child["libraries"].as_array().is_some_and(|libs| {
            libs.iter().all(|l| {
                l["downloads"]["artifact"]["path"]
                    .as_str()
                    .is_some_and(|p| net::safe_join(&libraries, p).is_ok_and(|p| p.is_file()))
            })
        })
    });
    let child = match cached {
        Some(child) if complete => child,
        _ => {
            let child = install(kind, root, &profile.version, &version, vanilla, &java()?, cancel, notify)?;
            profiles::atomic_write(&cache, &serde_json::to_vec(&child)?)?;
            child
        }
    };
    merge(kind, vanilla, &child, &profile.version)
}
pub fn cached_child(root: &Path, kind: Kind, mc: &str, version: &str) -> Result<(PathBuf, Value)> {
    let path = child_path(root, kind, mc, version)?;
    let value = serde_json::from_slice(&fs::read(&path)?)?;
    Ok((path, value))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn neoforge_versions_map_to_minecraft() {
        assert_eq!(neoforge_mc("21.1.77").as_deref(), Some("1.21.1"));
        assert_eq!(neoforge_mc("21.0.3-beta").as_deref(), Some("1.21"));
        assert_eq!(neoforge_mc("20.4.237").as_deref(), Some("1.20.4"));
        assert_eq!(neoforge_mc("26.3.0.101").as_deref(), Some("26.3"));
        assert_eq!(neoforge_mc("26.1.2.5").as_deref(), Some("26.1.2"));
        assert_eq!(neoforge_mc("0.25w14craftmine.3-beta"), None);
    }
    #[test]
    fn maven_paths_and_hosts_are_constrained() {
        assert_eq!(
            maven_path("net.minecraftforge:forge:26.3-66.1.0:client").unwrap(),
            "net/minecraftforge/forge/26.3-66.1.0/forge-26.3-66.1.0-client.jar"
        );
        assert_eq!(
            maven_path("net.minecraft:client:1.20.1-20230612.114412:mappings@txt").unwrap(),
            "net/minecraft/client/1.20.1-20230612.114412/client-1.20.1-20230612.114412-mappings.txt"
        );
        assert!(maven_path("a:../b:1").is_err());
        assert!(maven_path("a:b").is_err());
        assert!(approved("https://maven.neoforged.net/releases/x.jar"));
        assert!(!approved("http://maven.neoforged.net/x.jar"));
        assert!(!approved("https://maven.neoforged.net.evil.test/x.jar"));
    }
    #[test]
    fn merge_prefers_loader_libraries_and_keeps_vanilla_identity() {
        let vanilla = json!({"id":"26.3","mainClass":"net.minecraft.client.main.Main","arguments":{"jvm":["-cp","${classpath}"],"game":["--version","${version_name}"]},"libraries":[{"name":"org.ow2.asm:asm:9.0"},{"name":"com.example:keep:1.0"}]});
        let child = json!({"id":"neoforge-26.3.0.101","inheritsFrom":"26.3","mainClass":"net.neoforged.fml.startup.Client","arguments":{"jvm":["-DlibraryDirectory=${library_directory}"],"game":["--fml.mcVersion","26.3"]},"libraries":[
            {"name":"org.ow2.asm:asm:9.8","downloads":{"artifact":{"path":"org/ow2/asm/asm/9.8/asm-9.8.jar","url":"https://maven.neoforged.net/releases/org/ow2/asm/asm/9.8/asm-9.8.jar","sha1":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}},
            {"name":"net.minecraftforge:forge:26.3-66.1.0:client","downloads":{"artifact":{"path":"net/minecraftforge/forge/26.3-66.1.0/forge-26.3-66.1.0-client.jar","url":"","sha1":""}}}
        ]});
        let merged = merge(Kind::NeoForge, &vanilla, &child, "26.3").unwrap();
        assert_eq!(merged["id"], "26.3");
        assert_eq!(merged["mainClass"], "net.neoforged.fml.startup.Client");
        let names: Vec<_> = merged["libraries"].as_array().unwrap().iter().map(|l| l["name"].as_str().unwrap()).collect();
        assert_eq!(names, ["org.ow2.asm:asm:9.8", "net.minecraftforge:forge:26.3-66.1.0:client", "com.example:keep:1.0"]);
        assert_eq!(merged["arguments"]["jvm"].as_array().unwrap().len(), 3);
        let bad = json!({"inheritsFrom":"26.3","mainClass":"x","libraries":[{"name":"a:b:1","downloads":{"artifact":{"path":"a/b/1/b-1.jar","url":"https://evil.test/b.jar"}}}]});
        assert!(merge(Kind::Forge, &vanilla, &bad, "26.3").is_err());
    }
}
