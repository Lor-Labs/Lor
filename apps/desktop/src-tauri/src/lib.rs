#[cfg(debug_assertions)]
use tauri::Manager;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
