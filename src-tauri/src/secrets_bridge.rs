//! Opt-in local API execution; provider secrets never leave the backend.
// Broker, sessao e auditoria so rodam no Linux; nos demais alvos o modulo
// compila apenas o necessario para recusar.
#![cfg_attr(not(target_os = "linux"), allow(dead_code, unused_imports))]
pub mod broker;
#[cfg(target_os = "linux")]
mod identity;
#[cfg(target_os = "linux")]
mod providers;
mod quota;
#[cfg(target_os = "linux")]
mod services;
#[cfg(target_os = "linux")]
pub mod universal;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    path::Path,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, State};
use zeroize::Zeroizing;

const DENIED: &str = "error.bridge.denied";
#[cfg(target_os = "linux")]
const MAX_EXECUTABLE_BYTES: u64 = 512 * 1024 * 1024;
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Integration {
    pub id: String,
    pub name: String,
    pub executable: String,
    pub sha256: String,
    #[serde(default = "custom_kind")]
    pub kind: String,
}
fn custom_kind() -> String {
    "custom".into()
}
struct Key {
    secret: Zeroizing<String>,
    identifier: String,
    // Legacy delivery fixtures; production uses the proxy broker permissions.
    #[cfg(test)]
    integrations: Vec<Integration>,
    label: String,
    #[cfg(target_os = "linux")]
    config: providers::Config,
}
struct Session {
    generation: u64,
    expires: Instant,
    vault_name: String,
    file_hash: Vec<u8>,
    content_hash: Vec<u8>,
    keys: HashMap<String, Key>,
}
#[derive(Default)]
struct Core {
    generation: u64,
    session: Option<Session>,
    close_reason: &'static str,
}
#[derive(Default)]
pub struct BridgeState(Mutex<Core>, Mutex<()>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRequest {
    key_id: String,
    integration_id: String,
}
#[derive(Default)]
pub struct BridgeRequests(Mutex<Option<(LaunchRequest, Instant)>>);
fn request_from_args(args: &[String]) -> Option<LaunchRequest> {
    fn id(s: &str) -> bool {
        !s.is_empty()
            && s.len() <= 128
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    }
    if args.len() != 4 || args[1] != "--bridge-request" || !id(&args[2]) || !id(&args[3]) {
        return None;
    }
    Some(LaunchRequest {
        key_id: args[2].clone(),
        integration_id: args[3].clone(),
    })
}
/// Untrusted requests contain IDs only and never return a secret. A request
/// can only ask the UI to launch an already approved consumer, after a popup.
pub fn queue_request(app: &AppHandle, args: &[String]) {
    #[cfg(target_os = "linux")]
    if let Some(request) = request_from_args(args) {
        if let Some(state) = app.try_state::<BridgeRequests>() {
            if let Ok(mut pending) = state.0.lock() {
                // One outstanding request prevents queues of approval popups.
                if pending
                    .as_ref()
                    .is_some_and(|(_, deadline)| *deadline > Instant::now())
                {
                    return;
                }
                *pending = Some((request, Instant::now() + Duration::from_secs(30)));
                let _ = app.emit("kpassword:bridge-request", ());
            }
        }
    }
    #[cfg(not(target_os = "linux"))]
    let _ = (app, args);
}
#[tauri::command]
pub fn bridge_take_request(state: State<BridgeRequests>) -> Option<LaunchRequest> {
    let (request, deadline) = state.0.lock().ok()?.take()?;
    (deadline > Instant::now()).then_some(request)
}

impl Core {
    fn close(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.session = None;
        self.close_reason = "bridge_inactive";
    }
    fn install_session(&mut self, generation: u64, session: Session) -> Result<(), String> {
        if self.generation != generation || session.generation != generation {
            return Err(DENIED.into());
        }
        self.session = Some(session);
        Ok(())
    }
    #[cfg(test)]
    fn authorize(
        &self,
        generation: u64,
        key_id: &str,
        integration_id: &str,
    ) -> Result<(&Key, &Integration), String> {
        let session = self.session.as_ref().ok_or(DENIED)?;
        if session.generation != generation || session.expires <= Instant::now() {
            return Err(DENIED.into());
        }
        let key = session.keys.get(key_id).ok_or(DENIED)?;
        let integration = key
            .integrations
            .iter()
            .find(|i| i.id == integration_id)
            .ok_or(DENIED)?;
        Ok((key, integration))
    }
}

pub fn close(app: &AppHandle) {
    let state = app.state::<BridgeState>();
    let Ok(_lifecycle) = state.1.lock() else {
        return;
    };
    close_unlocked(app);
}
fn close_unlocked(app: &AppHandle) {
    if let Some(state) = app.try_state::<BridgeState>() {
        if let Ok(mut core) = state.0.lock() {
            core.close();
        }
    }

    #[cfg(target_os = "linux")]
    universal::stop(app);
    broker::revoke(app);
    if let Some(state) = app.try_state::<BridgeRequests>() {
        if let Ok(mut pending) = state.0.lock() {
            *pending = None;
        }
    }
}

pub fn valid_identifier(s: &str) -> bool {
    let suffix = ["_API_KEY", "_TOKEN", "_SECRET"]
        .iter()
        .find(|suffix| s.ends_with(**suffix));
    let Some(suffix) = suffix else {
        return false;
    };
    let prefix = &s[..s.len() - suffix.len()];
    !prefix.is_empty()
        && prefix.len() <= 64
        && prefix.as_bytes()[0].is_ascii_uppercase()
        && prefix
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
}

fn parse_keys(plain: &Value) -> Result<HashMap<String, Key>, String> {
    if plain["settings"]["secretsBridgeEnabled"] != true {
        return Err(DENIED.into());
    }
    let mut keys = HashMap::new();
    for record in plain["credentials"].as_array().ok_or(DENIED)? {
        if record["itemType"] != "api_key"
            || record
                .get("deletedAt")
                .is_some_and(|v| !v.is_null() && v != "")
        {
            continue;
        }
        let secret = record["password"].as_str().ok_or(DENIED)?;
        let identifier = record["apiIdentifier"].as_str().ok_or(DENIED)?;
        if !valid_identifier(identifier)
            || secret.trim().is_empty()
            || secret.contains('\0')
            || secret.len() > 16_384
        {
            return Err(DENIED.into());
        }
        let integrations = match record.get("apiApplications") {
            Some(v) => serde_json::from_value::<Vec<Integration>>(v.clone()).map_err(|_| DENIED)?,
            None => Vec::new(),
        };
        if integrations.len() > 32 {
            return Err(DENIED.into());
        }
        let id = record["id"].as_str().ok_or(DENIED)?.to_string();
        if keys.contains_key(&id) {
            return Err(DENIED.into());
        }
        let label = record["title"]
            .as_str()
            .unwrap_or("API")
            .chars()
            .filter(|c| !c.is_control())
            .take(120)
            .collect();
        #[cfg(target_os = "linux")]
        let config = {
            let c: providers::Config =
                serde_json::from_value(record.clone()).map_err(|_| DENIED)?;
            c.validate()?;
            if !c.base_url.is_empty() && c.base_url.contains(secret) {
                return Err(DENIED.into());
            }
            c
        };
        keys.insert(
            id,
            Key {
                #[cfg(target_os = "linux")]
                config,
                secret: Zeroizing::new(secret.into()),
                identifier: identifier.into(),
                #[cfg(test)]
                integrations,
                label,
            },
        );
    }
    Ok(keys)
}

fn erase_json(value: &mut Value) {
    use zeroize::Zeroize;
    match value {
        Value::String(s) => s.zeroize(),
        Value::Array(a) => a.iter_mut().for_each(erase_json),
        Value::Object(o) => o.values_mut().for_each(erase_json),
        _ => {}
    }
}

fn content_digest(value: &Value) -> Result<Vec<u8>, String> {
    let mut copy = value.clone();
    if let Some(object) = copy.as_object_mut() {
        object.remove("actionHistory");
        object.remove("updatedAt");
    }
    let serialized = serde_json::to_vec(&copy).map_err(|_| DENIED);
    erase_json(&mut copy);
    let serialized = Zeroizing::new(serialized?);
    Ok(Sha256::digest(&*serialized).to_vec())
}

/// Preserve the independent lease only for an authenticated history-only save.
/// The caller cannot assert that keys did not change: backend decrypts and checks
/// every vault field except the two operational-history fields itself.
pub fn save_with_history_check(
    app: &AppHandle,
    vault_name: &str,
    payload: &str,
    write: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let state = app.state::<BridgeState>();
    let mut core = state.0.lock().map_err(|_| DENIED.to_string())?;
    let preserve = (|| {
        let session = core.session.as_ref()?;
        if session.expires <= Instant::now() || session.vault_name != vault_name {
            return None;
        }
        let (path, _, _) = super::storage_paths(app, Some(vault_name.into())).ok()?;
        if Sha256::digest(fs::read(path).ok()?).as_slice() != session.file_hash {
            return None;
        }
        let encrypted = serde_json::from_str(payload).ok()?;
        let plaintext =
            Zeroizing::new(super::vault_session::decrypt(app, vault_name, &encrypted)?.ok()?);
        let mut plain = serde_json::from_str::<Value>(&plaintext).ok()?;
        let digest = content_digest(&plain);
        erase_json(&mut plain);
        (digest.as_ref().ok() == Some(&session.content_hash)).then_some(())
    })()
    .is_some();
    if !preserve {
        drop(core);
        close(app);
        return write();
    }
    // Keep the digest and the atomic replacement under the same lease lock.
    // A concurrent request sees either the old file/hash or the new pair.
    let result = write();
    if result.is_ok() {
        if let Some(session) = core.session.as_mut() {
            session.file_hash = Sha256::digest(payload.as_bytes()).to_vec();
        }
    }
    drop(core);
    if result.is_err() {
        close(app);
    }
    result
}

#[tauri::command]
pub fn bridge_close(app: AppHandle) {
    close(&app);
}

#[tauri::command]
pub async fn bridge_open(
    app: AppHandle,
    vault_name: String,
    duration_hours: Option<u64>,
) -> Result<u64, String> {
    // Broker, limites e expiracao da sessao so existem no Linux.
    if !cfg!(target_os = "linux") {
        return Err(DENIED.into());
    }
    // Decifrar o cofre fora da thread principal, com a sessao do cofre aberto.
    tauri::async_runtime::spawn_blocking(move || {
        bridge_open_blocking(app, vault_name, duration_hours)
    })
    .await
    .map_err(|_| DENIED)?
}

fn bridge_open_blocking(
    app: AppHandle,
    vault_name: String,
    duration_hours: Option<u64>,
) -> Result<u64, String> {
    let state = app.state::<BridgeState>();
    let _lifecycle = state.1.lock().map_err(|_| DENIED)?;
    close_unlocked(&app);
    let generation = {
        let mut core = state.0.lock().map_err(|_| DENIED)?;
        core.close();
        core.generation
    };
    let (path, _, name) = super::storage_paths(&app, Some(vault_name))?;
    let raw = fs::read(&path).map_err(|_| DENIED)?;
    let encrypted: Value = serde_json::from_slice(&raw).map_err(|_| DENIED)?;
    let plaintext = Zeroizing::new(
        super::vault_session::decrypt(&app, &name, &encrypted)
            .ok_or(DENIED)?
            .map_err(|_| DENIED)?,
    );
    let mut plain: Value = serde_json::from_str(&plaintext).map_err(|_| DENIED)?;
    let result = parse_keys(&plain);
    let content_hash = content_digest(&plain);
    let hours = duration_hours.unwrap_or(48);
    if ![24, 48, 72].contains(&hours) {
        erase_json(&mut plain);
        return Err(DENIED.into());
    }
    let minutes = hours * 60;
    erase_json(&mut plain);
    let keys = result?;
    let mut core = state.0.lock().map_err(|_| DENIED)?;
    core.install_session(
        generation,
        Session {
            generation,
            expires: Instant::now() + Duration::from_secs(minutes * 60),
            vault_name: name,
            file_hash: Sha256::digest(&raw).to_vec(),
            content_hash: content_hash?,
            keys,
        },
    )?;
    drop(core);
    if broker::start(&app).is_err() {
        close_unlocked(&app);
        return Err(DENIED.into());
    }
    #[cfg(target_os = "linux")]
    {
        if universal::start(&app, generation).is_err() {
            close_unlocked(&app);
            return Err("error.bridge.portBusy".into());
        }
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(minutes * 60)).await;
            let state = app.state::<BridgeState>();
            let Ok(_lifecycle) = state.1.lock() else {
                return;
            };
            let expired = app.try_state::<BridgeState>().is_some_and(|state| {
                state
                    .0
                    .lock()
                    .is_ok_and(|core| core.generation == generation)
            });
            if expired {
                close_unlocked(&app);
                if let Some(state) = app.try_state::<BridgeState>() {
                    if let Ok(mut core) = state.0.lock() {
                        core.close_reason = "session_expired";
                    }
                }
            }
        });
    }
    Ok(generation)
}

