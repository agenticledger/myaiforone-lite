#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use std::net::TcpStream;
use std::sync::Mutex;

/// Global handle to the sidecar child process so we can kill it on exit.
static SIDECAR_CHILD: Mutex<Option<CommandChild>> = Mutex::new(None);

fn kill_sidecar() {
  if let Ok(mut guard) = SIDECAR_CHILD.lock() {
    if let Some(child) = guard.take() {
      let _ = child.kill();
    }
  }
}

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
      // Strip Windows \\?\ long-path prefix — it breaks child process spawning
      // (e.g. Claude CLI can't launch MCP servers when paths have this prefix).
      fn strip_long_path_prefix(s: String) -> String {
        if s.starts_with("\\\\?\\") { s[4..].to_string() } else { s }
      }

      let resource_dir = app.path().resource_dir()
        .map(|p| strip_long_path_prefix(p.to_string_lossy().to_string()))
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

      // Lite uses its own data dir so it never collides with full MyAIforOne.
      // On Windows: %LOCALAPPDATA%/ai.myaiforone.lite/data
      // On macOS:   ~/Library/Application Support/ai.myaiforone.lite/data
      let data_dir = app.path().app_local_data_dir()
        .map(|p| p.join("data"))
        .unwrap_or_default();
      let _ = std::fs::create_dir_all(&data_dir);
      let data_dir_str = strip_long_path_prefix(data_dir.to_string_lossy().to_string());

      // Start the Node.js sidecar
      let sidecar_command = app.shell().sidecar("myaiforone-server")
        .expect("Failed to create sidecar command")
        .env("TAURI_RESOURCE_DIR", &resource_dir)
        .env("MYAGENT_DATA_DIR", &data_dir_str)
        .env("PORT", "4889");
      let (mut rx, child) = sidecar_command.spawn()
        .expect("Failed to spawn sidecar");

      // Store the child handle so we can kill it on app exit
      if let Ok(mut guard) = SIDECAR_CHILD.lock() {
        *guard = Some(child);
      }

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
              kill_sidecar();
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
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|_app, event| {
      // Kill the sidecar when the app is exiting (covers all exit paths)
      if let tauri::RunEvent::Exit = event {
        kill_sidecar();
      }
    });
}
