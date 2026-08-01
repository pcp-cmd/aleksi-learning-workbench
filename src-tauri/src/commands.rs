use crate::runtime::{DesktopRuntime, RuntimeSnapshot, DESKTOP_ORIGIN, PROTOCOL_SECRET_HEADER};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::TcpStream;
use std::path::Path;
use std::process::Command;
use std::time::Duration;
use tauri::{AppHandle, State};

#[cfg(windows)]
use std::ffi::OsString;
#[cfg(windows)]
use std::os::windows::ffi::OsStringExt;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use std::path::PathBuf;
#[cfg(windows)]
use windows_sys::Win32::System::SystemInformation::GetWindowsDirectoryW;

const MAX_READING_BYTES: u64 = 128 * 1024 * 1024;
const READING_PREVIEW_BYTES: u64 = 64 * 1024;
const READING_PART_BYTES: u64 = 512 * 1024;
const MAX_NATIVE_RESPONSE_BYTES: u64 = 2 * 1024 * 1024;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedReading {
    handle_id: String,
    file_name: String,
    preview: String,
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

fn loopback_get_request(port: u16, path: &str, protocol_secret: &str) -> Result<String, String> {
    if !path.starts_with("/api/") || path.contains(['\r', '\n']) {
        return Err("Native API path is invalid".into());
    }
    Ok(format!(
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: {DESKTOP_ORIGIN}\r\n{PROTOCOL_SECRET_HEADER}: {protocol_secret}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    ))
}

fn loopback_get(port: u16, path: &str, protocol_secret: &str) -> Result<Vec<u8>, String> {
    let request = loopback_get_request(port, path, protocol_secret)?;
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

fn selected_reading_metadata(path: &Path) -> Result<std::fs::Metadata, String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|error| format!("无法读取所选文件: {error}"))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("所选路径不是普通文件".into());
    }
    if metadata.len() == 0 {
        return Err("文件中没有可导入的文本内容".into());
    }
    if metadata.len() > MAX_READING_BYTES {
        return Err("所选文件超过 128 MB 安全上限".into());
    }
    Ok(metadata)
}

fn read_reading_range(path: &Path, offset: u64, length: u64) -> Result<Vec<u8>, String> {
    if length == 0 || length > READING_PART_BYTES {
        return Err("单次文件读取必须介于 1 字节与 512 KiB 之间".into());
    }
    let metadata = selected_reading_metadata(path)?;
    if offset > metadata.len() || length > metadata.len().saturating_sub(offset) {
        return Err("文件读取范围超出所选材料".into());
    }
    let mut file = fs::File::open(path).map_err(|error| format!("无法读取所选文件: {error}"))?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| format!("无法定位所选文件: {error}"))?;
    let mut bytes = vec![0_u8; length as usize];
    file.read_exact(&mut bytes)
        .map_err(|error| format!("无法读取所选文件: {error}"))?;
    Ok(bytes)
}

fn read_reading_preview(path: &Path) -> Result<(String, u64), String> {
    let metadata = selected_reading_metadata(path)?;
    let preview_length = metadata.len().min(READING_PREVIEW_BYTES);
    let bytes = read_reading_range(path, 0, preview_length)?;
    let preview = match std::str::from_utf8(&bytes) {
        Ok(value) => value,
        Err(error) if error.error_len().is_none() && preview_length < metadata.len() => {
            std::str::from_utf8(&bytes[..error.valid_up_to()])
                .map_err(|_| "文件开头不是有效的 UTF-8 文本")?
        }
        Err(_) => return Err("文件开头不是有效的 UTF-8 文本，请先转换编码后再导入".into()),
    };
    let preview = preview
        .strip_prefix('\u{feff}')
        .unwrap_or(preview)
        .to_string();
    if preview.trim().is_empty() {
        return Err("文件中没有可导入的文本内容".into());
    }
    if preview.contains('\0') {
        return Err("文件包含不受支持的空字符".into());
    }
    Ok((preview, metadata.len()))
}

