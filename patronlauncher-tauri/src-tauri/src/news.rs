use anyhow::{Context, Result, bail};
use base64::Engine as _;
use serde::Deserialize;
use std::{io::Read, time::Duration};

#[derive(Debug, Clone, serde::Serialize)]
pub struct Article {
    pub title: String,
    pub date: String,
    pub url: String,
    pub image: Option<String>,
}

#[derive(Deserialize)]
struct Feed {
    entries: Vec<Entry>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    title: String,
    date: String,
    read_more_link: Option<String>,
    play_page_image: Option<Picture>,
    category: Option<String>,
    news_type: Option<Vec<String>>,
}
#[derive(Deserialize)]
struct Picture {
    url: String,
}

fn read_limited(response: reqwest::blocking::Response, limit: u64) -> Result<Vec<u8>> {
    let mut data = Vec::new();
    response
        .error_for_status()?
        .take(limit + 1)
        .read_to_end(&mut data)?;
    if data.len() as u64 > limit {
        bail!("Haber içeriği çok büyük");
    }
    Ok(data)
}

fn valid_article_url(url: &str) -> bool {
    reqwest::Url::parse(url).is_ok_and(|u| {
        u.scheme() == "https"
            && matches!(u.host_str(), Some("minecraft.net" | "www.minecraft.net"))
            && u.username().is_empty()
            && u.password().is_none()
            && u.port().is_none()
    })
}

pub fn fetch() -> Result<Vec<Article>> {
    let client = reqwest::blocking::Client::builder()
        .user_agent(concat!("PatronLauncher/", env!("CARGO_PKG_VERSION")))
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(12))
        .build()?;
    let bytes = read_limited(
        client
            .get("https://launchercontent.mojang.com/v2/news.json")
            .send()?,
        2_000_000,
    )?;
    let feed: Feed = serde_json::from_slice(&bytes).context("Haber listesi okunamadı")?;
    let mut articles = Vec::new();
    for entry in feed.entries {
        if !entry
            .news_type
            .as_ref()
            .is_some_and(|types| types.iter().any(|t| t == "Java"))
            && !entry
                .category
                .as_deref()
                .is_some_and(|c| c.contains("Java"))
        {
            continue;
        }
        let Some(url) = entry.read_more_link.filter(|u| valid_article_url(u)) else {
            continue;
        };
        let picture = entry.play_page_image.and_then(|p| {
            if !p.url.starts_with("/v2/images/")
                || p.url.contains("..")
                || p.url.contains('\\')
                || p.url.contains('?')
                || p.url.contains('#')
            {
                return None;
            }
            let url = format!("https://launchercontent.mojang.com{}", p.url);
            let bytes = read_limited(client.get(url).send().ok()?, 2_000_000).ok()?;
            // Decode and shrink on this worker, before handing pixels to the UI.
            let pixels = ::image::load_from_memory(&bytes)
                .ok()?
                .resize_to_fill(640, 360, ::image::imageops::FilterType::Lanczos3)
                .to_rgba8();
            let mut png = std::io::Cursor::new(Vec::new());
            image::DynamicImage::ImageRgba8(pixels)
                .write_to(&mut png, image::ImageFormat::Png)
                .ok()?;
            Some(format!(
                "data:image/png;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(png.into_inner())
            ))
        });
        articles.push(Article {
            title: entry.title.chars().take(100).collect(),
            date: entry.date.chars().take(10).collect(),
            url,
            image: picture,
        });
        if articles.len() == 4 {
            break;
        }
    }
    if articles.is_empty() {
        bail!("Gösterilecek Java Edition haberi bulunamadı");
    }
    Ok(articles)
}

#[cfg(test)]
mod tests {
    #[test]
    #[ignore = "Resmi haber servisine ağ erişimi gerektirir"]
    fn official_feed_loads_java_articles() {
        let articles = super::fetch().unwrap();
        assert!(!articles.is_empty());
        assert!(
            articles
                .iter()
                .all(|article| super::valid_article_url(&article.url))
        );
        assert!(articles.iter().any(|article| article.image.is_some()));
    }
    #[test]
    fn news_links_are_limited_to_official_https_hosts() {
        assert!(super::valid_article_url(
            "https://www.minecraft.net/article/example"
        ));
        assert!(!super::valid_article_url(
            "https://minecraft.net.attacker.invalid/article"
        ));
        assert!(!super::valid_article_url("http://minecraft.net/article"));
        assert!(!super::valid_article_url(
            "https://evil@minecraft.net/article"
        ));
    }
}
