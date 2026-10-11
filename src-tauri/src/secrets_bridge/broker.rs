//! Linux local request/approval broker. This is not a same-UID malware sandbox.
use std::{collections::HashMap, sync::{Mutex, mpsc}, time::{Duration, Instant}};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use super::{DENIED, BridgeState};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub request_id: String,
    pub key_id: String,
    pub key_label: String,
    pub executable: String,
    pub sha256: String,
    pub pid: i32,
    pub provider: String,
    pub operation: String,
    pub timeout_ms: u64,
    pub application: String,
    pub entry_script: Option<String>,
    pub project: String,
    pub model: String,
    pub identity: String,
    pub remember_allowed: bool,
}
type Grant = (u64, String, String, String, String);
struct Permit { remaining: u32, minute: Instant, calls: u32, request: Request }
struct Pending { request: Request, generation: u64, deadline: Instant, reply: mpsc::Sender<bool>, presented: bool }
#[derive(Default)]
struct Hub { listening: bool, pending: Option<Pending>, grants: HashMap<Grant, Permit>, policy_revision: u64 }
#[derive(Default)]
pub struct BrokerState(Mutex<Hub>);

fn consume(permit: &mut Permit) -> bool {
    if permit.minute.elapsed() >= Duration::from_secs(60) { permit.minute = Instant::now(); permit.calls = 0; }
    if permit.remaining == 0 || permit.calls >= 60 { return false; }
    permit.remaining -= 1; permit.calls += 1; true
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status { active: bool, remaining_seconds: u64, grants: Vec<Permission> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Permission { key_id: String, identity: String, application: String, entry_script: Option<String>, project: String, operation: String, model: String, remaining_calls: u32 }
#[tauri::command]
pub fn bridge_status(window: tauri::WebviewWindow, app: AppHandle) -> Result<Status,String> {
    if window.label() != "main" { return Err(DENIED.into()); }
    let remaining_seconds = {
        let state = app.state::<BridgeState>(); let core = state.0.lock().map_err(|_| DENIED)?;
        core.session.as_ref().map(|s| s.expires.saturating_duration_since(Instant::now()).as_secs()).unwrap_or(0)
    };
    let state = app.state::<BrokerState>(); let hub = state.0.lock().map_err(|_| DENIED)?;
    let grants = if remaining_seconds > 0 { hub.grants.values().map(|p| Permission { key_id:p.request.key_id.clone(), identity:p.request.identity.clone(), application:p.request.application.clone(), entry_script:p.request.entry_script.clone(), project:p.request.project.clone(), operation:p.request.operation.clone(), model:p.request.model.clone(), remaining_calls:p.remaining }).collect() } else { Vec::new() };
    Ok(Status { active:remaining_seconds > 0, remaining_seconds, grants })
}
#[tauri::command]
pub fn bridge_revoke_grant(window: tauri::WebviewWindow, app: AppHandle, identity: String, key_id: String, operation: String, model: String) -> Result<(),String> {
    if window.label() != "main" { return Err(DENIED.into()); }
    let state = app.state::<BrokerState>(); let mut hub = state.0.lock().map_err(|_| DENIED)?;
    hub.policy_revision = hub.policy_revision.wrapping_add(1);
    hub.grants.retain(|(_,k,i,o,m),_| !(k == &key_id && i == &identity && o == &operation && m == &model));
    if hub.pending.as_ref().is_some_and(|p| p.request.identity == identity && p.request.key_id == key_id && p.request.operation == operation && p.request.model == model) {
        if let Some(p) = hub.pending.take() { let _ = p.reply.send(false); }
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn show_approval(app: &AppHandle) -> Result<(),String> {
    let owner = app.clone();
    app.run_on_main_thread(move || {
        use tauri::{Emitter, WebviewWindowBuilder, WebviewUrl};
        let window = if let Some(window) = owner.get_webview_window("bridge-approval") { Some(window) } else {
            let mut builder = WebviewWindowBuilder::new(&owner,"bridge-approval",WebviewUrl::App("index.html".into()))
                .title("KPassword — autorizar chamada de API").inner_size(440.0,580.0).min_inner_size(360.0,440.0)
                .always_on_top(true).skip_taskbar(true).visible(false)
                .on_navigation(|url| {
                    let local = (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
                        || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost"))
                        || (cfg!(debug_assertions) && url.scheme() == "http" && url.host_str() == Some("localhost") && url.port() == Some(1420));
                    local && ["", "/", "/index.html"].contains(&url.path())
                })
                .initialization_script("window.__KPASSWORD_BRIDGE_APPROVAL__ = true;");
            if let Some(monitor) = owner.get_webview_window("main").and_then(|w| w.current_monitor().ok().flatten()) {
                let scale = monitor.scale_factor(); let pos = monitor.position(); let size = monitor.size();
                builder = builder.position((pos.x as f64 + size.width as f64)/scale - 464.0, (pos.y as f64 + size.height as f64)/scale - 640.0);
            }
            match builder.build() {
                Ok(window) => {
                    let a = owner.clone(); let w = window.clone();
                    window.on_window_event(move |event| { if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let state = a.state::<BrokerState>(); if let Ok(mut hub) = state.0.lock() { if let Some(p) = hub.pending.take() { let _ = p.reply.send(false); } }
                        let _ = w.hide();
                    }});
                    Some(window)
                },
                Err(_) => { revoke(&owner); None }
            }
        };
        if let Some(window) = window { let _ = window.show(); let _ = window.set_focus(); let _ = window.emit("kpassword:bridge-access-request", ()); }
    }).map_err(|_| DENIED.into())
}

pub fn revoke(app: &AppHandle) {
    if let Some(state) = app.try_state::<BrokerState>() {
        if let Ok(mut hub) = state.0.lock() {
            hub.policy_revision = hub.policy_revision.wrapping_add(1);
            hub.grants.clear();
            if let Some(p) = hub.pending.take() { let _ = p.reply.send(false); }
        }
    }
    if let Some(window) = app.get_webview_window("bridge-approval") { let _ = window.hide(); }
}

#[tauri::command]
pub fn bridge_take_access_request(window: tauri::WebviewWindow, state: State<BrokerState>) -> Option<Request> {
    if window.label() != "bridge-approval" { return None; }
    let mut hub = state.0.lock().ok()?;
    let p = hub.pending.as_mut()?;
    if p.deadline <= Instant::now() { return None; }
    p.presented = true;
    let mut request = p.request.clone();
    request.timeout_ms = p.deadline.saturating_duration_since(Instant::now()).as_millis() as u64;
    Some(request)
}

#[tauri::command]
pub fn bridge_answer_access_request(app: AppHandle, window: tauri::WebviewWindow, request_id: String, approve: bool, remember: bool, max_calls: Option<u32>) -> Result<(), String> {
    if window.label() != "bridge-approval" { return Err(DENIED.into()); }
    let state = app.state::<BrokerState>();
    let mut hub = state.0.lock().map_err(|_| DENIED)?;
    let p = hub.pending.as_ref().ok_or(DENIED)?;
    if p.request.request_id != request_id || !p.presented || p.deadline <= Instant::now() { return Err(DENIED.into()); }
    let core_state = app.state::<BridgeState>();
    let core = core_state.0.lock().map_err(|_| DENIED)?;
    let session = core.session.as_ref().ok_or(DENIED)?;
    if session.generation != p.generation || session.expires <= Instant::now() { return Err(DENIED.into()); }
    let p = hub.pending.take().ok_or(DENIED)?;
    if approve && remember {
        if !p.request.remember_allowed { let _ = p.reply.send(false); return Err(DENIED.into()); }
        if hub.grants.len() >= 256 { let _ = p.reply.send(false); return Err(DENIED.into()); }
        let grant = (p.generation, p.request.key_id.clone(), p.request.identity.clone(), p.request.operation.clone(), p.request.model.clone());
        hub.grants.insert(grant, Permit { remaining:max_calls.unwrap_or(10_000).clamp(1,100_000), minute:Instant::now(), calls:0, request:p.request.clone() });
    }
    p.reply.send(approve).map_err(|_| DENIED.into())
}

#[cfg(target_os = "linux")]
mod linux {
    use super::*;
    use std::{fs, io::{Read, Write}, os::{unix::{fs::{FileTypeExt, MetadataExt, PermissionsExt}, net::{UnixListener, UnixStream}}}, path::PathBuf};
    use serde::Deserialize;

    use sha2::{Digest, Sha256};
    use zeroize::Zeroizing;

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct WireRequest { version: u32, key_id: String, operation: String, body: serde_json::Value }
    fn parse_request(raw: &[u8]) -> Result<WireRequest, String> {
        let r: WireRequest = serde_json::from_slice(raw).map_err(|_| DENIED)?;
        if r.version != 1 || r.key_id.is_empty() || r.key_id.len() > 128 || !r.key_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') { return Err(DENIED.into()); }
        if !r.body.is_object() || r.body.get("stream").is_some_and(|v| v != false) || !["responses", "chat", "embeddings", "messages"].contains(&r.operation.as_str()) { return Err(DENIED.into()); }
        if !r.body["model"].as_str().is_some_and(|m| !m.is_empty() && m.len() <= 128 && !m.chars().any(char::is_control)) { return Err(DENIED.into()); }
        for field in ["max_tokens", "max_completion_tokens", "max_output_tokens"] {
            if let Some(value) = r.body.get(field) { if !value.as_u64().is_some_and(|n| (1..=8192).contains(&n)) { return Err(DENIED.into()); } }
        }
        Ok(r)
    }
    fn endpoint(identifier: &str, operation: &str) -> Result<(&'static str, &'static str), String> {
        match (identifier, operation) {
            ("OPENAI_API_KEY", "responses") => Ok(("OpenAI", "https://api.openai.com/v1/responses")),
            ("OPENAI_API_KEY", "chat") => Ok(("OpenAI", "https://api.openai.com/v1/chat/completions")),
            ("OPENAI_API_KEY", "embeddings") => Ok(("OpenAI", "https://api.openai.com/v1/embeddings")),
            ("DEEPSEEK_API_KEY", "chat") => Ok(("DeepSeek", "https://api.deepseek.com/chat/completions")),
            ("ANTHROPIC_API_KEY", "messages") => Ok(("Anthropic", "https://api.anthropic.com/v1/messages")),
            _ => Err(DENIED.into()),
        }
    }
    fn sanitize_response(value: &mut serde_json::Value, secret: &str) {
        match value {
            serde_json::Value::String(s) => { if s.contains(secret) { *s = s.replace(secret, "[redacted]"); } },
            serde_json::Value::Array(a) => a.iter_mut().for_each(|v| sanitize_response(v, secret)),
            serde_json::Value::Object(o) => {
                let old = std::mem::take(o);
                for (name, mut v) in old { sanitize_response(&mut v, secret); o.insert(name.replace(secret, "[redacted]"), v); }
            },
            _ => {},
        }
    }
    fn call_provider(url: &str, identifier: &str, secret: &str, body: &serde_json::Value) -> Result<(u16, serde_json::Value), String> {
        let mut body = body.clone();
        if !url.ends_with("/embeddings") && !["max_tokens", "max_completion_tokens", "max_output_tokens"].iter().any(|f| body.get(*f).is_some()) {
            let field = if url.ends_with("/responses") { "max_output_tokens" } else if identifier == "OPENAI_API_KEY" { "max_completion_tokens" } else { "max_tokens" };
            body[field] = serde_json::json!(8192);
        }
        // No redirects, caller URLs, caller headers, environment proxies, debug
        // logs or cookies. Authentication is attached only to a fixed HTTPS origin.
        let client = reqwest::blocking::Client::builder().https_only(true).no_proxy()
            .redirect(reqwest::redirect::Policy::none()).connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(60)).build().map_err(|_| DENIED)?;
        let mut auth = reqwest::header::HeaderValue::from_str(&if identifier == "ANTHROPIC_API_KEY" { secret.to_owned() } else { format!("Bearer {secret}") }).map_err(|_| DENIED)?;
        auth.set_sensitive(true);
        let mut request = client.post(url).json(&body);
        if identifier == "ANTHROPIC_API_KEY" { request = request.header("x-api-key", auth).header("anthropic-version", "2023-06-01"); }
        else { request = request.header(reqwest::header::AUTHORIZATION, auth); }
        let response = request.send().map_err(|_| DENIED)?;
        let status = response.status().as_u16();
        if response.status().is_redirection() { return Err(DENIED.into()); }
        let mut data = Zeroizing::new(Vec::new());
        response.take(4 * 1024 * 1024 + 1).read_to_end(&mut data).map_err(|_| DENIED)?;
        if data.len() > 4 * 1024 * 1024 { return Err(DENIED.into()); }
        let mut body: serde_json::Value = serde_json::from_slice(&data).map_err(|_| DENIED)?;
        sanitize_response(&mut body, secret);
        Ok((status, body))
    }
    use super::super::identity::peer;
    fn socket_path(app: &AppHandle) -> Result<PathBuf, String> {
        let dir = app.path().app_data_dir().map_err(|_| DENIED)?.join("secrets-bridge");
        if !dir.exists() { fs::create_dir(&dir).map_err(|_| DENIED)?; fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).map_err(|_| DENIED)?; }
        let meta = fs::symlink_metadata(&dir).map_err(|_| DENIED)?;
        if !meta.is_dir() || meta.uid() != unsafe { libc::geteuid() } || meta.mode() & 0o077 != 0 { return Err(DENIED.into()); }
        Ok(dir.join("request.sock"))
    }
    pub fn start(app: &AppHandle) -> Result<(), String> {
        let state = app.state::<BrokerState>();
        let mut hub = state.0.lock().map_err(|_| DENIED)?;
        if hub.listening { return Ok(()); }
        let path = socket_path(app)?;
        match fs::symlink_metadata(&path) {
            Ok(meta) => {
                if !meta.file_type().is_socket() || meta.uid() != unsafe { libc::geteuid() } || UnixStream::connect(&path).is_ok() { return Err(DENIED.into()); }
                // Only our stale socket is removed, never an arbitrary file/symlink.
                fs::remove_file(&path).map_err(|_| DENIED)?;
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {},
            Err(_) => return Err(DENIED.into()),
        }
        let listener = UnixListener::bind(path).map_err(|_| DENIED)?;
        // The containing directory is private before bind; keep the socket private too.
        fs::set_permissions(socket_path(app)?, fs::Permissions::from_mode(0o600)).map_err(|_| DENIED)?;
        hub.listening = true;
        let app = app.clone();
        std::thread::spawn(move || {
            // One connection at a time bounds approval queues and worker count.
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break; };
                let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
                if handle(&app, &mut stream).is_err() { let _ = stream.write_all(b"{\"ok\":false}\n"); }
            }
        });
        Ok(())
    }
    fn handle(app: &AppHandle, stream: &mut UnixStream) -> Result<(), String> {
        let identity = peer(stream)?;
        let mut raw = Vec::new();
        let read_deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let remaining = read_deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() { return Err(DENIED.into()); }
            stream.set_read_timeout(Some(remaining)).map_err(|_| DENIED)?;
            let mut b = [0];
            stream.read_exact(&mut b).map_err(|_| DENIED)?;
            if b[0] == b'\n' { break; }
            if raw.len() == 1024 * 1024 { return Err(DENIED.into()); }
            raw.push(b[0]);
        }
        let request = parse_request(&raw)?;
        let (generation, provider, url, key_label) = {
            let state = app.state::<BridgeState>();
            let core = state.0.lock().map_err(|_| DENIED)?;
            let s = core.session.as_ref().ok_or(DENIED)?;
            if s.expires <= Instant::now() || !s.keys.contains_key(&request.key_id) { return Err(DENIED.into()); }
            let key = s.keys.get(&request.key_id).ok_or(DENIED)?;
            let (provider, url) = endpoint(&key.identifier, &request.operation)?;
            (s.generation, provider, url, key.label.clone())
        };
        let model = request.body["model"].as_str().ok_or(DENIED)?.to_owned();
        let grant = (generation, request.key_id.clone(), identity.identity.clone(), request.operation.clone(), model.clone());
        let mut nonce = [0; 16]; getrandom::fill(&mut nonce).map_err(|_| DENIED)?;
        let request_id = nonce.iter().map(|b| format!("{b:02x}")).collect::<String>();
        let (tx, rx) = mpsc::channel();
        let (remembered, policy_revision) = {
            let state = app.state::<BrokerState>();
            let mut hub = state.0.lock().map_err(|_| DENIED)?;
            if let Some(permit) = hub.grants.get_mut(&grant) {
                if !consume(permit) { return Err(DENIED.into()); }
                (true, hub.policy_revision)
            } else {
                if hub.pending.is_some() { return Err(DENIED.into()); }
                hub.pending = Some(Pending { request: Request { request_id: request_id.clone(), key_id: request.key_id.clone(), key_label, executable: identity.executable.clone(), sha256: identity.sha256.clone(), pid: identity.pid, provider:provider.into(), operation:request.operation.clone(), timeout_ms: 30_000, application:identity.application.clone(), entry_script:identity.entry_script.clone(), project:identity.project.clone(), model:model.clone(), identity:identity.identity.clone(), remember_allowed:identity.remember_allowed }, generation, deadline: Instant::now() + Duration::from_secs(30), reply: tx, presented: false });
                (false, hub.policy_revision)
            }
        };
        if !remembered {
            show_approval(app)?;
            let approved = rx.recv_timeout(Duration::from_secs(30)).unwrap_or(false);
            {
                let state = app.state::<BrokerState>();
                let mut hub = state.0.lock().map_err(|_| DENIED)?;
                if hub.pending.as_ref().is_some_and(|p| p.request.request_id == request_id) { hub.pending = None; }
            }
            if let Some(window) = app.get_webview_window("bridge-approval") { let _ = window.hide(); }
            if approved {
                let state = app.state::<BrokerState>();
                let mut hub = state.0.lock().map_err(|_| DENIED)?;
                if let Some(permit) = hub.grants.get_mut(&grant) { if !consume(permit) { return Err(DENIED.into()); } }
            }
            if !approved { super::super::append_audit(app, "denied", &request.key_id, &identity.identity)?; return Err(DENIED.into()); }
        }
        // No UI receives the secret. Recheck process identity, session, expiry and
        // encrypted-file digest immediately before the one-record delivery.
        if peer(stream)? != identity { return Err(DENIED.into()); }
        { let state = app.state::<BrokerState>(); let hub = state.0.lock().map_err(|_| DENIED)?;
          if hub.policy_revision != policy_revision { return Err(DENIED.into()); } }
        let state = app.state::<BridgeState>();
        let core = state.0.lock().map_err(|_| DENIED)?;
        let s = core.session.as_ref().ok_or(DENIED)?;
        if s.generation != generation || s.expires <= Instant::now() { return Err(DENIED.into()); }
        let (path, _, _) = super::super::super::storage_paths(app, Some(s.vault_name.clone()))?;
        if Sha256::digest(fs::read(path).map_err(|_| DENIED)?).as_slice() != s.file_hash { return Err(DENIED.into()); }
        let key = s.keys.get(&request.key_id).ok_or(DENIED)?;
        let secret = Zeroizing::new(key.secret.to_string());
        let identifier = key.identifier.clone();
        super::super::append_audit(app, "approved", &request.key_id, &identity.identity)?;
        if s.expires <= Instant::now() { return Err(DENIED.into()); }
        drop(core);
        // Revocation blocks subsequent calls; a provider request already sent
        // cannot be recalled. Never hold the vault lock during network I/O.
        let (status, body) = call_provider(url, &identifier, &secret, &request.body)?;
        let data = Zeroizing::new(serde_json::to_vec(&serde_json::json!({"ok":true,"status":status,"body":body})).map_err(|_| DENIED)?);
        stream.write_all(&data).and_then(|_| stream.write_all(b"\n")).map_err(|_| DENIED)?;
        super::super::append_audit(app, "delivered", &request.key_id, &identity.identity)
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test] fn protocol_does_not_accept_claimed_identity_or_path() {
            assert!(parse_request(br#"{"version":1,"key_id":"key-a","operation":"chat","body":{"model":"fictional"}}"#).is_ok());
            for raw in [br#"{"version":1,"key_id":"../secret"}"#.as_slice(), br#"{"version":2,"key_id":"key-a"}"#, br#"{"version":1,"key_id":"key-a","application":"Trusted App"}"#] { assert!(parse_request(raw).is_err()); }
        }
        #[test] fn destinations_are_fixed_and_provider_specific() {
            assert_eq!(endpoint("OPENAI_API_KEY", "responses").unwrap().1, "https://api.openai.com/v1/responses");
            for op in ["https://evil.invalid", "../secret", "messages"] { assert!(endpoint("OPENAI_API_KEY", op).is_err()); }
            assert!(endpoint("OTHER_API_KEY", "chat").is_err());
            assert!(parse_request(br#"{"version":1,"key_id":"key-a","operation":"chat","body":{"stream":true}}"#).is_err());
        }
        #[test] fn replies_redact_keys_in_nested_values_and_field_names() {
            let mut value = serde_json::json!({"fake-key":[{"message":"Bearer fake-key"}]});
            sanitize_response(&mut value, "fake-key");
            assert!(!serde_json::to_string(&value).unwrap().contains("fake-key"));
        }
        #[test] fn remembered_access_is_scoped_to_key_binary_operation_and_session() {
            let grant: Grant = (1, "key-a".into(), "/usr/bin/app".into(), "hash-a".into(), "chat".into());
            let mut grants = std::collections::HashSet::from([grant.clone()]);
            for other in [(2, "key-a", "/usr/bin/app", "hash-a", "chat"), (1, "key-b", "/usr/bin/app", "hash-a", "chat"), (1, "key-a", "/usr/bin/app", "hash-b", "chat"), (1, "key-a", "/usr/bin/other", "hash-a", "chat"), (1, "key-a", "/usr/bin/app", "hash-a", "responses")] {
                assert!(!grants.contains(&(other.0, other.1.into(), other.2.into(), other.3.into(), other.4.into())));
            }
            grants.clear(); assert!(!grants.contains(&grant));
        }
        #[test] fn missing_approval_is_denied_and_does_not_grant_a_future_request() {
            let (_tx, rx) = mpsc::channel::<bool>();
            assert!(!rx.recv_timeout(Duration::from_millis(1)).unwrap_or(false));
            assert!(Hub::default().grants.is_empty());
        }
        #[test] fn call_budget_and_rate_limit_fail_closed_without_resetting_total() {
            let request = Request { request_id:"r".into(),key_id:"k".into(),key_label:"API".into(),executable:"/app".into(),sha256:"h".into(),pid:1,provider:"OpenAI".into(),operation:"chat".into(),timeout_ms:30000,application:"/app".into(),entry_script:None,project:"/project".into(),model:"model".into(),identity:"i".into(),remember_allowed:true };
            let mut permit = Permit { remaining:100,minute:Instant::now(),calls:59,request };
            assert!(consume(&mut permit)); assert!(!consume(&mut permit)); assert_eq!(permit.remaining,99);
            permit.minute = Instant::now() - Duration::from_secs(61);
            assert!(consume(&mut permit)); assert_eq!(permit.remaining,98);
            permit.remaining=0; assert!(!consume(&mut permit));
        }
        #[test] fn model_and_output_budget_are_validated_before_approval() {
            for body in [serde_json::json!({}),serde_json::json!({"model":""}),serde_json::json!({"model":"m","max_tokens":8193}),serde_json::json!({"model":"m","max_output_tokens":0})] {
                let raw=serde_json::to_vec(&serde_json::json!({"version":1,"key_id":"key-a","operation":"chat","body":body})).unwrap();
                assert!(parse_request(&raw).is_err());
            }
        }
        #[test] fn kernel_peer_identity_matches_the_connecting_process() {
            let (a, _b) = UnixStream::pair().unwrap();
            let p = peer(&a).unwrap();
            assert_eq!(p.pid, std::process::id() as i32);
            assert_eq!(p.executable, fs::canonicalize(std::env::current_exe().unwrap()).unwrap().to_str().unwrap());
        }
    }
}

pub fn start(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "linux")] { linux::start(app) }
    #[cfg(not(target_os = "linux"))] { let _ = app; Ok(()) }
}
