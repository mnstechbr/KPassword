//! Linux local request/approval broker. This is not a same-UID malware sandbox.
use std::{collections::HashMap, sync::{Mutex, mpsc, atomic::{AtomicUsize, Ordering}}, time::{Duration, Instant}};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use super::{DENIED, BridgeState, quota::{Limits, Usage, Booking, Exceeded, output_usage}};

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
struct Permit { request: Request }
struct Pending { request: Request, generation: u64, deadline: Instant, reply: mpsc::Sender<Result<(), &'static str>>, presented: bool }
struct Flight<'a>(&'a AtomicUsize);
impl Drop for Flight<'_> { fn drop(&mut self) { self.0.fetch_sub(1,Ordering::SeqCst); } }
#[derive(Default)]
struct Hub { usage: HashMap<(u64,String,String), Usage>, limits: HashMap<(u64,String,String), Limits>, listening: bool, pending: Option<Pending>, grants: HashMap<Grant, Permit>, policy_revision: u64 }
#[derive(Default)]
pub struct BrokerState(Mutex<Hub>, AtomicUsize);

/// Only stable codes cross IPC; never exception text, paths, URLs or bodies.
pub(super) fn public_error_code(error: &str) -> &'static str {
    if Exceeded::parse(error).is_some() { return "quota_exceeded"; }
    match error {
        "bridge_inactive" => "bridge_inactive", "session_expired" => "session_expired",
        "key_not_found" => "key_not_found", "credential_ambiguous" => "credential_ambiguous", "user_denied" => "user_denied",
        "approval_expired" => "approval_expired", "permission_revoked" => "permission_revoked",
        "quota_exceeded" => "quota_exceeded", "bridge_busy" => "bridge_busy",
        "unsupported_operation" => "unsupported_operation", "invalid_request" => "invalid_request",
        "provider_unavailable" => "provider_unavailable", "identity_changed" => "identity_changed",
        "vault_changed" => "vault_changed", "destination_blocked" => "destination_blocked", _ => "request_failed",
    }
}

/// Build public metadata from typed local quota errors; arbitrary error text is discarded.
pub(super) fn public_error(error: &str) -> serde_json::Value {
    let mut value = serde_json::json!({"code":public_error_code(error)});
    if let Some(quota) = Exceeded::parse(error) {
        value = serde_json::to_value(quota).expect("quota metadata");
        value["code"] = serde_json::json!("quota_exceeded");
        value["source"] = serde_json::json!("kpassword");
        value["scope"] = serde_json::json!("application_credential");
    }
    value
}

#[tauri::command]
pub fn bridge_set_limits(window: tauri::WebviewWindow, app: AppHandle, identity: String, key_id: String, limits: Limits) -> Result<(),String> {
    if window.label() != "main" { return Err(DENIED.into()); }
    let state = app.state::<BrokerState>(); let mut hub = state.0.lock().map_err(|_| DENIED)?;
    let scope = hub.grants.keys().find(|(_,k,i,_,_)| k == &key_id && i == &identity)
        .map(|(g,k,i,_,_)| (*g,k.clone(),i.clone())).ok_or(DENIED)?;
    hub.limits.insert(scope, limits);
    Ok(())
}