/// One on-disk version of a file, observed with fstat on the very fd that is
/// hashed. Any write or metadata change bumps ctime (which userspace cannot
/// set), so a changed or replaced file never matches an older version.
#[cfg(target_os = "linux")]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct FileVersion {
    dev: u64,
    ino: u64,
    size: u64,
    mtime_ns: i128,
    ctime_ns: i128,
}
#[cfg(target_os = "linux")]
impl FileVersion {
    fn of(meta: &fs::Metadata) -> Self {
        use std::os::unix::fs::MetadataExt;
        let ns = |s: i64, n: i64| i128::from(s) * 1_000_000_000 + i128::from(n);
        Self {
            dev: meta.dev(),
            ino: meta.ino(),
            size: meta.size(),
            mtime_ns: ns(meta.mtime(), meta.mtime_nsec()),
            ctime_ns: ns(meta.ctime(), meta.ctime_nsec()),
        }
    }
}
/// Bounded least-recently-used cache of executable SHA-256 digests, so the
/// bridge does not re-read up to 512 MB per process on every request.
#[cfg(target_os = "linux")]
struct FingerprintCache {
    entries: Vec<(FileVersion, String, u64)>,
    tick: u64,
}
#[cfg(target_os = "linux")]
impl FingerprintCache {
    const CAPACITY: usize = 64;
    /// File timestamps have kernel-tick granularity: a file changed within the
    /// tick it was hashed in can keep the same size, mtime and ctime. Only
    /// versions whose ctime is clearly older than the start of hashing are
    /// cached, so any later change necessarily produces a newer ctime.
    const SETTLED_NS: i128 = 2_000_000_000;
    const fn new() -> Self {
        Self {
            entries: Vec::new(),
            tick: 0,
        }
    }
    fn get(&mut self, version: &FileVersion) -> Option<String> {
        self.tick += 1;
        let tick = self.tick;
        self.entries
            .iter_mut()
            .find(|(v, _, _)| v == version)
            .map(|(_, hash, used)| {
                *used = tick;
                hash.clone()
            })
    }
    fn insert(&mut self, version: FileVersion, hash: String, hashing_started_ns: i128) {
        if version.ctime_ns > hashing_started_ns - Self::SETTLED_NS {
            return;
        }
        self.tick += 1;
        if let Some(entry) = self.entries.iter_mut().find(|(v, _, _)| *v == version) {
            *entry = (version, hash, self.tick);
            return;
        }
        if self.entries.len() >= Self::CAPACITY {
            if let Some(oldest) = self
                .entries
                .iter()
                .enumerate()
                .min_by_key(|(_, (_, _, used))| *used)
                .map(|(i, _)| i)
            {
                self.entries.swap_remove(oldest);
            }
        }
        self.entries.push((version, hash, self.tick));
    }
}
#[cfg(target_os = "linux")]
static FINGERPRINTS: Mutex<FingerprintCache> = Mutex::new(FingerprintCache::new());

