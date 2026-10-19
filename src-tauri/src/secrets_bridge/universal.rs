//! One loopback MCP/inference listener over the existing approval executor.
//! Tokens are capabilities for this local transport, never provider credentials.
use std::{collections::HashMap, io::{Read, Write}, net::{TcpListener, TcpStream}, sync::{Arc, Mutex, atomic::{AtomicBool, AtomicUsize, Ordering}}, thread::JoinHandle, time::{Duration, Instant}};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use zeroize::Zeroizing;
use super::{BridgeState, DENIED, identity::{Peer, tcp_peer}, broker};

const ADDRESS: &str = "127.0.0.1:8765";
const MAX_BODY: usize = 1024 * 1024;
const MAX_HEADER: usize = 16 * 1024;
const VERSIONS: &[&str] = &["2025-11-25", "2025-06-18", "2025-03-26"];
struct Token {
    created: Instant,
    generation: u64, owner: Option<Peer>, sessions: HashMap<String, String>,
}
impl Token {
    fn bind(&mut self, generation: u64, peer: &Peer) -> bool {
        if self.generation != generation || (self.owner.is_none() && self.created.elapsed() >= Duration::from_secs(120)) { return false; }
        if self.owner.is_none() { self.owner=Some(peer.clone()); }
        self.owner.as_ref()==Some(peer)
    }

}
struct Runtime { stop: Arc<AtomicBool>, thread: JoinHandle<()> }
#[derive(Default)]
struct Hub { tokens: HashMap<String, Token>, runtime: Option<Runtime> }
#[derive(Default)]
pub struct HttpState(Mutex<Hub>);
fn random() -> Result<String, String> {
    let mut bytes = [0u8; 32]; getrandom::fill(&mut bytes).map_err(|_| DENIED)?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
fn active(app: &AppHandle, generation: u64) -> bool {
    let state = app.state::<BridgeState>();
    state.0.lock().is_ok_and(|c| c.session.as_ref().is_some_and(|s| s.generation == generation && s.expires > Instant::now()))
}
/// Issued only through the existing private, UID-verified Unix socket. No API
/// authorization is granted here; actual requests still use observed identity.
pub fn enroll(app: &AppHandle) -> Result<String, String> {
    let generation = {
        let state = app.state::<BridgeState>(); let core = state.0.lock().map_err(|_| DENIED)?;
        let s = core.session.as_ref().ok_or("bridge_inactive")?;
        if s.expires <= Instant::now() { return Err("session_expired".into()); }
        s.generation
    };
    let state = app.state::<HttpState>(); let mut hub = state.0.lock().map_err(|_| DENIED)?;
    hub.tokens.retain(|_, t| t.owner.as_ref().map(super::identity::alive).unwrap_or(t.created.elapsed() < Duration::from_secs(120)));
    if hub.runtime.is_none() || hub.tokens.len() >= 256 { return Err("bridge_busy".into()); }
    let token = random()?;
    hub.tokens.insert(token.clone(), Token { created:Instant::now(), generation, owner: None, sessions: HashMap::new() });
    Ok(token)
}
pub fn stop(app: &AppHandle) {
    let state = app.state::<HttpState>();
    let runtime = if let Ok(mut hub) = state.0.lock() { hub.tokens.clear(); hub.runtime.take() } else { None };
    if let Some(runtime) = runtime { runtime.stop.store(true, Ordering::SeqCst); let _ = runtime.thread.join(); }
}
pub fn start(app: &AppHandle, generation: u64) -> Result<(), String> {
    let listener = TcpListener::bind(ADDRESS).map_err(|_| DENIED)?;
    listener.set_nonblocking(true).map_err(|_| DENIED)?;
    let stop = Arc::new(AtomicBool::new(false)); let stopped = stop.clone(); let app = app.clone();
    let state_app = app.clone();
    let thread = std::thread::spawn(move || {
        let workers = Arc::new(AtomicUsize::new(0));
        while !stopped.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
                    let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));
                    if workers.load(Ordering::SeqCst) >= 4 { let _ = reply(&mut stream, 429, &json!({"error":{"code":"bridge_busy"}}), None); continue; }
                    workers.fetch_add(1, Ordering::SeqCst);
                    let workers = workers.clone(); let app = app.clone();
                    std::thread::spawn(move || {
                        if let Err(error) = handle(&app, generation, &mut stream) {
                            let _ = reply(&mut stream, 400, &json!({"error":broker::public_error(&error)}), None);
                        }
                        workers.fetch_sub(1, Ordering::SeqCst);
                    });
                },
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(20)),
                Err(_) => break,
            }
        }
    });
    let state = state_app.state::<HttpState>();
    let mut hub = state.0.lock().map_err(|_| DENIED)?;
    hub.runtime = Some(Runtime { stop, thread });
    Ok(())
}

