#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use std::net::TcpStream;

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
      }
    }))
    .plugin(tauri_plugin_shell::init())
    .setup(|app| {
      let resource_dir = app.path().resource_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

      // Write sidecar logs so crashes are debuggable
      let log_dir = app.path().app_log_dir().unwrap_or_default();
      let _ = std::fs::create_dir_all(&log_dir);
      let log_path = log_dir.join("sidecar.log");
      let log_file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&log_path);

      // Start the Node.js sidecar
      let sidecar_command = app.shell().sidecar("myaiforone-server")
        .expect("Failed to create sidecar command")
        .env("TAURI_RESOURCE_DIR", &resource_dir);
      let (mut rx, _child) = sidecar_command.spawn()
        .expect("Failed to spawn sidecar");

      // Capture sidecar stdout/stderr → log file in background
      if let Ok(mut file) = log_file {
        std::thread::spawn(move || {
          use std::io::Write;
          while let Some(event) = rx.blocking_recv() {
            match event {
              CommandEvent::Stdout(line) => {
                let _ = writeln!(file, "[out] {}", String::from_utf8_lossy(&line));
                let _ = file.flush();
              }
              CommandEvent::Stderr(line) => {
                let _ = writeln!(file, "[err] {}", String::from_utf8_lossy(&line));
                let _ = file.flush();
              }
              CommandEvent::Terminated(payload) => {
                let _ = writeln!(file, "[terminated] code={:?} signal={:?}", payload.code, payload.signal);
                let _ = file.flush();
                break;
              }
              _ => {}
            }
          }
        });
      }

      // Wait for sidecar to start listening on port 4889 (up to 15 seconds)
      for _ in 0..30 {
        std::thread::sleep(std::time::Duration::from_millis(500));
        if TcpStream::connect("127.0.0.1:4889").is_ok() {
          break;
        }
      }

      // Build tray menu
      let open_item = MenuItemBuilder::with_id("open", "Open MyAIforOne Lite").build(app)?;
      let separator = PredefinedMenuItem::separator(app)?;
      let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;

      let menu = MenuBuilder::new(app)
        .item(&open_item)
        .item(&separator)
        .item(&quit_item)
        .build()?;

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
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        let _ = window.hide();
        api.prevent_close();
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