#[cfg(target_os = "linux")]
fn fingerprint(path: &str) -> Result<(String, String), String> {
    use std::{io::Read, os::unix::fs::MetadataExt};
    if !Path::new(path).is_absolute() || path.contains(['\n', '\r', '\0']) {
        return Err(DENIED.into());
    }
    let canonical = fs::canonicalize(path).map_err(|_| DENIED)?;
    let canonical_str = canonical.to_str().ok_or(DENIED)?.to_owned();
    // Taken before open: any change from here on gets a ctime at or after it.
    let started = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as i128)
        .unwrap_or(0);
    let mut file = fs::File::open(&canonical).map_err(|_| DENIED)?;
    let meta = file.metadata().map_err(|_| DENIED)?;
    if !meta.is_file()
        || meta.len() > MAX_EXECUTABLE_BYTES
        || meta.mode() & 0o111 == 0
        || meta.mode() & 0o022 != 0
    {
        return Err(DENIED.into());
    }
    let version = FileVersion::of(&meta);
    if let Some(hash) = FINGERPRINTS
        .lock()
        .ok()
        .and_then(|mut cache| cache.get(&version))
    {
        return Ok((canonical_str, hash));
    }
    let mut hash = Sha256::new();
    let mut buf = [0; 16_384];
    let mut total = 0u64;
    loop {
        let n = file.read(&mut buf).map_err(|_| DENIED)?;
        if n == 0 {
            break;
        }
        total += n as u64;
        if total > MAX_EXECUTABLE_BYTES {
            return Err(DENIED.into());
        }
        hash.update(&buf[..n]);
    }
    let hash = format!("{:x}", hash.finalize());
    // Cache only if the same fd still reports the version seen before reading.
    if file
        .metadata()
        .is_ok_and(|after| FileVersion::of(&after) == version)
    {
        if let Ok(mut cache) = FINGERPRINTS.lock() {
            cache.insert(version, hash.clone(), started);
        }
    }
    Ok((canonical_str, hash))
}

