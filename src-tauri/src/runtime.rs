use crate::runtime_diagnostics::{
    bounded_utf8_tail, recent_log_tail, redact_known_secret, sanitize_diagnostic_message,
    write_redacted_log, MAX_FAILURE_LOG_BYTES,
};
use crate::selected_readings::{SelectedReadingHandle, SelectedReadingHandles};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::ffi::{OsStr, OsString};
use std::fs::{create_dir_all, read_to_string, remove_file, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Manager};

#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
#[cfg(windows)]
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

const READY_PREFIX: &str = "ALEKSI_READY ";
const DESKTOP_LIFECYCLE_LOG: &str = "desktop-lifecycle.log";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const SIDECAR_READINESS_TIMEOUT: Duration = Duration::from_secs(45);
const SIDECAR_TERMINATION_POLL: Duration = Duration::from_millis(20);
const SIDECAR_TERMINATION_POLLS: usize = 100;
const COMPILED_DESKTOP_IDENTITY_JSON: &str = include_str!("../resources/identity.json");
const ALLOWED_PARENT_ENVIRONMENT: &[&str] = &[
    "APPDATA",
    "HOMEDRIVE",
    "HOMEPATH",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "SystemDrive",
    "SystemRoot",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "WINDIR",
];
pub(crate) const DESKTOP_PROTOCOL_VERSION: u32 = 1;
pub(crate) const DESKTOP_ORIGIN: &str = "http://tauri.localhost";
pub(crate) const PROTOCOL_SECRET_HEADER: &str = "X-Aleksi-Protocol-Secret";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RuntimeProcessState {
    Starting,
    Running,
    Stopping,
    StopFailed,
    Stopped,
    Crashed,
}

impl RuntimeProcessState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Starting => "starting",
            Self::Running => "ready",
            Self::Stopping => "stopping",
            Self::StopFailed => "stop-failed",
            Self::Stopped => "stopped",
            Self::Crashed => "crashed",
        }
    }
}

#[derive(Debug)]
struct ShutdownError {
    operation: &'static str,
    message: String,
}

impl ShutdownError {
    fn new(operation: &'static str, error: impl std::fmt::Display) -> Self {
        Self {
            operation,
            message: error.to_string(),
        }
    }
}

impl std::fmt::Display for ShutdownError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "Unable to stop local sidecar during {}: {}",
            self.operation, self.message
        )
    }
}

#[derive(Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub mode: String,
    pub api_base_url: Option<String>,
    pub build_id: Option<String>,
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocol_secret: Option<String>,
}

impl RuntimeSnapshot {
    fn starting(build_id: String) -> Self {
        Self {
            mode: RuntimeProcessState::Starting.as_str().into(),
            api_base_url: None,
            build_id: Some(build_id),
            message: None,
            protocol_secret: None,
        }
    }

    fn stopped(build_id: Option<String>) -> Self {
        Self {
            mode: RuntimeProcessState::Stopped.as_str().into(),
            api_base_url: None,
            build_id,
            message: None,
            protocol_secret: None,
        }
    }

    fn crashed(build_id: Option<String>, message: String) -> Self {
        Self {
            mode: RuntimeProcessState::Crashed.as_str().into(),
            api_base_url: None,
            build_id,
            message: Some(message),
            protocol_secret: None,
        }
    }

    fn stopping(build_id: Option<String>) -> Self {
        Self {
            mode: RuntimeProcessState::Stopping.as_str().into(),
            api_base_url: None,
            build_id,
            message: None,
            protocol_secret: None,
        }
    }

