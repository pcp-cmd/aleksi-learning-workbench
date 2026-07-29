fn main() {
    let app_manifest = tauri_build::AppManifest::new().commands(&[
        "desktop_runtime_snapshot",
        "restart_sidecar",
        "select_reading_file",
        "select_learning_library",
        "open_learning_library",
        "export_diagnostics",
        "request_exit",
        "force_exit",
    ]);

    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(app_manifest))
        .expect("failed to build Aleksi Workbench desktop metadata");
}