#[tauri::command]
pub fn bridge_prepare(
    executable: String,
    name: String,
    kind: Option<String>,
) -> Result<Integration, String> {
    #[cfg(target_os = "linux")]
    {
        if name.trim().is_empty() || name.len() > 64 || name.chars().any(char::is_control) {
            return Err(DENIED.into());
        }
        let (executable, sha256) = fingerprint(&executable)?;
        let kind = kind.unwrap_or_else(custom_kind);
        if !["claude", "codex", "custom"].contains(&kind.as_str()) {
            return Err(DENIED.into());
        }
        let mut bytes = [0; 16];
        getrandom::fill(&mut bytes).map_err(|_| DENIED)?;
        Ok(Integration {
            id: bytes.iter().map(|b| format!("{b:02x}")).collect(),
            name: name.trim().into(),
            executable,
            sha256,
            kind,
        })
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (executable, name, kind);
        Err("error.bridge.linuxOnly".into())
    }
}

#[derive(Serialize, Deserialize)]
struct Delivery {
    identifier: String,
    secret: String,
    executable: String,
    kind: String,
}
impl Drop for Delivery {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.secret.zeroize();
    }
}

#[derive(Serialize, Deserialize)]
pub struct Audit {
    at: u128,
    outcome: String,
    key_id: String,
    integration_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    error: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    status: Option<u16>,
}
fn audit_event(outcome: &str, key_id: &str, integration_id: &str) -> Audit {
    fn safe_id(s: &str) -> String {
        if s.len() <= 128
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            s.into()
        } else {
            "invalid".into()
        }
    }
    Audit {
        at: super::now_epoch_millis(),
        outcome: outcome.into(),
        key_id: safe_id(key_id),
        integration_id: safe_id(integration_id),
        error: None,
        status: None,
    }
}

#[cfg(target_os = "linux")]
fn append_audit(
    app: &AppHandle,
    outcome: &str,
    key_id: &str,
    integration_id: &str,
) -> Result<(), String> {
    append_audit_detail(app, outcome, key_id, integration_id, None, None)
}

#[cfg(target_os = "linux")]
fn open_audit(dir: &Path) -> Result<fs::File, String> {
    use std::os::unix::fs::OpenOptionsExt;
    let path = dir.join("bridge-audit.jsonl");
    let open = || {
        fs::OpenOptions::new()
            .append(true)
            .create(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&path)
            .map_err(|_| DENIED.to_string())
    };
    let file = open()?;
    let meta = file.metadata().map_err(|_| DENIED)?;
    if !meta.is_file() {
        return Err(DENIED.into());
    }
    if meta.len() >= 10 * 1024 * 1024 {
        drop(file);
        fs::rename(&path, dir.join("bridge-audit.previous.jsonl")).map_err(|_| DENIED)?;
        return open();
    }
    Ok(file)
}

