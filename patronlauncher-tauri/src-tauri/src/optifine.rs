//! OptiFine: sürümler BMCLAPI aynasından listelenir ve indirilir (OptiFine'ın resmî API'si yoktur),
//! OptiFine'ın kendi Patcher'ı yerel Java ile çalıştırılarak kütüphane üretilir ve
//! launchwrapper ile başlatılır. Ana ayna dosyayı gönüllü OpenBMCLAPI düğümlerine yönlendirir;
//! yönlendirme adresindeki SHA-1 ana aynadan alınır ve düğümden gelen dosya buna göre doğrulanır.
use crate::{fabric::LoaderVersion, fabric::LoaderVersions, net, profiles, runtime};
use anyhow::{Context, Result, bail, ensure};
use reqwest::blocking::Client;
use serde::Deserialize;
use sha1::{Digest, Sha1};
use serde_json::{Value, json};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

const MIRROR: &str = "bmclapi2.bangbang93.com";
const MAX_JAR: u64 = 64 * 1024 * 1024;

fn approved(url: &str) -> bool {
    reqwest::Url::parse(url).is_ok_and(|u| {
        u.scheme() == "https"
            && u.username().is_empty()
            && u.password().is_none()
            && u.port().is_none()
            && u.host_str() == Some(MIRROR)
    })
}
/// Ana aynaya yönlendirme izlemeden istek atan istemci.
fn mirror_client() -> Result<Client> {
    Ok(Client::builder()
        .https_only(true)
        .user_agent(concat!("PatronLauncher/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::none())
        .build()?)
}
/// Düğümden indirme: herhangi bir HTTPS sunucu olabilir; bütünlük SHA-1 ile sağlanır.
fn node_client() -> Result<Client> {
    Ok(Client::builder()
        .https_only(true)
        .user_agent(concat!("PatronLauncher/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(300))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()?)
}
/// "/download/<sha1>" biçimindeki düğüm adresinden özeti çıkarır.
fn node_sha1(url: &reqwest::Url) -> Option<String> {
    let mut segments = url.path_segments()?;
    (segments.next()? == "download")
        .then(|| segments.next())
        .flatten()
        .filter(|h| h.len() == 40 && h.bytes().all(|b| b.is_ascii_hexdigit()))
        .map(str::to_ascii_lowercase)
}
/// Ana aynanın yönlendirmelerini izleyerek düğüm adresini ve SHA-1'i bulur.
fn resolve_download(start: &str) -> Result<(reqwest::Url, String)> {
    let client = mirror_client()?;
    let mut url = reqwest::Url::parse(start)?;
    for _ in 0..4 {
        ensure!(approved(url.as_str()), "OptiFine adresi ana aynada değil.");
        let response = client.get(url.clone()).send()?;
        ensure!(response.status().is_redirection(), "OptiFine aynası beklenen yönlendirmeyi vermedi.");
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .context("OptiFine yönlendirme adresi eksik")?;
        let next = url.join(location)?;
        if next.host_str() == Some(MIRROR) {
            url = next;
            continue;
        }
        ensure!(
            next.scheme() == "https" && next.username().is_empty() && next.password().is_none(),
            "OptiFine indirme adresi güvenli değil."
        );
        let sha1 = node_sha1(&next).context("OptiFine indirme adresinde özet yok.")?;
        return Ok((next, sha1));
    }
    bail!("OptiFine aynası çok fazla yönlendirme yaptı.")
}
fn client() -> Result<Client> {
    Ok(Client::builder()
        .https_only(true)
        .user_agent(concat!("PatronLauncher/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(300))
        .redirect(reqwest::redirect::Policy::custom(|a| {
            if a.previous().len() >= 5 || !approved(a.url().as_str()) {
                a.error("OptiFine yönlendirmesi reddedildi")
            } else {
                a.follow()
            }
        }))
        .build()?)
}
#[derive(Deserialize)]
struct Entry {
    #[serde(rename = "type")]
    kind: String,
    patch: String,
    filename: String,
}
/// Sürüm kimliği "tür+yama" biçimindedir (ör. HD_U+J1).
fn split(version: &str) -> Result<(&str, &str)> {
    crate::fabric::identifier(version)?;
    let (kind, patch) = version.split_once('+').context("OptiFine sürümü geçersiz.")?;
    ensure!(
        [kind, patch].iter().all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')),
        "OptiFine sürümü geçersiz."
    );
    Ok((kind, patch))
}
pub fn versions(mc: &str) -> Result<LoaderVersions> {
    crate::fabric::identifier(mc)?;
    let url = format!("https://{MIRROR}/optifine/{mc}");
    let response = client()?.get(&url).send()?.error_for_status()?;
    let mut bytes = Vec::new();
    response.take(2 * 1024 * 1024 + 1).read_to_end(&mut bytes)?;
    ensure!(bytes.len() <= 2 * 1024 * 1024, "OptiFine listesi çok büyük.");
    let entries: Vec<Entry> = serde_json::from_slice(&bytes)?;
    let mut versions: Vec<LoaderVersion> = entries
        .into_iter()
        .map(|e| LoaderVersion {
            stable: !e.filename.starts_with("preview_"),
            version: format!("{}+{}", e.kind, e.patch),
        })
        .filter(|v| split(&v.version).is_ok())
        .collect();
    // Kararlılar önce; aynı grupta harf/sayı sırasına göre en yeni üstte.
    versions.sort_by(|a, b| b.stable.cmp(&a.stable).then_with(|| b.version.cmp(&a.version)));
    versions.dedup_by(|a, b| a.version == b.version);
    let default_version = versions.iter().find(|v| v.stable).map(|v| v.version.clone());
    Ok(LoaderVersions { versions, default_version })
}
pub fn resolve(mc: &str, requested: Option<&str>) -> Result<String> {
    let options = versions(mc)?;
    match requested {
        Some(v) if options.versions.iter().any(|o| o.version == v) => Ok(v.to_string()),
        Some(_) => bail!("OptiFine sürümü bu Minecraft sürümüyle uyumlu değil."),
        None => options
            .default_version
            .context("Bu Minecraft sürümü için kararlı OptiFine bulunamadı."),
    }
}
pub fn child_name(mc: &str, version: &str) -> Result<String> {
    crate::fabric::identifier(mc)?;
    split(version)?;
    Ok(format!("optifine-{mc}-{version}.json"))
}
fn child_path(root: &Path, mc: &str, version: &str) -> Result<PathBuf> {
    net::safe_join(&root.join("minecraft/optifine"), &child_name(mc, version)?)
}
pub fn cached_child(root: &Path, mc: &str, version: &str) -> Result<(PathBuf, Value)> {
    let path = child_path(root, mc, version)?;
    Ok((path.clone(), serde_json::from_slice(&fs::read(path)?)?))
}

/// OptiFine sürüm tanımını vanilla ile birleştirir (launchwrapper + tweaker).
pub fn merge(vanilla: &Value, child: &Value, mc: &str) -> Result<Value> {
    ensure!(
        child["inheritsFrom"].as_str() == Some(mc) && vanilla["id"].as_str() == Some(mc),
        "OptiFine sürüm tanımı vanilla ile eşleşmiyor."
    );
    let mut result = vanilla.clone();
    result["mainClass"] = json!("net.minecraft.launchwrapper.Launch");
    let mut game = vanilla["arguments"]["game"].as_array().cloned().unwrap_or_default();
    game.extend([json!("--tweakClass"), json!("optifine.OptiFineTweaker")]);
    result["arguments"]["game"] = json!(game);
    let mut libs = child["libraries"].as_array().cloned().context("OptiFine kütüphaneleri eksik")?;
    for lib in &libs {
        let path = lib["downloads"]["artifact"]["path"].as_str().context("OptiFine kütüphane yolu eksik")?;
        net::safe_join(Path::new("libraries"), path)?;
    }
    libs.extend(vanilla["libraries"].as_array().cloned().unwrap_or_default());
    result["libraries"] = json!(libs);
    Ok(result)
}

fn library(name: &str, path: &str) -> Value {
    json!({"name": name, "patronlauncher_loader": "optifine", "downloads": {"artifact": {"path": path, "url": "", "sha1": ""}}})
}

#[allow(clippy::too_many_arguments)]
fn install(root: &Path, mc: &str, version: &str, vanilla: &Value, java: &Path, cancel: &AtomicBool, notify: &dyn Fn(String)) -> Result<Value> {
    let (kind, patch) = split(version)?;
    let shared = root.join("minecraft");
    let libraries = shared.join("libraries");
    let stage = shared.join("optifine").join(format!(".install-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&stage)?;
    let result = (|| -> Result<Value> {
        notify(format!("OptiFine {} indiriliyor…", version.replace('+', " ")));
        let (node, expected) = resolve_download(&format!("https://{MIRROR}/optifine/{mc}/{kind}/{patch}"))?;
        let mut response = node_client()?.get(node).send()?.error_for_status()?;
        let installer = stage.join("OptiFine.jar");
        let mut out = fs::File::create(&installer)?;
        let mut hash = Sha1::new();
        let mut buf = [0u8; 65536];
        let mut total = 0u64;
        loop {
            ensure!(!cancel.load(Ordering::Relaxed), "İşlem iptal edildi.");
            let n = response.read(&mut buf)?;
            if n == 0 {
                break;
            }
            total += n as u64;
            ensure!(total <= MAX_JAR, "OptiFine dosyası çok büyük.");
            out.write_all(&buf[..n])?;
            hash.update(&buf[..n]);
        }
        drop(out);
        ensure!(
            format!("{:x}", hash.finalize()) == expected,
            "OptiFine dosyası doğrulanamadı (SHA-1 eşleşmiyor)."
        );
        let mut zip = zip::ZipArchive::new(fs::File::open(&installer)?).context("OptiFine dosyası geçersiz")?;
        ensure!(zip.by_name("optifine/Patcher.class").is_ok(), "OptiFine dosyası beklenen yapıda değil.");
        let mut wrapper = String::new();
        zip.by_name("launchwrapper-of.txt")
            .context("OptiFine launchwrapper bilgisi yok")?
            .take(64)
            .read_to_string(&mut wrapper)?;
        let wrapper = wrapper.trim().to_string();
        crate::fabric::identifier(&wrapper)?;
        let wrapper_path = format!("optifine/launchwrapper-of/{wrapper}/launchwrapper-of-{wrapper}.jar");
        let wrapper_file = net::safe_join(&libraries, &wrapper_path)?;
        if !wrapper_file.is_file() {
            fs::create_dir_all(wrapper_file.parent().context("Geçersiz yol")?)?;
            let mut entry = zip.by_name(&format!("launchwrapper-of-{wrapper}.jar"))?;
            let mut out = fs::File::create(&wrapper_file)?;
            std::io::copy(&mut (&mut entry).take(MAX_JAR), &mut out)?;
        }
        let client_jar = net::safe_join(&shared.join("versions"), mc)?.join(format!("{mc}.jar"));
        let jar = &vanilla["downloads"]["client"];
        net::download_cancellable(
            &net::client()?,
            jar["url"].as_str().context("İstemci adresi eksik")?,
            &client_jar,
            jar["sha1"].as_str().context("İstemci özeti eksik")?,
            false,
            cancel,
        )?;
        let lib_version = format!("{mc}_{kind}_{patch}");
        let lib_path = format!("optifine/OptiFine/{lib_version}/OptiFine-{lib_version}.jar");
        let lib_file = net::safe_join(&libraries, &lib_path)?;
        fs::create_dir_all(lib_file.parent().context("Geçersiz yol")?)?;
        notify("OptiFine istemciye uygulanıyor…".into());
        let output = runtime::quiet_command(java)
            .arg("-cp")
            .arg(&installer)
            .arg("optifine.Patcher")
            .arg(&client_jar)
            .arg(&installer)
            .arg(&lib_file)
            .current_dir(&stage)
            .output()
            .context("OptiFine Patcher başlatılamadı")?;
        ensure!(
            output.status.success() && lib_file.is_file(),
            "OptiFine kurulamadı: {}",
            String::from_utf8_lossy(&output.stderr).lines().last().unwrap_or_default()
        );
        let installer_sha1 = net::digest_file(&installer, false)?;
        Ok(json!({
            "id": format!("{mc}-OptiFine_{kind}_{patch}"),
            "inheritsFrom": mc,
            "patronlauncher_installer_sha1": installer_sha1,
            "libraries": [
                library(&format!("optifine:OptiFine:{lib_version}"), &lib_path),
                library(&format!("optifine:launchwrapper-of:{wrapper}"), &wrapper_path),
            ]
        }))
    })();
    let _ = fs::remove_dir_all(&stage);
    result
}

pub fn prepare(
    root: &Path,
    profile: &crate::model::Profile,
    vanilla: &Value,
    java: &dyn Fn() -> Result<PathBuf>,
    cancel: &AtomicBool,
    notify: &dyn Fn(String),
) -> Result<Value> {
    let version = match profile.loader_version.as_deref() {
        Some(v) => {
            split(v)?;
            v.to_string()
        }
        None => resolve(&profile.version, None)?,
    };
    let cache = child_path(root, &profile.version, &version)?;
    let libraries = root.join("minecraft/libraries");
    let cached = fs::read(&cache).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).filter(|c| {
        c["libraries"].as_array().is_some_and(|libs| {
            libs.iter().all(|l| {
                l["downloads"]["artifact"]["path"]
                    .as_str()
                    .is_some_and(|p| net::safe_join(&libraries, p).is_ok_and(|p| p.is_file()))
            })
        })
    });
    let child = match cached {
        Some(c) => c,
        None => {
            let c = install(root, &profile.version, &version, vanilla, &java()?, cancel, notify)?;
            profiles::atomic_write(&cache, &serde_json::to_vec(&c)?)?;
            c
        }
    };
    merge(vanilla, &child, &profile.version)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn versions_and_hosts_are_validated() {
        assert_eq!(split("HD_U+J1").unwrap(), ("HD_U", "J1"));
        assert_eq!(split("HD_U_J1+pre10").unwrap(), ("HD_U_J1", "pre10"));
        assert!(split("HD_U").is_err());
        assert!(split("HD/U+J1").is_err());
        assert!(approved("https://bmclapi2.bangbang93.com/maven/com/optifine/x.jar"));
        assert!(!approved("http://bmclapi2.bangbang93.com/x"));
        assert!(!approved("https://evil.test/x"));
        let node = reqwest::Url::parse(
            "https://bmclapi.node.test:443/download/CEE35B83C75DA33DC07FFBB344386CAE5CDC5C5B?name=a.jar",
        )
        .unwrap();
        assert_eq!(node_sha1(&node).as_deref(), Some("cee35b83c75da33dc07ffbb344386cae5cdc5c5b"));
        assert!(node_sha1(&reqwest::Url::parse("https://n.test/files/abc").unwrap()).is_none());
    }
    #[test]
    fn merge_uses_launchwrapper_and_tweaker() {
        let vanilla = json!({"id":"1.21.1","mainClass":"net.minecraft.client.main.Main","arguments":{"jvm":[],"game":["--version","${version_name}"]},"libraries":[{"name":"a:b:1"}]});
        let child = json!({"inheritsFrom":"1.21.1","libraries":[library("optifine:OptiFine:1.21.1_HD_U_J1","optifine/OptiFine/1.21.1_HD_U_J1/OptiFine-1.21.1_HD_U_J1.jar")]});
        let merged = merge(&vanilla, &child, "1.21.1").unwrap();
        assert_eq!(merged["mainClass"], "net.minecraft.launchwrapper.Launch");
        assert_eq!(merged["arguments"]["game"].as_array().unwrap().len(), 4);
        assert_eq!(merged["libraries"].as_array().unwrap().len(), 2);
    }
}
