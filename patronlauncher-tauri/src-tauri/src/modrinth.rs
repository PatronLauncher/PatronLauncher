//! Bounded v2 metadata client. No API-provided URL is used as an API endpoint.
use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    io::Read,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

#[derive(Default)]
struct Cache {
    values: HashMap<String, (Instant, Value)>,
    blocked: Option<Instant>,
}
static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
pub fn user_agent() -> String {
    format!(
        "PatronLauncher/{} ({})",
        env!("CARGO_PKG_VERSION"),
        option_env!("PATRONLAUNCHER_CONTACT").unwrap_or("contact: see project repository")
    )
}
pub fn id(id: &str) -> Result<()> {
    ensure!(
        !id.is_empty()
            && id.len() <= 100
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b)),
        "Modrinth kimliği geçersiz."
    );
    Ok(())
}
pub fn get(path: &str, query: &[(&str, String)]) -> Result<Value> {
    let mut url = reqwest::Url::parse(&format!("https://api.modrinth.com/v2/{path}"))?;
    url.query_pairs_mut()
        .extend_pairs(query.iter().map(|(k, v)| (*k, v.as_str())));
    let key = url.to_string();
    let cache = CACHE.get_or_init(Default::default);
    {
        let c = cache
            .lock()
            .map_err(|_| anyhow::anyhow!("Önbellek kilidi açılamadı"))?;
        if let Some((at, v)) = c.values.get(&key) {
            if at.elapsed() < Duration::from_secs(120) {
                return Ok(v.clone());
            }
        }
        if c.blocked.is_some_and(|until| until > Instant::now()) {
            bail!("Modrinth istek sınırına ulaşıldı. Bir süre sonra tekrar deneyin.");
        }
    }
    let client = reqwest::blocking::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(user_agent())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(45))
        .build()?;
    let response = client
        .get(url)
        .send()
        .context("Modrinth'e bağlanılamadı; internet bağlantınızı kontrol edin")?;
    let exhausted = response.status().as_u16() == 429
        || response
            .headers()
            .get("x-ratelimit-remaining")
            .is_some_and(|v| v == "0");
    if exhausted {
        let seconds = response
            .headers()
            .get("retry-after")
            .or_else(|| response.headers().get("x-ratelimit-reset"))
            .and_then(|h| h.to_str().ok())
            .and_then(|s| s.parse::<f64>().ok())
            .filter(|v| v.is_finite())
            .unwrap_or(60.)
            .clamp(1., 3600.);
        cache.lock().unwrap().blocked = Some(Instant::now() + Duration::from_secs_f64(seconds));
    }
    ensure!(
        response.status().is_success(),
        "Modrinth isteği başarısız (HTTP {}). Lütfen daha sonra tekrar deneyin.",
        response.status()
    );
    let mut bytes = Vec::new();
    response
        .take(8 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .context("Modrinth yanıtı okunamadı")?;
    ensure!(
        bytes.len() <= 8 * 1024 * 1024,
        "Modrinth yanıt boyutu sınırı aşıldı."
    );
    let value: Value = serde_json::from_slice(&bytes).context("Modrinth yanıtı çözümlenemedi")?;
    let mut c = cache.lock().unwrap();
    c.values
        .retain(|_, (at, _)| at.elapsed() < Duration::from_secs(120));
    if c.values.len() >= 64 {
        c.values.clear();
    }
    c.values.insert(key, (Instant::now(), value.clone()));
    Ok(value)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Search {
    #[serde(default)]
    pub categories: Vec<String>,
    pub query: String,
    pub sort: String,
    pub category: Option<String>,
    pub loader: Option<String>,
    pub game_version: Option<String>,
    pub environment: Option<String>,
    pub offset: u32,
    pub limit: u32,
    #[serde(default)]
    pub project_type: Option<String>,
}
pub fn search(s: Search) -> Result<Value> {
    ensure!(
        s.query.len() <= 256 && s.limit > 0 && s.limit <= 100 && s.offset <= 100_000,
        "Arama sınırları geçersiz."
    );
    ensure!(
        ["relevance", "downloads", "follows", "updated", "newest"].contains(&s.sort.as_str()),
        "Sıralama geçersiz."
    );
    let kind = s.project_type.as_deref().unwrap_or("mod");
    ensure!(
        ["mod", "resourcepack", "shader", "datapack", "modpack"].contains(&kind),
        "İçerik türü geçersiz."
    );
    let mut facets = vec![vec![format!("project_type:{kind}")]];
    ensure!(s.categories.len() <= 12, "Çok fazla kategori filtresi.");
    if !s.categories.is_empty() {
        let mut group = Vec::new();
        for c in &s.categories {
            id(c)?;
            group.push(format!("categories:{c}"));
        }
        facets.push(group);
    }
    for (key, val) in [
        ("categories", s.category),
        ("categories", s.loader),
        ("versions", s.game_version),
    ] {
        if let Some(v) = val {
            ensure!(
                v.len() <= 100
                    && !v.is_empty()
                    && v.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"._-+".contains(&b)),
                "Arama filtresi geçersiz."
            );
            facets.push(vec![format!("{key}:{v}")]);
        }
    }
    if let Some(env) = s.environment {
        let values = match env.as_str() {
            "client" => vec![
                "client_and_server",
                "client_only",
                "client_only_server_optional",
                "singleplayer_only",
                "client_or_server",
                "client_or_server_prefers_both",
            ],
            "server" => vec![
                "client_and_server",
                "server_only",
                "server_only_client_optional",
                "dedicated_server_only",
                "client_or_server",
                "client_or_server_prefers_both",
            ],
            _ => bail!("Ortam client veya server olmalı."),
        };
        facets.push(values.iter().map(|v| format!("environment:{v}")).collect());
    }
    get(
        "search",
        &[
            ("query", s.query),
            ("index", s.sort),
            ("facets", serde_json::to_string(&facets)?),
            ("offset", s.offset.to_string()),
            ("limit", s.limit.to_string()),
        ],
    )
}
pub fn detail(project: &str) -> Result<Value> {
    id(project)?;
    Ok(
        json!({"project":get(&format!("project/{project}"),&[])?,"creators":get(&format!("project/{project}/members"),&[])?,"versions":get(&format!("project/{project}/version"),&[])?}),
    )
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Dependency {
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    pub file_name: Option<String>,
    pub dependency_type: String,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Version {
    pub id: String,
    pub project_id: String,
    pub version_number: String,
    pub version_type: String,
    pub date_published: String,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub files: Vec<crate::performance::File>,
    pub dependencies: Vec<Dependency>,
    #[serde(default)]
    pub changelog: String,
}
pub trait Source {
    fn versions(&mut self, project: &str) -> Result<Vec<Version>>;
    fn version(&mut self, id: &str) -> Result<Version>;
}
pub struct Api;
impl Source for Api {
    fn versions(&mut self, project: &str) -> Result<Vec<Version>> {
        id(project)?;
        ensure!(
            get(&format!("project/{project}"), &[])?["project_type"] == "mod",
            "Yalnızca mod projeleri kurulabilir."
        );
        Ok(serde_json::from_value(get(
            &format!("project/{project}/version"),
            &[],
        )?)?)
    }
    fn version(&mut self, v: &str) -> Result<Version> {
        id(v)?;
        let version: Version = serde_json::from_value(get(&format!("version/{v}"), &[])?)?;
        id(&version.project_id)?;
        ensure!(
            get(&format!("project/{}", version.project_id), &[])?["project_type"] == "mod",
            "Bağımlılık bir mod projesi değil."
        );
        Ok(version)
    }
}
/// Profil yükleyicisinin Modrinth'te kabul ettiği yükleyici adları (Quilt, Fabric modlarını da yükler).
pub fn loader_keys(loader: crate::model::Loader) -> &'static [&'static str] {
    use crate::model::Loader;
    match loader {
        Loader::Fabric => &["fabric"],
        Loader::Quilt => &["quilt", "fabric"],
        Loader::NeoForge => &["neoforge"],
        Loader::Forge => &["forge"],
        _ => &[],
    }
}
pub fn compatible(v: &Version, mc: &str, keys: &[&str]) -> bool {
    v.game_versions.iter().any(|x| x == mc) && v.loaders.iter().any(|x| keys.contains(&x.as_str()))
}
pub fn ranked(mut versions: Vec<Version>, mc: &str, keys: &[&str]) -> Vec<Version> {
    versions.retain(|v| compatible(v, mc, keys));
    versions.sort_by(|a, b| {
        rank(&a.version_type)
            .cmp(&rank(&b.version_type))
            .then(b.date_published.cmp(&a.date_published))
    });
    versions
}
fn rank(s: &str) -> u8 {
    match s {
        "release" => 0,
        "beta" => 1,
        "alpha" => 2,
        _ => 3,
    }
}