#[cfg(target_os = "linux")]
fn append_audit_detail(
    app: &AppHandle,
    outcome: &str,
    key_id: &str,
    integration_id: &str,
    error: Option<Value>,
    status: Option<u16>,
) -> Result<(), String> {
    use std::io::Write;
    static AUDIT_LOCK: Mutex<()> = Mutex::new(());
    let _guard = AUDIT_LOCK.lock().map_err(|_| DENIED)?;
    let dir = app.path().app_data_dir().map_err(|_| DENIED)?;
    fs::create_dir_all(&dir).map_err(|_| DENIED)?;
    let mut file = open_audit(&dir)?;
    let mut event = audit_event(outcome, key_id, integration_id);
    event.error = error;
    event.status = status;
    let mut line = serde_json::to_vec(&event).map_err(|_| DENIED)?;
    line.push(b'\n');
    file.write_all(&line)
        .and_then(|_| file.sync_all())
        .map_err(|_| DENIED.into())
}

#[tauri::command]
pub fn bridge_history(app: AppHandle, key_id: String) -> Result<Vec<Audit>, String> {
    use std::io::Read;
    let dir = app.path().app_data_dir().map_err(|_| DENIED)?;
    let mut records = Vec::new();
    for name in ["bridge-audit.previous.jsonl", "bridge-audit.jsonl"] {
        let file = match fs::File::open(dir.join(name)) {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return Err(DENIED.into()),
        };
        // One bounded record may take a file just beyond the rotation threshold.
        let mut raw = String::new();
        file.take(10 * 1024 * 1024 + 4097)
            .read_to_string(&mut raw)
            .map_err(|_| DENIED)?;
        if raw.len() > 10 * 1024 * 1024 + 4096 {
            return Err(DENIED.into());
        }
        records.extend(
            raw.lines()
                .filter_map(|s| serde_json::from_str::<Audit>(s).ok())
                .filter(|a| a.key_id == key_id),
        );
    }
    records.reverse();
    records.truncate(100);
    Ok(records)
}

#[cfg(target_os = "linux")]
fn read_delivery(stream: &mut std::os::unix::net::UnixStream) -> Result<Delivery, String> {
    use std::io::{Read, Write};
    stream.write_all(b"KPBRIDGE1\n").map_err(|_| DENIED)?;
    let mut header = [0; 4];
    stream.read_exact(&mut header).map_err(|_| DENIED)?;
    let len = u32::from_be_bytes(header) as usize;
    if len == 0 || len > 32_768 {
        return Err(DENIED.into());
    }
    let mut data = Zeroizing::new(vec![0; len]);
    stream.read_exact(&mut data).map_err(|_| DENIED)?;
    let delivery: Delivery = serde_json::from_slice(&data).map_err(|_| DENIED)?;
    if !valid_identifier(&delivery.identifier)
        || delivery.secret.contains('\0')
        || delivery.secret.len() > 16_384
    {
        return Err(DENIED.into());
    }
    Ok(delivery)
}

#[cfg(target_os = "linux")]
fn clean_environment(command: &mut std::process::Command) {
    command
        .env_clear()
        .env("PATH", "/usr/local/bin:/usr/bin:/bin");
    for key in [
        "HOME",
        "USER",
        "LANG",
        "LC_ALL",
        "DISPLAY",
        "WAYLAND_DISPLAY",
        "XDG_RUNTIME_DIR",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
        "DBUS_SESSION_BUS_ADDRESS",
        "XAUTHORITY",
    ] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
}

/// Entry point before Tauri/single-instance initialization. The only request
/// capability is the inherited socket; no path, UID or claimed tool identity.
#[cfg(target_os = "linux")]
pub fn child() -> Result<(), String> {
    use std::{
        os::fd::FromRawFd,
        os::unix::net::UnixStream,
        process::{Command, Stdio},
    };
    // Parent dup2s its private socket onto FD 198 in pre_exec. Restore CLOEXEC
    // immediately; the terminal and tool must never inherit this capability.
    if unsafe { libc::fcntl(198, libc::F_SETFD, libc::FD_CLOEXEC) } == -1 {
        return Err(DENIED.into());
    }
    let mut stream = unsafe { UnixStream::from_raw_fd(198) };
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|_| DENIED)?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|_| DENIED)?;
    let delivery = read_delivery(&mut stream)?;
    drop(stream);
    // Dedicated Konsole process is part of the explicitly approved consumer chain.
    let mut command = Command::new("/usr/bin/konsole");
    clean_environment(&mut command);
    command
        .env(&delivery.identifier, &delivery.secret)
        .args(["--separate", "-e", &delivery.executable])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if delivery.kind == "codex" {
        if delivery.identifier != "OPENAI_API_KEY" {
            return Err(DENIED.into());
        }
        // Provider-specific env_key avoids persistent login/auth.json. Command
        // arguments contain configuration only, never the key value.
        for config in [
            "model_provider=\"kpassword\"",
            "model_providers.kpassword.name=\"OpenAI\"",
            "model_providers.kpassword.base_url=\"https://api.openai.com/v1\"",
            "model_providers.kpassword.env_key=\"OPENAI_API_KEY\"",
            "model_providers.kpassword.requires_openai_auth=false",
            "model_providers.kpassword.wire_api=\"responses\"",
            "cli_auth_credentials_store=\"ephemeral\"",
        ] {
            command.args(["-c", config]);
        }
    } else if delivery.kind == "claude" {
        if delivery.identifier != "ANTHROPIC_API_KEY" {
            return Err(DENIED.into());
        }
    } else if delivery.kind != "custom" {
        return Err(DENIED.into());
    }
    let mut terminal = command.spawn().map_err(|_| DENIED)?;
    drop(command);
    drop(delivery);
    let _ = terminal.wait();
    Ok(())
}