    fn stop_failed(build_id: Option<String>, message: String) -> Self {
        Self {
            mode: RuntimeProcessState::StopFailed.as_str().into(),
            api_base_url: None,
            build_id,
            message: Some(message),
            protocol_secret: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct DesktopIdentity {
    version: String,
    protocol_version: u32,
    shell_build_id: String,
    sidecar_build_id: String,
    build_id: String,
    files: Vec<DesktopIdentityFile>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct DesktopIdentityFile {
    path: String,
    bytes: u64,
    sha256: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ReadyRecord {
    host: String,
    port: u16,
    version: String,
    protocol_version: u32,
    shell_build_id: String,
    sidecar_build_id: String,
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

#[cfg(windows)]
struct SidecarJob {
    handle: HANDLE,
}

#[cfg(windows)]
unsafe impl Send for SidecarJob {}

#[cfg(windows)]
impl SidecarJob {
    fn new() -> Result<Self, String> {
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(format!(
                "Unable to create sidecar process job: {}",
                std::io::Error::last_os_error()
            ));
        }

        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                std::ptr::addr_of!(limits).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if configured == 0 {
            let error = std::io::Error::last_os_error();
            unsafe {
                CloseHandle(handle);
            }
            return Err(format!("Unable to configure sidecar process job: {error}"));
        }

        Ok(Self { handle })
    }

    fn assign(&self, child: &Child) -> Result<(), String> {
        let process_handle = child.as_raw_handle() as HANDLE;
        if unsafe { AssignProcessToJobObject(self.handle, process_handle) } == 0 {
            return Err(format!(
                "Unable to bind sidecar to its process job: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(())
    }

    fn terminate(&self) -> Result<(), String> {
        if unsafe { TerminateJobObject(self.handle, 1) } == 0 {
            return Err(format!(
                "Unable to terminate sidecar process job: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(())
    }
}

#[cfg(windows)]
impl Drop for SidecarJob {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.handle);
        }
    }
}

struct SidecarProcess {
    child: Child,
    #[cfg(windows)]
    job: SidecarJob,
}

impl SidecarProcess {
    fn try_wait(&mut self) -> std::io::Result<Option<std::process::ExitStatus>> {
        self.child.try_wait()
    }

    fn terminate_and_wait(&mut self) -> Result<std::process::ExitStatus, ShutdownError> {
        if let Some(status) = self
            .child
            .try_wait()
            .map_err(|error| ShutdownError::new("initial status check", error))?
        {
            return Ok(status);
        }
        {
            #[cfg(windows)]
            {
                if let Err(job_error) = self.job.terminate() {
                    self.child.kill().map_err(|kill_error| {
                        ShutdownError::new(
                            "job termination and process kill",
                            format!("{job_error}; fallback kill failed: {kill_error}"),
                        )
                    })?;
                }
            }
            #[cfg(not(windows))]
            {
                self.child
                    .kill()
                    .map_err(|error| ShutdownError::new("process kill", error))?;
            }
        }
        for _ in 0..SIDECAR_TERMINATION_POLLS {
            if let Some(status) = self
                .child
                .try_wait()
                .map_err(|error| ShutdownError::new("termination status check", error))?
            {
                return Ok(status);
            }
            thread::sleep(SIDECAR_TERMINATION_POLL);
        }
        self.child
            .kill()
            .map_err(|error| ShutdownError::new("forced process kill", error))?;
        for _ in 0..SIDECAR_TERMINATION_POLLS {
            if let Some(status) = self
                .child
                .try_wait()
                .map_err(|error| ShutdownError::new("forced termination status check", error))?
            {
                return Ok(status);
            }
            thread::sleep(SIDECAR_TERMINATION_POLL);
        }
        Err(ShutdownError::new(
            "forced termination timeout",
            "the process did not report an exit status",
        ))
    }

    fn wait_for_exit(&mut self) {
        let _ = self.child.wait();
    }
}

struct RuntimeInner {
    active_protocol_secret: Option<String>,
    child: Option<SidecarProcess>,
    configuration: Option<RuntimeConfiguration>,
    generation: u64,
    readiness_deadline: Option<Instant>,
    snapshot: RuntimeSnapshot,
}

struct RuntimeShared {
    inner: Mutex<RuntimeInner>,
    lifecycle: Mutex<()>,
    selected_readings: SelectedReadingHandles,
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
                    active_protocol_secret: None,
                    child: None,
                    configuration: None,
                    generation: 0,
                    readiness_deadline: None,
                    snapshot: RuntimeSnapshot::stopped(None),
                }),
                lifecycle: Mutex::new(()),
                selected_readings: SelectedReadingHandles::default(),
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

fn lock_lifecycle(shared: &RuntimeShared) -> MutexGuard<'_, ()> {
    shared
        .lifecycle
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

fn canonical_allowed_environment_key(key: &OsStr) -> Option<&'static str> {
    let key = key.to_str()?;
    ALLOWED_PARENT_ENVIRONMENT
        .iter()
        .copied()
        .find(|allowed| key.eq_ignore_ascii_case(allowed))
}

fn sanitized_parent_environment<I>(environment: I) -> Vec<(OsString, OsString)>
where
    I: IntoIterator<Item = (OsString, OsString)>,
{
    let mut selected = std::collections::BTreeMap::<&'static str, OsString>::new();
    for (key, value) in environment {
        if let Some(canonical_key) = canonical_allowed_environment_key(&key) {
            selected.insert(canonical_key, value);
        }
    }
    selected
        .into_iter()
        .map(|(key, value)| (OsString::from(key), value))
        .collect()
}

fn apply_sanitized_parent_environment_from<I>(
    command: &mut Command,
    parent_environment: I,
) -> Result<(), String>
where
    I: IntoIterator<Item = (OsString, OsString)>,
{
    let environment = sanitized_parent_environment(parent_environment);
    let system_root = environment
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case("SystemRoot"))
        .map(|(_, value)| PathBuf::from(value))
        .ok_or_else(|| "Windows SystemRoot is unavailable for the local sidecar".to_string())?;
    if !system_root.is_absolute() {
        return Err("Windows SystemRoot is not an absolute path".into());
    }

    let search_path = std::env::join_paths([system_root.join("System32"), system_root])
        .map_err(|error| format!("Unable to construct the local sidecar search path: {error}"))?;

    command.env_clear();
    command.envs(environment);
    command.env("NODE_ENV", "production");
    command.env("PATH", search_path);
    command.env("PATHEXT", ".COM;.EXE;.BAT;.CMD");
    Ok(())
}

fn apply_sanitized_parent_environment(command: &mut Command) -> Result<(), String> {
    apply_sanitized_parent_environment_from(command, std::env::vars_os())
}

fn validate_desktop_identity(
    installed: &DesktopIdentity,
    compiled: &DesktopIdentity,
    app_version: &str,
) -> Result<(), String> {
    if installed != compiled {
        return Err("Desktop resource identity does not match the compiled desktop shell".into());
    }
    if installed.version != app_version {
        return Err(format!(
            "Desktop resource version {} does not match application package version {app_version}",
            installed.version
        ));
    }
    if installed.protocol_version != DESKTOP_PROTOCOL_VERSION {
        return Err(format!(
            "Desktop protocol {} is incompatible with shell protocol {}",
            installed.protocol_version, DESKTOP_PROTOCOL_VERSION
        ));
    }
    if installed.build_id != installed.shell_build_id {
        return Err("Desktop resource build alias does not match the shell build identity".into());
    }
    Ok(())
}

fn identity_file<'a>(
    identity: &'a DesktopIdentity,
    logical_path: &str,
) -> Result<&'a DesktopIdentityFile, String> {
    let mut matches = identity
        .files
        .iter()
        .filter(|file| file.path == logical_path);
    let resource = matches
        .next()
        .ok_or_else(|| format!("Desktop identity is missing {logical_path}"))?;
    if matches.next().is_some() {
        return Err(format!(
            "Desktop identity contains duplicate entries for {logical_path}"
        ));
    }
    if resource.sha256.len() != 64
        || !resource
            .sha256
            .bytes()
            .all(|character| character.is_ascii_digit() || (b'a'..=b'f').contains(&character))
    {
        return Err(format!(
            "Desktop identity contains an invalid SHA-256 for {logical_path}"
        ));
    }
    Ok(resource)
}

fn verify_resource_file(path: &Path, expected: &DesktopIdentityFile) -> Result<(), String> {
    let metadata = path.metadata().map_err(|error| {
        format!(
            "Unable to inspect desktop resource {}: {error}",
            expected.path
        )
    })?;
    if !metadata.is_file() {
        return Err(format!(
            "Desktop resource {} is not a regular file",
            expected.path
        ));
    }
    if metadata.len() != expected.bytes {
        return Err(format!(
            "Desktop resource {} byte length is {}, expected {}",
            expected.path,
            metadata.len(),
            expected.bytes
        ));
    }

    let mut file = File::open(path)
        .map_err(|error| format!("Unable to read desktop resource {}: {error}", expected.path))?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|error| {
            format!("Unable to read desktop resource {}: {error}", expected.path)
        })?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    let actual_sha256 = hex::encode(digest.finalize());
    if actual_sha256 != expected.sha256 {
        return Err(format!(
            "Desktop resource {} SHA-256 does not match the compiled desktop identity",
            expected.path
        ));
    }
    Ok(())
}

fn verify_runtime_resources(configuration: &RuntimeConfiguration) -> Result<(), String> {
    let node = identity_file(&configuration.identity, "sidecar/node.exe")?;
    let server = identity_file(&configuration.identity, "sidecar/server.cjs")?;
    verify_resource_file(&configuration.node_path, node)?;
    verify_resource_file(&configuration.server_path, server)?;

    let expected_sidecar_build_id = format!("sidecar-{}", &server.sha256[..20]);
    if configuration.identity.sidecar_build_id != expected_sidecar_build_id {
        return Err(
            "Desktop sidecar build identity is not bound to the verified server resource".into(),
        );
    }
    Ok(())
}

fn runtime_configuration(app: &AppHandle) -> Result<RuntimeConfiguration, String> {
    let identity_path = resource_file(app, Path::new("identity.json"))?;
    let identity: DesktopIdentity = serde_json::from_str(
        &read_to_string(&identity_path)
            .map_err(|error| format!("Unable to read desktop identity: {error}"))?,
    )
    .map_err(|error| format!("Desktop identity is invalid: {error}"))?;
    let compiled_identity: DesktopIdentity =
        serde_json::from_str(COMPILED_DESKTOP_IDENTITY_JSON)
            .map_err(|error| format!("Compiled desktop identity is invalid: {error}"))?;
    validate_desktop_identity(
        &identity,
        &compiled_identity,
        &app.package_info().version.to_string(),
    )?;
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
    if ready.protocol_version != expected_identity.protocol_version {
        return Err("Sidecar protocol version does not match the desktop shell".into());
    }
    if ready.version != expected_identity.version {
        return Err("Sidecar version does not match the desktop shell".into());
    }
    if ready.shell_build_id != expected_identity.shell_build_id {
        return Err("Sidecar shell build identity does not match the desktop shell".into());
    }
    if ready.sidecar_build_id != expected_identity.sidecar_build_id {
        return Err("Packaged sidecar build identity does not match the desktop shell".into());
    }
    Ok(Some(ready))
}

fn generate_protocol_secret() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|error| format!("Unable to create sidecar protocol secret: {error}"))?;
    Ok(hex::encode(bytes))
}