struct HttpRequest { method: String, path: String, headers: HashMap<String, String>, body: Zeroizing<Vec<u8>> }
impl Drop for HttpRequest {
    fn drop(&mut self) { use zeroize::Zeroize; for value in self.headers.values_mut() { value.zeroize(); } }
}
fn parse_head(raw: &[u8]) -> Result<(HttpRequest, usize), String> {
    let mut fields = [httparse::EMPTY_HEADER; 64]; let mut parsed = httparse::Request::new(&mut fields);
    let size = match parsed.parse(raw).map_err(|_| "invalid_request")? { httparse::Status::Complete(n) => n, _ => return Err("invalid_request".into()) };
    if size > MAX_HEADER || parsed.version != Some(1) { return Err("invalid_request".into()); }
    let mut headers = HashMap::new();
    for h in parsed.headers.iter() {
        let name = h.name.to_ascii_lowercase(); let value = std::str::from_utf8(h.value).map_err(|_| "invalid_request")?.trim().to_owned();
        if headers.insert(name, value).is_some() { return Err("invalid_request".into()); }
    }
    let length = headers.get("content-length").map(|n| n.parse::<usize>()).transpose().map_err(|_| "invalid_request")?.unwrap_or(0);
    if headers.contains_key("transfer-encoding") || length > MAX_BODY { return Err("invalid_request".into()); }
    Ok((HttpRequest { method: parsed.method.ok_or("invalid_request")?.into(), path: parsed.path.ok_or("invalid_request")?.into(), headers, body: Zeroizing::new(Vec::new()) }, length))
}
fn read_request(stream: &mut impl Read) -> Result<HttpRequest, String> {
    let mut raw = Zeroizing::new(Vec::new()); let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        if raw.len() >= MAX_HEADER || Instant::now() >= deadline { return Err("invalid_request".into()); }
        let mut b = [0]; stream.read_exact(&mut b).map_err(|_| "invalid_request")?; raw.push(b[0]);
        if raw.ends_with(b"\r\n\r\n") { break; }
    }
    let (mut request, length) = parse_head(&raw)?;
    request.body.resize(length, 0);
    let mut offset=0;
    while offset<length {
        if Instant::now()>=deadline { return Err("invalid_request".into()); }
        let n=stream.read(&mut request.body[offset..]).map_err(|_| "invalid_request")?;
        if n==0 { return Err("invalid_request".into()); }
        offset+=n;
    }
    Ok(request)
}
fn valid_origin(request: &HttpRequest) -> bool {
    request.headers.get("host").is_some_and(|h| h == ADDRESS || h == "localhost:8765")
        && request.headers.get("origin").is_none_or(|o| o == "http://127.0.0.1:8765" || o == "http://localhost:8765")
}
fn headers(stream: &mut impl Write, status: u16, content_type: &str, length: Option<usize>, session: Option<&str>) -> Result<(), String> {
    write!(stream, "HTTP/1.1 {status} Bridge\r\nContent-Type: {content_type}\r\nCache-Control: no-store\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n").map_err(|_| DENIED)?;
    if let Some(n) = length { write!(stream, "Content-Length: {n}\r\n").map_err(|_| DENIED)?; }
    if let Some(id) = session { write!(stream, "Mcp-Session-Id: {id}\r\n").map_err(|_| DENIED)?; }
    if status == 401 { stream.write_all(b"WWW-Authenticate: Bearer realm=\"KPassword\"\r\n").map_err(|_| DENIED)?; }
    if status == 405 { stream.write_all(b"Allow: POST, DELETE\r\n").map_err(|_| DENIED)?; }
    stream.write_all(b"\r\n").map_err(|_| DENIED.into())
}
fn reply(stream: &mut impl Write, status: u16, value: &Value, session: Option<&str>) -> Result<(), String> {
    let data = Zeroizing::new(serde_json::to_vec(value).map_err(|_| DENIED)?);
    if let Some(seconds) = value.pointer("/error/retry_after").and_then(Value::as_u64) {
        write!(stream,"HTTP/1.1 {status} Bridge\r\nRetry-After: {seconds}\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\nContent-Length: {}\r\n\r\n",data.len()).map_err(|_| DENIED)?;
    } else { headers(stream, status, "application/json", Some(data.len()), session)?; }
    stream.write_all(&data).map_err(|_| DENIED.into())
}
fn rpc_error(id: &Value, code: i32, message: &str) -> Value { json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":message}}) }
fn tool_failure(id: &Value, error: &str) -> Value {
    let detail = broker::public_error(error);
    json!({"jsonrpc":"2.0","id":id,"result":{"content":[{"type":"text","text":detail.to_string()}],"structuredContent":{"error":detail},"isError":true}})
}
fn authenticated(app: &AppHandle, generation: u64, token: &str, peer: &Peer) -> bool {
    if !active(app, generation) { return false; }
    let state = app.state::<HttpState>();
    state.0.lock().is_ok_and(|h| h.tokens.get(token).is_some_and(|t| t.generation == generation && t.owner.as_ref() == Some(peer)))
}
fn authenticated_mcp(app: &AppHandle, generation: u64, token: &str, peer: &Peer, session: &str) -> bool {
    if !authenticated(app,generation,token,peer) { return false; }
    let state=app.state::<HttpState>();
    state.0.lock().is_ok_and(|h| h.tokens.get(token).is_some_and(|t| t.sessions.contains_key(session)))
}

fn bind_token(app: &AppHandle, generation: u64, token: &str, peer: &Peer) -> bool {
    if !active(app, generation) { return false; }
    let state = app.state::<HttpState>(); let Ok(mut h) = state.0.lock() else { return false; };
    let Some(t) = h.tokens.get_mut(token) else { return false; };
    t.bind(generation,peer)
}
/// Known model families can choose a provider, never a credential among multiple
/// matching records. An explicit key must still support the requested operation.
fn requested_provider<'a>(provider: &'a str, body: &Value) -> &'a str {
    if !provider.is_empty() { return provider; }
    match body["model"].as_str().unwrap_or("") {
        m if m.starts_with("deepseek-") => "DEEPSEEK_API_KEY",
        m if m.starts_with("claude-") => "ANTHROPIC_API_KEY",
        _ => "",
    }
}

