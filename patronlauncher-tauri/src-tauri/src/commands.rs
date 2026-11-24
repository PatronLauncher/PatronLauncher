use crate::core::{
    CoreService,
    types::{Action, Reply},
};
#[tauri::command]
pub async fn profile_action(
    state: tauri::State<'_, CoreService>,
    id: uuid::Uuid,
    operation: crate::core::types::ProfileOperation,
) -> Result<Reply, String> {
    state.call(Action::WithProfile { id, operation }).await
}
#[tauri::command]
pub async fn get_state(state: tauri::State<'_, CoreService>) -> Result<Reply, String> {
    state.call(Action::Read).await
}
#[tauri::command]
pub async fn list_versions(
    state: tauri::State<'_, CoreService>,
    refresh: bool,
) -> Result<Reply, String> {
    state.call(Action::Versions { refresh }).await
}
#[tauri::command]
pub async fn list_profiles(
    state: tauri::State<'_, CoreService>,
    kind: Option<crate::model::ProfileKind>,
) -> Result<Reply, String> {
    let mut reply = state.call(Action::Inventory).await?;
    reply
        .state
        .profiles
        .retain(|p| p.kind == kind.unwrap_or_default());
    Ok(reply)
}
#[tauri::command]
pub async fn install_version(
    state: tauri::State<'_, CoreService>,
    plans: tauri::State<'_, crate::performance::PlanStore>,
    mc: String,
    loader: crate::model::Loader,
    loader_version: Option<String>,
    plan_id: Option<uuid::Uuid>,
    confirmed: Option<bool>,
) -> Result<Reply, String> {
    let plan = if let Some(id) = plan_id {
        if loader != crate::model::Loader::Fabric {
            return Err("Performans paketi Fabric gerektirir.".into());
        }
        Some(
            plans
                .approve(id, &mc, confirmed.unwrap_or(false))
                .map_err(|e| e.to_string())?,
        )
    } else {
        None
    };
    let snapshot = state.call(Action::Inventory).await?.state;
    if snapshot.busy || snapshot.load_failed {
        return Err(snapshot.status);
    }
    if !snapshot.versions.iter().any(|v| v.id == mc) {
        return Err("Desteklenen bir sürüm seçin.".into());
    }
    let combination = tauri::async_runtime::spawn_blocking(
        move || -> Result<crate::store::Combination, String> {
            let loader_version = crate::loaders::resolve(loader, &mc, loader_version.as_deref())
                .map_err(|e| format!("{e:#}"))?;
            Ok(crate::store::Combination {
                mc,
                loader,
                loader_version,
            })
        },
    )
    .await
    .map_err(|e| e.to_string())??;
    state
        .call(Action::InstallVersion { combination, plan })
        .await
}
#[tauri::command]
pub async fn select_quick(
    state: tauri::State<'_, CoreService>,
    id: uuid::Uuid,
) -> Result<Reply, String> {
    state.call(Action::SelectQuick { id }).await
}
#[tauri::command]
pub async fn list_installed_versions(
    state: tauri::State<'_, CoreService>,
) -> Result<Vec<crate::store::InstalledVersion>, String> {
    let s = state.call(Action::Inventory).await?.state;
    if s.load_failed {
        return Err(s.status);
    }
    tauri::async_runtime::spawn_blocking(move || {
        crate::store::list(&crate::model::data_root(), &s.profiles, &s.versions)
    })
    .await
    .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn is_installed(
    state: tauri::State<'_, CoreService>,
    mc: String,
    loader: crate::model::Loader,
    loader_version: Option<String>,
) -> Result<bool, String> {
    crate::fabric::identifier(&mc).map_err(|e| e.to_string())?;
    if let Some(v) = &loader_version {
        crate::fabric::identifier(v).map_err(|e| e.to_string())?;
    }
    Ok(list_installed_versions(state).await?.iter().any(|v| {
        v.combination.mc == mc
            && v.combination.loader == loader
            && (loader_version.is_none() || v.combination.loader_version == loader_version)
    }))
}
#[tauri::command]
pub async fn remove_version(
    state: tauri::State<'_, CoreService>,
    mc: String,
    loader: crate::model::Loader,
    loader_version: Option<String>,
    confirmed: bool,
) -> Result<Reply, String> {
    state
        .call(Action::RemoveVersion {
            combination: crate::store::Combination {
                mc,
                loader,
                loader_version,
            },
            confirmed,
        })
        .await
}
#[tauri::command]
pub async fn launch_quick(
    state: tauri::State<'_, CoreService>,
    id: uuid::Uuid,
) -> Result<Reply, String> {
    state.call(Action::LaunchQuick { id }).await
}
#[tauri::command]
pub async fn rename_profile(
    state: tauri::State<'_, CoreService>,
    id: uuid::Uuid,
    name: String,
) -> Result<Reply, String> {
    state.call(Action::RenameProfile { id, name }).await
}
#[tauri::command]
pub async fn copy_profile(
    state: tauri::State<'_, CoreService>,
    id: uuid::Uuid,
    name: String,
) -> Result<Reply, String> {
    state.call(Action::CopyProfile { id, name }).await
}
#[tauri::command]
pub async fn install_profile(
    state: tauri::State<'_, CoreService>,
    id: uuid::Uuid,
) -> Result<Reply, String> {
    state.call(Action::InstallProfile { id }).await
}
#[tauri::command]
pub async fn profile_statuses(
    state: tauri::State<'_, CoreService>,
) -> Result<std::collections::HashMap<uuid::Uuid, crate::profile_management::InstallStatus>, String>
{
    let snapshot = state.call(Action::Read).await?.state;
    if snapshot.load_failed {
        return Err(snapshot.status);
    }
    tauri::async_runtime::spawn_blocking(move || {
        snapshot
            .profiles
            .iter()
            .map(|p| {
                (
                    p.id,
                    crate::profile_management::status(
                        &crate::model::data_root(),
                        p,
                        &snapshot.versions,
                    ),
                )
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn create_profile(
    state: tauri::State<'_, CoreService>,
    name: String,
    version_id: String,
) -> Result<Reply, String> {
    state.call(Action::CreateProfile { name, version_id }).await
}
#[tauri::command]
pub async fn create_wizard_profile(
    state: tauri::State<'_, CoreService>,
    name: String,
    version_id: String,
    loader: crate::model::Loader,
    loader_version: Option<String>,
    appearance: crate::profile_appearance::Appearance,
) -> Result<Reply, String> {
    let snapshot = state.call(Action::Read).await?.state;
    if snapshot.load_failed || snapshot.busy || snapshot.running {
        return Err("Başka bir işlem çalışıyor veya kayıtlar okunamadı.".into());
    }
    crate::core::security::text(&name, 32).map_err(|e| e.to_string())?;
    if !snapshot.versions.iter().any(|v| v.id == version_id) {
        return Err("Desteklenen bir Minecraft sürümü seçin.".into());
    }
    let loader_version = {
        let mc = version_id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            crate::loaders::resolve(loader, &mc, loader_version.as_deref())
                .map_err(|e| format!("{e:#}"))
        })
        .await
        .map_err(|e| e.to_string())??
    };
    let appearance = tauri::async_runtime::spawn_blocking(move || {
        appearance.validate().map_err(|e| e.to_string())?;
        Ok::<_, String>(appearance)
    })
    .await
    .map_err(|e| e.to_string())??;
    state
        .call(Action::CreateWizardProfile {
            name,
            version_id,
            loader,
            loader_version,
            appearance,
        })
        .await
}
#[tauri::command]
pub async fn remove_profile(
    state: tauri::State<'_, CoreService>,
    id: uuid::Uuid,
) -> Result<Reply, String> {
    state.call(Action::RemoveProfile { id }).await
}
#[tauri::command]
pub async fn select_profile(
    state: tauri::State<'_, CoreService>,
    id: uuid::Uuid,
) -> Result<Reply, String> {
    state.call(Action::SelectProfile { id }).await
}
#[tauri::command]
pub async fn select_version(
    state: tauri::State<'_, CoreService>,
    version_id: String,
) -> Result<Reply, String> {
    state.call(Action::SelectVersion { version_id }).await
}
#[tauri::command]
pub async fn list_accounts(state: tauri::State<'_, CoreService>) -> Result<Reply, String> {
    state.call(Action::Read).await
}
#[tauri::command]
pub async fn add_local_account(
    state: tauri::State<'_, CoreService>,
    name: String,
) -> Result<Reply, String> {
    state.call(Action::AddLocal { name }).await
}
#[tauri::command]
pub async fn microsoft_login(state: tauri::State<'_, CoreService>) -> Result<Reply, String> {
    state.call(Action::MicrosoftLogin).await
}
#[tauri::command]
pub async fn remove_account(
    state: tauri::State<'_, CoreService>,
    id: uuid::Uuid,
) -> Result<Reply, String> {
    state.call(Action::RemoveAccount { id }).await
}
#[tauri::command]
pub async fn select_account(
    state: tauri::State<'_, CoreService>,
    id: uuid::Uuid,
) -> Result<Reply, String> {
    state.call(Action::SelectAccount { id }).await
}
#[tauri::command]
pub async fn read_settings(state: tauri::State<'_, CoreService>) -> Result<Reply, String> {
    state.call(Action::Read).await
}
#[tauri::command]
pub async fn save_settings(
    state: tauri::State<'_, CoreService>,
    settings: crate::core::types::Settings,
) -> Result<Reply, String> {
    state.call(Action::SaveSettings(settings)).await
}
#[tauri::command]
pub async fn get_news(
    state: tauri::State<'_, CoreService>,
    refresh: bool,
) -> Result<Reply, String> {
    state.call(Action::News { refresh }).await
}
#[tauri::command]
pub async fn check_java(state: tauri::State<'_, CoreService>) -> Result<Reply, String> {
    state.call(Action::CheckJava).await
}
#[tauri::command]
pub async fn install_java(state: tauri::State<'_, CoreService>) -> Result<Reply, String> {
    state.call(Action::InstallJava).await
}
#[tauri::command]
pub async fn launch_game(state: tauri::State<'_, CoreService>) -> Result<Reply, String> {
    state.call(Action::Launch).await
}
#[tauri::command]
pub async fn cancel_operation(state: tauri::State<'_, CoreService>) -> Result<Reply, String> {
    state.call(Action::Cancel).await
}
#[tauri::command]
pub async fn backup_profile(state: tauri::State<'_, CoreService>) -> Result<Reply, String> {
    state.call(Action::Backup).await
}
#[tauri::command]
pub async fn restore_profile(
    state: tauri::State<'_, CoreService>,
    confirmed: bool,
) -> Result<Reply, String> {
    state.call(Action::Restore { confirmed }).await
}
#[tauri::command]
pub async fn recover_profiles(state: tauri::State<'_, CoreService>) -> Result<Reply, String> {
    state.call(Action::RecoverProfiles).await
}
#[tauri::command]
pub async fn open_folder(
    state: tauri::State<'_, CoreService>,
    target: crate::core::types::FolderTarget,
) -> Result<Reply, String> {
    state.call(Action::OpenFolder { target }).await
}
#[tauri::command]
pub async fn open_external(
    state: tauri::State<'_, CoreService>,
    url: String,
) -> Result<Reply, String> {
    state.call(Action::OpenExternal { url }).await
}

#[tauri::command]
pub async fn list_version_catalog(
    app: tauri::AppHandle,
    state: tauri::State<'_, CoreService>,
) -> Result<Vec<crate::catalog::CatalogVersion>, String> {
    let snapshot = state.call(Action::Read).await?.state;
    if snapshot.load_failed {
        return Err(snapshot.status);
    }
    // Filesystem/network work is outside the state actor and the webview thread.
    tauri::async_runtime::spawn_blocking(move || {
        let entries =
            crate::catalog::load(&crate::model::data_root()).map_err(|e| format!("{e:#}"))?;
        crate::catalog::revalidate(app);
        Ok(entries)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_loader_versions(
    state: tauri::State<'_, CoreService>,
    minecraft_version: String,
    loader: Option<crate::model::Loader>,
) -> Result<crate::fabric::LoaderVersions, String> {
    let snapshot = state.call(Action::Read).await?.state;
    if snapshot.load_failed {
        return Err(snapshot.status);
    }
    if !snapshot.versions.iter().any(|v| v.id == minecraft_version) {
        return Err("Desteklenen bir Minecraft sürümü seçin.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        crate::loaders::versions(loader.unwrap_or(crate::model::Loader::Fabric), &minecraft_version)
            .map_err(|e| format!("{e:#}"))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn set_profile_loader(
    state: tauri::State<'_, CoreService>,
    id: uuid::Uuid,
    loader: crate::model::Loader,
    loader_version: Option<String>,
) -> Result<Reply, String> {
    let snapshot = state.call(Action::Read).await?.state;
    if snapshot.load_failed {
        return Err(snapshot.status);
    }
    if snapshot.busy || snapshot.running {
        return Err("Başka bir işlem veya oyun çalışıyor.".into());
    }
    let profile = snapshot
        .profiles
        .iter()
        .find(|p| p.id == id)
        .ok_or("Profil bulunamadı.")?;
    let expected_version = profile.version.clone();
    let resolved = match loader {
        crate::model::Loader::Vanilla => {
            if loader_version.is_some() {
                return Err("Vanilla için loader sürümü verilmez.".into());
            }
            None
        }
        _ => {
            if !snapshot.versions.iter().any(|v| v.id == expected_version) {
                return Err("Desteklenen bir Minecraft sürümü seçin.".into());
            }
            let mc = expected_version.clone();
            tauri::async_runtime::spawn_blocking(move || {
                crate::loaders::resolve(loader, &mc, loader_version.as_deref())
                    .map_err(|e| format!("{e:#}"))
            })
            .await
            .map_err(|e| e.to_string())??
        }
    };
    state
        .call(Action::SetLoader {
            id,
            expected_version,
            loader,
            loader_version: resolved,
        })
        .await
}

#[tauri::command]
pub async fn preview_performance_pack(
    state: tauri::State<'_, CoreService>,
    plans: tauri::State<'_, crate::performance::PlanStore>,
    minecraft_version: String,
    mods: Option<Vec<String>>,
) -> Result<crate::performance::PlanSummary, String> {
    let snapshot = state.call(Action::Read).await?.state;
    if snapshot.load_failed {
        return Err(snapshot.status);
    }
    if !snapshot.versions.iter().any(|v| v.id == minecraft_version) {
        return Err("Desteklenen bir Minecraft sürümü seçin.".into());
    }
    let plan = tauri::async_runtime::spawn_blocking(move || {
        match mods {
            Some(mods) => crate::performance::preview_selected(&minecraft_version, &mods),
            None => crate::performance::preview(&minecraft_version),
        }
        .map_err(|e| format!("{e:#}"))
    })
    .await
    .map_err(|e| e.to_string())??;
    plans.insert(plan).map_err(|e| format!("{e:#}"))
}
#[tauri::command]
pub async fn create_configured_profile(
    state: tauri::State<'_, CoreService>,
    plans: tauri::State<'_, crate::performance::PlanStore>,
    name: String,
    version_id: String,
    loader: crate::model::Loader,
    loader_version: Option<String>,
    plan_id: Option<uuid::Uuid>,
    confirmed: bool,
) -> Result<Reply, String> {
    let snapshot = state.call(Action::Read).await?.state;
    if snapshot.load_failed {
        return Err(snapshot.status);
    }
    if snapshot.busy || snapshot.running {
        return Err("Başka bir işlem veya oyun çalışıyor.".into());
    }
    crate::core::security::text(&name, 40).map_err(|e| e.to_string())?;
    let plan = if let Some(id) = plan_id {
        if loader != crate::model::Loader::Fabric {
            return Err("Performans paketi Fabric gerektirir.".into());
        }
        Some(
            plans
                .approve(id, &version_id, confirmed)
                .map_err(|e| e.to_string())?,
        )
    } else {
        if confirmed {
            return Err("Onaylanacak mod planı verilmedi.".into());
        }
        None
    };
    let (completion, rx) = tokio::sync::oneshot::channel();
    state
        .call(Action::CreateConfiguredProfile {
            name,
            version_id,
            loader,
            loader_version,
            plan,
            completion,
        })
        .await?;
    rx.await
        .map_err(|_| "Profil oluşturma işlemi kapandı.".to_string())??;
    state.call(Action::Read).await
}
async fn mod_profile(
    state: &tauri::State<'_, CoreService>,
    id: uuid::Uuid,
) -> Result<crate::model::Profile, String> {
    let s = state.call(Action::Read).await?.state;
    if s.load_failed || s.busy || s.running {
        return Err("Önce devam eden işlemi veya oyunu kapatın.".into());
    }
    let p = s
        .profiles
        .into_iter()
        .chain(s.quick_profile)
        .find(|p| p.id == id)
        .ok_or("Profil bulunamadı.")?;
    crate::mods::supports(&p).map_err(|e| e.to_string())?;
    Ok(p)
}
#[tauri::command]
pub async fn mods_search(search: crate::modrinth::Search) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::modrinth::search(search).map_err(|e| format!("{e:#}"))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn mods_project(project: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::modrinth::detail(&project).map_err(|e| format!("{e:#}"))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn mods_versions(
    state: tauri::State<'_, CoreService>,
    id: uuid::Uuid,
    project: String,
    include_incompatible: bool,
) -> Result<serde_json::Value, String> {
    let p = mod_profile(&state, id).await?;
    tauri::async_runtime::spawn_blocking(move||{use crate::modrinth::Source;let all=crate::modrinth::Api.versions(&project)?;let compatible=crate::modrinth::ranked(all.clone(),&p.version,crate::modrinth::loader_keys(p.loader));let incompatible:Vec<_>=if include_incompatible{all.into_iter().filter(|v|!crate::modrinth::compatible(v,&p.version,crate::modrinth::loader_keys(p.loader))).collect()}else{vec![]};Ok::<_,anyhow::Error>(serde_json::json!({"recommended":compatible.first().map(|v|&v.id),"compatible":compatible,"incompatible":incompatible}))}).await.map_err(|e|e.to_string())?.map_err(|e|format!("{e:#}"))
}
#[tauri::command]
pub async fn mods_plan(
    state: tauri::State<'_, CoreService>,
    plans: tauri::State<'_, crate::mods::Plans>,
    id: uuid::Uuid,
    projects: Vec<String>,
    version_id: Option<String>,
) -> Result<crate::mods::Plan, String> {
    let p = mod_profile(&state, id).await?;
    let plan = tauri::async_runtime::spawn_blocking(move || {
        let dir = crate::mods::directory(&crate::model::data_root(), &p)?;
        crate::mods::resolve_selected(
            &mut crate::modrinth::Api,
            &p,
            &dir,
            &projects,
            version_id.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("{e:#}"))?;
    plans.put(plan).map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn mods_install(
    app: tauri::AppHandle,
    state: tauri::State<'_, CoreService>,
    plans: tauri::State<'_, crate::mods::Plans>,
    id: uuid::Uuid,
    plan_id: uuid::Uuid,
    confirmed: bool,
) -> Result<Reply, String> {
    mod_profile(&state, id).await?;
    let plan = plans
        .take(plan_id, id, confirmed)
        .map_err(|e| e.to_string())?;
    state
        .call(Action::ModJob {
            id,
            job: crate::mods::Job(Box::new(move |root, p, cancel, notify| {
                use tauri::Emitter;
                crate::mods::install(&root, &p, plan, &cancel, &*notify, &|progress| {
                    let _ = app.emit_to("main", "patronlauncher://mods-progress", progress);
                })
            })),
        })
        .await
}
#[tauri::command]
pub async fn mods_list(
    state: tauri::State<'_, CoreService>,
    id: uuid::Uuid,
) -> Result<crate::mods::Listing, String> {
    let p = mod_profile(&state, id).await?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::mods::list(&crate::mods::directory(&crate::model::data_root(), &p)?)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("{e:#}"))
}
#[tauri::command]
pub async fn mods_removal_plan(
    state: tauri::State<'_, CoreService>,
    id: uuid::Uuid,
    project: String,
) -> Result<Vec<crate::mods::Entry>, String> {
    let p = mod_profile(&state, id).await?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::mods::removal(
            &crate::mods::directory(&crate::model::data_root(), &p)?,
            &project,
        )
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("{e:#}"))
}
#[tauri::command]
pub async fn mods_remove(
    state: tauri::State<'_, CoreService>,
    id: uuid::Uuid,
    project: String,
    remove_dependencies: bool,
    confirmed: bool,
) -> Result<Reply, String> {
    if !confirmed {
        return Err("Mod kaldırmak için açık onay gerekli.".into());
    }
    state
        .call(Action::ModJob {
            id,
            job: crate::mods::Job(Box::new(move |root, p, _, _| {
                crate::mods::remove(
                    &crate::mods::directory(&root, &p)?,
                    &project,
                    remove_dependencies,
                )
            })),
        })
        .await
}
#[tauri::command]
pub async fn mods_set_enabled(
    state: tauri::State<'_, CoreService>,
    id: uuid::Uuid,
    project: String,
    enabled: bool,
) -> Result<Reply, String> {
    state
        .call(Action::ModJob {
            id,
            job: crate::mods::Job(Box::new(move |root, p, _, _| {
                crate::mods::toggle(&crate::mods::directory(&root, &p)?, &project, enabled)
            })),
        })
        .await
}
#[tauri::command]
pub async fn mods_check_updates(
    state: tauri::State<'_, CoreService>,
    id: uuid::Uuid,
) -> Result<serde_json::Value, String> {
    let p = mod_profile(&state, id).await?;
    tauri::async_runtime::spawn_blocking(move||{use crate::modrinth::Source;let m=crate::mods::read(&crate::mods::directory(&crate::model::data_root(),&p)?)?;let mut out=vec![];for e in m.entries{let versions=crate::modrinth::ranked(crate::modrinth::Api.versions(&e.project_id)?,&p.version,crate::modrinth::loader_keys(p.loader));let current=versions.iter().find(|v|v.id==e.version_id);if let Some(v)=versions.first(){if v.id!=e.version_id&&current.is_none_or(|c|v.date_published>c.date_published){out.push(serde_json::json!({"project_id":e.project_id,"current":e.version_id,"update":v}));}}}Ok::<_,anyhow::Error>(serde_json::json!(out))}).await.map_err(|e|e.to_string())?.map_err(|e|format!("{e:#}"))
}
#[tauri::command]
pub async fn mods_create_fabric_profile(
    state: tauri::State<'_, CoreService>,
    plans: tauri::State<'_, crate::mods::Plans>,
    name: String,
    version_id: String,
    projects: Vec<String>,
) -> Result<crate::mods::Plan, String> {
    if projects.is_empty() || projects.len() > 32 {
        return Err("1–32 mod seçin.".into());
    }
    for project in &projects {
        crate::modrinth::id(project).map_err(|e| e.to_string())?;
    }
    let reply = create_wizard_profile(
        state.clone(),
        name,
        version_id,
        crate::model::Loader::Fabric,
        None,
        Default::default(),
    )
    .await?;
    let id = reply
        .state
        .selected_profile
        .ok_or("Profil oluşturulamadı.")?;
    let p = reply
        .state
        .profiles
        .into_iter()
        .find(|p| p.id == id)
        .ok_or("Oluşturulan profil bulunamadı.")?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let dir = crate::mods::directory(&crate::model::data_root(), &p)?;
        crate::mods::resolve(&mut crate::modrinth::Api, &p, &dir, &projects)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("{e:#}"));
    result.and_then(|p|plans.put(p).map_err(|e|e.to_string())).map_err(|e|format!("Fabric profili oluşturuldu ({id}), ancak mod planı hazırlanamadı: {e}. Hiçbir mod indirilmedi; aynı profil için tekrar plan oluşturabilirsiniz."))
}
#[tauri::command]
pub async fn read_appearance(
    state: tauri::State<'_, CoreService>,
) -> Result<crate::appearance::Preferences, String> {
    let snapshot = state.call(Action::Read).await?.state;
    if snapshot.load_failed {
        return Err(snapshot.status);
    }
    let path = crate::model::data_root().join("appearance.json");
    match std::fs::read(path) {
        Ok(b) => {
            let p: crate::appearance::Preferences =
                serde_json::from_slice(&b).map_err(|_| "Görünüm ayarları okunamadı.")?;
            p.validate()?;
            Ok(p)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Default::default()),
        Err(e) => Err(e.to_string()),
    }
}
#[tauri::command]
pub async fn save_appearance(
    state: tauri::State<'_, CoreService>,
    preferences: crate::appearance::Preferences,
) -> Result<(), String> {
    let snapshot = state.call(Action::Read).await?.state;
    if snapshot.load_failed {
        return Err(snapshot.status);
    }
    preferences.validate()?;
    crate::profiles::atomic_write(
        &crate::model::data_root().join("appearance.json"),
        &serde_json::to_vec_pretty(&preferences).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("Görünüm kaydedilemedi: {e}"))?;
    crate::discord::set_language(&preferences.discord_language);
    // Discord Rich Presence arayüze göre PatronLauncher ya da PClient uygulamasını gösterir.
    crate::discord::set_pclient_mode(preferences.ui_mode == "pclient");
    Ok(())
}
#[tauri::command]
pub async fn storage_usage(
    state: tauri::State<'_, CoreService>,
) -> Result<crate::storage::Usage, String> {
    let snapshot = state.call(Action::Read).await?.state;
    if snapshot.load_failed {
        return Err(snapshot.status);
    }
    let mut profiles = snapshot.profiles;
    profiles.extend(snapshot.quick_profile);
    // Klasör taraması durum aktörünü ve arayüz iş parçacığını bekletmez.
    tauri::async_runtime::spawn_blocking(move || {
        crate::storage::usage(&crate::model::data_root(), &profiles)
    })
    .await
    .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn servers_list(
    state: tauri::State<'_, CoreService>,
    store: tauri::State<'_, crate::servers::Store>,
) -> Result<crate::servers::Listing, String> {
    let snapshot = state.call(Action::Read).await?.state;
    if snapshot.load_failed {
        return Err(snapshot.status);
    }
    let listing = tauri::async_runtime::spawn_blocking(|| {
        crate::servers::load(&crate::model::data_root())
    })
    .await
    .map_err(|e| e.to_string())?;
    store.remember(&listing.servers);
    Ok(listing)
}
#[tauri::command]
pub async fn server_ping(
    store: tauri::State<'_, crate::servers::Store>,
    id: String,
) -> Result<crate::servers::Ping, String> {
    if let Some(ping) = store.cached_ping(&id) {
        return Ok(ping);
    }
    let server = store.find(&id).ok_or("Sunucu listede bulunamadı.")?;
    let ping = tauri::async_runtime::spawn_blocking(move || crate::servers::ping(&server))
        .await
        .map_err(|e| e.to_string())?;
    store.store_ping(&id, &ping);
    Ok(ping)
}
#[tauri::command]
pub async fn join_server(
    state: tauri::State<'_, CoreService>,
    store: tauri::State<'_, crate::servers::Store>,
    id: String,
    pclient: Option<bool>,
) -> Result<Reply, String> {
    // Adres arayüzden değil, doğrulanmış listeden alınır.
    let server = store.find(&id).ok_or("Sunucu listede bulunamadı.")?;
    state
        .call(Action::JoinServer { host: server.address, port: server.port, pclient: pclient.unwrap_or(false) })
        .await
}
#[tauri::command]
pub fn server_open_link(
    store: tauri::State<'_, crate::servers::Store>,
    id: String,
    discord: bool,
) -> Result<(), String> {
    // Bağlantılar listeyi yüklerken HTTPS olarak doğrulandı; başka adres açılmaz.
    let server = store.find(&id).ok_or("Sunucu listede bulunamadı.")?;
    let url = if discord { server.discord } else { server.website };
    webbrowser::open(&url.ok_or("Bu sunucu için bağlantı yok.")?).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn servers_votes() -> crate::servers::Votes {
    crate::servers::load_votes(&crate::model::data_root())
}
fn listed(store: &crate::servers::Store, id: &str) -> Result<(), String> {
    store.find(id).map(|_| ()).ok_or_else(|| "Sunucu listede bulunamadı.".to_string())
}
/// Sunucunun site sayfasını oy bölümünde açar; oylar sitede Turnstile ve 8 saatlik kilitle korunur.
#[tauri::command]
pub fn server_vote(
    store: tauri::State<'_, crate::servers::Store>,
    id: String,
    lang: String,
) -> Result<(), String> {
    listed(&store, &id)?;
    webbrowser::open(&format!("{}#vote", crate::servers::page_url(&id, &lang))).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn server_rate(
    store: tauri::State<'_, crate::servers::Store>,
    id: String,
    stars: u8,
) -> Result<crate::servers::Vote, String> {
    listed(&store, &id)?;
    crate::servers::rate(&crate::model::data_root(), &id, stars).map_err(|e| format!("{e:#}"))
}
#[tauri::command]
pub fn server_favorite(
    store: tauri::State<'_, crate::servers::Store>,
    id: String,
    favorite: bool,
) -> Result<crate::servers::Vote, String> {
    listed(&store, &id)?;
    crate::servers::favorite(&crate::model::data_root(), &id, favorite).map_err(|e| format!("{e:#}"))
}
#[tauri::command]
pub fn system_memory() -> Option<crate::storage::Memory> {
    crate::storage::memory()
}
#[tauri::command]
pub async fn mods_fetch_image(url: String) -> Result<crate::mod_images::Image, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::mod_images::fetch(&url).map_err(|e| format!("{e:#}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn content_profile(snapshot: &crate::core::types::Snapshot, id: uuid::Uuid) -> Result<crate::model::Profile, String> {
    snapshot
        .profiles
        .iter()
        .chain(snapshot.quick_profile.iter())
        .find(|p| p.id == id)
        .cloned()
        .ok_or_else(|| "Profil bulunamadı.".to_string())
}
#[tauri::command]
pub async fn content_versions(
    state: tauri::State<'_, CoreService>,
    profile: uuid::Uuid,
    kind: String,
    project: String,
) -> Result<Vec<crate::content::ContentVersion>, String> {
    let profile = content_profile(&state.call(Action::Read).await?.state, profile)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::content::versions(crate::content::Kind::parse(&kind)?, &project, &profile.version)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("{e:#}"))
}
#[tauri::command]
pub async fn content_worlds(
    state: tauri::State<'_, CoreService>,
    profile: uuid::Uuid,
) -> Result<Vec<String>, String> {
    let profile = content_profile(&state.call(Action::Read).await?.state, profile)?;
    Ok(crate::content::worlds(&crate::model::data_root(), &profile))
}
#[tauri::command]
pub async fn content_installed(
    state: tauri::State<'_, CoreService>,
    profile: uuid::Uuid,
    kind: String,
    world: Option<String>,
) -> Result<Vec<String>, String> {
    let profile = content_profile(&state.call(Action::Read).await?.state, profile)?;
    let kind = crate::content::Kind::parse(&kind).map_err(|e| e.to_string())?;
    Ok(crate::content::installed(&crate::model::data_root(), &profile, kind, world.as_deref()))
}
/// Profilde kurulu modlar, shaderlar, kaynak ve veri paketleri (kütüphane görünümü).
#[tauri::command]
pub async fn content_library(
    state: tauri::State<'_, CoreService>,
    profile: uuid::Uuid,
) -> Result<Vec<crate::content::LibraryItem>, String> {
    let profile = content_profile(&state.call(Action::Read).await?.state, profile)?;
    tauri::async_runtime::spawn_blocking(move || crate::content::library(&crate::model::data_root(), &profile))
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn content_remove(
    state: tauri::State<'_, CoreService>,
    profile: uuid::Uuid,
    kind: String,
    filename: String,
    world: Option<String>,
    confirmed: bool,
) -> Result<(), String> {
    if !confirmed {
        return Err("Silmek için açık onay gerekli.".into());
    }
    let snapshot = state.call(Action::Read).await?.state;
    if snapshot.running {
        return Err("Oyun açıkken içerik silinemez.".into());
    }
    let profile = content_profile(&snapshot, profile)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::content::remove(
            &crate::model::data_root(),
            &profile,
            crate::content::Kind::parse(&kind)?,
            &filename,
            world.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("{e:#}"))
}
/// Birden çok Modrinth projesinin özeti (kütüphane kartları için tek istek).
#[tauri::command]
pub async fn mods_projects(ids: Vec<String>) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ids: Vec<String> = ids.into_iter().filter(|id| crate::modrinth::id(id).is_ok()).take(200).collect();
        if ids.is_empty() {
            return Ok(serde_json::json!([]));
        }
        crate::modrinth::get("projects", &[("ids", serde_json::to_string(&ids)?)])
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e: anyhow::Error| format!("{e:#}"))
}
#[tauri::command]
pub async fn content_install(
    state: tauri::State<'_, CoreService>,
    profile: uuid::Uuid,
    kind: String,
    project: String,
    version: String,
    world: Option<String>,
) -> Result<String, String> {
    let snapshot = state.call(Action::Read).await?.state;
    if snapshot.load_failed {
        return Err(snapshot.status);
    }
    let profile = content_profile(&snapshot, profile)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::content::install(
            &crate::model::data_root(),
            &profile,
            crate::content::Kind::parse(&kind)?,
            &project,
            &version,
            world.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn curseforge_key_status() -> &'static str {
    crate::curseforge::key_status()
}
#[tauri::command]
pub async fn curseforge_set_key(key: String) -> Result<&'static str, String> {
    tauri::async_runtime::spawn_blocking(move || crate::curseforge::set_key(&key))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))?;
    Ok(crate::curseforge::key_status())
}
#[tauri::command]
pub fn curseforge_clear_key() -> Result<&'static str, String> {
    crate::curseforge::clear_key().map_err(|e| format!("{e:#}"))?;
    Ok(crate::curseforge::key_status())
}
async fn cf_blocking<T: Send + 'static>(
    job: impl FnOnce() -> anyhow::Result<T> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))
}
#[tauri::command]
pub async fn curseforge_search(search: crate::curseforge::Search) -> Result<serde_json::Value, String> {
    cf_blocking(move || crate::curseforge::search(search)).await
}
#[tauri::command]
pub async fn curseforge_categories(kind: String) -> Result<serde_json::Value, String> {
    cf_blocking(move || crate::curseforge::categories(&kind)).await
}
#[tauri::command]
pub async fn curseforge_project(project: u32) -> Result<serde_json::Value, String> {
    cf_blocking(move || crate::curseforge::project(project)).await
}
#[tauri::command]
pub async fn curseforge_files(
    state: tauri::State<'_, CoreService>,
    profile: uuid::Uuid,
    project: u32,
    kind: String,
) -> Result<Vec<crate::curseforge::CfFile>, String> {
    let profile = content_profile(&state.call(Action::Read).await?.state, profile)?;
    cf_blocking(move || {
        crate::curseforge::class(&kind)?;
        crate::curseforge::files(project, &profile.version, (kind == "mod").then_some(profile.loader))
    })
    .await
}
#[tauri::command]
pub async fn curseforge_plan(
    state: tauri::State<'_, CoreService>,
    plans: tauri::State<'_, crate::mods::Plans>,
    id: uuid::Uuid,
    project: u32,
    file: Option<u32>,
) -> Result<crate::mods::Plan, String> {
    let p = mod_profile(&state, id).await?;
    let plan = cf_blocking(move || {
        let dir = crate::mods::directory(&crate::model::data_root(), &p)?;
        crate::curseforge::plan(&p, &dir, project, file)
    })
    .await?;
    plans.put(plan).map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn curseforge_install(
    app: tauri::AppHandle,
    state: tauri::State<'_, CoreService>,
    plans: tauri::State<'_, crate::mods::Plans>,
    id: uuid::Uuid,
    plan_id: uuid::Uuid,
    confirmed: bool,
) -> Result<Reply, String> {
    mod_profile(&state, id).await?;
    let plan = plans.take(plan_id, id, confirmed).map_err(|e| e.to_string())?;
    state
        .call(Action::ModJob {
            id,
            job: crate::mods::Job(Box::new(move |root, p, cancel, notify| {
                use tauri::Emitter;
                crate::curseforge::install(&root, &p, plan, &cancel, &*notify, &|progress| {
                    let _ = app.emit_to("main", "patronlauncher://mods-progress", progress);
                })
            })),
        })
        .await
}
#[tauri::command]
pub async fn curseforge_content_install(
    state: tauri::State<'_, CoreService>,
    profile: uuid::Uuid,
    kind: String,
    project: u32,
    file: u32,
    world: Option<String>,
) -> Result<String, String> {
    let snapshot = state.call(Action::Read).await?.state;
    if snapshot.load_failed {
        return Err(snapshot.status);
    }
    let profile = content_profile(&snapshot, profile)?;
    cf_blocking(move || {
        crate::curseforge::install_content(
            &crate::model::data_root(),
            &profile,
            crate::content::Kind::parse(&kind)?,
            &kind,
            project,
            file,
            world.as_deref(),
        )
    })
    .await
}

#[derive(serde::Serialize)]
pub struct UpdateInfo {
    version: String,
    notes: Option<String>,
}
/// GitHub'daki son sürümü (latest.json) sorar; yeni sürüm yoksa ya da çevrimdışıysa yok döner.
#[tauri::command]
pub async fn update_check(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    Ok(update.map(|u| UpdateInfo { version: u.version, notes: u.body }))
}
/// İmzası doğrulanan kurulum dosyasını indirip çalıştırır. Kurulum launcher'ı kapatır,
/// günceller ve yeniden açar; oyun açıkken çağrılmaz.
#[tauri::command]
pub async fn update_install(app: tauri::AppHandle, state: tauri::State<'_, CoreService>) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let snapshot = state.call(Action::Read).await?.state;
    if snapshot.running || snapshot.busy {
        return Err("Önce oyunu kapat ve devam eden işlemin bitmesini bekle.".into());
    }
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or("Yeni sürüm bulunamadı.")?;
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| format!("Güncelleme kurulamadı: {e}"))
}

#[tauri::command]
pub async fn media_now_playing() -> Result<Option<crate::media::NowPlaying>, String> {
    tauri::async_runtime::spawn_blocking(crate::media::now_playing)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))
}
#[tauri::command]
pub async fn media_control(action: String, value: Option<i64>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || crate::media::control(&action, value))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))
}
/// Kapak resmi, base64 PNG. Şarkı o arada değiştiyse yok döner.
#[tauri::command]
pub async fn media_cover(key: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || crate::media::cover(&key))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))
}

