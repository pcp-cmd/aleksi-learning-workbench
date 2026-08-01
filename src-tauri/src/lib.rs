mod commands;
mod runtime;
mod runtime_diagnostics;
mod selected_readings;

use commands::{
    desktop_runtime_snapshot, export_diagnostics, force_exit, open_learning_library, request_exit,
    read_selected_reading_part, restart_sidecar, select_learning_library, select_reading_file,
};
use runtime::DesktopRuntime;
use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(DesktopRuntime::default())
        .invoke_handler(tauri::generate_handler![
            desktop_runtime_snapshot,
            restart_sidecar,
            select_reading_file,
            read_selected_reading_part,
            select_learning_library,
            open_learning_library,
            export_diagnostics,
            request_exit,
            force_exit
        ])
        .setup(|app| {
            let runtime = app.state::<DesktopRuntime>();
            if let Err(message) = runtime.start(app.handle()) {
                runtime.record_start_failure(message);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::Destroyed) {
                let runtime = window.app_handle().state::<DesktopRuntime>();
                match runtime.shutdown() {
                    Ok(()) => {
                        if runtime
                            .clear_destroyed_window_shutdown_failure()
                            .is_err()
                        {
                            eprintln!(
                                "Unable to clear the bounded desktop lifecycle diagnostic"
                            );
                        }
                    }
                    Err(error) => {
                        if runtime
                            .record_destroyed_window_shutdown_failure(&error)
                            .is_err()
                        {
                            eprintln!(
                                "Unable to persist the bounded desktop lifecycle diagnostic"
                            );
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Aleksi Workbench Desktop");
}
