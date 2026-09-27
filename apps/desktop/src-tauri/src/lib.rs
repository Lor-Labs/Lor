#[cfg(debug_assertions)]
use tauri::Manager;
use tauri::{
    menu::{Menu, MenuItem},
    AppHandle, Emitter,
};

mod restart;

#[cfg(any(target_os = "macos", target_os = "windows"))]
use tauri::menu::PredefinedMenuItem;
#[cfg(target_os = "linux")]
use tauri::menu::Submenu;

const SETTINGS_MENU_ID: &str = "settings";
const OPEN_SETTINGS_EVENT: &str = "open-settings";

// Dev servers (API :8080, realtime :8081) are plain HTTP on localhost, which
// the production http scope (https://*.lor.chat) rejects. Grant them only in
// debug builds so localhost is never reachable from a shipped app.
#[cfg(debug_assertions)]
const DEV_LOCALHOST_CAPABILITY: &str = r#"{
  "identifier": "dev-localhost-http",
  "description": "Allow HTTP to local dev servers (debug builds only)",
  "windows": ["main"],
  "permissions": [
    {
      "identifier": "http:default",
      "allow": [
        { "url": "http://localhost:8080" },
        { "url": "http://127.0.0.1:8080" },
        { "url": "http://localhost:8081" },
        { "url": "http://127.0.0.1:8081" }
      ]
    }
  ]
}"#;

fn desktop_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::default(app)?;
    let settings = MenuItem::with_id(
        app,
        SETTINGS_MENU_ID,
        "Settings…",
        true,
        Some("CmdOrCtrl+,"),
    )?;

    #[cfg(target_os = "macos")]
    {
        let items = menu.items()?;
        if let Some(app_menu) = items.first().and_then(|item| item.as_submenu()) {
            let separator = PredefinedMenuItem::separator(app)?;
            app_menu.insert_items(&[&settings, &separator], 2)?;
        }
    }

    #[cfg(target_os = "windows")]
    {
        let items = menu.items()?;
        if let Some(file_menu) = items.first().and_then(|item| item.as_submenu()) {
            let separator = PredefinedMenuItem::separator(app)?;
            file_menu.insert_items(&[&settings, &separator], 0)?;
        }
    }

    #[cfg(target_os = "linux")]
    {
        let file_menu = Submenu::with_items(app, "File", true, &[&settings])?;
        menu.insert(&file_menu, 0)?;
    }

    Ok(menu)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![restart::restart_app])
        .menu(desktop_menu)
        .on_menu_event(|app, event| {
            if event.id() == SETTINGS_MENU_ID {
                let _ = app.emit(OPEN_SETTINGS_EVENT, ());
            }
        })
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                app.handle().add_capability(DEV_LOCALHOST_CAPABILITY)?;
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            #[cfg(not(debug_assertions))]
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
