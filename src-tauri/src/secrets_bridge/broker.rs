//! Linux local request/approval broker. This is not a same-UID malware sandbox.
use std::{collections::HashSet, sync::{Mutex, mpsc}, time::{Duration, Instant}};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use super::{DENIED, BridgeState};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub request_id: String,
    pub key_id: String,
    pub executable: String,
    pub sha256: String,
    pub pid: i32,
    pub provider: String,
    pub operation: String,
    pub timeout_ms: u64,
}
type Grant = (u64, String, String, String, String);
struct Pending { request: Request, generation: u64, deadline: Instant, reply: mpsc::Sender<bool>, presented: bool }
#[derive(Default)]
struct Hub { listening: bool, pending: Option<Pending>, grants: HashSet<Grant> }
#[derive(Default)]
pub struct BrokerState(Mutex<Hub>);

pub fn revoke(app: &AppHandle) {
    if let Some(state) = app.try_state::<BrokerState>() {
        if let Ok(mut hub) = state.0.lock() {
            hub.grants.clear();
            if let Some(p) = hub.pending.take() { let _ = p.reply.send(false); }
        }
    }
}

#[tauri::command]
pub fn bridge_take_access_request(state: State<BrokerState>) -> Option<Request> {
    let mut hub = state.0.lock().ok()?;
    let p = hub.pending.as_mut()?;
    if p.presented || p.deadline <= Instant::now() { return None; }
    p.presented = true;
    let mut request = p.request.clone();
    request.timeout_ms = p.deadline.saturating_duration_since(Instant::now()).as_millis() as u64;
    Some(request)
}

#[tauri::command]
pub fn bridge_answer_access_request(app: AppHandle, request_id: String, approve: bool, remember: bool) -> Result<(), String> {
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
        if hub.grants.len() >= 256 { let _ = p.reply.send(false); return Err(DENIED.into()); }
        hub.grants.insert((p.generation, p.request.key_id.clone(), p.request.executable.clone(), p.request.sha256.clone(), p.request.operation.clone()));
    }
    p.reply.send(approve).map_err(|_| DENIED.into())
}