fn sidecar_exit_message(
    configuration: &RuntimeConfiguration,
    protocol_secret: Option<&str>,
) -> String {
    let stderr_path = configuration.log_directory.join("sidecar.stderr.log");
    recent_log_tail(&stderr_path, protocol_secret)
        .map(|tail| format!("本地服务意外退出：{tail}"))
        .unwrap_or_else(|| "本地服务意外退出，错误日志为空".into())
}

fn mark_crashed(shared: &RuntimeShared, generation: u64, message: String) {
    let mut inner = lock_inner(shared);
    if inner.generation != generation {
        return;
    }
    if inner.snapshot.mode == "starting" || inner.snapshot.mode == "ready" {
        let message = redact_known_secret(&message, inner.active_protocol_secret.as_deref());
        inner.snapshot = RuntimeSnapshot::crashed(inner.snapshot.build_id.clone(), message);
        inner.active_protocol_secret = None;
        inner.readiness_deadline = None;
    }
}

fn fail_generation(shared: &RuntimeShared, generation: u64, message: String) {
    let mut inner = lock_inner(shared);
    if inner.generation != generation
        || (inner.snapshot.mode != "starting" && inner.snapshot.mode != "ready")
    {
        return;
    }
    let message = redact_known_secret(&message, inner.active_protocol_secret.as_deref());
    inner.readiness_deadline = None;
    let termination = match inner.child.as_mut() {
        Some(process) => process.terminate_and_wait().map(|_| ()),
        None => Ok(()),
    };
    match termination {
        Ok(()) => {
            inner.child = None;
            inner.active_protocol_secret = None;
            inner.snapshot = RuntimeSnapshot::crashed(inner.snapshot.build_id.clone(), message);
        }
        Err(error) => {
            inner.active_protocol_secret = None;
            inner.snapshot = RuntimeSnapshot::stop_failed(
                inner.snapshot.build_id.clone(),
                format!("{message}; {error}"),
            );
        }
    }
}

fn terminate_failed_start(
    shared: &RuntimeShared,
    generation: u64,
    mut process: SidecarProcess,
    message: String,
) -> String {
    match process.terminate_and_wait() {
        Ok(_) => {
            mark_crashed(shared, generation, message.clone());
            message
        }
        Err(error) => {
            let combined = format!("{message}; {error}");
            let mut inner = lock_inner(shared);
            if inner.generation == generation && inner.child.is_none() {
                inner.child = Some(process);
                inner.active_protocol_secret = None;
                inner.readiness_deadline = None;
                inner.snapshot =
                    RuntimeSnapshot::stop_failed(inner.snapshot.build_id.clone(), combined.clone());
            }
            combined
        }
    }
}

fn expire_starting_generation(shared: &RuntimeShared, generation: u64, now: Instant) {
    let mut inner = lock_inner(shared);
    let deadline_expired = inner
        .readiness_deadline
        .map(|deadline| now >= deadline)
        .unwrap_or(false);
    if inner.generation != generation || inner.snapshot.mode != "starting" || !deadline_expired {
        return;
    }
    let message = format!(
        "Sidecar readiness timed out after {} seconds",
        SIDECAR_READINESS_TIMEOUT.as_secs()
    );
    inner.readiness_deadline = None;
    let termination = match inner.child.as_mut() {
        Some(process) => process.terminate_and_wait().map(|_| ()),
        None => Ok(()),
    };
    match termination {
        Ok(()) => {
            inner.child = None;
            inner.active_protocol_secret = None;
            inner.snapshot = RuntimeSnapshot::crashed(inner.snapshot.build_id.clone(), message);
        }
        Err(error) => {
            inner.active_protocol_secret = None;
            inner.snapshot = RuntimeSnapshot::stop_failed(
                inner.snapshot.build_id.clone(),
                format!("{message}; {error}"),
            );
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ReadyDisposition {
    Accepted,
    Expired,
    Ignored,
}

fn record_ready(
    shared: &RuntimeShared,
    generation: u64,
    ready: ReadyRecord,
    protocol_secret: &str,
    now: Instant,
) -> ReadyDisposition {
    let mut inner = lock_inner(shared);
    if inner.generation != generation || inner.snapshot.mode != "starting" {
        return ReadyDisposition::Ignored;
    }
    if match inner.readiness_deadline {
        Some(deadline) => now >= deadline,
        None => true,
    } {
        return ReadyDisposition::Expired;
    }

    inner.snapshot = RuntimeSnapshot {
        mode: RuntimeProcessState::Running.as_str().into(),
        api_base_url: Some(format!("http://{}:{}", ready.host, ready.port)),
        build_id: Some(ready.shell_build_id),
        message: None,
        protocol_secret: Some(protocol_secret.to_string()),
    };
    inner.readiness_deadline = None;
    ReadyDisposition::Accepted
}

fn follow_sidecar_stdout(
    shared: Arc<RuntimeShared>,
    generation: u64,
    stdout: impl std::io::Read,
    configuration: RuntimeConfiguration,
    protocol_secret: String,
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
                fail_generation(
                    &shared,
                    generation,
                    format!("Unable to read sidecar output: {error}"),
                );
                return;
            }
        };
        if let Some(file) = log.as_mut() {
            let _ = writeln!(
                file,
                "{}",
                redact_known_secret(&line, Some(&protocol_secret))
            );
        }

        match parse_ready_line(&line, &configuration.identity) {
            Ok(Some(ready)) => {
                if record_ready(&shared, generation, ready, &protocol_secret, Instant::now())
                    == ReadyDisposition::Expired
                {
                    fail_generation(
                        &shared,
                        generation,
                        format!(
                            "Sidecar readiness timed out after {} seconds",
                            SIDECAR_READINESS_TIMEOUT.as_secs()
                        ),
                    );
                    return;
                }
            }
            Ok(None) => {}
            Err(message) => {
                fail_generation(&shared, generation, message);
                return;
            }
        }
    }

    fail_generation(
        &shared,
        generation,
        sidecar_exit_message(&configuration, Some(&protocol_secret)),
    );
}

