//! Opt-in, controlled launch. No network listener and no public secret API.
use std::{collections::HashMap, fs, path::Path, sync::Mutex, time::{Duration, Instant}};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};
use zeroize::Zeroizing;

const DENIED: &str = "Secrets Bridge: acesso negado ou sessão expirada.";
#[cfg(target_os = "linux")]
const MAX_EXECUTABLE_BYTES: u64 = 512 * 1024 * 1024;
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Integration { pub id: String, pub name: String, pub executable: String, pub sha256: String, #[serde(default="custom_kind")] pub kind: String }
fn custom_kind() -> String { "custom".into() }
struct Key { secret: Zeroizing<String>, identifier: String, integrations: Vec<Integration> }
struct Session { generation: u64, expires: Instant, vault_name: String, file_hash: Vec<u8>, keys: HashMap<String, Key> }
#[derive(Default)]
struct Core { generation: u64, session: Option<Session> }
#[derive(Default)]
pub struct BridgeState(Mutex<Core>);

impl Core {
    fn close(&mut self) { self.generation = self.generation.wrapping_add(1); self.session = None; }
    fn authorize(&self, generation: u64, key_id: &str, integration_id: &str) -> Result<(&Key, &Integration), String> {
        let session = self.session.as_ref().ok_or(DENIED)?;
        if session.generation != generation || session.expires <= Instant::now() { return Err(DENIED.into()); }
        let key = session.keys.get(key_id).ok_or(DENIED)?;
        let integration = key.integrations.iter().find(|i| i.id == integration_id).ok_or(DENIED)?;
        Ok((key, integration))
    }
}

pub fn close(app: &AppHandle) {
    if let Some(state) = app.try_state::<BridgeState>() {
        if let Ok(mut core) = state.0.lock() { core.close(); }
    }
}

pub fn valid_identifier(s: &str) -> bool {
    let suffix = ["_API_KEY", "_TOKEN", "_SECRET"].iter().find(|suffix| s.ends_with(**suffix));
    let Some(suffix) = suffix else { return false; };
    let prefix = &s[..s.len() - suffix.len()];
    !prefix.is_empty() && prefix.len() <= 64 && prefix.as_bytes()[0].is_ascii_uppercase()
        && prefix.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
}

fn parse_keys(plain: &Value) -> Result<HashMap<String, Key>, String> {
    if plain["settings"]["secretsBridgeEnabled"] != true { return Err(DENIED.into()); }
    let mut keys = HashMap::new();
    for record in plain["credentials"].as_array().ok_or(DENIED)? {
        if record["itemType"] != "api_key" || record.get("deletedAt").is_some_and(|v| !v.is_null() && v != "") { continue; }
        let secret = record["password"].as_str().ok_or(DENIED)?;
        let identifier = record["apiIdentifier"].as_str().ok_or(DENIED)?;
        if !valid_identifier(identifier) || secret.trim().is_empty() || secret.contains('\0') || secret.len() > 16_384 { return Err(DENIED.into()); }
        let integrations = match record.get("apiApplications") {
            Some(v) => serde_json::from_value::<Vec<Integration>>(v.clone()).map_err(|_| DENIED)?,
            None => Vec::new(),
        };
        if integrations.len() > 32 { return Err(DENIED.into()); }
        let id = record["id"].as_str().ok_or(DENIED)?.to_string();
        if keys.contains_key(&id) { return Err(DENIED.into()); }
        keys.insert(id, Key { secret: Zeroizing::new(secret.into()), identifier: identifier.into(), integrations });
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

#[tauri::command]
pub fn bridge_close(app: AppHandle) { close(&app); }

#[tauri::command]
pub fn bridge_open(app: AppHandle, state: State<BridgeState>, vault_name: String, master_password: String) -> Result<u64, String> {
    close(&app);
    let password = Zeroizing::new(master_password);
    let (path, _, name) = super::storage_paths(&app, Some(vault_name))?;
    let raw = fs::read(&path).map_err(|_| DENIED)?;
    let encrypted: Value = serde_json::from_slice(&raw).map_err(|_| DENIED)?;
    let plaintext = Zeroizing::new(super::crypto_vault::decrypt_vault_file(&encrypted, &password).map_err(|_| DENIED)?);
    let mut plain: Value = serde_json::from_str(&plaintext).map_err(|_| DENIED)?;
    let result = parse_keys(&plain);
    let minutes = plain["settings"]["autoLockMinutes"].as_u64().unwrap_or(1).clamp(1, 120);
    erase_json(&mut plain);
    let keys = result?;
    let mut core = state.0.lock().map_err(|_| DENIED)?;
    let generation = core.generation;
    core.session = Some(Session { generation, expires: Instant::now() + Duration::from_secs(minutes * 60), vault_name: name, file_hash: Sha256::digest(&raw).to_vec(), keys });
    #[cfg(target_os="linux")]
    {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(minutes*60)).await;
            if let Some(state)=app.try_state::<BridgeState>() {
                if let Ok(mut core)=state.0.lock() {
                    if core.generation==generation { core.close(); }
                }
            }
        });
    }
    Ok(generation)
}

