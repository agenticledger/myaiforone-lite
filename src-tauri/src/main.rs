#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tauri_plugin_shell::ShellExt;

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .setup(|app| {
      // Start the Node.js sidecar
      let sidecar_command = app.shell().sidecar("myaiforone-server").unwrap();
      let (_rx, _child) = sidecar_command.spawn().unwrap();

      // Give server time to start
      std::thread::sleep(std::time::Duration::from_secs(2));

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
