use crate::{game, model, runtime};
use anyhow::{Context, Result, bail};
use std::sync::{Arc, atomic::AtomicBool};
#[derive(Debug, PartialEq)]
enum Mode {
    InstallJava(u32),
    SmokeLaunch(String),
    SmokeLaunchFabric(String, Option<String>),
    /// Launcher'ın PClient profiliyle aynı kurulumu (Fabric + gömülü PClient jar) başlatır.
    SmokePClient,
    /// Başka yükleyiciyle başlatır veya yalnızca kurar (ağ ve Java gerektirir).
    SmokeLoader {
        mc: String,
        loader: model::Loader,
        version: Option<String>,
        install_only: bool,
    },
}
fn loader_arg(name: &str) -> Result<model::Loader> {
    Ok(match name {
        "fabric" => model::Loader::Fabric,
        "quilt" => model::Loader::Quilt,
        "neoforge" => model::Loader::NeoForge,
        "forge" => model::Loader::Forge,
        "optifine" => model::Loader::OptiFine,
        _ => bail!("Yükleyici fabric, quilt, neoforge, forge veya optifine olmalı."),
    })
}
fn parse(args: &[String]) -> Result<Option<Mode>> {
    if args.is_empty() {
        return Ok(None);
    }
    match args[0].as_str() {
        "--install-java" => {
            if args.len() != 2 {
                bail!("Java sürümünü belirtin.");
            }
            let major: u32 = args[1].parse().context("Java sürümü geçersiz")?;
            if !(8..=99).contains(&major) {
                bail!("Java sürümü geçersiz.");
            }
            Ok(Some(Mode::InstallJava(major)))
        }
        "--smoke-install" | "--smoke-loader" => {
            if !(3..=4).contains(&args.len()) {
                bail!("Kullanım: {} <Minecraft> <yükleyici> [sürüm]", args[0]);
            }
            crate::fabric::identifier(&args[1])?;
            let version = args.get(3).cloned();
            if let Some(v) = &version {
                crate::fabric::identifier(v)?;
            }
            Ok(Some(Mode::SmokeLoader {
                mc: args[1].clone(),
                loader: loader_arg(&args[2])?,
                version,
                install_only: args[0] == "--smoke-install",
            }))
        }
        "--smoke-pclient" if args.len() == 1 => Ok(Some(Mode::SmokePClient)),
        "--smoke-launch" => {
            if args.len() < 2 {
                bail!("Minecraft sürümünü belirtin.");
            }
            let id = &args[1];
            if id.len() > 64
                || !id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
            {
                bail!("Sürüm kimliği geçersiz.");
            }
            crate::net::safe_join(std::path::Path::new("."), id)?;
            match args.len() {
                2 => Ok(Some(Mode::SmokeLaunch(id.clone()))),
                3 | 4 if args[2] == "--fabric" => {
                    let loader = args.get(3).cloned();
                    if let Some(value) = &loader {
                        crate::fabric::identifier(value)?;
                    }
                    Ok(Some(Mode::SmokeLaunchFabric(id.clone(), loader)))
                }
                _ => bail!("Kullanım: --smoke-launch <Minecraft> [--fabric [loader-sürümü]]"),
            }
        }
        _ => bail!("Bilinmeyen komut satırı seçeneği."),
    }
}
pub fn run(args: &[String]) -> Result<bool> {
    let Some(mode) = parse(args)? else {
        return Ok(false);
    };
    let root = model::data_root();
    crate::migration::ensure_for_root(&root)?;
    let _lock = crate::core::lock::acquire(&root)?;
    let fabric = matches!(&mode, Mode::SmokeLaunchFabric(..) | Mode::SmokePClient);
    let requested_loader = match &mode {
        Mode::SmokeLaunchFabric(_, v) => v.clone(),
        _ => None,
    };
    if let Mode::SmokeLoader { mc, loader, version, install_only } = &mode {
        let target = game::versions(&root)?
            .into_iter()
            .find(|v| v.id == *mc)
            .context("Sürüm bulunamadı")?;
        let account = model::local_account("PatronTest")?;
        let profile = model::Profile {
            appearance: Default::default(),
            kind: crate::model::ProfileKind::Quick,
            id: uuid::Uuid::new_v4(),
            name: "Yükleyici testi".into(),
            version: target.id.clone(),
            loader: *loader,
            loader_version: crate::loaders::resolve(*loader, mc, version.as_deref())?,
        };
        println!("{} {}", crate::loaders::name(*loader), profile.loader_version.clone().unwrap_or_default());
        let state = model::State {
            selected_account: Some(account.id),
            selected_profile: Some(profile.id),
            accounts: vec![account],
            profiles: vec![profile],
            ..Default::default()
        };
        let notify: game::Notify = Arc::new(|s| println!("{s}"));
        let cancel = Arc::new(AtomicBool::new(false));
        if *install_only {
            game::install(&root, &state, &target, cancel, notify)?;
        } else {
            game::launch(&root, &state, &target, cancel, notify)?;
        }
        return Ok(true);
    }
    match mode {
        Mode::SmokeLoader { .. } => unreachable!(),
        Mode::InstallJava(major) => {
            let path =
                runtime::install(&root, major, &AtomicBool::new(false), |s| println!("{s}"))?;
            println!("Java hazır: {}", path.display());
        }
        Mode::SmokeLaunch(_) | Mode::SmokeLaunchFabric(..) | Mode::SmokePClient => {
            let pclient = matches!(&mode, Mode::SmokePClient);
            let version_id = match &mode {
                Mode::SmokeLaunch(v) | Mode::SmokeLaunchFabric(v, _) => v.clone(),
                _ => crate::pclient::MINECRAFT.to_string(),
            };
            let version = game::versions(&root)?
                .into_iter()
                .find(|v| v.id == version_id)
                .context("Sürüm bulunamadı")?;
            let account = model::local_account("PatronTest")?;
            let mut profile = model::Profile {
                appearance: Default::default(),
                kind: crate::model::ProfileKind::Quick,
                id: uuid::Uuid::new_v4(),
                name: "Başlatma testi".into(),
                version: version.id.clone(),
                loader: if fabric {
                    model::Loader::Fabric
                } else {
                    model::Loader::Vanilla
                },
                loader_version: if fabric {
                    Some(crate::fabric::resolve(
                        &version.id,
                        requested_loader.as_deref(),
                    )?)
                } else {
                    None
                },
            };
            if pclient {
                // Launcher'daki PClient başlatmasıyla aynı gizli profil ve klasör.
                profile = crate::pclient::prepare(&root)?;
            }
            let state = model::State {
                selected_account: Some(account.id),
                selected_profile: Some(profile.id),
                accounts: vec![account],
                profiles: vec![profile],
                ..Default::default()
            };
            game::launch(
                &root,
                &state,
                &version,
                Arc::new(AtomicBool::new(false)),
                Arc::new(|s| println!("{s}")),
            )?;
        }
    }
    Ok(true)
}
#[cfg(test)]
mod tests {
    #[test]
    fn cli_flags_parse_without_initializing_a_webview() {
        use super::*;
        assert_eq!(parse(&[]).unwrap(), None);
        assert_eq!(parse(&["--smoke-pclient".into()]).unwrap(), Some(Mode::SmokePClient));
        assert!(parse(&["--smoke-pclient".into(), "x".into()]).is_err());
        assert_eq!(
            parse(&["--install-java".into(), "21".into()]).unwrap(),
            Some(Mode::InstallJava(21))
        );
        assert_eq!(
            parse(&["--smoke-launch".into(), "1.21.11".into()]).unwrap(),
            Some(Mode::SmokeLaunch("1.21.11".into()))
        );
        assert!(parse(&["--install-java".into()]).is_err());
        assert!(parse(&["--smoke-launch".into(), "../evil".into()]).is_err());
        assert_eq!(
            parse(&["--smoke-launch".into(), "1.21.11".into(), "--fabric".into()]).unwrap(),
            Some(Mode::SmokeLaunchFabric("1.21.11".into(), None))
        );
        assert_eq!(
            parse(&[
                "--smoke-launch".into(),
                "1.21.11".into(),
                "--fabric".into(),
                "0.18.4".into()
            ])
            .unwrap(),
            Some(Mode::SmokeLaunchFabric(
                "1.21.11".into(),
                Some("0.18.4".into())
            ))
        );
        assert!(
            parse(&[
                "--smoke-launch".into(),
                "1.21.11".into(),
                "--fabric".into(),
                "../evil".into()
            ])
            .is_err()
        );
        assert!(parse(&["--smoke-launch".into(), "1.21.11".into(), "--forge".into()]).is_err());
    }
}
