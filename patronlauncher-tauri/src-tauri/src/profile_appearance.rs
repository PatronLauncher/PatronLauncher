//! Optional, portable profile presentation metadata. Never accepts filesystem paths.
use anyhow::{Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};

pub const DEFAULT_ICON: &str = "builtin:profile-icon";
pub const DEFAULT_BACKGROUND: &str = "builtin:profile-background";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Appearance {
    pub description: String,
    pub icon: Option<String>,
    pub background: Option<String>,
}
impl Appearance {
    pub fn with_defaults(mut self) -> Self {
        self.icon.get_or_insert_with(|| DEFAULT_ICON.into());
        self.background
            .get_or_insert_with(|| DEFAULT_BACKGROUND.into());
        self
    }
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.description.chars().count() <= 300,
            "Açıklama en fazla 300 karakter olabilir."
        );
        ensure!(
            !self
                .description
                .chars()
                .any(|c| c.is_control() && c != '\n'),
            "Açıklama geçersiz."
        );
        for (src, icon) in [(&self.icon, true), (&self.background, false)] {
            if let Some(src) = src {
                if src
                    == if icon {
                        DEFAULT_ICON
                    } else {
                        DEFAULT_BACKGROUND
                    }
                {
                    continue;
                }
                ensure!(src.len() <= 7_000_000, "Görsel en fazla 5 MB olabilir.");
                let raw = src
                    .strip_prefix("data:image/png;base64,")
                    .ok_or_else(|| anyhow::anyhow!("Görsel PNG olarak hazırlanmalı."))?;
                let bytes = STANDARD.decode(raw)?;
                ensure!(
                    bytes.len() <= 5 * 1024 * 1024,
                    "Görsel en fazla 5 MB olabilir."
                );
                let mut reader = image::ImageReader::with_format(
                    std::io::Cursor::new(&bytes),
                    image::ImageFormat::Png,
                );
                let mut limits = image::Limits::default();
                limits.max_image_width = Some(1920);
                limits.max_image_height = Some(1080);
                limits.max_alloc = Some(32 * 1024 * 1024);
                reader.limits(limits);
                let decoded = reader.decode()?;
                ensure!(
                    !icon || (decoded.width() == 128 && decoded.height() == 128),
                    "Simge 128×128 olmalı."
                );
            }
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_profiles_and_appearance_roundtrip() {
        let raw = serde_json::json!({"id":uuid::Uuid::new_v4(),"name":"Eski","version":"1.21"});
        let mut profile: crate::model::Profile = serde_json::from_value(raw).unwrap();
        assert_eq!(profile.kind, crate::model::ProfileKind::Custom);
        assert!(profile.appearance.icon.is_none());
        profile.appearance.description = "Kişisel dünya".into();
        let copy: crate::model::Profile =
            serde_json::from_slice(&serde_json::to_vec(&profile).unwrap()).unwrap();
        assert_eq!(copy.appearance.description, "Kişisel dünya");
    }
    #[test]
    fn rejects_paths_oversized_text_and_invalid_images() {
        assert!(
            Appearance {
                description: "a".repeat(301),
                ..Default::default()
            }
            .validate()
            .is_err()
        );
        for src in [
            "file:///secret.png",
            "https://example.com/a.png",
            "data:image/png;base64,YmFk",
        ] {
            assert!(
                Appearance {
                    icon: Some(src.into()),
                    ..Default::default()
                }
                .validate()
                .is_err()
            );
        }
    }
}