/// PClient'ı başlatır. PClient launcher profillerinden ayrı, gizli kendi profiliyle çalışır;
/// oyuncunun seçili profili değişmez.
#[tauri::command]
pub async fn pclient_play(state: tauri::State<'_, CoreService>) -> Result<Reply, String> {
    state.call(Action::LaunchPClient).await
}

/// PClient'ın seçili sürümünü oyunu açmadan indirir ve kurar.
#[tauri::command]
pub async fn pclient_install(state: tauri::State<'_, CoreService>) -> Result<Reply, String> {
    state.call(Action::InstallPClient).await
}

/// PClient'ın desteklediği ve planlanan Minecraft sürümleri.
#[tauri::command]
pub fn pclient_versions() -> Vec<crate::pclient::ReleaseInfo> {
    crate::pclient::releases(&crate::model::data_root())
}

#[tauri::command]
pub fn pclient_select_version(version: String) -> Result<Vec<crate::pclient::ReleaseInfo>, String> {
    let root = crate::model::data_root();
    crate::pclient::select(&root, &version).map_err(|e| format!("{e:#}"))?;
    Ok(crate::pclient::releases(&root))
}

/// Seçilen PClient sürümü için Sodium ve Lithium'u kurar ya da kaldırıp kararı kaydeder.
#[tauri::command]
pub async fn pclient_performance(version: String, install: bool) -> Result<Vec<crate::pclient::ReleaseInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = crate::model::data_root();
        if install {
            crate::pclient::install_performance(&root, &version)?;
        } else {
            crate::pclient::decline_performance(&root, &version)?;
        }
        Ok::<_, anyhow::Error>(crate::pclient::releases(&root))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn pclient_performance_notice() -> bool {
    crate::pclient::performance_notice_hidden(&crate::model::data_root())
}

