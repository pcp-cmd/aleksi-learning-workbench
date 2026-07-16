use crate::runtime::{DesktopRuntime, RuntimeSnapshot};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::process::Command;
use std::time::Duration;
use tauri::{AppHandle, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const MAX_READING_BYTES: u64 = 10 * 1024 * 1024;
const MAX_NATIVE_RESPONSE_BYTES: u64 = 2 * 1024 * 1024;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedReading {
    body: String,
    file_name: String,
    size: u64,
}

#[derive(Deserialize)]
struct VaultPath {
    path: String,
}

#[derive(Deserialize)]
struct VaultStatusResponse {
    status: Option<VaultPath>,
}

fn loopback_get(port: u16, path: &str) -> Result<Vec<u8>, String> {
    if !path.starts_with("/api/") || path.contains(['\r', '\n']) {
        return Err("Native API path is invalid".into());
    }
    let address = format!("127.0.0.1:{port}");
    let mut stream = TcpStream::connect_timeout(
        &address
            .parse()
            .map_err(|_| "Local sidecar address is invalid".to_string())?,
        Duration::from_secs(2),
    )
    .map_err(|error| format!("Unable to connect to local sidecar: {error}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(4)))
        .map_err(|error| format!("Unable to configure local request: {error}"))?;
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("Unable to request local data: {error}"))?;
    let mut response = Vec::new();
    stream
        .take(MAX_NATIVE_RESPONSE_BYTES + 1)
        .read_to_end(&mut response)
        .map_err(|error| format!("Unable to read local data: {error}"))?;
    if response.len() as u64 > MAX_NATIVE_RESPONSE_BYTES {
        return Err("Local response exceeds the native safety limit".into());
    }
    let header_end = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| "Local sidecar returned an invalid response".to_string())?;
    let headers = String::from_utf8_lossy(&response[..header_end]);
    let status_line = headers.lines().next().unwrap_or_default();
    if !status_line.starts_with("HTTP/1.1 200 ") && !status_line.starts_with("HTTP/1.0 200 ") {
        return Err(format!("Local sidecar request failed: {status_line}"));
    }
    Ok(response[(header_end + 4)..].to_vec())
}

fn supported_reading(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "txt"
            )
        })
        .unwrap_or(false)
}

#[tauri::command]
pub fn desktop_runtime_snapshot(runtime: State<'_, DesktopRuntime>) -> RuntimeSnapshot {
    runtime.snapshot()
}

#[tauri::command]
pub fn restart_sidecar(
    app: AppHandle,
    runtime: State<'_, DesktopRuntime>,
) -> Result<RuntimeSnapshot, String> {
    runtime.restart(&app)?;
    Ok(runtime.snapshot())
}

#[tauri::command]
pub fn request_exit(app: AppHandle, runtime: State<'_, DesktopRuntime>) {
    runtime.shutdown();
    app.exit(0);
}

#[tauri::command]
pub fn select_reading_file() -> Result<Option<SelectedReading>, String> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("Markdown 或文本", &["md", "markdown", "txt"])
        .pick_file()
    else {
        return Ok(None);
    };
    if !supported_reading(&path) {
        return Err("只支持 .md、.markdown 或 .txt 文件".into());
    }

    let metadata = fs::metadata(&path).map_err(|error| format!("无法读取所选文件: {error}"))?;
    if metadata.len() > MAX_READING_BYTES {
        return Err("所选文件超过 10MB，请缩短后再导入".into());
    }
    let bytes = fs::read(&path).map_err(|error| format!("无法读取所选文件: {error}"))?;
    let decoded = String::from_utf8(bytes)
        .map_err(|_| "文件不是有效的 UTF-8 文本，请转换编码后再导入".to_string())?;
    let body = decoded
        .strip_prefix('\u{feff}')
        .unwrap_or(&decoded)
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    if body.trim().is_empty() {
        return Err("文件中没有可导入的文本内容".into());
    }
    if body.contains('\0') {
        return Err("文件包含不受支持的空字符".into());
    }

    Ok(Some(SelectedReading {
        body,
        file_name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("未命名材料")
            .to_string(),
        size: metadata.len(),
    }))
}

#[tauri::command]
pub fn select_learning_library() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn open_learning_library(runtime: State<'_, DesktopRuntime>) -> Result<(), String> {
    let response = loopback_get(runtime.api_port()?, "/api/vault/status")?;
    let status: VaultStatusResponse = serde_json::from_slice(&response)
        .map_err(|error| format!("Local learning library status is invalid: {error}"))?;
    let path = status
        .status
        .ok_or_else(|| "Local learning library is not configured".to_string())?
        .path;
    if !Path::new(&path).is_dir() {
        return Err("The verified Local Learning Library directory is unavailable".into());
    }

    #[cfg(windows)]
    {
        let mut command = Command::new("explorer.exe");
        command.arg(&path).creation_flags(CREATE_NO_WINDOW);
        command
            .spawn()
            .map_err(|error| format!("Unable to open Local Learning Library: {error}"))?;
    }
    #[cfg(not(windows))]
    Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|error| format!("Unable to open Local Learning Library: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn export_diagnostics(runtime: State<'_, DesktopRuntime>) -> Result<Option<String>, String> {
    let report = loopback_get(runtime.api_port()?, "/api/runtime/diagnostics")?;
    serde_json::from_slice::<serde_json::Value>(&report)
        .map_err(|error| format!("Local diagnostic report is invalid: {error}"))?;
    let Some(path) = rfd::FileDialog::new()
        .set_file_name("aleksi-workbench-diagnostics.json")
        .add_filter("JSON", &["json"])
        .save_file()
    else {
        return Ok(None);
    };
    fs::write(&path, report)
        .map_err(|error| format!("Unable to save diagnostic report: {error}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::{loopback_get, supported_reading};
    use std::path::Path;

    #[test]
    fn accepts_only_supported_reading_extensions() {
        assert!(supported_reading(Path::new("材料.MD")));
        assert!(supported_reading(Path::new("notes.markdown")));
        assert!(supported_reading(Path::new("plain.txt")));
        assert!(!supported_reading(Path::new("payload.exe")));
        assert!(!supported_reading(Path::new("no-extension")));
    }

    #[test]
    fn rejects_non_api_native_requests_before_connecting() {
        assert!(loopback_get(9, "/not-api").unwrap_err().contains("invalid"));
        assert!(loopback_get(9, "/api/status\r\nInjected: true")
            .unwrap_err()
            .contains("invalid"));
    }
}