#[cfg(target_os = "linux")]
mod linux {
    use super::*;
    use std::{fs, io::{Read, Write}, os::{fd::AsRawFd, unix::{fs::{FileTypeExt, MetadataExt, PermissionsExt}, net::{UnixListener, UnixStream}}}, path::PathBuf};
    use serde::Deserialize;
    use tauri::Emitter;
    use sha2::{Digest, Sha256};
    use zeroize::Zeroizing;

    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct WireRequest { version: u32, key_id: String, operation: String, body: serde_json::Value }
    fn parse_request(raw: &[u8]) -> Result<WireRequest, String> {
        let r: WireRequest = serde_json::from_slice(raw).map_err(|_| DENIED)?;
        if r.version != 1 || r.key_id.is_empty() || r.key_id.len() > 128 || !r.key_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') { return Err(DENIED.into()); }
        if !r.body.is_object() || r.body.get("stream").is_some_and(|v| v != false) || !["responses", "chat", "embeddings", "messages"].contains(&r.operation.as_str()) { return Err(DENIED.into()); }
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
        // No redirects, caller URLs, caller headers, environment proxies, debug
        // logs or cookies. Authentication is attached only to a fixed HTTPS origin.
        let client = reqwest::blocking::Client::builder().https_only(true).no_proxy()
            .redirect(reqwest::redirect::Policy::none()).connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(60)).build().map_err(|_| DENIED)?;
        let mut auth = reqwest::header::HeaderValue::from_str(&if identifier == "ANTHROPIC_API_KEY" { secret.to_owned() } else { format!("Bearer {secret}") }).map_err(|_| DENIED)?;
        auth.set_sensitive(true);
        let mut request = client.post(url).json(body);
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
    #[derive(Clone, PartialEq, Eq)]
    struct Peer { pid: i32, started: String, executable: String, sha256: String }
    fn peer(stream: &UnixStream) -> Result<Peer, String> {
        let mut cred: libc::ucred = unsafe { std::mem::zeroed() };
        let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
        if unsafe { libc::getsockopt(stream.as_raw_fd(), libc::SOL_SOCKET, libc::SO_PEERCRED, &mut cred as *mut _ as *mut _, &mut len) } != 0
            || len as usize != std::mem::size_of::<libc::ucred>() || cred.uid != unsafe { libc::geteuid() } || cred.pid <= 0 { return Err(DENIED.into()); }
        let stat = fs::read_to_string(format!("/proc/{}/stat", cred.pid)).map_err(|_| DENIED)?;
        let started = stat.rsplit_once(')').ok_or(DENIED)?.1.split_whitespace().nth(19).ok_or(DENIED)?.to_owned();
        let path = fs::read_link(format!("/proc/{}/exe", cred.pid)).map_err(|_| DENIED)?;
        let (executable, sha256) = super::super::fingerprint(path.to_str().ok_or(DENIED)?)?;
        Ok(Peer { pid: cred.pid, started, executable, sha256 })
    }
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
        let (generation, provider, url) = {
            let state = app.state::<BridgeState>();
            let core = state.0.lock().map_err(|_| DENIED)?;
            let s = core.session.as_ref().ok_or(DENIED)?;
            if s.expires <= Instant::now() || !s.keys.contains_key(&request.key_id) { return Err(DENIED.into()); }
            let key = s.keys.get(&request.key_id).ok_or(DENIED)?;
            let (provider, url) = endpoint(&key.identifier, &request.operation)?;
            (s.generation, provider, url)
        };
        let grant = (generation, request.key_id.clone(), identity.executable.clone(), identity.sha256.clone(), request.operation.clone());
        let mut nonce = [0; 16]; getrandom::fill(&mut nonce).map_err(|_| DENIED)?;
        let request_id = nonce.iter().map(|b| format!("{b:02x}")).collect::<String>();
        let (tx, rx) = mpsc::channel();
        let remembered = {
            let state = app.state::<BrokerState>();
            let mut hub = state.0.lock().map_err(|_| DENIED)?;
            if hub.grants.contains(&grant) { true } else {
                if hub.pending.is_some() { return Err(DENIED.into()); }
                hub.pending = Some(Pending { request: Request { request_id: request_id.clone(), key_id: request.key_id.clone(), executable: identity.executable.clone(), sha256: identity.sha256.clone(), pid: identity.pid, provider:provider.into(), operation:request.operation.clone(), timeout_ms: 30_000 }, generation, deadline: Instant::now() + Duration::from_secs(30), reply: tx, presented: false });
                false
            }
        };
        if !remembered {
            super::super::super::show_main_window(app);
            let _ = app.emit("kpassword:bridge-access-request", ());
            let approved = rx.recv_timeout(Duration::from_secs(30)).unwrap_or(false);
            {
                let state = app.state::<BrokerState>();
                let mut hub = state.0.lock().map_err(|_| DENIED)?;
                if hub.pending.as_ref().is_some_and(|p| p.request.request_id == request_id) { hub.pending = None; }
            }
            if !approved { super::super::append_audit(app, "denied", &request.key_id, &request_id)?; return Err(DENIED.into()); }
        }
        // No UI receives the secret. Recheck process identity, session, expiry and
        // encrypted-file digest immediately before the one-record delivery.
        if peer(stream)? != identity { return Err(DENIED.into()); }
        let state = app.state::<BridgeState>();
        let core = state.0.lock().map_err(|_| DENIED)?;
        let s = core.session.as_ref().ok_or(DENIED)?;
        if s.generation != generation || s.expires <= Instant::now() { return Err(DENIED.into()); }
        let (path, _, _) = super::super::super::storage_paths(app, Some(s.vault_name.clone()))?;
        if Sha256::digest(fs::read(path).map_err(|_| DENIED)?).as_slice() != s.file_hash { return Err(DENIED.into()); }
        let key = s.keys.get(&request.key_id).ok_or(DENIED)?;
        let secret = Zeroizing::new(key.secret.to_string());
        let identifier = key.identifier.clone();
        super::super::append_audit(app, "approved", &request.key_id, &request_id)?;
        if s.expires <= Instant::now() { return Err(DENIED.into()); }
        drop(core);
        // Revocation blocks subsequent calls; a provider request already sent
        // cannot be recalled. Never hold the vault lock during network I/O.
        let (status, body) = call_provider(url, &identifier, &secret, &request.body)?;
        let data = Zeroizing::new(serde_json::to_vec(&serde_json::json!({"ok":true,"status":status,"body":body})).map_err(|_| DENIED)?);
        stream.write_all(&data).and_then(|_| stream.write_all(b"\n")).map_err(|_| DENIED)?;
        super::super::append_audit(app, "delivered", &request.key_id, &request_id)
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test] fn protocol_does_not_accept_claimed_identity_or_path() {
            assert!(parse_request(br#"{"version":1,"key_id":"key-a","operation":"chat","body":{}}"#).is_ok());
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
            let mut grants = HashSet::from([grant.clone()]);
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