#[tauri::command]
pub fn pclient_performance_hide(hidden: bool) -> Result<(), String> {
    crate::pclient::hide_performance_notice(&crate::model::data_root(), hidden).map_err(|e| format!("{e:#}"))
}

/// Hesabın skini: uuid verilirse (Microsoft) o profil, yoksa ada kayıtlı lisanslı hesap.
#[tauri::command]
pub async fn player_skin(name: String, uuid: Option<String>) -> Result<Option<crate::skins::Skin>, String> {
    tauri::async_runtime::spawn_blocking(move || crate::skins::fetch(&crate::model::data_root(), &name, uuid.as_deref()))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))
}

// ── PatronLauncher hesabı (Minecraft hesaplarından ayrı) ─────────────────────────────────────────────
use crate::patron_account::{self, Status as PatronStatus};
fn blocking_error(e: impl std::fmt::Display) -> String {
    e.to_string()
}
#[tauri::command]
pub fn patron_account_status() -> PatronStatus {
    patron_account::status()
}
#[tauri::command]
pub async fn patron_account_login(lang: String) -> Result<PatronStatus, String> {
    tauri::async_runtime::spawn_blocking(move || patron_account::login(&lang))
        .await
        .map_err(blocking_error)?
        .map_err(|e| format!("{e:#}"))
}
#[tauri::command]
pub fn patron_account_cancel() -> PatronStatus {
    patron_account::cancel()
}
#[tauri::command]
pub fn patron_account_reopen() -> Result<(), String> {
    patron_account::reopen().map_err(|e| format!("{e:#}"))
}
#[tauri::command]
pub fn patron_account_logout() -> PatronStatus {
    patron_account::logout()
}
#[tauri::command]
pub fn patron_account_profile() -> Result<(), String> {
    patron_account::open_profile().map_err(|e| format!("{e:#}"))
}
#[tauri::command]
pub fn patron_account_language(lang: String) {
    patron_account::set_language(&lang);
}
#[tauri::command]
pub async fn patron_open_help(lang: String, minecraft: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || patron_account::open_help(&lang, minecraft.as_deref()))
        .await
        .map_err(blocking_error)?
        .map_err(|e| format!("{e:#}"))
}

// ── Arkadaşlar ve mesajlar (sitenin /api/social/* uçlarına aracı; anlık olaylar social::EVENT ile gelir) ──
#[tauri::command]
pub async fn social_api(method: String, path: String, body: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || crate::social::api(&method, &path, body))
        .await
        .map_err(blocking_error)?
        .map_err(|e| format!("{e:#}"))
}
#[tauri::command]
pub fn social_status() -> serde_json::Value {
    serde_json::json!({ "connected": crate::social::connected() })
}