// One booking spans preflight, network I/O and delivery. Drop reconciles every
// early return, including identity changes, timeouts and disconnected clients.
struct Reservation<'a> { state: &'a BrokerState, scope: (u64,String,String), booking: Booking, reserved: u64, dispatched: bool, actual: Option<u64>, completed: bool, bounded: bool }
impl Reservation<'_> {
    fn observe(&mut self, value: &serde_json::Value) {
        if let Some(n) = output_usage(value) { self.actual = Some(self.actual.unwrap_or(0).max(n)); }
    }
}
impl Drop for Reservation<'_> {
    fn drop(&mut self) {
        let actual = if self.dispatched { self.actual.unwrap_or(if self.completed { self.reserved } else { 0 }) } else { 0 };
        if let Ok(mut hub) = self.state.0.lock() {
            if let Some(usage) = hub.usage.get_mut(&self.scope) { usage.settle(self.booking,self.dispatched,actual); }
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status { active: bool, remaining_seconds: u64, grants: Vec<Permission> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Permission { key_id: String, identity: String, application: String, entry_script: Option<String>, project: String, operation: String, model: String, calls_this_minute: u32, output_tokens_this_hour: u64, limits: Limits }
#[tauri::command]
pub fn bridge_status(window: tauri::WebviewWindow, app: AppHandle) -> Result<Status,String> {
    if window.label() != "main" { return Err(DENIED.into()); }
    let remaining_seconds = {
        let state = app.state::<BridgeState>(); let core = state.0.lock().map_err(|_| DENIED)?;
        core.session.as_ref().map(|s| s.expires.saturating_duration_since(Instant::now()).as_secs()).unwrap_or(0)
    };
    let state = app.state::<BrokerState>(); let hub = state.0.lock().map_err(|_| DENIED)?;
    let grants = if remaining_seconds > 0 { hub.grants.iter().map(|((g,k,i,_,_),p)| {
        let scope = (*g,k.clone(),i.clone()); let usage = hub.usage.get(&scope);
        Permission { key_id:p.request.key_id.clone(), identity:p.request.identity.clone(), application:p.request.application.clone(), entry_script:p.request.entry_script.clone(), project:p.request.project.clone(), operation:p.request.operation.clone(), model:p.request.model.clone(),
            calls_this_minute:usage.filter(|u| u.minute.elapsed()<Duration::from_secs(60)).map_or(0,|u| u.calls),
            output_tokens_this_hour:usage.filter(|u| u.hour.elapsed()<Duration::from_secs(3600)).map_or(0,|u| u.output),
            limits:hub.limits.get(&scope).copied().unwrap_or_default() }
    }).collect() } else { Vec::new() };
    Ok(Status { active:remaining_seconds > 0, remaining_seconds, grants })
}
#[tauri::command]
pub fn bridge_revoke_grant(window: tauri::WebviewWindow, app: AppHandle, identity: String, key_id: String, operation: String, model: String) -> Result<(),String> {
    if window.label() != "main" { return Err(DENIED.into()); }
    let state = app.state::<BrokerState>(); let mut hub = state.0.lock().map_err(|_| DENIED)?;
    hub.policy_revision = hub.policy_revision.wrapping_add(1);
    hub.grants.retain(|(_,k,i,o,m),_| !(k == &key_id && i == &identity && o == &operation && m == &model));
    if hub.pending.as_ref().is_some_and(|p| p.request.identity == identity && p.request.key_id == key_id && p.request.operation == operation && p.request.model == model) {
        if let Some(p) = hub.pending.take() { let _ = p.reply.send(Err("permission_revoked")); }
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
                        let state = a.state::<BrokerState>(); if let Ok(mut hub) = state.0.lock() { if let Some(p) = hub.pending.take() { let _ = p.reply.send(Err("user_denied")); } }
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
            hub.usage.clear();
            hub.limits.clear();
            if let Some(p) = hub.pending.take() { let _ = p.reply.send(Err("permission_revoked")); }
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
pub fn bridge_answer_access_request(app: AppHandle, window: tauri::WebviewWindow, request_id: String, approve: bool, remember: bool) -> Result<(), String> {
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
        if !p.request.remember_allowed { let _ = p.reply.send(Err("permission_revoked")); return Err(DENIED.into()); }
        if hub.grants.len() >= 256 { let _ = p.reply.send(Err("permission_revoked")); return Err(DENIED.into()); }
        let grant = (p.generation, p.request.key_id.clone(), p.request.identity.clone(), p.request.operation.clone(), p.request.model.clone());
        hub.grants.insert(grant, Permit { request:p.request.clone() });
    }
    p.reply.send(if approve { Ok(()) } else { Err("user_denied") }).map_err(|_| DENIED.into())
}

#[cfg(target_os = "linux")]
pub(super) mod linux {
    use super::*;
    use std::{fs, io::{Read, Write}, os::{unix::{fs::{FileTypeExt, MetadataExt, PermissionsExt}, net::{UnixListener, UnixStream}}}, path::PathBuf};
    use serde::Deserialize;

    use sha2::{Digest, Sha256};
    use zeroize::Zeroizing;

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct WireRequest { version: u32, key_id: String, operation: String, body: serde_json::Value }
    impl Drop for WireRequest { fn drop(&mut self) { super::super::erase_json(&mut self.body); } }
    fn parse_request(raw: &[u8]) -> Result<WireRequest, String> {
        let r: WireRequest = serde_json::from_slice(raw).map_err(|_| DENIED)?;
        if r.version != 1 || r.key_id.is_empty() || r.key_id.len() > 128 || !r.key_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') { return Err(DENIED.into()); }
        if r.body.get("n").is_some_and(|n| n.as_u64()!=Some(1)) { return Err("invalid_request".into()); }
        if !r.body.is_object() || r.body.get("stream").is_some_and(|v| !v.is_boolean())  { return Err(DENIED.into()); }
        if !["responses", "chat", "embeddings", "messages"].contains(&r.operation.as_str()) {
            if r.body.get("stream").is_some() { return Err("invalid_request".into()); }
            if !["http.get","http.post"].contains(&r.operation.as_str()) { super::super::services::scope(&r.operation,&r.body)?; }
            if r.operation=="http.get" && !r.body.as_object().is_some_and(|o| o.values().all(|v| v.is_string() || v.is_number() || v.is_boolean())) { return Err("invalid_request".into()); }
            return Ok(r);
        }
        if r.body["stream"] == true && !["chat", "responses", "messages"].contains(&r.operation.as_str()) { return Err(DENIED.into()); }
        if !r.body["model"].as_str().is_some_and(|m| !m.is_empty() && m.len() <= 128 && !m.chars().any(char::is_control)) { return Err(DENIED.into()); }
        for field in ["max_tokens", "max_completion_tokens", "max_output_tokens"] {
            if let Some(value) = r.body.get(field) { if !value.as_u64().is_some_and(|n| (1..=u32::MAX as u64).contains(&n)) { return Err(DENIED.into()); } }
        }
        Ok(r)
    }
    pub(crate) fn endpoint(identifier: &str, operation: &str) -> Result<(&'static str, &'static str), String> {
        if let Some(provider) = super::super::services::provider(identifier,operation) { return Ok((provider,"")); }
        match (identifier, operation) {
            ("OPENAI_API_KEY", "responses") => Ok(("OpenAI", "https://api.openai.com/v1/responses")),
            ("OPENAI_API_KEY", "chat") => Ok(("OpenAI", "https://api.openai.com/v1/chat/completions")),
            ("OPENAI_API_KEY", "embeddings") => Ok(("OpenAI", "https://api.openai.com/v1/embeddings")),
            ("ZAI_API_KEY" | "Z_AI_API_KEY", "chat") => Ok(("Z.AI", "https://api.z.ai/api/paas/v4/chat/completions")),
            ("MIMO_API_KEY" | "XIAOMI_API_KEY", "chat") => Ok(("Xiaomi MiMo", "https://api.xiaomimimo.com/v1/chat/completions")),
            ("DEEPSEEK_API_KEY", "messages") => Ok(("DeepSeek", "https://api.deepseek.com/anthropic/v1/messages")),
            ("DEEPSEEK_API_KEY", "responses") => Ok(("DeepSeek", "https://api.deepseek.com/responses")),
            ("DEEPSEEK_API_KEY", "chat") => Ok(("DeepSeek", "https://api.deepseek.com/chat/completions")),
            ("ANTHROPIC_API_KEY", "messages") => Ok(("Anthropic", "https://api.anthropic.com/v1/messages")),
            _ => Err("unsupported_operation".into()),
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
    fn authentication<'a>(config: &'a super::super::providers::Config, url: &str) -> (&'a str, bool) {
        let anthropic = config.protocol == "anthropic" || ((config.protocol.is_empty() || config.protocol=="auto") && url.ends_with("/messages"));
        let auth_type = if config.auth.is_empty() { if anthropic { "x-api-key" } else { "bearer" } } else { &config.auth };
        (auth_type,anthropic)
    }
    fn provider_request(url: &str, identifier: &str, secret: &str, body: &serde_json::Value, config: &super::super::providers::Config, operation: &str, output_budget: Option<u64>) -> Result<reqwest::blocking::Response, String> {
        let mut body = body.clone();
        let (_,anthropic) = authentication(config,url);
        if (output_budget.is_some() || anthropic) && !["http.get", "http.post"].contains(&operation) && !url.ends_with("/embeddings") && !["max_tokens", "max_completion_tokens", "max_output_tokens"].iter().any(|f| body.get(*f).is_some()) {
            let field = if url.ends_with("/responses") { "max_output_tokens" } else if identifier == "OPENAI_API_KEY" { "max_completion_tokens" } else { "max_tokens" };
            body[field] = serde_json::json!(output_budget.unwrap_or(8192));
        }
        let client = super::super::providers::pinned_client(url)?;
        let (auth_type,anthropic) = authentication(config,url);
        let mut auth = reqwest::header::HeaderValue::from_str(&if auth_type=="bearer" { format!("Bearer {secret}") } else { secret.to_owned() }).map_err(|_| DENIED)?;
        auth.set_sensitive(true);
        let request = if operation=="http.get" {
            let mut url=reqwest::Url::parse(url).map_err(|_| "invalid_request")?;
            { let mut pairs=url.query_pairs_mut();
              for (key,value) in body.as_object().ok_or("invalid_request")? {
                let value=value.as_str().map(str::to_string).unwrap_or_else(||value.to_string());
                pairs.append_pair(key,&value);
              }
            }
            client.get(url)
        } else { client.post(url).json(&body) };
        let request = match auth_type {
            "bearer"=>request.header(reqwest::header::AUTHORIZATION,auth),
            "x-api-key"=>request.header("x-api-key",auth),
            "x-goog-api-key"=>request.header("x-goog-api-key",auth),
            "api-key"=>request.header("api-key",auth),
            _=>return Err("invalid_request".into()),
        };
        let request = if anthropic { request.header("anthropic-version","2023-06-01") } else { request };
        let response = request.send().map_err(|_| "provider_unavailable")?;
        if response.status().is_redirection() { return Err("provider_unavailable".into()); }
        Ok(response)
    }
    pub(super) fn read_provider_json(response: reqwest::blocking::Response, secret: &str) -> Result<(u16, serde_json::Value), String> {
        let status = response.status().as_u16();
        let mut data = Zeroizing::new(Vec::new());
        response.take(4 * 1024 * 1024 + 1).read_to_end(&mut data).map_err(|_| "provider_unavailable")?;
        if data.len() > 4 * 1024 * 1024 { return Err("provider_unavailable".into()); }
        let mut body: serde_json::Value = serde_json::from_slice(&data).map_err(|_| "provider_unavailable")?;
        sanitize_response(&mut body, secret);
        Ok((status, body))
    }
    fn write_json(stream: &mut impl Write, value: &serde_json::Value) -> Result<(), String> {
        let data = Zeroizing::new(serde_json::to_vec(value).map_err(|_| DENIED)?);
        stream.write_all(&data).and_then(|_| stream.write_all(b"\n")).map_err(|_| DENIED.into())
    }
    /// Bounded SSE parsing: preserve typed tool deltas without forwarding raw
    /// provider text, headers or credentials. Check revocation before every event.
    fn relay_sse(source: impl Read, target: &mut impl Write, secret: &str, mut authorized: impl FnMut() -> bool, mut observe: impl FnMut(&serde_json::Value)) -> Result<(), String> {
        use std::io::BufRead;
        let mut source = std::io::BufReader::new(source);
        let mut event = String::new();
        let mut data = Zeroizing::new(String::new());
        let mut total = 0usize;
        let mut terminal = false;
        loop {
            let mut line = Zeroizing::new(Vec::new());
            let n = (&mut source).take(4 * 1024 * 1024 + 1).read_until(b'\n', &mut line).map_err(|_| "provider_unavailable")?;
            total += n;
            if n > 4 * 1024 * 1024 || total > 128 * 1024 * 1024 { return Err("provider_unavailable".into()); }
            if !authorized() { return Err("permission_revoked".into()); }
            if n == 0 { if !terminal || !data.is_empty() { return Err("provider_unavailable".into()); } break; }
            let line = std::str::from_utf8(&line).map_err(|_| "provider_unavailable")?.trim_end_matches(['\r', '\n']);
            if line.is_empty() {
                if data.as_str() == "[DONE]" { terminal = true; break; }
                if !data.is_empty() {
                    let mut value: serde_json::Value = serde_json::from_str(&data).map_err(|_| "provider_unavailable")?;
                    if !value.is_object() { return Err("provider_unavailable".into()); }
                    terminal |= value["type"]=="message_stop" || value["type"]=="response.completed";
                    observe(&value);
                    sanitize_response(&mut value, secret);
                    write_json(target, &serde_json::json!({"event":event,"data":value}))?;
                    super::super::erase_json(&mut value);
                }
                data.clear(); event.clear();
            } else if let Some(value) = line.strip_prefix("event:") {
                let value = value.trim();
                if value.len() > 128 || !value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'.') { return Err("provider_unavailable".into()); }
                event = value.replace(secret,"redacted");
            } else if let Some(value) = line.strip_prefix("data:") {
                if !data.is_empty() { data.push('\n'); }
                data.push_str(value.trim_start());
                if data.len() > 4 * 1024 * 1024 { return Err("provider_unavailable".into()); }
            }
        }
        if !terminal { return Err("provider_unavailable".into()); }
        write_json(target, &serde_json::json!({"done":true}))
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
            // Bound native workers while allowing a second client during a
            // provider stream. There is still only one outstanding approval.
            use std::sync::{Arc,atomic::{AtomicUsize,Ordering}};
            let workers=Arc::new(AtomicUsize::new(0));
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break; };
                let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
                if workers.load(Ordering::SeqCst)>=4 {
                    let _=write_json(&mut stream,&serde_json::json!({"ok":false,"error":{"code":"bridge_busy"}}));
                    continue;
                }
                workers.fetch_add(1,Ordering::SeqCst);
                let workers=workers.clone(); let app=app.clone();
                std::thread::spawn(move || {
                    if let Err(error) = handle(&app, &mut stream) {
                        let _=write_json(&mut stream,&serde_json::json!({"ok":false,"error":public_error(&error)}));
                    }
                    workers.fetch_sub(1,Ordering::SeqCst);
                });
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
        if raw == br#"{"version":1,"connect":true}"# {
            let token = super::super::universal::enroll(app)?;
            return write_json(stream, &serde_json::json!({"token":token,"url":"http://127.0.0.1:8765/mcp"}));
        }
        execute(app, &raw, identity, || peer(stream), &mut stream.try_clone().map_err(|_| DENIED)?, || true)
    }
    pub(crate) fn execute(
        app: &AppHandle, raw: &[u8], identity: super::super::identity::Peer,
        verify: impl Fn() -> Result<super::super::identity::Peer, String>,
        stream: &mut impl Write, authorized: impl Fn() -> bool,
    ) -> Result<(), String> {
        let result = execute_inner(app,raw,identity.clone(),verify,stream,authorized);
        if let Err(error) = &result {
            let key_id = parse_request(raw).map(|r| r.key_id.clone()).unwrap_or_default();
            let _ = super::super::append_audit_detail(app,"failed",&key_id,&identity.identity,Some(public_error(error)),None);
        }
        result
    }
    fn execute_inner(
        app: &AppHandle, raw: &[u8], identity: super::super::identity::Peer,
        verify: impl Fn() -> Result<super::super::identity::Peer, String>,
        stream: &mut impl Write, authorized: impl Fn() -> bool,
    ) -> Result<(), String> {
        let broker_state = app.state::<BrokerState>();
        broker_state.1.fetch_update(Ordering::SeqCst,Ordering::SeqCst,|n| (n<4).then_some(n+1)).map_err(|_| "bridge_busy")?;
        let _flight = Flight(&broker_state.1);
        let request = parse_request(&raw).map_err(|e| if e=="unsupported_operation" { "unsupported_operation" } else { "invalid_request" })?;
        let (generation, provider, url, key_label) = {
            let state = app.state::<BridgeState>();
            let core = state.0.lock().map_err(|_| DENIED)?;
            let s = core.session.as_ref().ok_or(if core.close_reason=="session_expired" { "session_expired" } else { "bridge_inactive" })?;
            if s.expires <= Instant::now() { return Err("session_expired".into()); }
            let key = s.keys.get(&request.key_id).ok_or("key_not_found")?;
            let (provider,url) = if let Some(url) = key.config.endpoint(&request.operation)? {
                let provider=reqwest::Url::parse(&url).map_err(|_| "invalid_request")?.host_str().ok_or("invalid_request")?.to_string();
                (provider,url)
            } else {
                let (p,u)=endpoint(&key.identifier,&request.operation)?; (p.to_string(),u.to_string())
            };
            (s.generation, provider, url, key.label.clone())
        };
        let model = if let Some(model) = request.body["model"].as_str() { model.to_owned() } else if ["http.get","http.post"].contains(&request.operation.as_str()) { "fixed_endpoint".into() } else { super::super::services::scope(&request.operation,&request.body)? };
        let grant = (generation, request.key_id.clone(), identity.identity.clone(), request.operation.clone(), model.clone());
        let mut nonce = [0; 16]; getrandom::fill(&mut nonce).map_err(|_| DENIED)?;
        let request_id = nonce.iter().map(|b| format!("{b:02x}")).collect::<String>();
        let (tx, rx) = mpsc::channel();
        let (remembered, policy_revision) = {
            let state = app.state::<BrokerState>();
            let mut hub = state.0.lock().map_err(|_| DENIED)?;
            if hub.grants.contains_key(&grant) {
                (true, hub.policy_revision)
            } else {
                if hub.pending.is_some() { return Err("bridge_busy".into()); }
                hub.pending = Some(Pending { request: Request { request_id: request_id.clone(), key_id: request.key_id.clone(), key_label, executable: identity.executable.clone(), sha256: identity.sha256.clone(), pid: identity.pid, provider:provider.into(), operation:request.operation.clone(), timeout_ms: 30_000, application:identity.application.clone(), entry_script:identity.entry_script.clone(), project:identity.project.clone(), model:model.clone(), identity:identity.identity.clone(), remember_allowed:identity.remember_allowed }, generation, deadline: Instant::now() + Duration::from_secs(30), reply: tx, presented: false });
                (false, hub.policy_revision)
            }
        };
        if !remembered {
            show_approval(app)?;
            let decision = rx.recv_timeout(Duration::from_secs(30)).unwrap_or(Err("approval_expired"));
            let approved = decision.is_ok();
            {
                let state = app.state::<BrokerState>();
                let mut hub = state.0.lock().map_err(|_| DENIED)?;
                if hub.pending.as_ref().is_some_and(|p| p.request.request_id == request_id) { hub.pending = None; }
                // A different worker may already have presented its approval.
                // Keep dismissal and pending ownership under the same lock.
                if hub.pending.is_none() {
                    if let Some(window) = app.get_webview_window("bridge-approval") { let _ = window.hide(); }
                }
            }
            if !approved { super::super::append_audit(app, "denied", &request.key_id, &identity.identity)?; return Err(decision.err().unwrap_or("user_denied").into()); }
        }
        let mut reservation = {
            let mut hub = broker_state.0.lock().map_err(|_| DENIED)?;
            let output = if ["chat","responses","messages"].contains(&request.operation.as_str()) {
                ["max_tokens","max_completion_tokens","max_output_tokens"].iter().filter_map(|f| request.body.get(*f).and_then(serde_json::Value::as_u64)).max().unwrap_or(8192)
            } else { 0 };
            let scope = (generation,request.key_id.clone(),identity.identity.clone());
            let limits = hub.limits.get(&scope).copied().unwrap_or_default();
            let booking = hub.usage.entry(scope.clone()).or_default().reserve(limits,output).map_err(|e| e.error())?;
            Reservation { state: &broker_state, scope, booking, reserved:output, dispatched:false, actual:None, completed:false, bounded:limits.output_tokens_per_hour>0 }
        };
        let still_authorized = || {
            let revision_ok = broker_state.0.lock().is_ok_and(|h| h.policy_revision == policy_revision);
            let state = app.state::<BridgeState>();
            revision_ok && authorized() && state.0.lock().is_ok_and(|c| c.session.as_ref().is_some_and(|s| s.generation == generation && s.expires > Instant::now()))
        };
        // No UI receives the secret. Recheck process identity, session, expiry and
        // encrypted-file digest immediately before the one-record delivery.
        if verify()? != identity { return Err("identity_changed".into()); }
        { let state = app.state::<BrokerState>(); let hub = state.0.lock().map_err(|_| DENIED)?;
          if hub.policy_revision != policy_revision { return Err("permission_revoked".into()); } }
        let state = app.state::<BridgeState>();
        let core = state.0.lock().map_err(|_| DENIED)?;
        let s = core.session.as_ref().ok_or(DENIED)?;
        if s.generation != generation { return Err("permission_revoked".into()); }
        if s.expires <= Instant::now() { return Err("session_expired".into()); }
        let (path, _, _) = super::super::super::storage_paths(app, Some(s.vault_name.clone()))?;
        if Sha256::digest(fs::read(path).map_err(|_| DENIED)?).as_slice() != s.file_hash { return Err("vault_changed".into()); }
        let key = s.keys.get(&request.key_id).ok_or(DENIED)?;
        let secret = Zeroizing::new(key.secret.to_string());
        let identifier = key.identifier.clone();
        let config = key.config.clone();
        super::super::append_audit(app, "approved", &request.key_id, &identity.identity)?;
        if s.expires <= Instant::now() { return Err(DENIED.into()); }
        drop(core);
        // Revocation blocks subsequent calls; a provider request already sent
        // cannot be recalled. Never hold the vault lock during network I/O.
        if !still_authorized() { return Err("permission_revoked".into()); }
        if url.is_empty() {
            reservation.dispatched = true;
            let (status,mut body) = super::super::services::call(&identifier,&request.operation,&secret,&request.body)?;
            if !(200..300).contains(&status) {
                super::super::append_audit_detail(app,"provider_http_error",&request.key_id,&identity.identity,Some(serde_json::json!({"code":"provider_http_error"})),Some(status))?;
            }
            sanitize_response(&mut body,&secret);
            if !still_authorized() { super::super::erase_json(&mut body); return Err("permission_revoked".into()); }
            let result=write_json(stream,&serde_json::json!({"ok":true,"status":status,"body":body}));
            super::super::erase_json(&mut body);
            result?;
            return super::super::append_audit(app,"delivered",&request.key_id,&identity.identity);
        }
        if !still_authorized() { return Err("permission_revoked".into()); }
        reservation.dispatched = true;
        let response = provider_request(&url, &identifier, &secret, &request.body, &config, &request.operation, reservation.bounded.then_some(reservation.reserved))?;
        let status = response.status().as_u16();
        if !(200..300).contains(&status) {
            // A rejected upstream call has no local output reservation. Keep
            // attempted call accounting and report the upstream HTTP status.
            reservation.actual = Some(0);
            super::super::append_audit_detail(app,"provider_http_error",&request.key_id,&identity.identity,Some(serde_json::json!({"code":"provider_http_error"})),Some(status))?;
        }
        if request.body["stream"] == true && response.status().is_success() {
            let is_sse = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).is_some_and(|v| v.split(';').next() == Some("text/event-stream"));
            if !is_sse { return Err("provider_unavailable".into()); }
            write_json(stream, &serde_json::json!({"ok":true,"status":response.status().as_u16(),"stream":true}))?;
            let result = relay_sse(response, stream, &secret, still_authorized, |v| reservation.observe(v));
            reservation.completed = result.is_ok();
            result?;
        } else {
            let (status, mut body) = read_provider_json(response, &secret)?;
            if (200..300).contains(&status) { reservation.observe(&body); reservation.completed = true; }
            if !still_authorized() { super::super::erase_json(&mut body); return Err("permission_revoked".into()); }
            let result = write_json(stream, &serde_json::json!({"ok":true,"status":status,"body":body}));
            super::super::erase_json(&mut body);
            result?;
        }
        super::super::append_audit(app, "delivered", &request.key_id, &identity.identity)
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test] fn reservation_drop_refunds_preflight_and_reconciles_success_and_failure() {
            let state = BrokerState::default();
            let scope = (1,"key".into(),"app".into());
            let reserve = || {
                let mut h=state.0.lock().unwrap();
                let booking=h.usage.entry(scope.clone()).or_default().reserve(Limits::default(),8192).unwrap();
                Reservation { state:&state,scope:scope.clone(),booking,reserved:8192,dispatched:false,actual:None,completed:false,bounded:false }
            };
            drop(reserve());
            { let h=state.0.lock().unwrap();let u=&h.usage[&scope];assert_eq!((u.calls,u.output),(0,0)); }
            { let mut r=reserve();r.dispatched=true; }
            { let h=state.0.lock().unwrap();let u=&h.usage[&scope];assert_eq!((u.calls,u.output),(1,0)); }
            { let mut r=reserve();r.dispatched=true;r.completed=true;r.observe(&serde_json::json!({"usage":{"completion_tokens":12}})); }
            { let h=state.0.lock().unwrap();let u=&h.usage[&scope];assert_eq!((u.calls,u.output),(2,12)); }
            // Unknown successful usage retains the reservation, never invents a zero.
            { let mut r=reserve();r.dispatched=true;r.completed=true; }
            { let h=state.0.lock().unwrap();let u=&h.usage[&scope];assert_eq!((u.calls,u.output),(3,8204)); }
        }
        #[test] fn stream_usage_is_reconciled_on_complete_and_truncated_streams() {
            let mut actual=None;
            let input=b"data: {\"usage\":{\"output_tokens\":2}}\n\ndata: {\"usage\":{\"output_tokens\":9}}\n\ndata: {\"type\":\"message_stop\"}\n\n";
            relay_sse(input.as_slice(),&mut Vec::new(),"secret",||true,|v| { if let Some(n)=output_usage(v) { actual=Some(actual.unwrap_or(0).max(n)); } }).unwrap();
            assert_eq!(actual,Some(9));
            let mut actual=None;
            assert!(relay_sse(b"data: {\"usage\":{\"completion_tokens\":3}}\n\n".as_slice(),&mut Vec::new(),"secret",||true,|v| actual=output_usage(v)).is_err());
            assert_eq!(actual,Some(3));
        }
        #[test] fn explicit_output_above_the_old_cap_is_accepted() {
            for field in ["max_tokens","max_completion_tokens","max_output_tokens"] {
                let raw=serde_json::to_vec(&serde_json::json!({"version":1,"key_id":"key","operation":"chat","body":{"model":"m",field:32768}})).unwrap();
                assert!(parse_request(&raw).is_ok());
            }
        }
        #[test] fn automatic_and_explicit_anthropic_profiles_use_correct_authentication() {
            let mut c=super::super::super::providers::Config::default();
            for protocol in ["","auto","anthropic"] { c.protocol=protocol.into();assert_eq!(authentication(&c,"https://api.deepseek.com/anthropic/v1/messages"),("x-api-key",true)); }
            c.protocol="openai".into();assert_eq!(authentication(&c,"https://example.com/v1/chat/completions"),("bearer",false));
            c.auth="api-key".into();assert_eq!(authentication(&c,"https://example.com/v1/chat/completions"),("api-key",false));
        }
        #[test] fn streams_preserve_tool_deltas_redact_and_detect_truncation() {
            let input=b"event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"fake-key\"}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";
            let mut out=Vec::new(); relay_sse(input.as_slice(),&mut out,"fake-key",||true, |_| {}).unwrap();
            let out=String::from_utf8(out).unwrap(); assert!(out.contains("input_json_delta"));assert!(!out.contains("fake-key"));assert!(out.contains("done"));
            assert!(relay_sse(b"data: {}\n\n".as_slice(),&mut Vec::new(),"secret",||true, |_| {}).is_err());
            assert_eq!(relay_sse(input.as_slice(),&mut Vec::new(),"secret",||false, |_| {}).unwrap_err(),"permission_revoked");
            assert!(relay_sse(b"event: injected\rheader\ndata: {}\n\n".as_slice(),&mut Vec::new(),"secret",||true, |_| {}).is_err());
        }
        #[test] fn diagnostic_codes_never_forward_error_payloads() {
            for code in ["bridge_inactive","session_expired","key_not_found","user_denied","approval_expired","unsupported_operation"] { assert_eq!(public_error_code(code),code); }
            assert_eq!(public_error_code("https://provider.invalid?secret=fake"),"request_failed");
        }
        #[test] fn protocol_does_not_accept_claimed_identity_or_path() {
            assert!(parse_request(br#"{"version":1,"key_id":"key-a","operation":"chat","body":{"model":"fictional"}}"#).is_ok());
            for raw in [br#"{"version":1,"key_id":"../secret"}"#.as_slice(), br#"{"version":2,"key_id":"key-a"}"#, br#"{"version":1,"key_id":"key-a","application":"Trusted App"}"#] { assert!(parse_request(raw).is_err()); }
        }
        #[test] fn destinations_are_fixed_and_provider_specific() {
            assert_eq!(endpoint("OPENAI_API_KEY", "responses").unwrap().1, "https://api.openai.com/v1/responses");
            for op in ["https://evil.invalid", "../secret", "messages"] { assert!(endpoint("OPENAI_API_KEY", op).is_err()); }
            assert!(endpoint("OTHER_API_KEY", "chat").is_err());
            assert!(parse_request(br#"{"version":1,"key_id":"key-a","operation":"chat","body":{"model":"m","stream":true}}"#).is_ok());
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
        #[test] fn model_and_output_budget_are_validated_before_approval() {
            for body in [serde_json::json!({}),serde_json::json!({"model":""}),serde_json::json!({"model":"m","max_tokens":-1}),serde_json::json!({"model":"m","max_output_tokens":0})] {
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

#[cfg(target_os = "linux")]
pub(super) fn service_response(response: reqwest::blocking::Response, secret: &str) -> Result<(u16,serde_json::Value),String> {
    if response.status().is_redirection() { return Err("provider_unavailable".into()); }
    linux::read_provider_json(response,secret)
}