fn resolve(app: &AppHandle, provider: &str, explicit: Option<&str>, operation: &str) -> Result<String, String> {
    let state = app.state::<BridgeState>(); let core = state.0.lock().map_err(|_| DENIED)?;
    let s = core.session.as_ref().ok_or("bridge_inactive")?;
    if s.expires <= Instant::now() { return Err("session_expired".into()); }
    select_key(&s.keys,provider,explicit,operation)
}
fn select_key(records: &HashMap<String,super::Key>,provider: &str,explicit: Option<&str>,operation: &str) -> Result<String,String> {
    let keys: Vec<_> = records.iter().filter(|(id, k)| {
        explicit.is_none_or(|e| id.as_str() == e) && (provider.is_empty() || k.identifier == provider)
            && (matches!(k.config.endpoint(operation), Ok(Some(_))) || (k.config.base_url.is_empty() && broker::linux::endpoint(&k.identifier, operation).is_ok()))
    }).collect();
    match keys.as_slice() { [(id, _)] => Ok((*id).clone()), [] => Err("key_not_found".into()), _ => Err("credential_ambiguous".into()) }
}
fn tools() -> Value {
    json!({"tools":[{
        "name":"api_request", "description":"Call a vault-backed API. KPassword approves the observed local process, credential, operation and model. Provider keys are never returned. Use a provider identifier such as DEEPSEEK_API_KEY; use credential_id if multiple keys match. For inference streaming use the local HTTP gateway.",
        "inputSchema":{"type":"object","properties":{"provider":{"type":"string"},"credential_id":{"type":"string"},"operation":{"type":"string","description":"chat, responses, messages, embeddings, http.get/http.post or a supported service operation"},"body":{"type":"object"}},"required":["operation","body"],"additionalProperties":false},
        "annotations":{"readOnlyHint":false,"destructiveHint":true,"idempotentHint":false,"openWorldHint":true}
    }]})
}
fn handle(app: &AppHandle, generation: u64, stream: &mut TcpStream) -> Result<(), String> {
    let request = read_request(stream)?;
    if !valid_origin(&request) { return reply(stream, 403, &json!({"error":{"code":"invalid_origin"}}), None); }
    let token = Zeroizing::new(request.headers.get("authorization").and_then(|h| h.strip_prefix("Bearer ")).unwrap_or("").to_owned());
    if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) { return reply(stream, 401, &json!({"error":{"code":"authentication_required"}}), None); }
    let observed = match tcp_peer(stream) { Ok(p)=>p, Err(_)=>return reply(stream,401,&json!({"error":{"code":"identity_verification_failed"}}),None) };
    if !bind_token(app, generation, &token, &observed) { return reply(stream, 401, &json!({"error":{"code":"authentication_failed"}}), None); }
    // Transport capabilities authenticate connections; approval belongs to the
    // observed application/project and survives token/session reconnects.
    let scoped = observed.clone();
    if request.path == "/mcp" { return mcp(app, generation, &token, &observed, &scoped, &request, stream); }
    let operation = match request.path.as_str() { "/v1/chat/completions" => "chat", "/v1/responses" => "responses", "/v1/messages" => "messages", _ => return reply(stream, 404, &json!({"error":{"code":"not_found"}}), None) };
    if request.method != "POST" { return reply(stream, 405, &json!({"error":{"code":"method_not_allowed"}}), None); }
    if !request.headers.get("content-type").is_some_and(|h| h.split(';').next() == Some("application/json")) { return reply(stream, 415, &json!({"error":{"code":"invalid_request"}}), None); }
    let mut body: Value = serde_json::from_slice(&request.body).map_err(|_| "invalid_request")?;
    let result = (|| {
        let provider = request.headers.get("x-kpassword-provider").map(String::as_str).unwrap_or("");
        let key = resolve(app, requested_provider(provider,&body), request.headers.get("x-kpassword-credential").map(String::as_str), operation)?;
        let raw = Zeroizing::new(serde_json::to_vec(&json!({"version":1,"key_id":key,"operation":operation,"body":body})).map_err(|_| DENIED)?);
        let socket = stream.try_clone().map_err(|_| DENIED)?;
        let mut relay = Gateway { target: stream, line: Zeroizing::new(Vec::new()), response: None, streaming: false, started: false, operation };
        let result = broker::linux::execute(app, &raw, scoped.clone(), || { let p = tcp_peer(&socket)?; if p != observed { return Err("identity_changed".into()); } Ok(scoped.clone()) }, &mut relay, || authenticated(app, generation, &token, &observed));
        relay.finish(result)
    })();
    super::erase_json(&mut body); result
}
fn mcp(app: &AppHandle, generation: u64, token: &str, observed: &Peer, scoped: &Peer, request: &HttpRequest, stream: &mut TcpStream) -> Result<(), String> {
    if request.method == "GET" { return reply(stream, 405, &json!({"error":{"code":"method_not_allowed"}}), None); }
    let session = request.headers.get("mcp-session-id");
    if request.method == "DELETE" {
        let state = app.state::<HttpState>(); let mut h = state.0.lock().map_err(|_| DENIED)?;
        let removed = session.is_some_and(|id| h.tokens.get_mut(token).is_some_and(|t| t.sessions.remove(id).is_some()));
        drop(h);
        return reply(stream, if removed { 200 } else { 404 }, &json!({}), None);
    }
    if request.method != "POST" { return reply(stream, 405, &json!({}), None); }
    if !request.headers.get("content-type").is_some_and(|h| h.split(';').next() == Some("application/json")) { return reply(stream, 415, &json!({}), None); }
    if !request.headers.get("accept").is_some_and(|h| h.contains("application/json") && h.contains("text/event-stream")) { return reply(stream, 406, &json!({}), None); }
    let mut message: Value = match serde_json::from_slice(&request.body) { Ok(m) => m, Err(_) => return reply(stream, 400, &rpc_error(&Value::Null, -32700, "Parse error"), None) };
    let result = (|| {
        let id = message.get("id").cloned().unwrap_or(Value::Null);
        let method = message["method"].as_str().unwrap_or("");
        if message["jsonrpc"] != "2.0" || !message.is_object() || method.is_empty() || !(id.is_null() || id.is_string() || id.is_number()) { return reply(stream, 400, &rpc_error(&id, -32600, "Invalid request"), None); }
        if method == "initialize" {
            if session.is_some() || message.get("id").is_none() { return reply(stream, 400, &rpc_error(&id, -32600, "Invalid initialize"), None); }
            let version = message["params"]["protocolVersion"].as_str().filter(|v| VERSIONS.contains(v)).unwrap_or(VERSIONS[0]);
            let sid = random()?;
            let state = app.state::<HttpState>(); let mut h = state.0.lock().map_err(|_| DENIED)?;
            let t = h.tokens.get_mut(token).ok_or(DENIED)?;
            if t.sessions.len() >= 8 { return Err("bridge_busy".into()); }
            t.sessions.insert(sid.clone(), version.into()); drop(h);
            return reply(stream, 200, &json!({"jsonrpc":"2.0","id":id,"result":{"protocolVersion":version,"capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"KPassword Secrets Bridge","version":env!("CARGO_PKG_VERSION")},"instructions":"Uses KPassword's local approval window. Client names are not trusted identities. Provider credentials never leave KPassword. MCP tools do not change your primary model."}}), Some(&sid));
        }
        let version = {
            let state = app.state::<HttpState>(); let h = state.0.lock().map_err(|_| DENIED)?;
            session.and_then(|id| h.tokens.get(token)?.sessions.get(id)).cloned()
        };
        let Some(version) = version else { return reply(stream, 404, &rpc_error(&id, -32000, "Session not found"), None); };
        let sid=session.ok_or("invalid_request")?;
        if request.headers.get("mcp-protocol-version") != Some(&version) { return reply(stream, 400, &rpc_error(&id, -32600, "Protocol version mismatch"), None); }
        if method.starts_with("notifications/") && !message.get("id").is_some() { return headers(stream, 202, "application/json", Some(0), None); }
        if message.get("id").is_none() { return headers(stream, 202, "application/json", Some(0), None); }
        let response = match method {
            "ping" => json!({"jsonrpc":"2.0","id":id,"result":{}}),
            "tools/list" => json!({"jsonrpc":"2.0","id":id,"result":tools()}),
            "tools/call" => {
                let result: Result<Value, String> = (|| {
                    if message["params"]["name"] != "api_request" { return Err("unsupported_operation".into()); }
                    let args = &message["params"]["arguments"];
                    if !args.as_object().is_some_and(|o| o.keys().all(|k| ["provider","credential_id","operation","body"].contains(&k.as_str()))) { return Err("invalid_request".into()); }
                    let op = args["operation"].as_str().ok_or("invalid_request")?;
                    let body = &args["body"];
                    if !body.is_object() || body.get("stream").is_some_and(|v| v != false) { return Err("invalid_request".into()); }
                    for key in ["provider","credential_id"] { if args.get(key).is_some_and(|v| !v.is_string()) { return Err("invalid_request".into()); } }
                    let key = resolve(app, requested_provider(args["provider"].as_str().unwrap_or(""),body), args["credential_id"].as_str(), op)?;
                    let raw = Zeroizing::new(serde_json::to_vec(&json!({"version":1,"key_id":key,"operation":op,"body":body})).map_err(|_| DENIED)?);
                    let socket = stream.try_clone().map_err(|_| DENIED)?; let mut output = Zeroizing::new(Vec::new());
                    broker::linux::execute(app, &raw, scoped.clone(), || { let p = tcp_peer(&socket)?; if &p != observed { return Err("identity_changed".into()); } Ok(scoped.clone()) }, &mut *output, || authenticated_mcp(app, generation, token, observed, sid))?;
                    serde_json::from_slice::<Value>(&output).map_err(|_| "provider_unavailable".into())
                })();
                match result {
                    Ok(mut value) => { let r = json!({"jsonrpc":"2.0","id":id,"result":{"content":[{"type":"text","text":serde_json::to_string(&value).map_err(|_| DENIED)?}],"isError":value["ok"]==false || value["status"].as_u64().is_some_and(|s| s >= 400)}}); super::erase_json(&mut value); r },
                    Err(e) => tool_failure(&id,&e),
                }
            },
            _ => rpc_error(&id, -32601, "Method not found"),
        };
        let mut response = response;
        let result = reply(stream, 200, &response, None); super::erase_json(&mut response); result
    })();
    super::erase_json(&mut message); result
}
/// Convert only broker-sanitized records to standard HTTP/SSE. The broker's
/// private wire format and upstream headers never pass through to consumers.
struct Gateway<'a> { target: &'a mut TcpStream, line: Zeroizing<Vec<u8>>, response: Option<Value>, streaming: bool, started: bool, operation: &'a str }
impl Gateway<'_> {
    fn record(&mut self, mut record: Value) -> Result<(), String> {
        let result = (|| {
            if record["stream"] == true {
                self.streaming = true; self.started = true;
                headers(self.target, record["status"].as_u64().unwrap_or(502) as u16, "text/event-stream", None, None)?;
            } else if let Some(data) = record.get("data") {
                let event = record["event"].as_str().unwrap_or("");
                if !event.is_empty() { write!(self.target, "event: {event}\n").map_err(|_| DENIED)?; }
                writeln!(self.target, "data: {}\n", serde_json::to_string(data).map_err(|_| DENIED)?).map_err(|_| DENIED)?;
                self.target.flush().map_err(|_| DENIED)?;
            } else if record["done"] == true {
                if self.operation == "chat" { self.target.write_all(b"data: [DONE]\n\n").map_err(|_| DENIED)?; }
            } else { self.response = Some(record.clone()); }
            Ok(())
        })();
        super::erase_json(&mut record); result
    }
    fn finish(&mut self, result: Result<(), String>) -> Result<(), String> {
        if let Err(error) = result {
            let value = json!({"error":broker::public_error(&error)});
            if self.started { writeln!(self.target, "event: error\ndata: {value}\n").map_err(|_| DENIED)?; return Ok(()); }
            return reply(self.target, match broker::public_error_code(&error) { "quota_exceeded" | "bridge_busy" => 429, "provider_unavailable" => 502, "invalid_request" | "unsupported_operation" => 400, _ => 403 }, &value, None);
        }
        if self.streaming { return Ok(()); }
        let mut response = self.response.take().ok_or("provider_unavailable")?;
        let result = reply(self.target, response["status"].as_u64().unwrap_or(502) as u16, &response["body"], None);
        super::erase_json(&mut response); result
    }
}
impl Write for Gateway<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        for b in bytes {
            if *b == b'\n' {
                let record: Value = serde_json::from_slice(&self.line).map_err(|_| std::io::Error::other("invalid broker record"))?;
                self.line.clear(); self.record(record).map_err(|_| std::io::Error::other("gateway closed"))?;
            } else { if self.line.len() > 4 * 1024 * 1024 + 8192 { return Err(std::io::Error::other("oversized broker record")); } self.line.push(*b); }
        }
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> { self.target.flush() }
}

#[cfg(test)] mod tests {
    use super::*;
    fn token() -> Token { Token { created:Instant::now(),generation:1,owner:None,sessions:HashMap::new() } }
    fn peer() -> Peer { Peer { pid:42,started:"100".into(),executable:"/app".into(),sha256:"hash".into(),application:"/app".into(),entry_script:None,project:"/project".into(),identity:"identity".into(),remember_allowed:true } }
    #[test] fn quota_details_survive_http_and_mcp_without_untrusted_error_text() {
        let mut usage=super::super::quota::Usage::default();
        let limits=super::super::quota::Limits { calls_per_minute:1,output_tokens_per_hour:0 };
        usage.reserve(limits,32).unwrap();let error=usage.reserve(limits,32).err().unwrap().error();
        let detail=broker::public_error(&error);
        assert_eq!(detail["code"],"quota_exceeded");assert_eq!(detail["limit"],"calls_per_minute");
        assert_eq!(detail["remaining"],0);assert_eq!(detail["retry_after"],60);
        let mut http=Vec::new();reply(&mut http,429,&json!({"error":detail}),None).unwrap();
        let http=String::from_utf8(http).unwrap();assert!(http.contains("Retry-After: 60\r\n"));assert!(http.contains("application_credential"));
        let rpc=tool_failure(&json!(1),&error);assert_eq!(rpc["result"]["structuredContent"]["error"],detail);
        assert_eq!(tool_failure(&json!(1),"secret in unexpected payload")["result"]["structuredContent"]["error"],json!({"code":"request_failed"}));
    }
    #[test] fn stolen_tokens_process_reuse_and_context_changes_are_rejected() {
        let mut t=token();let p=peer();assert!(t.bind(1,&p));assert!(t.bind(1,&p));assert!(!t.bind(2,&p));
        for changed in [Peer { pid:43,..p.clone() },Peer { started:"101".into(),..p.clone() },Peer { sha256:"changed".into(),..p.clone() },Peer { project:"/other".into(),..p.clone() }] { assert!(!t.bind(1,&changed)); }
        let mut expired=token();expired.created=Instant::now()-Duration::from_secs(121);assert!(!expired.bind(1,&p));
    }
    #[test] fn transport_sessions_remain_bound_to_their_token() {
        let mut a=token();let b=token();a.sessions.insert("session-a".into(),"2025-11-25".into());assert!(!b.sessions.contains_key("session-a"));
    }
    #[test] fn provider_and_operation_selection_requires_explicit_ambiguous_credential() {
        fn key(identifier:&str) -> super::super::Key { super::super::Key { secret:Zeroizing::new("fictitious".into()),identifier:identifier.into(),integrations:vec![],label:"test".into(),config:super::super::providers::Config::default() } }
        let mut keys=HashMap::from([("ds-a".into(),key("DEEPSEEK_API_KEY")),("openai".into(),key("OPENAI_API_KEY"))]);
        assert_eq!(requested_provider("",&json!({"model":"deepseek-flash"})),"DEEPSEEK_API_KEY");
        assert_eq!(select_key(&keys,"DEEPSEEK_API_KEY",None,"responses").unwrap(),"ds-a");
        assert_eq!(select_key(&keys,"DEEPSEEK_API_KEY",Some("openai"),"chat").unwrap_err(),"key_not_found");
        keys.insert("ds-b".into(),key("DEEPSEEK_API_KEY"));
        assert_eq!(select_key(&keys,"DEEPSEEK_API_KEY",None,"chat").unwrap_err(),"credential_ambiguous");
        assert_eq!(select_key(&keys,"DEEPSEEK_API_KEY",Some("ds-b"),"chat").unwrap(),"ds-b");
        assert!(select_key(&keys,"DEEPSEEK_API_KEY",Some("ds-b"),"embeddings").is_err());
    }
    #[test] fn host_origin_framing_and_smuggling_fail_closed() {
        let valid = b"POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:8765\r\nContent-Length: 2\r\n\r\n{}";
        let r = read_request(&mut valid.as_slice()).unwrap(); assert!(valid_origin(&r)); assert_eq!(&*r.body,b"{}");
        for raw in ["POST /mcp HTTP/1.1\r\nHost: evil.invalid\r\n\r\n", "POST /mcp HTTP/1.1\r\nHost: localhost:8765\r\nOrigin: https://evil.invalid\r\n\r\n", "POST /mcp HTTP/1.1\r\nHost: localhost:8765.evil.invalid\r\n\r\n"] { assert!(!valid_origin(&read_request(&mut raw.as_bytes()).unwrap())); }
        for raw in ["POST /mcp HTTP/1.1\r\nHost: localhost:8765\r\nContent-Length: 2\r\nContent-Length: 3\r\n\r\n", "POST /mcp HTTP/1.1\r\nHost: localhost:8765\r\nTransfer-Encoding: chunked\r\n\r\n", "POST /mcp HTTP/1.1\r\nHost: localhost:8765\r\nContent-Length: 1048577\r\n\r\n"] { assert!(parse_head(raw.as_bytes()).is_err()); }
    }
    #[test] fn transport_tokens_are_random_and_have_no_provider_secret() { let a=random().unwrap(); let b=random().unwrap(); assert_ne!(a,b); assert_eq!(a.len(),64); }
    #[test] fn mcp_tool_schema_does_not_accept_credentials_or_identity() {
        let schema=tools(); let props=&schema["tools"][0]["inputSchema"]["properties"];
        for field in ["api_key","secret","application","pid","url"] { assert!(props.get(field).is_none()); }
        assert_eq!(schema["tools"][0]["inputSchema"]["additionalProperties"],false);
    }
    #[test] fn mcp_session_and_version_contract_is_explicit() { assert!(VERSIONS.contains(&"2025-11-25")); assert!(!VERSIONS.contains(&"2026-07-28")); }
}