#[cfg(windows)]
fn windows_explorer_path() -> Result<PathBuf, String> {
    let mut buffer = [0_u16; 32_768];
    // SAFETY: `buffer` is writable for the advertised number of UTF-16 code
    // units and remains alive for the duration of the Windows API call.
    let length =
        unsafe { GetWindowsDirectoryW(buffer.as_mut_ptr(), buffer.len().try_into().unwrap()) };
    if length == 0 || length as usize >= buffer.len() {
        return Err("Unable to resolve the Windows system directory".into());
    }
    let windows_directory = PathBuf::from(OsString::from_wide(&buffer[..length as usize]));
    if !windows_directory.is_absolute() {
        return Err("Windows system directory is not absolute".into());
    }
    let explorer = windows_directory.join("explorer.exe");
    if !explorer.is_file() {
        return Err("Windows Explorer is unavailable in the system directory".into());
    }
    Ok(explorer)
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
pub fn request_exit(app: AppHandle, runtime: State<'_, DesktopRuntime>) -> Result<(), String> {
    runtime.shutdown()?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn force_exit() -> Result<(), String> {
    std::process::exit(1)
}

#[tauri::command]
pub fn select_reading_file(
    runtime: State<'_, DesktopRuntime>,
) -> Result<Option<SelectedReading>, String> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("Markdown 或文本", &["md", "markdown", "txt"])
        .pick_file()
    else {
        return Ok(None);
    };
    if !supported_reading(&path) {
        return Err("只支持 .md、.markdown 或 .txt 文件".into());
    }

    let (preview, size) = read_reading_preview(&path)?;
    let metadata = selected_reading_metadata(&path)?;
    let handle_id = runtime.register_selected_reading(
        path.clone(),
        metadata.len(),
        metadata.modified().ok(),
    )?;

    Ok(Some(SelectedReading {
        handle_id,
        file_name: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("未命名材料")
            .to_string(),
        preview,
        size,
    }))
}

#[tauri::command]
pub fn read_selected_reading_part(
    runtime: State<'_, DesktopRuntime>,
    handle_id: String,
    offset: u64,
    length: u64,
) -> Result<Vec<u8>, String> {
    let selected = runtime.selected_reading_handle(&handle_id)?;
    let metadata = selected_reading_metadata(&selected.path)?;
    if metadata.len() != selected.size || metadata.modified().ok() != selected.modified {
        return Err("所选文件在导入期间发生变化，请重新选择后再导入".into());
    }
    read_reading_range(&selected.path, offset, length)
}

#[tauri::command]
pub fn select_learning_library() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn open_learning_library(runtime: State<'_, DesktopRuntime>) -> Result<(), String> {
    let (port, protocol_secret) = runtime.api_session()?;
    let response = loopback_get(port, "/api/vault/status", &protocol_secret)?;
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
        let mut command = Command::new(windows_explorer_path()?);
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
    let (port, protocol_secret) = runtime.api_session()?;
    let report = loopback_get(port, "/api/runtime/diagnostics", &protocol_secret)?;
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
    use super::{
        loopback_get, loopback_get_request, read_reading_preview, read_reading_range,
        selected_reading_metadata, supported_reading, MAX_READING_BYTES, READING_PART_BYTES,
        READING_PREVIEW_BYTES,
    };
    use std::fs::{remove_file, write, OpenOptions};
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[cfg(windows)]
    use super::windows_explorer_path;

    fn temporary_test_file(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "aleksi-command-{name}-{}-{unique}",
            std::process::id()
        ))
    }

    #[test]
    fn accepts_only_supported_reading_extensions() {
        assert!(supported_reading(Path::new("材料.MD")));
        assert!(supported_reading(Path::new("notes.markdown")));
        assert!(supported_reading(Path::new("plain.txt")));
        assert!(!supported_reading(Path::new("payload.exe")));
        assert!(!supported_reading(Path::new("no-extension")));
    }

    #[cfg(windows)]
    #[test]
    fn resolves_windows_explorer_without_searching_path() {
        let explorer = windows_explorer_path().expect("Windows Explorer path");
        assert!(explorer.is_absolute());
        assert!(explorer.is_file());
        assert_eq!(
            explorer.file_name().and_then(|name| name.to_str()),
            Some("explorer.exe")
        );
    }

    #[test]
    fn reads_only_a_bounded_preview_and_exact_requested_parts() {
        let path = temporary_test_file("reading-parts");
        let bytes = vec![b'a'; READING_PREVIEW_BYTES as usize + 16];
        write(&path, bytes).unwrap();
        let (preview, size) = read_reading_preview(&path).unwrap();
        assert_eq!(preview.len(), READING_PREVIEW_BYTES as usize);
        assert_eq!(size, READING_PREVIEW_BYTES + 16);
        assert_eq!(
            read_reading_range(&path, READING_PREVIEW_BYTES, 16).unwrap(),
            vec![b'a'; 16]
        );
        assert!(read_reading_range(&path, 0, READING_PART_BYTES + 1).is_err());
        remove_file(path).unwrap();
    }

    #[test]
    fn rejects_sources_above_the_central_safety_limit_without_loading_them() {
        let path = temporary_test_file("reading-oversized");
        let file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)
            .unwrap();
        file.set_len(MAX_READING_BYTES + 1).unwrap();
        drop(file);
        assert!(selected_reading_metadata(&path)
            .unwrap_err()
            .contains("128 MB"));
        remove_file(path).unwrap();
    }

    #[test]
    fn rejects_non_api_native_requests_before_connecting() {
        let secret = "a".repeat(64);
        assert!(loopback_get(9, "/not-api", &secret)
            .unwrap_err()
            .contains("invalid"));
        assert!(loopback_get(9, "/api/status\r\nInjected: true", &secret)
            .unwrap_err()
            .contains("invalid"));
    }

    #[test]
    fn native_request_authenticates_in_headers_not_the_url() {
        let secret = "a".repeat(64);
        let request = loopback_get_request(43127, "/api/vault/status", &secret).unwrap();

        assert!(request.starts_with("GET /api/vault/status HTTP/1.1"));
        assert!(request.contains("Origin: http://tauri.localhost\r\n"));
        assert!(request.contains(&format!("X-Aleksi-Protocol-Secret: {secret}\r\n")));
        assert!(!request.lines().next().unwrap().contains(&secret));
    }
}
