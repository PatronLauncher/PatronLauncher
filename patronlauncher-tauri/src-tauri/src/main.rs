#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#[cfg(all(not(debug_assertions), not(feature = "custom-protocol")))]
compile_error!(
    "Release builds must embed the frontend: enable custom-protocol or use npm run desktop:build."
);
#[cfg(test)]
mod acl_tests;
mod appearance;
mod auth;
mod catalog;
mod cli;
mod commands;
mod content;
mod core;
mod curseforge;
mod spotify;
mod discord;
mod fabric;
mod forge;
mod loaders;
mod optifine;
mod game;
mod migration;
mod mod_images;
mod model;
mod modrinth;
mod mods;
mod net;
mod news;
mod pclient;
mod pclient_bridge;
mod skins;
mod performance;
mod profile_appearance;
mod profile_creation;
mod profile_management;
mod profiles;
mod runtime;
mod servers;
mod storage;
mod store;
mod verified;
use tauri::{Emitter, Manager};
fn main() {
    match cli::run(&std::env::args().skip(1).collect::<Vec<_>>()) {
        Ok(true) => return,
        Ok(false) => {}
        Err(error) => {
            eprintln!("{error:#}");
            std::process::exit(1);
        }
    }
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            let prefs = appearance::Preferences::load(&model::data_root());
            discord::set_language(&prefs.discord_language);
            // Rich Presence açılıştaki arayüze göre PatronLauncher ya da PClient uygulamasıyla başlar.
            discord::set_pclient_mode(prefs.launch_ui() == "pclient");
            app.manage(performance::PlanStore::default());
            app.manage(mods::Plans::default());
            app.manage(servers::Store::default());
            app.manage(core::CoreService::start(
                model::data_root(),
                move |notice| match notice {
                    core::types::Notification::Event(event) => {
                        let _ = handle.emit_to("main", "patronlauncher://core-event", event);
                    }
                    core::types::Notification::State(state) => {
                        let _ = handle.emit_to("main", "patronlauncher://state", state);
                    }
                },
            ));
            pclient_bridge::start(app.handle().clone(), &model::data_root());
            tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .on_navigation(core::security::approved_navigation)
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_state,
            commands::read_appearance,
            commands::save_appearance,
            commands::mods_search,
            commands::mods_fetch_image,
            commands::mods_project,
            commands::mods_versions,
            commands::mods_plan,
            commands::mods_install,
            commands::mods_list,
            commands::mods_removal_plan,
            commands::mods_remove,
            commands::mods_set_enabled,
            commands::mods_check_updates,
            commands::mods_create_fabric_profile,
            commands::list_versions,
            commands::list_loader_versions,
            commands::set_profile_loader,
            commands::preview_performance_pack,
            commands::create_configured_profile,
            commands::list_version_catalog,
            commands::list_profiles,
            commands::create_profile,
            commands::create_wizard_profile,
            commands::rename_profile,
            commands::copy_profile,
            commands::install_profile,
            commands::install_version,
            commands::list_installed_versions,
            commands::is_installed,
            commands::remove_version,
            commands::launch_quick,
            commands::select_quick,
            commands::profile_statuses,
            commands::profile_action,
            commands::remove_profile,
            commands::select_profile,
            commands::select_version,
            commands::list_accounts,
            commands::add_local_account,
            commands::microsoft_login,
            commands::remove_account,
            commands::select_account,
            commands::read_settings,
            commands::save_settings,
            commands::get_news,
            commands::check_java,
            commands::install_java,
            commands::launch_game,
            commands::pclient_play,
            commands::pclient_install,
            commands::pclient_versions,
            commands::pclient_performance,
            commands::pclient_performance_notice,
            commands::pclient_performance_hide,
            commands::pclient_select_version,
            commands::player_skin,
            commands::cancel_operation,
            commands::backup_profile,
            commands::restore_profile,
            commands::recover_profiles,
            commands::open_folder,
            commands::open_external,
            commands::storage_usage,
            commands::system_memory,
            commands::servers_list,
            commands::server_ping,
            commands::join_server,
            commands::server_open_link,
            commands::servers_votes,
            commands::server_vote,
            commands::server_rate,
            commands::server_favorite,
            commands::content_versions,
            commands::content_worlds,
            commands::content_installed,
            commands::content_install,
            commands::curseforge_key_status,
            commands::spotify_status,
            commands::spotify_login,
            commands::spotify_logout,
            commands::spotify_now_playing,
            commands::spotify_control,
            commands::curseforge_set_key,
            commands::curseforge_clear_key,
            commands::curseforge_search,
            commands::curseforge_categories,
            commands::curseforge_project,
            commands::curseforge_files,
            commands::curseforge_plan,
            commands::curseforge_install,
            commands::curseforge_content_install
        ])
        .run(tauri::generate_context!())
        .expect("PatronLauncher başlatılamadı");
}
