//! Fabric ve Quilt metadata/artefaktları. Üçüncü taraf kurulum programı çalıştırılmaz.
use crate::{model::Profile, net, profiles};
use anyhow::{Context, Result, bail};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoaderVersion {
    pub version: String,
    #[serde(default)]
    pub stable: bool,
}
/// Aynı Knot tabanlı profil biçimini kullanan yükleyiciler.
pub struct Flavor {
    pub name: &'static str,
    meta: &'static str,
    hosts: &'static [&'static str],
    mains: &'static [&'static str],
    pub prefix: &'static str,
    pub dir: &'static str,
}
pub const FABRIC: Flavor = Flavor {
    name: "Fabric",
    meta: "https://meta.fabricmc.net/v2",
    hosts: &["meta.fabricmc.net", "maven.fabricmc.net"],
    mains: &[
        "net.fabricmc.loader.impl.launch.knot.KnotClient",
        "net.fabricmc.loader.launch.knot.KnotClient",
    ],
    prefix: "fabric-loader",
    dir: "fabric",
};
pub const QUILT: Flavor = Flavor {
    name: "Quilt",
    meta: "https://meta.quiltmc.org/v3",
    hosts: &["meta.quiltmc.org", "maven.quiltmc.org", "maven.fabricmc.net"],
    mains: &["org.quiltmc.loader.impl.launch.knot.KnotClient"],
    prefix: "quilt-loader",
    dir: "quilt",
};
#[derive(Debug, Serialize)]
pub struct LoaderVersions {
    pub versions: Vec<LoaderVersion>,
    pub default_version: Option<String>,
}
pub fn identifier(id: &str) -> Result<()> {
    if id.is_empty()
        || id.len() > 100
        || id == "."
        || id == ".."
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-+".contains(&b))
    {
        bail!("Fabric sürüm kimliği geçersiz.");
    }
    Ok(())
}
pub fn approved_url(url: &str) -> bool {
    approved_for(&FABRIC, url)
}
/// Fabric veya Quilt kütüphanesi için izinli adres.
pub fn approved_any(url: &str) -> bool {
    approved_for(&FABRIC, url) || approved_for(&QUILT, url)
}
fn approved_for(flavor: &Flavor, url: &str) -> bool {
    reqwest::Url::parse(url).is_ok_and(|u| {
        u.scheme() == "https"
            && u.username().is_empty()
            && u.password().is_none()
            && u.port().is_none()
            && u.query().is_none()
            && u.fragment().is_none()
            && u.host_str().is_some_and(|h| flavor.hosts.contains(&h))
    })
}
pub fn client() -> Result<Client> {
    client_with(approved_url)
}
pub fn client_any() -> Result<Client> {
    client_with(approved_any)
}
fn client_for(flavor: &'static Flavor) -> Result<Client> {
    client_with(move |u| approved_for(flavor, u))
}
fn client_with(allowed: impl Fn(&str) -> bool + Send + Sync + 'static) -> Result<Client> {
    Ok(Client::builder()
        .https_only(true)
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(120))
        .user_agent(concat!("PatronLauncher/", env!("CARGO_PKG_VERSION")))
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= 5 || !allowed(attempt.url().as_str()) {
                attempt.error("Fabric yönlendirmesi izin verilen alan adlarının dışında.")
            } else {
                attempt.follow()
            }
        }))
        .build()?)
}
fn get_json(flavor: &Flavor, client: &Client, url: &str) -> Result<Value> {
    if !approved_for(flavor, url) {
        bail!("Fabric adresi izin verilen alan adlarının dışında.");
    }
    Ok(client.get(url).send()?.error_for_status()?.json()?)
}
pub fn versions(mc: &str) -> Result<LoaderVersions> {
    versions_for(&FABRIC, mc)
}
fn numeric(v: &str) -> Vec<u64> {
    v.split(|c: char| !c.is_ascii_digit()).filter_map(|p| p.parse().ok()).collect()
}
pub fn versions_for(flavor: &'static Flavor, mc: &str) -> Result<LoaderVersions> {
    identifier(mc)?;
    let raw = get_json(
        flavor,
        &client_for(flavor)?,
        &format!("{}/versions/loader/{mc}", flavor.meta),
    )?;
    let mut versions = vec![];
    let mut seen = HashSet::new();
    for entry in raw.as_array().context("Fabric loader listesi geçersiz")? {
        let mut loader: LoaderVersion = serde_json::from_value(entry["loader"].clone())?;
        identifier(&loader.version)?;
        if flavor.name == "Quilt" {
            // Quilt Meta kararlılık bilgisi vermez; ön sürümler "-beta" gibi ek taşır.
            loader.stable = !loader.version.contains('-');
        }
        if seen.insert(loader.version.clone()) {
            versions.push(loader);
        }
    }
    if flavor.name == "Quilt" {
        versions.sort_by(|a, b| numeric(&b.version).cmp(&numeric(&a.version)));
    }
    // Meta en yeniyi önce verir. En yeni kararlı seçilir; ön sürüm sessizce seçilmez.
    let default_version = versions
        .iter()
        .find(|v| v.stable)
        .map(|v| v.version.clone());
    Ok(LoaderVersions {
        versions,
        default_version,
    })
}
pub fn resolve(mc: &str, requested: Option<&str>) -> Result<String> {
    resolve_for(&FABRIC, mc, requested)
}
pub fn resolve_for(flavor: &'static Flavor, mc: &str, requested: Option<&str>) -> Result<String> {
    if let Some(id) = requested {
        identifier(id)?;
    }
    let options = versions_for(flavor, mc)?;
    if let Some(id) = requested {
        if options.versions.iter().any(|v| v.version == id) {
            return Ok(id.into());
        }
        bail!("{} loader bu Minecraft sürümüyle uyumlu değil.", flavor.name);
    }
    options
        .default_version
        .with_context(|| format!("Bu Minecraft sürümü için kararlı {} loader bulunamadı.", flavor.name))
}
fn coordinate(name: &str) -> Result<(String, String)> {
    let parts: Vec<_> = name.split(':').collect();
    if !(3..=4).contains(&parts.len()) {
        bail!("Fabric Maven koordinatı geçersiz.");
    }
    for part in &parts {
        identifier(part)?;
        if part.starts_with('.') || part.ends_with('.') || part.contains("..") {
            bail!("Fabric Maven koordinatı geçersiz.");
        }
    }
    let group = parts[0].replace('.', "/");
    let classifier = parts.get(3).map(|v| format!("-{v}")).unwrap_or_default();
    let path = format!(
        "{group}/{}/{}/{}-{}{classifier}.jar",
        parts[1], parts[2], parts[1], parts[2]
    );
    net::safe_join(Path::new("libraries"), &path)?;
    let key = format!("{}:{}:{}", parts[0], parts[1], parts.get(3).unwrap_or(&""));
    Ok((path, key))
}
fn sha1(value: &str) -> Result<String> {
    if value.len() != 40 || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
        bail!("Fabric SHA-1 özeti geçersiz.");
    }
    Ok(value.to_ascii_lowercase())
}
fn library(flavor: &Flavor, lib: &Value) -> Result<Value> {
    let name = lib["name"].as_str().context("Fabric kütüphane adı eksik")?;
    let (path, _) = coordinate(name)?;
    let base = lib["url"].as_str().context("Fabric Maven adresi eksik")?;
    if !approved_for(flavor, base) || !base.ends_with('/') {
        bail!("Fabric Maven adresi izin verilen alan adlarının dışında.");
    }
    let url = reqwest::Url::parse(base)?.join(&path)?.to_string();
    if !approved_for(flavor, &url) {
        bail!("Fabric kütüphane adresi geçersiz.");
    }
    let hash = lib
        .get("sha1")
        .map(|v| sha1(v.as_str().context("Fabric SHA-1 özeti geçersiz")?))
        .transpose()?;
    Ok(
        json!({"name":name,"patronlauncher_fabric":true,"downloads":{"artifact":{"path":path,"url":url,"sha1":hash}}}),
    )
}
/// Deliberately merge only loader-owned fields. Java/downloads/assets stay vanilla-owned.
pub fn merge(vanilla: &Value, child: &Value, mc: &str) -> Result<Value> {
    merge_for(&FABRIC, vanilla, child, mc)
}
pub fn merge_for(flavor: &Flavor, vanilla: &Value, child: &Value, mc: &str) -> Result<Value> {
    if child["inheritsFrom"].as_str() != Some(mc) || vanilla["id"].as_str() != Some(mc) {
        bail!("Fabric inheritsFrom sürümü vanilla ile eşleşmiyor.");
    }
    let main = child["mainClass"]
        .as_str()
        .context("Fabric mainClass eksik")?;
    if !flavor.mains.contains(&main) {
        bail!("{} istemci giriş sınıfı desteklenmiyor.", flavor.name);
    }
    let id = child["id"]
        .as_str()
        .context("Fabric profil kimliği eksik")?;
    identifier(id)?;
    let mut result = vanilla.clone();
    result["id"] = json!(id);
    result["mainClass"] = json!(main);
    for kind in ["jvm", "game"] {
        let mut args = vanilla["arguments"][kind]
            .as_array()
            .context("Vanilla argümanları eksik")?
            .clone();
        if let Some(extra) = child["arguments"].get(kind) {
            args.extend(
                extra
                    .as_array()
                    .context("Fabric argümanları geçersiz")?
                    .iter()
                    .cloned(),
            );
        }
        result["arguments"][kind] = json!(args);
    }
    let mut libs = vec![];
    let mut keys = HashSet::new();
    for lib in child["libraries"]
        .as_array()
        .context("Fabric kütüphaneleri eksik")?
    {
        let normalized = library(flavor, lib)?;
        let (_, key) = coordinate(normalized["name"].as_str().unwrap())?;
        if keys.insert(key) {
            libs.push(normalized);
        }
    }
    for lib in vanilla["libraries"]
        .as_array()
        .context("Vanilla kütüphaneleri eksik")?
    {
        let name = lib["name"]
            .as_str()
            .context("Vanilla kütüphane adı eksik")?;
        let key = coordinate(name)
            .map(|(_, key)| key)
            .unwrap_or_else(|_| name.into());
        if !keys.contains(&key) {
            libs.push(lib.clone());
        }
    }
    result["libraries"] = json!(libs);
    Ok(result)
}
fn profile_json(flavor: &Flavor, root: &Path, mc: &str, loader: &str, client: &Client) -> Result<Value> {
    identifier(mc)?;
    identifier(loader)?;
    let id = format!("{}-{loader}-{mc}", flavor.prefix);
    identifier(&id)?;
    let cache = net::safe_join(&root.join("minecraft").join(flavor.dir), &format!("{id}.json"))?;
    let raw = match get_json(
        flavor,
        client,
        &format!("{}/versions/loader/{mc}/{loader}/profile/json", flavor.meta),
    ) {
        Ok(value) => value,
        Err(error) => serde_json::from_slice(
            &fs::read(&cache)
                .with_context(|| format!("Fabric profili alınamadı ve önbellek yok: {error}"))?,
        )?,
    };
    if raw["id"].as_str() != Some(&id) || raw["inheritsFrom"].as_str() != Some(mc) {
        bail!("Fabric profil kimliği eşleşmiyor.");
    }
    Ok(raw)
}
pub fn prepare(
    root: &Path,
    profile: &Profile,
    vanilla: &Value,
    cancel: &AtomicBool,
) -> Result<Value> {
    prepare_for(&FABRIC, root, profile, vanilla, cancel)
}
pub fn prepare_for(
    flavor: &'static Flavor,
    root: &Path,
    profile: &Profile,
    vanilla: &Value,
    cancel: &AtomicBool,
) -> Result<Value> {
    let client = client_for(flavor)?;
    let loader = match profile.loader_version.as_deref() {
        Some(v) => {
            identifier(v)?;
            v.to_owned()
        }
        None => resolve_for(flavor, &profile.version, None)?,
    };
    let mut raw = profile_json(flavor, root, &profile.version, &loader, &client)?;
    let mut merged = merge_for(flavor, vanilla, &raw, &profile.version)?;
    for lib in merged["libraries"].as_array_mut().unwrap() {
        if cancel.load(Ordering::Relaxed) {
            bail!("İşlem iptal edildi.");
        }
        if lib["patronlauncher_fabric"] != true {
            continue;
        }
        let data = &mut lib["downloads"]["artifact"];
        if data["sha1"].is_null() {
            let url = format!("{}.sha1", data["url"].as_str().unwrap());
            if !approved_for(flavor, &url) {
                bail!("Fabric özet adresi reddedildi.");
            }
            let response = client.get(&url).send()?.error_for_status()?;
            let mut bytes = vec![];
            response.take(513).read_to_end(&mut bytes)?;
            if bytes.len() > 512 {
                bail!("Fabric özet dosyası çok büyük.");
            }
            let text = std::str::from_utf8(&bytes)?;
            data["sha1"] = json!(sha1(text.split_whitespace().next().unwrap_or(""))?);
        }
        if let Some(raw_lib) = raw["libraries"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|r| r["name"] == lib["name"])
        {
            raw_lib["sha1"] = lib["downloads"]["artifact"]["sha1"].clone();
        }
    }
    let id = raw["id"].as_str().unwrap();
    let cache = net::safe_join(&root.join("minecraft").join(flavor.dir), &format!("{id}.json"))?;
    profiles::atomic_write(&cache, &serde_json::to_vec(&raw)?)?;
    Ok(merged)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Loader;
    fn vanilla() -> Value {
        json!({"id":"1.21.11","mainClass":"net.minecraft.client.main.Main","arguments":{"jvm":["-cp","${classpath}"],"game":["--gameDir","${game_directory}"]},"libraries":[{"name":"org.ow2.asm:asm:9.0"},{"name":"com.example:keep:1.0"}],"javaVersion":{"majorVersion":21},"assetIndex":{"id":"assets"},"downloads":{"client":{"sha1":"vanilla"}}})
    }
    fn child() -> Value {
        json!({"id":"fabric-loader-0.18.4-1.21.11","inheritsFrom":"1.21.11","mainClass":"net.fabricmc.loader.impl.launch.knot.KnotClient","arguments":{"jvm":["-Dfabric.test=true"],"game":["--fabric-test"]},"libraries":[{"name":"org.ow2.asm:asm:9.8","url":"https://maven.fabricmc.net/","sha1":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}],"javaVersion":{"majorVersion":99},"downloads":{"client":{"url":"https://evil.invalid/"}}})
    }
    #[test]
    fn merges_loader_fields_and_replaces_conflicting_artifacts_without_losing_vanilla() {
        let base = vanilla();
        let merged = merge(&base, &child(), "1.21.11").unwrap();
        assert_eq!(
            merged["mainClass"],
            "net.fabricmc.loader.impl.launch.knot.KnotClient"
        );
        assert_eq!(
            merged["arguments"]["jvm"],
            json!(["-cp", "${classpath}", "-Dfabric.test=true"])
        );
        assert_eq!(
            merged["arguments"]["game"],
            json!(["--gameDir", "${game_directory}", "--fabric-test"])
        );
        assert_eq!(merged["libraries"].as_array().unwrap().len(), 2);
        assert_eq!(merged["libraries"][0]["name"], "org.ow2.asm:asm:9.8");
        assert_eq!(merged["libraries"][1]["name"], "com.example:keep:1.0");
        for field in ["javaVersion", "downloads", "assetIndex"] {
            assert_eq!(merged[field], base[field]);
        }
        assert_eq!(
            merged["libraries"][0]["downloads"]["artifact"]["path"],
            "org/ow2/asm/asm/9.8/asm-9.8.jar"
        );
    }
    #[test]
    fn rejects_wrong_inheritance_and_malformed_arguments() {
        let mut raw = child();
        raw["inheritsFrom"] = json!("1.18.2");
        assert!(merge(&vanilla(), &raw, "1.21.11").is_err());
        raw = child();
        raw["arguments"]["jvm"] = json!("bad");
        assert!(merge(&vanilla(), &raw, "1.21.11").is_err());
    }
    #[test]
    fn rejects_unapproved_urls_coordinates_and_hashes() {
        for url in [
            "http://maven.fabricmc.net/",
            "https://maven.fabricmc.net.evil.invalid/",
            "https://evil.invalid/",
            "https://evil@meta.fabricmc.net/",
            "https://meta.fabricmc.net:444/",
            "file:///C:/test",
            "https://maven.fabricmc.net/#fragment",
        ] {
            assert!(!approved_url(url));
            let mut raw = child();
            raw["libraries"][0]["url"] = json!(url);
            assert!(merge(&vanilla(), &raw, "1.21.11").is_err());
        }
        assert!(approved_url(
            "https://meta.fabricmc.net/v2/versions/loader/1.21.11"
        ));
        assert!(approved_url("https://maven.fabricmc.net/a.jar.sha1"));
        for name in [
            "../escape:lib:1",
            "g:../lib:1",
            "g:a:../../x",
            "g:a:1:c:extra",
        ] {
            let mut raw = child();
            raw["libraries"][0]["name"] = json!(name);
            assert!(merge(&vanilla(), &raw, "1.21.11").is_err());
        }
        let mut raw = child();
        raw["libraries"][0]["sha1"] = json!("bad");
        assert!(merge(&vanilla(), &raw, "1.21.11").is_err());
    }
    #[test]
    fn identifiers_cannot_inject_paths_or_api_queries() {
        for id in ["", "../evil", "C:/evil", "1.21?url=x", "0.1#x", "a\\b"] {
            assert!(identifier(id).is_err());
        }
        assert!(identifier("0.4.8+build.155").is_ok());
    }
    #[test]
    #[ignore = "Official Fabric Meta/Maven network test; downloads only checked library data into a temporary directory"]
    fn fabric_live_metadata_and_checked_libraries() {
        let root = std::env::temp_dir().join(format!(
            "patronlauncher-fabric-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        let result = (|| -> Result<()> {
            let version = resolve("1.21.11", None)?;
            let profile = Profile {
                appearance: Default::default(),
                kind: crate::model::ProfileKind::Custom,
                id: uuid::Uuid::new_v4(),
                name: "Fabric test".into(),
                version: "1.21.11".into(),
                loader: Loader::Fabric,
                loader_version: Some(version.clone()),
            };
            let merged = prepare(&root, &profile, &vanilla(), &AtomicBool::new(false))?;
            let client = client()?;
            let mut count = 0;
            for lib in merged["libraries"].as_array().unwrap() {
                if lib["patronlauncher_fabric"] != true {
                    continue;
                }
                let data = &lib["downloads"]["artifact"];
                let path = net::safe_join(&root.join("libraries"), data["path"].as_str().unwrap())?;
                let url = data["url"].as_str().unwrap();
                assert!(approved_url(url));
                let expected = data["sha1"].as_str().unwrap();
                net::download(&client, url, &path, expected, false)?;
                assert_eq!(net::digest_file(&path, false)?, expected);
                net::download(&client, url, &path, expected, false)?;
                count += 1;
            }
            assert!(count >= 3);
            println!(
                "Fabric {version}: {count} official artifacts verified; inherited Java 21 and KnotClient profile merged."
            );
            Ok(())
        })();
        let _ = fs::remove_dir_all(&root);
        result.unwrap();
    }
}
