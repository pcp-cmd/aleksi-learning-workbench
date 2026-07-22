use serde::{Deserialize, Serialize};
use std::fs::{create_dir_all, read, read_to_string, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const READY_PREFIX: &str = "ALEKSI_READY ";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const MAX_FAILURE_LOG_BYTES: usize = 4 * 1024;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub mode: String,
    pub api_base_url: Option<String>,
    pub build_id: Option<String>,
    pub message: Option<String>,
}

impl RuntimeSnapshot {
    fn starting(build_id: String) -> Self {
        Self {
            mode: "starting".into(),
            api_base_url: None,
            build_id: Some(build_id),
            message: None,
        }
    }

    fn stopped(build_id: Option<String>) -> Self {
        Self {
            mode: "stopped".into(),
            api_base_url: None,
            build_id,
            message: None,
        }
    }

    fn crashed(build_id: Option<String>, message: String) -> Self {
        Self {
            mode: "crashed".into(),
            api_base_url: None,
            build_id,
            message: Some(message),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopIdentity {
    version: String,
    build_id: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ReadyRecord {
    host: String,
    port: u16,
    version: String,
    build_id: String,
}

#[derive(Clone)]
struct RuntimeConfiguration {
    app_data_library: PathBuf,
    app_settings_directory: PathBuf,
    default_library: PathBuf,
    identity: DesktopIdentity,
    log_directory: PathBuf,
    node_path: PathBuf,
    server_path: PathBuf,
}

struct RuntimeInner {
    child: Option<Child>,
    configuration: Option<RuntimeConfiguration>,
    generation: u64,
    snapshot: RuntimeSnapshot,
}

struct RuntimeShared {
    inner: Mutex<RuntimeInner>,
}

#[derive(Clone)]
pub struct DesktopRuntime {
    shared: Arc<RuntimeShared>,
}

impl Default for DesktopRuntime {
    fn default() -> Self {
        Self {
            shared: Arc::new(RuntimeShared {
                inner: Mutex::new(RuntimeInner {
                    child: None,
                    configuration: None,
                    generation: 0,
                    snapshot: RuntimeSnapshot::stopped(None),
                }),
            }),
        }
    }
}

fn lock_inner(shared: &RuntimeShared) -> MutexGuard<'_, RuntimeInner> {
    shared
        .inner
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn resource_file(app: &AppHandle, relative: &Path) -> Result<PathBuf, String> {
    let resource_directory = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Unable to resolve desktop resources: {error}"))?;
    let direct = resource_directory.join(relative);
    if direct.is_file() {
        return Ok(direct);
    }

    let nested = resource_directory.join("resources").join(relative);
    if nested.is_file() {
        return Ok(nested);
    }

    Err(format!(
        "Required desktop resource is missing: {}",
        relative.display()
    ))
}

fn runtime_configuration(app: &AppHandle) -> Result<RuntimeConfiguration, String> {
    let identity_path = resource_file(app, Path::new("identity.json"))?;
    let identity: DesktopIdentity = serde_json::from_str(
        &read_to_string(&identity_path)
            .map_err(|error| format!("Unable to read desktop identity: {error}"))?,
    )
    .map_err(|error| format!("Desktop identity is invalid: {error}"))?;
    let app_settings_directory = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Unable to resolve app data: {error}"))?;
    let app_data_library = app_settings_directory.join("library");
    let default_library = app
        .path()
        .document_dir()
        .map(|documents| documents.join("Aleksi Learning Workbench"))
        .unwrap_or_else(|_| app_data_library.clone());

    Ok(RuntimeConfiguration {
        app_data_library,
        node_path: resource_file(app, Path::new("sidecar/node.exe"))?,
        server_path: resource_file(app, Path::new("sidecar/server.cjs"))?,
        log_directory: app_settings_directory.join("logs"),
        app_settings_directory: app_settings_directory.join("settings"),
        default_library,
        identity,
    })
}

fn parse_ready_line(
    line: &str,
    expected_identity: &DesktopIdentity,
) -> Result<Option<ReadyRecord>, String> {
    let Some(payload) = line.strip_prefix(READY_PREFIX) else {
        return Ok(None);
    };
    let ready: ReadyRecord = serde_json::from_str(payload)
        .map_err(|error| format!("Sidecar readiness record is invalid: {error}"))?;
    if ready.host != "127.0.0.1" {
        return Err("Sidecar readiness host is not IPv4 loopback".into());
    }
    if ready.version != expected_identity.version || ready.build_id != expected_identity.build_id {
        return Err("Sidecar build identity does not match the desktop shell".into());
    }
    Ok(Some(ready))
}


fn recent_log_tail(path: &Path) -> Option<String> {
    let data = read(path).ok()?;
    let start = data.len().saturating_sub(MAX_FAILURE_LOG_BYTES);
    let text = String::from_utf8_lossy(&data[start..]);
    let lines: Vec<_> = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    if lines.is_empty() {
        return None;
    }
    let start_line = lines.len().saturating_sub(6);
    Some(lines[start_line..].join(" | "))
}

fn sidecar_exit_message(configuration: &RuntimeConfiguration) -> String {
    let stderr_path = configuration.log_directory.join("sidecar.stderr.log");
    recent_log_tail(&stderr_path)
        .map(|tail| format!("本地服务意外退出：{tail}"))
        .unwrap_or_else(|| "本地服务意外退出，错误日志为空".into())
}

fn mark_crashed(shared: &RuntimeShared, generation: u64, message: String) {
    let mut inner = lock_inner(shared);
    if inner.generation != generation {
        return;
    }
    if inner.snapshot.mode == "starting" || inner.snapshot.mode == "ready" {
        inner.snapshot = RuntimeSnapshot::crashed(inner.snapshot.build_id.clone(), message);
    }
}

fn follow_sidecar_stdout(
    shared: Arc<RuntimeShared>,
    generation: u64,
    stdout: impl std::io::Read,
    configuration: RuntimeConfiguration,
) {
    let log_path = configuration.log_directory.join("sidecar.stdout.log");
    let mut log = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(log_path)
        .ok();

    for line in BufReader::new(stdout).lines() {
        let line = match line {
            Ok(line) => line,
            Err(error) => {
                mark_crashed(
                    &shared,
                    generation,
                    format!("Unable to read sidecar output: {error}"),
                );
                return;
            }
        };
        if let Some(file) = log.as_mut() {
            let _ = writeln!(file, "{line}");
        }

        match parse_ready_line(&line, &configuration.identity) {
            Ok(Some(ready)) => {
                let mut inner = lock_inner(&shared);
                if inner.generation == generation && inner.snapshot.mode == "starting" {
                    inner.snapshot = RuntimeSnapshot {
                        mode: "ready".into(),
                        api_base_url: Some(format!("http://{}:{}", ready.host, ready.port)),
                        build_id: Some(ready.build_id),
                        message: None,
                    };
                }
            }
            Ok(None) => {}
            Err(message) => {
                mark_crashed(&shared, generation, message);
                return;
            }
        }
    }

    mark_crashed(
        &shared,
        generation,
        sidecar_exit_message(&configuration),
    );
}

fn send_shutdown_request(port: u16) {
    let Ok(mut stream) = TcpStream::connect_timeout(
        &format!("127.0.0.1:{port}")
            .parse()
            .expect("valid loopback address"),
        Duration::from_millis(350),
    ) else {
        return;
    };
    let body = r#"{"confirmed":true}"#;
    let request = format!(
        "POST /api/runtime/exit HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(request.as_bytes());
    let _ = stream.flush();
}

impl DesktopRuntime {
    pub fn record_start_failure(&self, message: String) {
        let mut inner = lock_inner(&self.shared);
        inner.snapshot = RuntimeSnapshot::crashed(inner.snapshot.build_id.clone(), message);
    }

    pub fn api_port(&self) -> Result<u16, String> {
        self.snapshot()
            .api_base_url
            .as_deref()
            .and_then(|url| url.rsplit(':').next())
            .and_then(|value| value.parse::<u16>().ok())
            .ok_or_else(|| "Local sidecar is not ready".to_string())
    }

    pub fn start(&self, app: &AppHandle) -> Result<(), String> {
        let configuration = runtime_configuration(app)?;
        create_dir_all(&configuration.log_directory)
            .map_err(|error| format!("Unable to create desktop log directory: {error}"))?;
        create_dir_all(&configuration.app_settings_directory)
            .map_err(|error| format!("Unable to create desktop settings directory: {error}"))?;

        let generation = {
            let mut inner = lock_inner(&self.shared);
            if inner.snapshot.mode == "starting" {
                return Ok(());
            }
            if let Some(existing) = inner.child.as_mut() {
                if existing
                    .try_wait()
                    .map_err(|error| format!("Unable to inspect existing sidecar: {error}"))?
                    .is_none()
                {
                    return Ok(());
                }
            }
            inner.child = None;
            inner.generation = inner.generation.wrapping_add(1);
            inner.configuration = Some(configuration.clone());
            inner.snapshot = RuntimeSnapshot::starting(configuration.identity.build_id.clone());
            inner.generation
        };

        let stderr_path = configuration.log_directory.join("sidecar.stderr.log");
        let stderr_file = match OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(stderr_path)
        {
            Ok(file) => file,
            Err(error) => {
                let message = format!("Unable to open sidecar error log: {error}");
                mark_crashed(&self.shared, generation, message.clone());
                return Err(message);
            }
        };

        let server_file_name = configuration
            .server_path
            .file_name()
            .ok_or_else(|| "Sidecar entrypoint filename is invalid".to_string())?;
        let mut command = Command::new(&configuration.node_path);
        command
            .arg(server_file_name)
            .current_dir(
                configuration
                    .server_path
                    .parent()
                    .ok_or_else(|| "Sidecar resource directory is invalid".to_string())?,
            )
            .env("ALEKSI_DESKTOP_SIDECAR", "1")
            .env("ALEKSI_RUNTIME_MODE", "tauri-desktop")
            .env("ALEKSI_SERVER_PORT", "0")
            .env(
                "ALEKSI_APP_SETTINGS_DIR",
                &configuration.app_settings_directory,
            )
            .env("ALEKSI_DEFAULT_VAULT_PATH", &configuration.default_library)
            .env(
                "ALEKSI_APP_DATA_VAULT_PATH",
                &configuration.app_data_library,
            )
            .env("ALEKSI_APP_VERSION", &configuration.identity.version)
            .env("ALEKSI_BUILD_ID", &configuration.identity.build_id)
            .env("ALEKSI_RUNTIME_LOG_DIR", &configuration.log_directory)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::from(stderr_file));
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                let message = format!("Unable to start local sidecar: {error}");
                mark_crashed(&self.shared, generation, message.clone());
                return Err(message);
            }
        };
        let stdout = match child.stdout.take() {
            Some(stdout) => stdout,
            None => {
                let _ = child.kill();
                let _ = child.wait();
                let message = "Sidecar stdout is unavailable".to_string();
                mark_crashed(&self.shared, generation, message.clone());
                return Err(message);
            }
        };

        {
            let mut inner = lock_inner(&self.shared);
            if inner.generation != generation || inner.snapshot.mode != "starting" {
                drop(inner);
                let _ = child.kill();
                let _ = child.wait();
                return Ok(());
            }
            inner.child = Some(child);
        }

        let shared = Arc::clone(&self.shared);
        thread::spawn(move || {
            follow_sidecar_stdout(shared, generation, stdout, configuration)
        });
        Ok(())
    }

    pub fn snapshot(&self) -> RuntimeSnapshot {
        let mut inner = lock_inner(&self.shared);
        let exit_status = inner
            .child
            .as_mut()
            .and_then(|child| child.try_wait().ok().flatten());
        if let Some(status) = exit_status {
            if inner.snapshot.mode != "stopped" && inner.snapshot.mode != "crashed" {
                let message = inner
                    .configuration
                    .as_ref()
                    .map(sidecar_exit_message)
                    .unwrap_or_else(|| format!("本地服务已退出：{status}"));
                inner.snapshot = RuntimeSnapshot::crashed(
                    inner.snapshot.build_id.clone(),
                    message,
                );
            }
        }
        inner.snapshot.clone()
    }

    pub fn shutdown(&self) {
        {
            let mut inner = lock_inner(&self.shared);
            inner.generation = inner.generation.wrapping_add(1);
        }

        let port = self
            .snapshot()
            .api_base_url
            .as_deref()
            .and_then(|url| url.rsplit(':').next())
            .and_then(|value| value.parse::<u16>().ok());
        if let Some(port) = port {
            send_shutdown_request(port);
        }

        for _ in 0..20 {
            let exited = {
                let mut inner = lock_inner(&self.shared);
                inner
                    .child
                    .as_mut()
                    .map(|child| child.try_wait().ok().flatten().is_some())
                    .unwrap_or(true)
            };
            if exited {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }

        let mut inner = lock_inner(&self.shared);
        if let Some(mut child) = inner.child.take() {
            if child.try_wait().ok().flatten().is_none() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        inner.snapshot = RuntimeSnapshot::stopped(inner.snapshot.build_id.clone());
    }

    pub fn restart(&self, app: &AppHandle) -> Result<(), String> {
        self.shutdown();
        self.start(app)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        lock_inner, mark_crashed, parse_ready_line, DesktopIdentity, ReadyRecord, RuntimeInner,
        RuntimeShared, RuntimeSnapshot,
    };
    use std::sync::Mutex;

    fn identity() -> DesktopIdentity {
        DesktopIdentity {
            version: "0.1.0".into(),
            build_id: "desktop-0123456789abcdefabcd".into(),
        }
    }

    #[test]
    fn accepts_only_matching_loopback_readiness() {
        let parsed = parse_ready_line(
            r#"ALEKSI_READY {"host":"127.0.0.1","port":43127,"version":"0.1.0","buildId":"desktop-0123456789abcdefabcd"}"#,
            &identity(),
        )
        .unwrap();

        assert_eq!(
            parsed,
            Some(ReadyRecord {
                host: "127.0.0.1".into(),
                port: 43127,
                version: "0.1.0".into(),
                build_id: "desktop-0123456789abcdefabcd".into(),
            })
        );
    }

    #[test]
    fn ignores_crash_reports_from_stale_sidecar_generations() {
        let shared = RuntimeShared {
            inner: Mutex::new(RuntimeInner {
                child: None,
                configuration: None,
                generation: 2,
                snapshot: RuntimeSnapshot::starting(
                    "desktop-0123456789abcdefabcd".into(),
                ),
            }),
        };

        mark_crashed(&shared, 1, "stale sidecar exited".into());
        assert_eq!(lock_inner(&shared).snapshot.mode, "starting");

        mark_crashed(&shared, 2, "current sidecar exited".into());
        let snapshot = lock_inner(&shared).snapshot.clone();
        assert_eq!(snapshot.mode, "crashed");
        assert_eq!(snapshot.message.as_deref(), Some("current sidecar exited"));
    }

    #[test]
    fn rejects_non_loopback_or_mismatched_identity() {
        let wrong_host = r#"ALEKSI_READY {"host":"0.0.0.0","port":43127,"version":"0.1.0","buildId":"desktop-0123456789abcdefabcd"}"#;
        assert!(parse_ready_line(wrong_host, &identity())
            .unwrap_err()
            .contains("loopback"));

        let wrong_build = r#"ALEKSI_READY {"host":"127.0.0.1","port":43127,"version":"0.1.0","buildId":"desktop-wrong"}"#;
        assert!(parse_ready_line(wrong_build, &identity())
            .unwrap_err()
            .contains("identity"));
    }
}