#[cfg(target_os = "linux")]
fn fingerprint(path: &str) -> Result<(String, String), String> {
    use std::{io::Read, os::unix::fs::MetadataExt};
    if !Path::new(path).is_absolute() || path.contains(['\n', '\r', '\0']) { return Err(DENIED.into()); }
    let canonical = fs::canonicalize(path).map_err(|_| DENIED)?;
    let mut file = fs::File::open(&canonical).map_err(|_| DENIED)?;
    let meta = file.metadata().map_err(|_| DENIED)?;
    if !meta.is_file() || meta.len() > MAX_EXECUTABLE_BYTES || meta.mode() & 0o111 == 0 || meta.mode() & 0o022 != 0 { return Err(DENIED.into()); }
    let mut hash = Sha256::new();
    let mut buf = [0; 16_384];
    let mut total = 0u64;
    loop { let n = file.read(&mut buf).map_err(|_| DENIED)?; if n == 0 { break; } total += n as u64; if total > MAX_EXECUTABLE_BYTES { return Err(DENIED.into()); } hash.update(&buf[..n]); }
    Ok((canonical.to_str().ok_or(DENIED)?.into(), format!("{:x}", hash.finalize())))
}

#[tauri::command]
pub fn bridge_prepare(executable: String, name: String, kind: Option<String>) -> Result<Integration, String> {
    #[cfg(target_os = "linux")]
    {
        if name.trim().is_empty() || name.len() > 64 || name.chars().any(char::is_control) { return Err(DENIED.into()); }
        let (executable, sha256) = fingerprint(&executable)?;
        let kind = kind.unwrap_or_else(custom_kind);
        if !["claude", "codex", "custom"].contains(&kind.as_str()) { return Err(DENIED.into()); }
        let mut bytes = [0; 16]; getrandom::fill(&mut bytes).map_err(|_| DENIED)?;
        Ok(Integration { id: bytes.iter().map(|b| format!("{b:02x}")).collect(), name: name.trim().into(), executable, sha256, kind })
    }
    #[cfg(not(target_os = "linux"))]
    { let _ = (executable, name, kind); Err("Inicializador disponível apenas no Linux.".into()) }
}

#[derive(Serialize, Deserialize)]
struct Delivery { identifier: String, secret: String, executable: String, kind: String }
impl Drop for Delivery { fn drop(&mut self) { use zeroize::Zeroize; self.secret.zeroize(); } }

#[derive(Serialize, Deserialize)]
pub struct Audit { at: u128, outcome: String, key_id: String, integration_id: String }
fn audit_event(outcome: &str, key_id: &str, integration_id: &str) -> Audit {
    fn safe_id(s: &str) -> String {
        if s.len() <= 128 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') { s.into() } else { "invalid".into() }
    }
    Audit { at: super::now_epoch_millis(), outcome: outcome.into(), key_id: safe_id(key_id), integration_id: safe_id(integration_id) }
}

#[cfg(target_os="linux")]
fn append_audit(app: &AppHandle, outcome: &str, key_id: &str, integration_id: &str) -> Result<(), String> {
    use std::{io::Write, os::unix::fs::OpenOptionsExt};
    let dir = app.path().app_data_dir().map_err(|_| DENIED)?;
    fs::create_dir_all(&dir).map_err(|_| DENIED)?;
    let mut file = fs::OpenOptions::new().append(true).create(true).mode(0o600).custom_flags(libc::O_NOFOLLOW)
        .open(dir.join("bridge-audit.jsonl")).map_err(|_| DENIED)?;
    if !file.metadata().map_err(|_| DENIED)?.is_file() || file.metadata().map_err(|_| DENIED)?.len() > 10 * 1024 * 1024 { return Err(DENIED.into()); }
    let mut line = serde_json::to_vec(&audit_event(outcome, key_id, integration_id)).map_err(|_| DENIED)?;
    line.push(b'\n');
    file.write_all(&line).and_then(|_| file.sync_all()).map_err(|_| DENIED.into())
}

