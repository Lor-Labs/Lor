#[cfg(target_os = "macos")]
use tauri::Manager;

#[tauri::command]
pub async fn restart_app(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let env = app.env();
        let binary = tauri::process::current_binary(&env).map_err(|error| error.to_string())?;
        let bundle = binary
            .parent()
            .filter(|path| path.ends_with("MacOS"))
            .and_then(|path| path.parent())
            .filter(|path| path.ends_with("Contents"))
            .and_then(|path| path.parent())
            .filter(|path| path.extension().is_some_and(|extension| extension == "app"));

        if let Some(bundle) = bundle {
            // LaunchServices opens the updated bundle independently of the old process.
            // -n prevents it from merely activating the instance we're about to quit.
            let output = std::process::Command::new("/usr/bin/open")
                .arg("-n")
                .arg(bundle)
                .arg("--args")
                .args(env.args_os.iter().skip(1))
                .output()
                .map_err(|error| format!("Failed to reopen the app: {error}"))?;

            if !output.status.success() {
                return Err(format!(
                    "Failed to reopen the app ({}): {}",
                    output.status,
                    String::from_utf8_lossy(&output.stderr).trim()
                ));
            }

            app.exit(0);
            return Ok(());
        }
    }

    app.request_restart();
    Ok(())
}
