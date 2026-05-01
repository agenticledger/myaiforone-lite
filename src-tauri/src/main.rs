#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri_plugin_shell::ShellExt;

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      // Focus the existing window when a second instance tries to launch
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
      }
    }))
    .plugin(tauri_plugin_shell::init())
    .setup(|app| {
      // Start the Node.js sidecar
      let sidecar_command = app.shell().sidecar("myaiforone-server").unwrap();
      let (_rx, _child) = sidecar_command.spawn().unwrap();

      // Give server time to start
      std::thread::sleep(std::time::Duration::from_secs(2));

      // Build tray menu
      let open_item = MenuItemBuilder::with_id("open", "Open MyAIforOne Lite").build(app)?;
      let separator = PredefinedMenuItem::separator(app)?;
      let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

      let menu = MenuBuilder::new(app)
        .item(&open_item)
        .item(&separator)
        .item(&quit_item)
        .build()?;

      // Build tray icon
      let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("MyAIforOne Lite")
        .on_menu_event(|app, event| {
          match event.id().as_ref() {
            "open" => {
              if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
              }
            }
            "quit" => {
              app.exit(0);
            }
            _ => {}
          }
        })
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
          } = event
          {
            let app = tray.app_handle();
            if let Some(window) = app.get_webview_window("main") {
              let _ = window.show();
              let _ = window.set_focus();
            }
          }
        })
        .build(app)?;

      Ok(())
    })
    .on_window_event(|window, event| {
      // Minimize to tray on close instead of quitting
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        let _ = window.hide();
        api.prevent_close();
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