fn shutdown_http_request(port: u16, protocol_secret: &str) -> String {
    let body = r#"{"confirmed":true}"#;
    format!(
        "POST /api/runtime/exit HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: {DESKTOP_ORIGIN}\r\n{PROTOCOL_SECRET_HEADER}: {protocol_secret}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

fn send_shutdown_request(port: u16, protocol_secret: &str) {
    let Ok(mut stream) = TcpStream::connect_timeout(
        &format!("127.0.0.1:{port}")
            .parse()
            .expect("valid loopback address"),
        Duration::from_millis(350),
    ) else {
        return;
    };
    let request = shutdown_http_request(port, protocol_secret);
    let _ = stream.write_all(request.as_bytes());
    let _ = stream.flush();
}

impl DesktopRuntime {
    pub fn register_selected_reading(
        &self,
        path: PathBuf,
        size: u64,
        modified: Option<SystemTime>,
    ) -> Result<String, String> {
        self.shared.selected_readings.register(path, size, modified)
    }

    pub fn selected_reading_handle(
        &self,
        handle_id: &str,
    ) -> Result<SelectedReadingHandle, String> {
        self.shared.selected_readings.get(handle_id)
    }

    pub fn record_start_failure(&self, message: String) {
        let generation = lock_inner(&self.shared).generation;
        fail_generation(&self.shared, generation, message);
    }

    pub fn api_session(&self) -> Result<(u16, String), String> {
        let inner = lock_inner(&self.shared);
        if inner.snapshot.mode != "ready" {
            return Err("Local sidecar is not ready".into());
        }
        let port = inner
            .snapshot
            .api_base_url
            .as_deref()
            .and_then(|url| url.rsplit(':').next())
            .and_then(|value| value.parse::<u16>().ok())
            .ok_or_else(|| "Local sidecar is not ready".to_string())?;
        let protocol_secret = inner
            .snapshot
            .protocol_secret
            .clone()
            .ok_or_else(|| "Local sidecar authentication is unavailable".to_string())?;
        Ok((port, protocol_secret))
    }

    pub fn record_destroyed_window_shutdown_failure(&self, message: &str) -> Result<(), String> {
        let (log_directory, protocol_secret) = {
            let inner = lock_inner(&self.shared);
            (
                inner
                    .configuration
                    .as_ref()
                    .map(|configuration| configuration.log_directory.clone())
                    .ok_or_else(|| "Desktop runtime log directory is unavailable".to_string())?,
                inner.active_protocol_secret.clone(),
            )
        };
        let sanitized = sanitize_diagnostic_message(message, protocol_secret.as_deref());
        const PREFIX: &str = "destroyed-window shutdown failed: ";
        let message_budget = MAX_FAILURE_LOG_BYTES.saturating_sub(PREFIX.len() + 1);
        let bounded = bounded_utf8_tail(&sanitized, message_budget);
        create_dir_all(&log_directory)
            .map_err(|_| "Unable to create the desktop diagnostic directory".to_string())?;
        let mut log = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(log_directory.join(DESKTOP_LIFECYCLE_LOG))
            .map_err(|_| "Unable to persist the desktop lifecycle diagnostic".to_string())?;
        writeln!(log, "{PREFIX}{bounded}")
            .map_err(|_| "Unable to persist the desktop lifecycle diagnostic".to_string())
    }

    pub fn clear_destroyed_window_shutdown_failure(&self) -> Result<(), String> {
        let log_path = {
            let inner = lock_inner(&self.shared);
            inner
                .configuration
                .as_ref()
                .map(|configuration| configuration.log_directory.join(DESKTOP_LIFECYCLE_LOG))
        };
        let Some(log_path) = log_path else {
            return Ok(());
        };
        match remove_file(log_path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err("Unable to clear the desktop lifecycle diagnostic".into()),
        }
    }

    pub fn start(&self, app: &AppHandle) -> Result<(), String> {
        let _lifecycle = lock_lifecycle(&self.shared);
        let configuration = runtime_configuration(app)?;
        let server_file_name = configuration
            .server_path
            .file_name()
            .ok_or_else(|| "Sidecar entrypoint filename is invalid".to_string())?
            .to_os_string();
        let sidecar_directory = configuration
            .server_path
            .parent()
            .ok_or_else(|| "Sidecar resource directory is invalid".to_string())?
            .to_path_buf();
        verify_runtime_resources(&configuration)?;
        let mut command = Command::new(&configuration.node_path);
        apply_sanitized_parent_environment(&mut command)?;
        let protocol_secret = generate_protocol_secret()?;
        create_dir_all(&configuration.log_directory)
            .map_err(|error| format!("Unable to create desktop log directory: {error}"))?;
        create_dir_all(&configuration.app_settings_directory)
            .map_err(|error| format!("Unable to create desktop settings directory: {error}"))?;

        let generation = {
            let mut inner = lock_inner(&self.shared);
            if inner.snapshot.mode == "starting" {
                return Ok(());
            }
            if inner.snapshot.mode == RuntimeProcessState::Stopping.as_str()
                || inner.snapshot.mode == RuntimeProcessState::StopFailed.as_str()
            {
                return Err(
                    "Cannot start a new sidecar while the previous process has not stopped".into(),
                );
            }
            if let Some(existing) = inner.child.as_mut() {
                if existing
                    .try_wait()
                    .map_err(|error| format!("Unable to inspect existing sidecar: {error}"))?
                    .is_none()
                {
                    return Err(
                        "Cannot start a new sidecar while the previous process is still live"
                            .into(),
                    );
                }
            }
            inner.child = None;
            inner.active_protocol_secret = Some(protocol_secret.clone());
            inner.generation = inner.generation.wrapping_add(1);
            inner.readiness_deadline = None;
            inner.configuration = Some(configuration.clone());
            inner.snapshot =
                RuntimeSnapshot::starting(configuration.identity.shell_build_id.clone());
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

        command
            .arg(server_file_name)
            .current_dir(sidecar_directory)
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
            .env(
                "ALEKSI_PROTOCOL_VERSION",
                configuration.identity.protocol_version.to_string(),
            )
            .env(
                "ALEKSI_SHELL_BUILD_ID",
                &configuration.identity.shell_build_id,
            )
            .env(
                "ALEKSI_SIDECAR_BUILD_ID",
                &configuration.identity.sidecar_build_id,
            )
            .env("ALEKSI_BUILD_ID", &configuration.identity.shell_build_id)
            .env("ALEKSI_DESKTOP_PARENT_PID", std::process::id().to_string())
            .env("ALEKSI_PROTOCOL_SECRET", &protocol_secret)
            .env("ALEKSI_RUNTIME_LOG_DIR", &configuration.log_directory)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);

        #[cfg(windows)]
        let sidecar_job = match SidecarJob::new() {
            Ok(job) => job,
            Err(message) => {
                mark_crashed(&self.shared, generation, message.clone());
                return Err(message);
            }
        };
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                let message = format!("Unable to start local sidecar: {error}");
                mark_crashed(&self.shared, generation, message.clone());
                return Err(message);
            }
        };
        #[cfg(windows)]
        if let Err(message) = sidecar_job.assign(&child) {
            let _ = child.kill();
            let _ = child.wait();
            mark_crashed(&self.shared, generation, message.clone());
            return Err(message);
        }
        let mut process = SidecarProcess {
            child,
            #[cfg(windows)]
            job: sidecar_job,
        };
        let stdout = match process.child.stdout.take() {
            Some(stdout) => stdout,
            None => {
                let message = "Sidecar stdout is unavailable".to_string();
                return Err(terminate_failed_start(
                    &self.shared,
                    generation,
                    process,
                    message,
                ));
            }
        };
        let stderr = match process.child.stderr.take() {
            Some(stderr) => stderr,
            None => {
                let message = "Sidecar stderr is unavailable".to_string();
                return Err(terminate_failed_start(
                    &self.shared,
                    generation,
                    process,
                    message,
                ));
            }
        };
        let stderr_protocol_secret = protocol_secret.clone();
        thread::spawn(move || {
            let _ = write_redacted_log(stderr, stderr_file, &stderr_protocol_secret);
        });

        {
            let mut inner = lock_inner(&self.shared);
            if inner.generation != generation || inner.snapshot.mode != "starting" {
                drop(inner);
                return match process.terminate_and_wait() {
                    Ok(_) => Ok(()),
                    Err(error) => {
                        let message = error.to_string();
                        let mut inner = lock_inner(&self.shared);
                        if inner.child.is_none() {
                            inner.child = Some(process);
                            inner.active_protocol_secret = None;
                            inner.readiness_deadline = None;
                            inner.snapshot = RuntimeSnapshot::stop_failed(
                                inner.snapshot.build_id.clone(),
                                message.clone(),
                            );
                        }
                        Err(message)
                    }
                };
            }
            inner.readiness_deadline = Some(Instant::now() + SIDECAR_READINESS_TIMEOUT);
            inner.child = Some(process);
        }

        let shared = Arc::clone(&self.shared);
        thread::spawn(move || {
            follow_sidecar_stdout(shared, generation, stdout, configuration, protocol_secret)
        });
        let shared = Arc::clone(&self.shared);
        thread::spawn(move || {
            thread::sleep(SIDECAR_READINESS_TIMEOUT);
            expire_starting_generation(&shared, generation, Instant::now());
        });
        Ok(())
    }

    pub fn snapshot(&self) -> RuntimeSnapshot {
        let mut inner = lock_inner(&self.shared);
        let exit_status = inner
            .child
            .as_mut()
            .and_then(|child| child.try_wait().ok().flatten());
        let mut exited_process = None;
        if let Some(status) = exit_status {
            if inner.snapshot.mode != "stopped" && inner.snapshot.mode != "crashed" {
                let message = inner
                    .configuration
                    .as_ref()
                    .map(|configuration| {
                        sidecar_exit_message(configuration, inner.active_protocol_secret.as_deref())
                    })
                    .unwrap_or_else(|| format!("本地服务已退出：{status}"));
                inner.snapshot = RuntimeSnapshot::crashed(inner.snapshot.build_id.clone(), message);
                inner.active_protocol_secret = None;
                inner.readiness_deadline = None;
            }
            exited_process = inner.child.take();
        }
        let snapshot = inner.snapshot.clone();
        drop(inner);
        if let Some(process) = exited_process.as_mut() {
            process.wait_for_exit();
        }
        snapshot
    }

    pub fn shutdown(&self) -> Result<(), String> {
        let _lifecycle = lock_lifecycle(&self.shared);
        let api_session = {
            let mut inner = lock_inner(&self.shared);
            let session = if inner.snapshot.mode == "ready" {
                inner
                    .snapshot
                    .api_base_url
                    .as_deref()
                    .and_then(|url| url.rsplit(':').next())
                    .and_then(|value| value.parse::<u16>().ok())
                    .zip(inner.snapshot.protocol_secret.clone())
            } else {
                None
            };
            inner.generation = inner.generation.wrapping_add(1);
            inner.readiness_deadline = None;
            inner.snapshot = RuntimeSnapshot::stopping(inner.snapshot.build_id.clone());
            session
        };

        if let Some((port, protocol_secret)) = api_session {
            send_shutdown_request(port, &protocol_secret);
        }

        for _ in 0..20 {
            let exit_check = {
                let mut inner = lock_inner(&self.shared);
                match inner.child.as_mut() {
                    Some(child) => child.try_wait().map(|status| status.is_some()),
                    None => Ok(true),
                }
            };
            match exit_check {
                Ok(true) => break,
                Ok(false) => thread::sleep(Duration::from_millis(100)),
                Err(error) => {
                    let message = format!("Unable to inspect sidecar shutdown: {error}");
                    let mut inner = lock_inner(&self.shared);
                    inner.snapshot = RuntimeSnapshot::stop_failed(
                        inner.snapshot.build_id.clone(),
                        message.clone(),
                    );
                    return Err(message);
                }
            }
        }

        let mut inner = lock_inner(&self.shared);
        let termination = match inner.child.as_mut() {
            Some(process) => process.terminate_and_wait().map(|_| ()),
            None => Ok(()),
        };
        match termination {
            Ok(()) => {
                inner.child = None;
                inner.active_protocol_secret = None;
                inner.readiness_deadline = None;
                inner.snapshot = RuntimeSnapshot::stopped(inner.snapshot.build_id.clone());
                Ok(())
            }
            Err(error) => {
                let message = error.to_string();
                inner.snapshot =
                    RuntimeSnapshot::stop_failed(inner.snapshot.build_id.clone(), message.clone());
                Err(message)
            }
        }
    }

    pub fn restart(&self, app: &AppHandle) -> Result<(), String> {
        self.shutdown()?;
        self.start(app)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        apply_sanitized_parent_environment_from, bounded_utf8_tail, expire_starting_generation,
        generate_protocol_secret, lock_inner, mark_crashed, parse_ready_line, recent_log_tail,
        record_ready, sanitize_diagnostic_message, sanitized_parent_environment,
        shutdown_http_request, validate_desktop_identity, verify_resource_file, write_redacted_log,
        DesktopIdentity, DesktopIdentityFile, ReadyDisposition, ReadyRecord, RuntimeInner,
        RuntimeProcessState, RuntimeShared, RuntimeSnapshot, ShutdownError,
        DESKTOP_PROTOCOL_VERSION, MAX_FAILURE_LOG_BYTES,
    };
    use crate::selected_readings::SelectedReadingHandles;
    use std::collections::BTreeMap;
    use std::ffi::OsString;
    use std::fs::{remove_file, write};
    use std::io::Cursor;
    use std::path::PathBuf;
    use std::process::Command;
    use std::sync::Mutex;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    fn identity() -> DesktopIdentity {
        DesktopIdentity {
            version: "0.1.0".into(),
            protocol_version: DESKTOP_PROTOCOL_VERSION,
            shell_build_id: "desktop-0123456789abcdefabcd".into(),
            sidecar_build_id: "sidecar-0123456789abcdefabcd".into(),
            build_id: "desktop-0123456789abcdefabcd".into(),
            files: vec![],
        }
    }

    #[test]
    fn runtime_process_states_have_stable_external_labels() {
        assert_eq!(RuntimeProcessState::Starting.as_str(), "starting");
        assert_eq!(RuntimeProcessState::Running.as_str(), "ready");
        assert_eq!(RuntimeProcessState::Stopping.as_str(), "stopping");
        assert_eq!(RuntimeProcessState::StopFailed.as_str(), "stop-failed");
        assert_eq!(RuntimeProcessState::Stopped.as_str(), "stopped");
        assert_eq!(RuntimeProcessState::Crashed.as_str(), "crashed");
    }

    #[test]
    fn shutdown_errors_name_the_failed_operation() {
        let error = ShutdownError::new("forced termination status check", "access denied");
        assert_eq!(
            error.to_string(),
            "Unable to stop local sidecar during forced termination status check: access denied"
        );
    }

    fn temporary_test_file(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "aleksi-runtime-{name}-{}-{unique}",
            std::process::id()
        ))
    }

    #[test]
    fn sanitizes_parent_environment_before_sidecar_spawn() {
        let parent = || {
            [
                ("SystemRoot", r"C:\Windows"),
                ("TEMP", r"C:\Users\Aleksi\AppData\Local\Temp"),
                ("USERPROFILE", r"C:\Users\Aleksi"),
                ("APPDATA", r"C:\Users\Aleksi\AppData\Roaming"),
                ("LOCALAPPDATA", r"C:\Users\Aleksi\AppData\Local"),
                ("PATH", r"C:\attacker"),
                ("NODE_OPTIONS", r"--require C:\attacker\bootstrap.cjs"),
                ("NODE_PATH", r"C:\attacker\modules"),
                ("ALEKSI_PROTOCOL_SECRET", "attacker-secret"),
                ("ALEKSI_STATIC_DIST_DIR", r"C:\attacker\dist"),
                ("HTTP_PROXY", "attacker.invalid:8080"),
            ]
            .into_iter()
            .map(|(key, value)| (OsString::from(key), OsString::from(value)))
        };

        let sanitized: BTreeMap<_, _> = sanitized_parent_environment(parent())
            .into_iter()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().to_ascii_uppercase(),
                    value.to_string_lossy().into_owned(),
                )
            })
            .collect();

        assert_eq!(sanitized.get("SYSTEMROOT"), Some(&r"C:\Windows".into()));
        assert_eq!(
            sanitized.get("USERPROFILE"),
            Some(&r"C:\Users\Aleksi".into())
        );
        for forbidden in [
            "NODE_OPTIONS",
            "NODE_PATH",
            "ALEKSI_PROTOCOL_SECRET",
            "ALEKSI_STATIC_DIST_DIR",
            "HTTP_PROXY",
            "PATH",
        ] {
            assert!(!sanitized.contains_key(forbidden));
        }

        let mut command = Command::new("node.exe");
        command.env("PREEXISTING_ATTACKER_VALUE", "must-be-cleared");
        apply_sanitized_parent_environment_from(&mut command, parent()).unwrap();
        let command_environment: BTreeMap<_, _> = command
            .get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().to_ascii_uppercase(),
                    value.unwrap().to_string_lossy().into_owned(),
                )
            })
            .collect();

        assert!(!command_environment.contains_key("PREEXISTING_ATTACKER_VALUE"));
        assert_eq!(
            command_environment.get("PATH"),
            Some(&r"C:\Windows\System32;C:\Windows".into())
        );
        assert_eq!(
            command_environment.get("NODE_ENV"),
            Some(&"production".into())
        );
        for forbidden in [
            "NODE_OPTIONS",
            "NODE_PATH",
            "ALEKSI_PROTOCOL_SECRET",
            "ALEKSI_STATIC_DIST_DIR",
            "HTTP_PROXY",
        ] {
            assert!(!command_environment.contains_key(forbidden));
        }
    }

    #[test]
    fn rejects_resource_identity_that_is_not_bound_to_the_compiled_shell() {
        let compiled = identity();
        let mut installed = compiled.clone();
        installed.shell_build_id = "desktop-attacker".into();
        installed.build_id = "desktop-attacker".into();

        let error = validate_desktop_identity(&installed, &compiled, "0.1.0").unwrap_err();
        assert!(error.contains("compiled desktop shell"));
    }

    #[test]
    fn rejects_resource_identity_version_that_differs_from_the_app_package() {
        let compiled = identity();
        let error = validate_desktop_identity(&compiled, &compiled, "0.1.1").unwrap_err();
        assert!(error.contains("application package version"));
    }

    #[test]
    fn verifies_resource_bytes_and_sha256_before_spawn() {
        let path = temporary_test_file("resource-ok");
        let bytes = b"console.log('verified sidecar');\n";
        write(&path, bytes).unwrap();
        let expected = DesktopIdentityFile {
            path: "sidecar/server.cjs".into(),
            bytes: bytes.len() as u64,
            sha256: "8440b1eef0bb02d2ca444ba400b07a8152c7627934baf05b6b28cbe2e58f4a07".into(),
        };

        verify_resource_file(&path, &expected).unwrap();
        remove_file(path).unwrap();
    }

    #[test]
    fn rejects_changed_resource_bytes_before_spawn() {
        let path = temporary_test_file("resource-changed");
        write(&path, b"changed").unwrap();
        let expected = DesktopIdentityFile {
            path: "sidecar/node.exe".into(),
            bytes: 7,
            sha256: "0000000000000000000000000000000000000000000000000000000000000000".into(),
        };

        let error = verify_resource_file(&path, &expected).unwrap_err();
        assert!(error.contains("SHA-256"));
        remove_file(path).unwrap();
    }

    #[test]
    fn accepts_only_matching_loopback_readiness() {
        let parsed = parse_ready_line(
            r#"ALEKSI_READY {"host":"127.0.0.1","port":43127,"version":"0.1.0","protocolVersion":1,"shellBuildId":"desktop-0123456789abcdefabcd","sidecarBuildId":"sidecar-0123456789abcdefabcd"}"#,
            &identity(),
        )
        .unwrap();

        assert_eq!(
            parsed,
            Some(ReadyRecord {
                host: "127.0.0.1".into(),
                port: 43127,
                version: "0.1.0".into(),
                protocol_version: DESKTOP_PROTOCOL_VERSION,
                shell_build_id: "desktop-0123456789abcdefabcd".into(),
                sidecar_build_id: "sidecar-0123456789abcdefabcd".into(),
            })
        );
    }

    #[test]
    fn ignores_crash_reports_from_stale_sidecar_generations() {
        let shared = RuntimeShared {
            inner: Mutex::new(RuntimeInner {
                active_protocol_secret: None,
                child: None,
                configuration: None,
                generation: 2,
                readiness_deadline: None,
                snapshot: RuntimeSnapshot::starting("desktop-0123456789abcdefabcd".into()),
            }),
            lifecycle: Mutex::new(()),
            selected_readings: SelectedReadingHandles::default(),
        };

        mark_crashed(&shared, 1, "stale sidecar exited".into());
        assert_eq!(lock_inner(&shared).snapshot.mode, "starting");

        mark_crashed(&shared, 2, "current sidecar exited".into());
        let snapshot = lock_inner(&shared).snapshot.clone();
        assert_eq!(snapshot.mode, "crashed");
        assert_eq!(snapshot.message.as_deref(), Some("current sidecar exited"));
    }

    #[test]
    fn readiness_deadline_never_terminates_an_accepted_generation() {
        let now = Instant::now();
        let secret = "a".repeat(64);
        let shared = RuntimeShared {
            inner: Mutex::new(RuntimeInner {
                active_protocol_secret: Some(secret.clone()),
                child: None,
                configuration: None,
                generation: 7,
                readiness_deadline: Some(now + Duration::from_secs(1)),
                snapshot: RuntimeSnapshot::starting("desktop-0123456789abcdefabcd".into()),
            }),
            lifecycle: Mutex::new(()),
            selected_readings: SelectedReadingHandles::default(),
        };
        let ready = ReadyRecord {
            host: "127.0.0.1".into(),
            port: 43127,
            version: "0.1.0".into(),
            protocol_version: DESKTOP_PROTOCOL_VERSION,
            shell_build_id: "desktop-0123456789abcdefabcd".into(),
            sidecar_build_id: "sidecar-0123456789abcdefabcd".into(),
        };

        assert_eq!(
            record_ready(&shared, 7, ready, &secret, now),
            ReadyDisposition::Accepted
        );
        expire_starting_generation(&shared, 7, now + Duration::from_secs(2));

        let snapshot = lock_inner(&shared).snapshot.clone();
        assert_eq!(snapshot.mode, "ready");
        assert_eq!(snapshot.protocol_secret.as_deref(), Some(secret.as_str()));
    }

    #[test]
    fn expired_readiness_clears_the_secret_and_marks_the_generation_crashed() {
        let now = Instant::now();
        let secret = "b".repeat(64);
        let shared = RuntimeShared {
            inner: Mutex::new(RuntimeInner {
                active_protocol_secret: Some(secret),
                child: None,
                configuration: None,
                generation: 8,
                readiness_deadline: Some(now),
                snapshot: RuntimeSnapshot::starting("desktop-0123456789abcdefabcd".into()),
            }),
            lifecycle: Mutex::new(()),
            selected_readings: SelectedReadingHandles::default(),
        };

        expire_starting_generation(&shared, 8, now);

        let inner = lock_inner(&shared);
        assert_eq!(inner.snapshot.mode, "crashed");
        assert!(inner.snapshot.protocol_secret.is_none());
        assert!(inner.active_protocol_secret.is_none());
        assert!(inner.readiness_deadline.is_none());
    }

    #[cfg(windows)]
    #[test]
    fn closing_the_sidecar_job_terminates_its_process_tree() {
        use std::process::Stdio;

        let mut child = Command::new("cmd.exe")
            .args(["/C", "ping -t 127.0.0.1 > nul"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let job = super::SidecarJob::new().unwrap();
        if let Err(error) = job.assign(&child) {
            let _ = child.kill();
            let _ = child.wait();
            panic!("{error}");
        }

        drop(job);
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if child.try_wait().unwrap().is_some() {
                break;
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                panic!("sidecar process survived closing its kill-on-close job");
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    #[test]
    fn rejects_non_loopback_or_mismatched_identity() {
        let wrong_host = r#"ALEKSI_READY {"host":"0.0.0.0","port":43127,"version":"0.1.0","protocolVersion":1,"shellBuildId":"desktop-0123456789abcdefabcd","sidecarBuildId":"sidecar-0123456789abcdefabcd"}"#;
        assert!(parse_ready_line(wrong_host, &identity())
            .unwrap_err()
            .contains("loopback"));

        let wrong_protocol = r#"ALEKSI_READY {"host":"127.0.0.1","port":43127,"version":"0.1.0","protocolVersion":2,"shellBuildId":"desktop-0123456789abcdefabcd","sidecarBuildId":"sidecar-0123456789abcdefabcd"}"#;
        assert!(parse_ready_line(wrong_protocol, &identity())
            .unwrap_err()
            .contains("protocol"));

        let wrong_shell = r#"ALEKSI_READY {"host":"127.0.0.1","port":43127,"version":"0.1.0","protocolVersion":1,"shellBuildId":"desktop-wrong","sidecarBuildId":"sidecar-0123456789abcdefabcd"}"#;
        assert!(parse_ready_line(wrong_shell, &identity())
            .unwrap_err()
            .contains("shell build"));

        let wrong_sidecar = r#"ALEKSI_READY {"host":"127.0.0.1","port":43127,"version":"0.1.0","protocolVersion":1,"shellBuildId":"desktop-0123456789abcdefabcd","sidecarBuildId":"sidecar-wrong"}"#;
        assert!(parse_ready_line(wrong_sidecar, &identity())
            .unwrap_err()
            .contains("sidecar build"));
    }

    #[test]
    fn creates_unique_256_bit_protocol_secrets() {
        let first = generate_protocol_secret().unwrap();
        let second = generate_protocol_secret().unwrap();

        assert_eq!(first.len(), 64);
        assert!(first.chars().all(|character| character.is_ascii_hexdigit()));
        assert_eq!(first, first.to_ascii_lowercase());
        assert_ne!(first, second);
    }

    #[test]
    fn redacts_protocol_secrets_from_crash_messages_and_log_tails() {
        let secret = "b".repeat(64);
        let shared = RuntimeShared {
            inner: Mutex::new(RuntimeInner {
                active_protocol_secret: Some(secret.clone()),
                child: None,
                configuration: None,
                generation: 4,
                readiness_deadline: None,
                snapshot: RuntimeSnapshot::starting("desktop-build".into()),
            }),
            lifecycle: Mutex::new(()),
            selected_readings: SelectedReadingHandles::default(),
        };

        mark_crashed(
            &shared,
            4,
            format!("sidecar printed secret {secret} before readiness"),
        );
        let snapshot = lock_inner(&shared).snapshot.clone();
        assert!(!snapshot.message.as_deref().unwrap().contains(&secret));
        assert!(snapshot.message.as_deref().unwrap().contains("[REDACTED]"));

        let path = temporary_test_file("redacted-tail");
        write(
            &path,
            format!(
                "{}{secret}\nvisible failure after secret\n",
                "x".repeat(MAX_FAILURE_LOG_BYTES)
            ),
        )
        .unwrap();
        let tail = recent_log_tail(&path, Some(&secret)).unwrap();
        assert!(!tail.contains(&secret));
        assert!(tail.contains("[REDACTED]"));
        assert!(tail.contains("visible failure after secret"));
        remove_file(path).unwrap();
    }

    #[test]
    fn redacts_protocol_secrets_before_writing_sidecar_logs() {
        let secret = "c".repeat(64);
        let input = format!("ordinary line\nsecret={secret}\n");
        let mut output = Vec::new();

        write_redacted_log(Cursor::new(input), &mut output, &secret).unwrap();
        let output = String::from_utf8(output).unwrap();

        assert!(!output.contains(&secret));
        assert!(output.contains("secret=[REDACTED]"));
    }

    #[test]
    fn redacts_secrets_and_absolute_paths_before_persisting_lifecycle_failures() {
        let secret = "d".repeat(64);
        let message = format!(
            "shutdown secret={secret}; source=\"C:\\Users\\alice\\Private Vault\\server.cjs\"; fallback=\"/home/alice/private.md\""
        );

        let sanitized = sanitize_diagnostic_message(&message, Some(&secret));

        assert!(!sanitized.contains(&secret));
        assert!(!sanitized.contains("alice"));
        assert!(!sanitized.contains("server.cjs"));
        assert!(!sanitized.contains("private.md"));
        assert!(sanitized.contains("[REDACTED]"));
        assert!(sanitized.contains("[local path]"));

        const PREFIX: &str = "destroyed-window shutdown failed: ";
        let oversized = "界".repeat(MAX_FAILURE_LOG_BYTES);
        let bounded = bounded_utf8_tail(
            &oversized,
            MAX_FAILURE_LOG_BYTES.saturating_sub(PREFIX.len() + 1),
        );
        let persisted = format!("{PREFIX}{bounded}\n");
        assert!(persisted.len() <= MAX_FAILURE_LOG_BYTES);
        assert!(persisted.is_char_boundary(persisted.len()));
    }

    #[test]
    fn never_serializes_a_secret_outside_the_ready_snapshot() {
        for snapshot in [
            RuntimeSnapshot::starting("desktop-build".into()),
            RuntimeSnapshot::crashed(Some("desktop-build".into()), "failure".into()),
            RuntimeSnapshot::stopped(Some("desktop-build".into())),
        ] {
            assert!(!serde_json::to_string(&snapshot)
                .unwrap()
                .contains("protocolSecret"));
        }
    }

    #[test]
    fn shutdown_request_authenticates_in_headers_not_the_url() {
        let secret = "a".repeat(64);
        let request = shutdown_http_request(43127, &secret);

        assert!(request.starts_with("POST /api/runtime/exit HTTP/1.1"));
        assert!(request.contains("Origin: http://tauri.localhost\r\n"));
        assert!(request.contains(&format!("X-Aleksi-Protocol-Secret: {secret}\r\n")));
        assert!(!request.lines().next().unwrap().contains(&secret));
    }
}