#[tauri::command]
pub fn bridge_history(app: AppHandle, key_id: String) -> Result<Vec<Audit>, String> {
    use std::io::Read;
    let path = app.path().app_data_dir().map_err(|_| DENIED)?.join("bridge-audit.jsonl");
    let file = match fs::File::open(path) { Ok(f) => f, Err(e) if e.kind()==std::io::ErrorKind::NotFound => return Ok(vec![]), Err(_) => return Err(DENIED.into()) };
    let mut raw = String::new();file.take(10*1024*1024+1).read_to_string(&mut raw).map_err(|_| DENIED)?;
    if raw.len()>10*1024*1024 { return Err(DENIED.into()); }
    let mut records: Vec<Audit> = raw.lines().filter_map(|s| serde_json::from_str::<Audit>(s).ok()).filter(|a| a.key_id==key_id).collect();
    records.reverse(); records.truncate(100);Ok(records)
}

#[cfg(target_os = "linux")]
fn read_delivery(stream: &mut std::os::unix::net::UnixStream) -> Result<Delivery, String> {
    use std::io::{Read, Write};
    stream.write_all(b"KPBRIDGE1\n").map_err(|_| DENIED)?;
    let mut header = [0; 4]; stream.read_exact(&mut header).map_err(|_| DENIED)?;
    let len = u32::from_be_bytes(header) as usize;
    if len == 0 || len > 32_768 { return Err(DENIED.into()); }
    let mut data = Zeroizing::new(vec![0; len]); stream.read_exact(&mut data).map_err(|_| DENIED)?;
    let delivery: Delivery = serde_json::from_slice(&data).map_err(|_| DENIED)?;
    if !valid_identifier(&delivery.identifier) || delivery.secret.contains('\0') || delivery.secret.len() > 16_384 { return Err(DENIED.into()); }
    Ok(delivery)
}

#[cfg(target_os = "linux")]
fn clean_environment(command: &mut std::process::Command) {
    command.env_clear().env("PATH", "/usr/local/bin:/usr/bin:/bin");
    for key in ["HOME", "USER", "LANG", "LC_ALL", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "DBUS_SESSION_BUS_ADDRESS", "XAUTHORITY"] {
        if let Some(value) = std::env::var_os(key) { command.env(key, value); }
    }
}

/// Entry point before Tauri/single-instance initialization. The only request
/// capability is the inherited socket; no path, UID or claimed tool identity.
#[cfg(target_os = "linux")]
pub fn child() -> Result<(), String> {
    use std::{os::fd::FromRawFd, os::unix::net::UnixStream, process::{Command, Stdio}};
    // Parent dup2s its private socket onto FD 198 in pre_exec. Restore CLOEXEC
    // immediately; the terminal and tool must never inherit this capability.
    if unsafe { libc::fcntl(198, libc::F_SETFD, libc::FD_CLOEXEC) } == -1 { return Err(DENIED.into()); }
    let mut stream = unsafe { UnixStream::from_raw_fd(198) };
    stream.set_read_timeout(Some(Duration::from_secs(5))).map_err(|_| DENIED)?;
    stream.set_write_timeout(Some(Duration::from_secs(5))).map_err(|_| DENIED)?;
    let delivery = read_delivery(&mut stream)?;
    drop(stream);
    // Dedicated Konsole process is part of the explicitly approved consumer chain.
    let mut command = Command::new("/usr/bin/konsole");
    clean_environment(&mut command);
    command.env(&delivery.identifier, &delivery.secret)
        .args(["--separate", "--hold", "-e", &delivery.executable])
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    if delivery.kind == "codex" {
        if delivery.identifier != "OPENAI_API_KEY" { return Err(DENIED.into()); }
        // Provider-specific env_key avoids persistent login/auth.json. Command
        // arguments contain configuration only, never the key value.
        for config in ["model_provider=\"kpassword\"", "model_providers.kpassword.name=\"OpenAI\"", "model_providers.kpassword.base_url=\"https://api.openai.com/v1\"", "model_providers.kpassword.env_key=\"OPENAI_API_KEY\"", "model_providers.kpassword.requires_openai_auth=false", "model_providers.kpassword.wire_api=\"responses\"", "cli_auth_credentials_store=\"ephemeral\""] {
            command.args(["-c", config]);
        }
    } else if delivery.kind == "claude" {
        if delivery.identifier != "ANTHROPIC_API_KEY" { return Err(DENIED.into()); }
    } else if delivery.kind != "custom" { return Err(DENIED.into()); }
    let mut terminal = command.spawn().map_err(|_| DENIED)?;
    drop(command);
    drop(delivery);
    let _ = terminal.wait();
    Ok(())
}

