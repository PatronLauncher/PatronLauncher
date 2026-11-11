//! Wizard-only creation transaction. Existing profiles and worlds are never removed.
use crate::{
    model::{Profile, ProfileKind, State},
    profiles,
};
use anyhow::{Context, Result, ensure};
use std::{fs, path::Path};

pub fn persist(root: &Path, current: &State, profile: Profile) -> Result<State> {
    ensure!(
        profile.kind == ProfileKind::Custom,
        "Sihirbaz Custom profil oluşturmalıdır."
    );
    ensure!(
        !current.profiles.iter().any(|p| p.id == profile.id),
        "Profil zaten var."
    );
    let parent = root.join("instances");
    fs::create_dir_all(&parent).context("Profil klasörü hazırlanamadı")?;
    let dir = profiles::dir(root, &profile);
    // Claim this fresh UUID before any writes. Never clean up an existing directory.
    fs::create_dir(&dir).context("Yeni profil klasörü oluşturulamadı")?;
    let result: Result<State> = (|| {
        profiles::save_metadata(root, &profile)?;
        let mut next = current.clone();
        next.selected_profile = Some(profile.id);
        next.profiles.push(profile);
        let primary = root.join("settings.json");
        if let Ok(old) = fs::read(&primary)
            && serde_json::from_slice::<State>(&old).is_err()
        {
            profiles::atomic_write(
                &root.join(format!("settings.corrupt-{}.json", uuid::Uuid::new_v4())),
                &old,
            )?;
        }
        // Keep a valid pre-transaction backup. A failed primary write must never
        // make recovery publish a profile whose directory has been cleaned up.
        profiles::atomic_write(
            &root.join("settings.json.bak"),
            &serde_json::to_vec_pretty(current)?,
        )?;
        profiles::atomic_write(&primary, &serde_json::to_vec_pretty(&next)?)?;
        Ok(next)
    })();
    match result {
        Ok(next) => Ok(next),
        Err(error) => {
            // `dir` is the newly claimed UUID directory directly under instances.
            // remove_dir_all does not follow directory symlinks.
            let expected_parent = parent.canonicalize()?;
            ensure!(
                dir.parent().and_then(|p| p.canonicalize().ok()).as_ref() == Some(&expected_parent),
                "Profil temizleme yolu geçersiz."
            );
            fs::remove_dir_all(&dir).with_context(|| {
                format!(
                    "Profil oluşturulamadı ({error:#}); yeni klasör temizlenemedi: {}",
                    dir.display()
                )
            })?;
            Err(error.context("Profil oluşturulamadı; yeni profil dosyaları temizlendi"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile_appearance::Appearance;
    fn profile() -> Profile {
        Profile {
            id: uuid::Uuid::new_v4(),
            name: "Yeni".into(),
            version: "1.21.11".into(),
            kind: ProfileKind::Custom,
            loader: Default::default(),
            loader_version: None,
            appearance: Appearance::default().with_defaults(),
        }
    }
    #[test]
    fn four_optional_artwork_combinations_validate_create_and_roundtrip() {
        use base64::{Engine, engine::general_purpose::STANDARD};
        let root =
            std::env::temp_dir().join(format!("patron-four-artworks-{}", uuid::Uuid::new_v4()));
        let mut png = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(128, 128)
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        let data = format!(
            "data:image/png;base64,{}",
            STANDARD.encode(png.into_inner())
        );
        let mut state = State::default();
        for (icon, background) in [(false, false), (true, false), (false, true), (true, true)] {
            let mut p = profile();
            p.appearance = Appearance {
                description: "Optional artwork".into(),
                icon: icon.then(|| data.clone()),
                background: background.then(|| data.clone()),
            };
            p.appearance.validate().unwrap();
            p.appearance = p.appearance.with_defaults();
            p.appearance.validate().unwrap();
            state = persist(&root, &state, p.clone()).unwrap();
            let disk = State::load(&root).unwrap();
            let saved = disk.profiles.last().unwrap();
            assert_eq!(
                saved.appearance.icon.as_deref(),
                Some(if icon {
                    &data
                } else {
                    crate::profile_appearance::DEFAULT_ICON
                })
            );
            assert_eq!(
                saved.appearance.background.as_deref(),
                Some(if background {
                    &data
                } else {
                    crate::profile_appearance::DEFAULT_BACKGROUND
                })
            );
            let metadata: Profile = serde_json::from_slice(
                &fs::read(profiles::dir(&root, &p).join(crate::migration::PROFILE_META)).unwrap(),
            )
            .unwrap();
            assert_eq!(metadata.appearance.icon, saved.appearance.icon);
            assert_eq!(metadata.appearance.background, saved.appearance.background);
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn failed_primary_write_removes_only_new_directory_and_keeps_recovery_valid() {
        let root =
            std::env::temp_dir().join(format!("patron-transaction-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("settings.json")).unwrap(); // Force the final rename to fail.
        let existing = root.join("instances/existing/saves");
        fs::create_dir_all(&existing).unwrap();
        fs::write(existing.join("world"), b"keep").unwrap();
        let p = profile();
        let dir = profiles::dir(&root, &p);
        let error = persist(&root, &State::default(), p).unwrap_err();
        assert!(error.to_string().contains("temizlendi"));
        assert!(!dir.exists());
        assert_eq!(fs::read(existing.join("world")).unwrap(), b"keep");
        assert!(State::load(&root).unwrap().profiles.is_empty());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn failed_backup_write_cleans_up_and_existing_directory_is_never_deleted() {
        let root =
            std::env::temp_dir().join(format!("patron-transaction-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("settings.json.bak")).unwrap();
        let p = profile();
        let dir = profiles::dir(&root, &p);
        assert!(persist(&root, &State::default(), p.clone()).is_err());
        assert!(!dir.exists());
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("keep"), b"keep").unwrap();
        assert!(persist(&root, &State::default(), p).is_err());
        assert!(dir.join("keep").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