#[tauri::command]
pub async fn bridge_launch(
    app: AppHandle,
    state: State<'_, BridgeState>,
    key_id: String,
    integration_id: String,
    generation: u64,
) -> Result<(), String> {
    let _ = (app, state, key_id, integration_id, generation);
    // The proxy-only mode never exports a key to a consumer process.
    Err("error.bridge.deliveryDisabled".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn external_requests_accept_ids_only() {
        let args = vec!["kpassword", "--bridge-request", "key-a", "tool-a"]
            .into_iter()
            .map(String::from)
            .collect::<Vec<_>>();
        assert!(request_from_args(&args).is_some());
        for value in ["", "../secret", "key\nsecret", "key with space"] {
            let mut bad = args.clone();
            bad[2] = value.into();
            assert!(request_from_args(&bad).is_none());
        }
        let mut extra = args.clone();
        extra.push("secret-value".into());
        assert!(request_from_args(&extra).is_none());
        let mut short = args;
        short.pop();
        assert!(request_from_args(&short).is_none());
    }
    fn plain() -> Value {
        json!({"settings":{"secretsBridgeEnabled":true},"credentials":[{"id":"key-a","itemType":"api_key","password":"fake-key-a","apiIdentifier":"OPENAI_API_KEY","apiApplications":[{"id":"tool-a","name":"Test","executable":"/usr/bin/true","sha256":"fake"}]},{"id":"key-b","itemType":"api_key","password":"fake-key-b","apiIdentifier":"ANTHROPIC_API_KEY"}]})
    }
    fn core() -> Core {
        Core {
            generation: 1,
            close_reason: "bridge_inactive",
            session: Some(Session {
                generation: 1,
                expires: Instant::now() + Duration::from_secs(60),
                vault_name: "vault".into(),
                file_hash: vec![],
                content_hash: vec![],
                keys: parse_keys(&plain()).unwrap(),
            }),
        }
    }
    #[test]
    fn disabled_by_default() {
        assert!(Core::default().authorize(0, "key-a", "tool-a").is_err());
        let mut p = plain();
        p["settings"] = json!({});
        assert!(parse_keys(&p).is_err());
    }
    #[test]
    fn only_explicit_record_and_tool_are_authorized() {
        let c = core();
        assert!(c.authorize(1, "key-a", "tool-a").is_ok());
        assert!(c.authorize(1, "key-b", "tool-a").is_err());
        assert!(c.authorize(1, "key-a", "spoofed").is_err());
    }
    #[test]
    fn close_revokes_pending_requests() {
        let mut c = core();
        c.close();
        assert!(c.authorize(1, "key-a", "tool-a").is_err());
    }
    #[test]
    fn close_cancels_an_activation_that_is_still_decrypting() {
        let mut c = core();
        let pending = c.session.take().unwrap();
        c.close();
        assert!(c.install_session(1, pending).is_err());
        assert!(c.session.is_none());
        assert!(c.authorize(c.generation, "key-a", "tool-a").is_err());
        let mut fresh = core().session.take().unwrap();
        fresh.generation = c.generation;
        assert!(c.install_session(c.generation, fresh).is_ok());
        assert!(c.authorize(c.generation, "key-a", "tool-a").is_ok());
    }
    #[test]
    fn stale_generation_and_expiry_fail_closed() {
        let mut c = core();
        assert!(c.authorize(0, "key-a", "tool-a").is_err());
        c.session.as_mut().unwrap().expires = Instant::now();
        assert!(c.authorize(1, "key-a", "tool-a").is_err());
    }
    #[test]
    fn revoking_grant_blocks_delivery() {
        let mut c = core();
        c.session
            .as_mut()
            .unwrap()
            .keys
            .get_mut("key-a")
            .unwrap()
            .integrations
            .clear();
        assert!(c.authorize(1, "key-a", "tool-a").is_err());
    }
    #[test]
    fn trashed_keys_are_not_available() {
        let mut p = plain();
        p["credentials"][0]["deletedAt"] = json!("2026-01-01");
        assert!(!parse_keys(&p).unwrap().contains_key("key-a"));
    }
    #[test]
    fn loader_variables_and_nul_are_rejected() {
        for s in ["PATH", "LD_PRELOAD", "NODE_OPTIONS", "X_API_KEY\n"] {
            assert!(!valid_identifier(s));
        }
        let mut p = plain();
        p["credentials"][0]["password"] = json!("fake\0key");
        assert!(parse_keys(&p).is_err());
    }
    #[test]
    fn errors_never_contain_secret_values() {
        let c = core();
        let e = c.authorize(1, "key-a", "spoofed").err().unwrap();
        assert!(!e.contains("fake-key"));
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn audit_rotates_instead_of_blocking_future_connections() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let dir = std::env::temp_dir().join(format!(
            "kp-audit-{}-{}",
            std::process::id(),
            super::super::now_epoch_millis()
        ));
        fs::create_dir(&dir).unwrap();
        let file = open_audit(&dir).unwrap();
        file.set_len(10 * 1024 * 1024).unwrap();
        drop(file);
        let file = open_audit(&dir).unwrap();
        assert_eq!(file.metadata().unwrap().len(), 0);
        assert_eq!(file.metadata().unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(
            fs::metadata(dir.join("bridge-audit.previous.jsonl"))
                .unwrap()
                .len(),
            10 * 1024 * 1024
        );
        drop(file);
        fs::remove_file(dir.join("bridge-audit.jsonl")).unwrap();
        symlink(
            dir.join("bridge-audit.previous.jsonl"),
            dir.join("bridge-audit.jsonl"),
        )
        .unwrap();
        assert!(open_audit(&dir).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn audit_has_metadata_only() {
        let c = core();
        let _ = c.authorize(1, "key-a", "tool-a").unwrap();
        let s = serde_json::to_string(&audit_event("approved", "key-a", "tool-a")).unwrap();
        assert!(!s.contains("fake-key"));
        assert!(!s.contains("password"));
        assert!(!s.contains("secret"));
    }
    #[test]
    fn audit_rejects_unbounded_and_injected_ids() {
        assert_eq!(audit_event("denied", "x\nsecret", "x").key_id, "invalid");
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn oversized_ipc_reply_is_rejected_before_allocation() {
        use std::io::Write;
        let (mut a, mut b) = std::os::unix::net::UnixStream::pair().unwrap();
        std::thread::spawn(move || {
            b.write_all(&u32::MAX.to_be_bytes()).unwrap();
        });
        assert!(read_delivery(&mut a).is_err());
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn private_socket_exchanges_only_the_requested_record() {
        use std::io::{Read, Write};
        let (mut a, mut b) = std::os::unix::net::UnixStream::pair().unwrap();
        let thread = std::thread::spawn(move || {
            let mut hello = [0; 10];
            b.read_exact(&mut hello).unwrap();
            assert_eq!(&hello, b"KPBRIDGE1\n");
            let data = serde_json::to_vec(&Delivery {
                identifier: "OPENAI_API_KEY".into(),
                secret: "fake-key-a".into(),
                executable: "/usr/bin/true".into(),
                kind: "custom".into(),
            })
            .unwrap();
            b.write_all(&(data.len() as u32).to_be_bytes()).unwrap();
            b.write_all(&data).unwrap();
        });
        let d = read_delivery(&mut a).unwrap();
        assert_eq!(d.secret, "fake-key-a");
        thread.join().unwrap();
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn truncated_reply_fails_closed() {
        use std::io::{Read, Write};
        let (mut a, mut b) = std::os::unix::net::UnixStream::pair().unwrap();
        a.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        let thread = std::thread::spawn(move || {
            let mut h = [0; 10];
            b.read_exact(&mut h).unwrap();
            b.write_all(&50u32.to_be_bytes()).unwrap();
            b.write_all(b"{\"secret\":").unwrap();
            b.shutdown(std::net::Shutdown::Both).unwrap();
        });
        assert!(read_delivery(&mut a).is_err());
        thread.join().unwrap();
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn executable_replacement_changes_fingerprint() {
        use std::os::unix::fs::PermissionsExt;
        let p = std::env::temp_dir().join(format!(
            "kpassword-bridge-executable-{}-{}",
            std::process::id(),
            super::super::now_epoch_millis()
        ));
        fs::write(&p, b"#!/bin/sh\nexit 0\n").unwrap();
        fs::set_permissions(&p, fs::Permissions::from_mode(0o700)).unwrap();
        let first = fingerprint(p.to_str().unwrap()).unwrap();
        fs::write(&p, b"#!/bin/sh\nexit 1\n").unwrap();
        let second = fingerprint(p.to_str().unwrap()).unwrap();
        assert_ne!(first.1, second.1);
        fs::remove_file(p).unwrap();
    }
    #[cfg(target_os = "linux")]
    fn version(seed: u64) -> FileVersion {
        FileVersion {
            dev: 1,
            ino: seed,
            size: 10,
            mtime_ns: 1_000,
            ctime_ns: 1_000,
        }
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn fingerprint_cache_hits_only_the_identical_file_version() {
        let mut cache = FingerprintCache::new();
        let v = version(7);
        assert_eq!(cache.get(&v), None);
        cache.insert(v, "hash-a".into(), i128::MAX / 2);
        assert_eq!(cache.get(&v).as_deref(), Some("hash-a"));
        assert_eq!(cache.get(&v).as_deref(), Some("hash-a"));
        for changed in [
            FileVersion { dev: 2, ..v },
            FileVersion { ino: 8, ..v },
            FileVersion { size: 11, ..v },
            FileVersion {
                mtime_ns: 1_001,
                ..v
            },
            FileVersion {
                ctime_ns: 1_001,
                ..v
            },
        ] {
            assert_eq!(cache.get(&changed), None, "{changed:?}");
        }
        cache.insert(v, "hash-b".into(), i128::MAX / 2);
        assert_eq!(cache.get(&v).as_deref(), Some("hash-b"));
        assert_eq!(cache.entries.len(), 1);
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn fingerprint_cache_skips_recent_versions_and_stays_bounded() {
        let mut cache = FingerprintCache::new();
        // ctime within the timestamp-granularity window of the hash start: never cached.
        let recent = FileVersion {
            ctime_ns: 10_000_000_000,
            ..version(1)
        };
        cache.insert(recent, "racy".into(), 11_000_000_000);
        assert_eq!(cache.get(&recent), None);
        cache.insert(recent, "settled".into(), 12_000_000_000);
        assert_eq!(cache.get(&recent).as_deref(), Some("settled"));
        let mut cache = FingerprintCache::new();
        for i in 0..FingerprintCache::CAPACITY as u64 {
            cache.insert(version(i), format!("h{i}"), i128::MAX / 2);
        }
        assert!(cache.get(&version(0)).is_some()); // Most recently used now; version(1) is the oldest.
        cache.insert(version(1000), "new".into(), i128::MAX / 2);
        assert_eq!(cache.entries.len(), FingerprintCache::CAPACITY);
        assert_eq!(cache.get(&version(1)), None);
        assert!(cache.get(&version(0)).is_some());
        assert_eq!(cache.get(&version(1000)).as_deref(), Some("new"));
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn fingerprint_uses_cache_for_same_version_and_rehashes_changed_file() {
        use std::os::unix::fs::PermissionsExt;
        let p = std::env::temp_dir().join(format!(
            "kpassword-bridge-cache-{}-{}",
            std::process::id(),
            super::super::now_epoch_millis()
        ));
        fs::write(&p, b"#!/bin/sh\nexit 0\n").unwrap();
        fs::set_permissions(&p, fs::Permissions::from_mode(0o700)).unwrap();
        let path = p.to_str().unwrap();
        let (_, real) = fingerprint(path).unwrap();
        assert_eq!(
            real,
            format!("{:x}", Sha256::digest(b"#!/bin/sh\nexit 0\n"))
        );
        // A fresh file is inside the granularity window, so it was not cached.
        let v = FileVersion::of(&fs::metadata(&p).unwrap());
        assert_eq!(FINGERPRINTS.lock().unwrap().get(&v), None);
        // Plant a marker for this exact version: a hit must return it unchanged.
        FINGERPRINTS
            .lock()
            .unwrap()
            .insert(v, "cached-marker".into(), i128::MAX / 2);
        assert_eq!(fingerprint(path).unwrap().1, "cached-marker");
        fs::write(&p, b"#!/bin/sh\nexit 10\n").unwrap();
        assert_eq!(
            fingerprint(path).unwrap().1,
            format!("{:x}", Sha256::digest(b"#!/bin/sh\nexit 10\n"))
        );
        fs::remove_file(p).unwrap();
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn large_native_executables_are_supported_with_a_bounded_limit() {
        use std::os::unix::fs::PermissionsExt;
        let p = std::env::temp_dir().join(format!(
            "kpassword-bridge-large-{}-{}",
            std::process::id(),
            super::super::now_epoch_millis()
        ));
        let file = fs::File::create(&p).unwrap();
        fs::set_permissions(&p, fs::Permissions::from_mode(0o700)).unwrap();
        // Sparse synthetic executable: exercise the actual streaming hash above the old limit.
        file.set_len(140 * 1024 * 1024).unwrap();
        assert!(fingerprint(p.to_str().unwrap()).is_ok());
        const { assert!(246_107_320 <= MAX_EXECUTABLE_BYTES) }; // Current native Claude binary size.
        const { assert!(294_451_848 <= MAX_EXECUTABLE_BYTES) }; // Current native Codex binary size.
        file.set_len(MAX_EXECUTABLE_BYTES + 1).unwrap();
        assert!(fingerprint(p.to_str().unwrap()).is_err());
        drop(file);
        fs::remove_file(p).unwrap();
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn child_environment_does_not_inherit_unrelated_keys_or_loader_options() {
        let mut c = std::process::Command::new("/usr/bin/true");
        c.env("OTHER_API_KEY", "fake-other")
            .env("LD_PRELOAD", "fake-loader");
        clean_environment(&mut c);
        c.env("OPENAI_API_KEY", "fake-selected");
        let names: Vec<_> = c
            .get_envs()
            .filter(|(_, v)| v.is_some())
            .map(|(k, _)| k.to_str().unwrap())
            .collect();
        assert!(!names.contains(&"OTHER_API_KEY"));
        assert!(!names.contains(&"LD_PRELOAD"));
        assert!(names.contains(&"OPENAI_API_KEY"));
    }
    #[test]
    fn serialized_delivery_contains_one_key_only() {
        let c = core();
        let (k, i) = c.authorize(1, "key-a", "tool-a").unwrap();
        let d = Delivery {
            secret: k.secret.to_string(),
            identifier: k.identifier.clone(),
            executable: i.executable.clone(),
            kind: "custom".into(),
        };
        let s = serde_json::to_string(&d).unwrap();
        assert!(s.contains("fake-key-a"));
        assert!(!s.contains("fake-key-b"));
        assert!(!s.contains("master"));
    }
}
#[test]
fn only_operational_history_changes_preserve_content_identity() {
    let value = serde_json::json!({"credentials":[{"password":"fictitious"}],"settings":{"secretsBridgeEnabled":true},"updatedAt":"before","actionHistory":[]});
    let original = content_digest(&value).unwrap();
    let mut history = value.clone();
    history["updatedAt"] = serde_json::json!("after");
    history["actionHistory"] = serde_json::json!([{"type":"vault_unlocked"}]);
    assert_eq!(content_digest(&history).unwrap(), original);
    history["credentials"][0]["password"] = serde_json::json!("changed");
    assert_ne!(content_digest(&history).unwrap(), original);
    let mut settings = value.clone();
    settings["settings"]["secretsBridgeEnabled"] = serde_json::json!(false);
    assert_ne!(content_digest(&settings).unwrap(), original);
}