#[tauri::command]
pub async fn bridge_launch(app: AppHandle, state: State<'_, BridgeState>, key_id: String, integration_id: String, generation: u64) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        use std::{io::{Read, Write}, os::{fd::AsRawFd, unix::{net::UnixStream, process::CommandExt}}, process::{Command, Stdio}};
        {
            let core = state.0.lock().map_err(|_| DENIED)?;
            if core.authorize(generation, &key_id, &integration_id).is_err() {
                append_audit(&app,"denied",&key_id,&integration_id)?;
                return Err(DENIED.into());
            }
        }
        let (mut server, client) = UnixStream::pair().map_err(|_| DENIED)?;
        server.set_read_timeout(Some(Duration::from_secs(5))).map_err(|_| DENIED)?;
        server.set_write_timeout(Some(Duration::from_secs(2))).map_err(|_| DENIED)?;
        let fd = client.as_raw_fd();
        let mut command = Command::new(std::env::current_exe().map_err(|_| DENIED)?);
        clean_environment(&mut command);
        command.arg("--secrets-bridge-child").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        unsafe { command.pre_exec(move || {
            if libc::dup2(fd, 198) == -1 || libc::fcntl(198, libc::F_SETFD, 0) == -1 { return Err(std::io::Error::last_os_error()); }
            Ok(())
        }); }
        let mut child = command.spawn().map_err(|_| DENIED)?;
        drop(client);
        // Wait outside the policy lock; blocking/locking the vault can revoke
        // while this one-use launcher is negotiating its protocol version.
        let handshake = tauri::async_runtime::spawn_blocking(move || {
            let mut hello = [0; 10];
            server.read_exact(&mut hello).map_err(|_| DENIED)?;
            if &hello != b"KPBRIDGE1\n" { return Err(DENIED); }
            Ok(server)
        }).await.map_err(|_| DENIED)?;
        let result = (|| {
            let mut server = handshake.map_err(|_| DENIED)?;
            let core = state.0.lock().map_err(|_| DENIED)?;
            let (key, integration) = core.authorize(generation, &key_id, &integration_id)?;
            let session = core.session.as_ref().ok_or(DENIED)?;
            let (path, _, _) = super::storage_paths(&app, Some(session.vault_name.clone()))?;
            if Sha256::digest(fs::read(path).map_err(|_| DENIED)?).as_slice() != session.file_hash { return Err(DENIED.into()); }
            let (path, hash) = fingerprint(&integration.executable)?;
            if path != integration.executable || hash != integration.sha256 { return Err(DENIED.into()); }
            // Only this record is serialized; no master password or other key.
            if (integration.kind=="claude" && key.identifier!="ANTHROPIC_API_KEY") || (integration.kind=="codex" && key.identifier!="OPENAI_API_KEY") { return Err(DENIED.into()); }
            let delivery = Delivery { identifier: key.identifier.clone(), secret: key.secret.to_string(), executable: path, kind:integration.kind.clone() };
            let data = Zeroizing::new(serde_json::to_vec(&delivery).map_err(|_| DENIED)?);
            if data.len() > 32_768 { return Err(DENIED.into()); }
            core.authorize(generation, &key_id, &integration_id)?;
            // Audit is durable before any secret is delivered. Failure denies access.
            append_audit(&app, "approved", &key_id, &integration_id)?;
            server.write_all(&(data.len() as u32).to_be_bytes()).and_then(|_| server.write_all(&data)).map_err(|_| DENIED)?;
            Ok(())
        })();
        if result.is_err() { let _ = child.kill(); let _=append_audit(&app,"denied",&key_id,&integration_id); }
        else { let _=append_audit(&app,"delivered",&key_id,&integration_id); }
        std::thread::spawn(move || { let _ = child.wait(); });
        result
    }
    #[cfg(not(target_os = "linux"))]
    { let _ = (app, state, key_id, integration_id, generation); Err("Inicializador disponível apenas no Linux.".into()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn plain() -> Value { json!({"settings":{"secretsBridgeEnabled":true},"credentials":[{"id":"key-a","itemType":"api_key","password":"fake-key-a","apiIdentifier":"OPENAI_API_KEY","apiApplications":[{"id":"tool-a","name":"Test","executable":"/usr/bin/true","sha256":"fake"}]},{"id":"key-b","itemType":"api_key","password":"fake-key-b","apiIdentifier":"ANTHROPIC_API_KEY"}]}) }
    fn core() -> Core { Core { generation: 1, session: Some(Session { generation: 1, expires: Instant::now() + Duration::from_secs(60), vault_name:"vault".into(),file_hash:vec![],keys:parse_keys(&plain()).unwrap() }) } }
    #[test] fn disabled_by_default() { assert!(Core::default().authorize(0,"key-a","tool-a").is_err()); let mut p=plain();p["settings"]=json!({});assert!(parse_keys(&p).is_err()); }
    #[test] fn only_explicit_record_and_tool_are_authorized() { let c=core();assert!(c.authorize(1,"key-a","tool-a").is_ok());assert!(c.authorize(1,"key-b","tool-a").is_err());assert!(c.authorize(1,"key-a","spoofed").is_err()); }
    #[test] fn close_revokes_pending_requests() { let mut c=core();c.close();assert!(c.authorize(1,"key-a","tool-a").is_err()); }
    #[test] fn stale_generation_and_expiry_fail_closed() { let mut c=core();assert!(c.authorize(0,"key-a","tool-a").is_err());c.session.as_mut().unwrap().expires=Instant::now();assert!(c.authorize(1,"key-a","tool-a").is_err()); }
    #[test] fn revoking_grant_blocks_delivery() { let mut c=core();c.session.as_mut().unwrap().keys.get_mut("key-a").unwrap().integrations.clear();assert!(c.authorize(1,"key-a","tool-a").is_err()); }
    #[test] fn trashed_keys_are_not_available() { let mut p=plain();p["credentials"][0]["deletedAt"]=json!("2026-01-01");assert!(!parse_keys(&p).unwrap().contains_key("key-a")); }
    #[test] fn loader_variables_and_nul_are_rejected() { for s in ["PATH","LD_PRELOAD","NODE_OPTIONS","X_API_KEY\n"] { assert!(!valid_identifier(s)); } let mut p=plain();p["credentials"][0]["password"]=json!("fake\0key");assert!(parse_keys(&p).is_err()); }
    #[test] fn errors_never_contain_secret_values() { let c=core();let e=c.authorize(1,"key-a","spoofed").err().unwrap();assert!(!e.contains("fake-key")); }
    #[test] fn audit_has_metadata_only() { let c=core();let _=c.authorize(1,"key-a","tool-a").unwrap();let s=serde_json::to_string(&audit_event("approved","key-a","tool-a")).unwrap();assert!(!s.contains("fake-key"));assert!(!s.contains("password"));assert!(!s.contains("secret")); }
    #[test] fn audit_rejects_unbounded_and_injected_ids() { assert_eq!(audit_event("denied","x\nsecret","x").key_id,"invalid"); }
    #[cfg(target_os="linux")]
    #[test] fn oversized_ipc_reply_is_rejected_before_allocation() { use std::io::Write;let (mut a,mut b)=std::os::unix::net::UnixStream::pair().unwrap();std::thread::spawn(move||{b.write_all(&u32::MAX.to_be_bytes()).unwrap();});assert!(read_delivery(&mut a).is_err()); }
    #[cfg(target_os="linux")]
    #[test] fn private_socket_exchanges_only_the_requested_record() {
        use std::io::{Read,Write};
        let (mut a,mut b)=std::os::unix::net::UnixStream::pair().unwrap();
        let thread=std::thread::spawn(move||{let mut hello=[0;10];b.read_exact(&mut hello).unwrap();assert_eq!(&hello,b"KPBRIDGE1\n");let data=serde_json::to_vec(&Delivery{identifier:"OPENAI_API_KEY".into(),secret:"fake-key-a".into(),executable:"/usr/bin/true".into(),kind:"custom".into()}).unwrap();b.write_all(&(data.len() as u32).to_be_bytes()).unwrap();b.write_all(&data).unwrap();});
        let d=read_delivery(&mut a).unwrap();assert_eq!(d.secret,"fake-key-a");thread.join().unwrap();
    }
    #[cfg(target_os="linux")]
    #[test] fn truncated_reply_fails_closed() {
        use std::io::{Read,Write};let (mut a,mut b)=std::os::unix::net::UnixStream::pair().unwrap();a.set_read_timeout(Some(Duration::from_secs(2))).unwrap();let thread=std::thread::spawn(move||{let mut h=[0;10];b.read_exact(&mut h).unwrap();b.write_all(&50u32.to_be_bytes()).unwrap();b.write_all(b"{\"secret\":").unwrap();b.shutdown(std::net::Shutdown::Both).unwrap();});assert!(read_delivery(&mut a).is_err());thread.join().unwrap();
    }
    #[cfg(target_os="linux")]
    #[test] fn executable_replacement_changes_fingerprint() {
        use std::os::unix::fs::PermissionsExt;
        let p=std::env::temp_dir().join(format!("kpassword-bridge-executable-{}-{}",std::process::id(),super::super::now_epoch_millis()));
        fs::write(&p,b"#!/bin/sh\nexit 0\n").unwrap();fs::set_permissions(&p,fs::Permissions::from_mode(0o700)).unwrap();let first=fingerprint(p.to_str().unwrap()).unwrap();fs::write(&p,b"#!/bin/sh\nexit 1\n").unwrap();let second=fingerprint(p.to_str().unwrap()).unwrap();assert_ne!(first.1,second.1);fs::remove_file(p).unwrap();
    }
    #[cfg(target_os="linux")]
    #[test] fn large_native_executables_are_supported_with_a_bounded_limit() {
        use std::os::unix::fs::PermissionsExt;
        let p=std::env::temp_dir().join(format!("kpassword-bridge-large-{}-{}",std::process::id(),super::super::now_epoch_millis()));
        let file=fs::File::create(&p).unwrap();
        fs::set_permissions(&p,fs::Permissions::from_mode(0o700)).unwrap();
        // Sparse synthetic executable: exercise the actual streaming hash above the old limit.
        file.set_len(140 * 1024 * 1024).unwrap();
        assert!(fingerprint(p.to_str().unwrap()).is_ok());
        assert!(246_107_320 <= MAX_EXECUTABLE_BYTES); // Current native Claude binary size.
        assert!(294_451_848 <= MAX_EXECUTABLE_BYTES); // Current native Codex binary size.
        file.set_len(MAX_EXECUTABLE_BYTES + 1).unwrap();
        assert!(fingerprint(p.to_str().unwrap()).is_err());
        drop(file);fs::remove_file(p).unwrap();
    }
    #[cfg(target_os="linux")]
    #[test] fn child_environment_does_not_inherit_unrelated_keys_or_loader_options() {
        let mut c=std::process::Command::new("/usr/bin/true");c.env("OTHER_API_KEY","fake-other").env("LD_PRELOAD","fake-loader");clean_environment(&mut c);c.env("OPENAI_API_KEY","fake-selected");let names:Vec<_>=c.get_envs().filter(|(_,v)|v.is_some()).map(|(k,_)|k.to_str().unwrap()).collect();assert!(!names.contains(&"OTHER_API_KEY"));assert!(!names.contains(&"LD_PRELOAD"));assert!(names.contains(&"OPENAI_API_KEY"));
    }
    #[test] fn serialized_delivery_contains_one_key_only() { let c=core();let (k,i)=c.authorize(1,"key-a","tool-a").unwrap();let d=Delivery{secret:k.secret.to_string(),identifier:k.identifier.clone(),executable:i.executable.clone(),kind:"custom".into()};let s=serde_json::to_string(&d).unwrap();assert!(s.contains("fake-key-a"));assert!(!s.contains("fake-key-b"));assert!(!s.contains("master")); }
}
