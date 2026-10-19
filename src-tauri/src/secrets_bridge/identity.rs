//! Kernel-observed caller identity; not isolation against same-account injection.
use std::{fs, os::{fd::AsRawFd, unix::net::UnixStream}, path::{Path, PathBuf}};
use sha2::{Digest, Sha256};
use super::{DENIED, fingerprint};

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Peer {
    pub pid: i32, pub started: String, pub executable: String, pub sha256: String,
    pub application: String, pub entry_script: Option<String>, pub project: String,
    pub identity: String, pub remember_allowed: bool,
}
fn process(pid: i32) -> Result<(i32, String, String, String), String> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).map_err(|_| DENIED)?;
    let fields: Vec<_> = stat.rsplit_once(')').ok_or(DENIED)?.1.split_whitespace().collect();
    let parent = fields.get(1).ok_or(DENIED)?.parse().map_err(|_| DENIED)?;
    let started = fields.get(19).ok_or(DENIED)?.to_string();
    let exe = fs::read_link(format!("/proc/{pid}/exe")).map_err(|_| DENIED)?;
    let (path, hash) = fingerprint(exe.to_str().ok_or(DENIED)?)?;
    Ok((parent, started, path, hash))
}
fn script_runtime(path: &str) -> bool {
    let name = Path::new(path).file_name().unwrap_or_default().to_string_lossy();
    name.starts_with("python") || ["node", "nodejs", "bun", "deno"].contains(&name.as_ref())
}
fn interpreter(path: &str) -> bool {
    let name = Path::new(path).file_name().unwrap_or_default().to_string_lossy();
    script_runtime(path) || ["ruby", "perl", "php", "lua"].iter().any(|prefix| name.starts_with(prefix))
        || ["luajit", "java", "dotnet", "Rscript", "pwsh", "powershell", "sh", "bash", "dash", "zsh", "fish"].contains(&name.as_ref())
}
fn entry(pid: i32, executable: &str) -> Option<(String, String)> {
    // Only these command-line grammars can establish a script identity.
    // Other recognized generic runtimes stay one-time-only, never binary grants.
    if !script_runtime(executable) { return None; }
    let args = fs::read(format!("/proc/{pid}/cmdline")).ok()?;
    if args.len() > 64 * 1024 { return None; }
    for arg in args.split(|b| *b == 0).skip(1) {
        let arg = std::str::from_utf8(arg).ok()?;
        if ["-c", "-m", "-e", "--eval", "--print", "-p"].contains(&arg) { return None; }
        if arg.starts_with('-') {
            if ["-u", "-B", "-E", "-s", "-S", "-I", "-O", "-OO", "--no-warnings", "--enable-source-maps"].contains(&arg) { continue; }
            // An unknown option may consume its next argument (e.g. --require).
            // Do not misidentify a preload/module argument as the entry script.
            return None;
        }
        if arg.is_empty() { return None; }
        let candidate = PathBuf::from(arg);
        let candidate = if candidate.is_absolute() { candidate } else { fs::read_link(format!("/proc/{pid}/cwd")).ok()?.join(candidate) };
        let path = fs::canonicalize(candidate).ok()?;
        use std::os::unix::fs::MetadataExt;
        let metadata = fs::metadata(&path).ok()?;
        if !metadata.is_file() || metadata.len() > 16 * 1024 * 1024 || metadata.mode() & 0o022 != 0 { return None; }
        let bytes = fs::read(&path).ok()?;
        if bytes.len() > 16 * 1024 * 1024 { return None; }
        return Some((path.to_str()?.to_owned(), format!("{:x}", Sha256::digest(bytes))));
    }
    None
}
pub fn peer(stream: &UnixStream) -> Result<Peer, String> {
    let mut cred: libc::ucred = unsafe { std::mem::zeroed() };
    let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    if unsafe { libc::getsockopt(stream.as_raw_fd(), libc::SOL_SOCKET, libc::SO_PEERCRED, &mut cred as *mut _ as *mut _, &mut len) } != 0
        || len as usize != std::mem::size_of::<libc::ucred>() || cred.uid != unsafe { libc::geteuid() } || cred.pid <= 0 { return Err(DENIED.into()); }
    observed(cred.pid, cred.uid)
}
fn observed(pid: i32, uid: u32) -> Result<Peer, String> {
    let (mut parent, started, executable, sha256) = process(pid)?;
    let project = fs::canonicalize(fs::read_link(format!("/proc/{}/cwd", pid)).map_err(|_| DENIED)?).map_err(|_| DENIED)?.to_str().ok_or(DENIED)?.to_owned();
    let mut application = executable.clone();
    let mut application_hash = sha256.clone();
    let mut script = entry(pid, &executable);
    let transport_script = script.clone();
    // The packaged connector is a transport, not an application. Inspect a
    // bounded launcher chain; never trust names sent in the request or env vars.
    if script.as_ref().is_some_and(|(p, _)| Path::new(p).file_name().is_some_and(|n| n == "kpassword_bridge_client.py" || n == "kpassword_mcp.py")) {
        script = None;
        for _ in 0..6 {
            if parent <= 1 { break; }
            use std::os::unix::fs::MetadataExt;
            if !fs::metadata(format!("/proc/{parent}")).is_ok_and(|m| m.uid() == uid) { break; }
            let Ok((next, _, exe, hash)) = process(parent) else { break; };
            if let Some(found) = entry(parent, &exe) { application = exe; application_hash = hash; script = Some(found); break; }
            let name = Path::new(&exe).file_name().unwrap_or_default().to_string_lossy();
            if !interpreter(&exe) && !["sh", "bash", "dash", "zsh", "fish", "env", "sudo", "flatpak", "bwrap", "systemd", "konsole", "gnome-terminal-server", "kitty", "alacritty"].contains(&name.as_ref()) {
                application = exe; application_hash = hash; break;
            }
            parent = next;
        }
    }
    let remember_allowed = !interpreter(&application) || script.is_some();
    let (entry_script, script_hash) = script.map(|(p,h)| (Some(p),h)).unwrap_or((None,String::new()));
    let encoded = serde_json::to_vec(&(&executable, &sha256, &transport_script, &application, &application_hash, &entry_script, &script_hash, &project)).map_err(|_| DENIED)?;
    let identity = format!("{:x}", Sha256::digest(encoded));
    Ok(Peer { pid:pid, started, executable, sha256, application, entry_script, project, identity, remember_allowed })
}
/// TCP has no SO_PEERCRED. Correlate the reverse connected socket with /proc.
/// Deny hidden /proc, ambiguous inherited sockets and other users; never fall
/// back to a client-supplied pid, name, User-Agent or token label.
pub fn tcp_peer(stream: &std::net::TcpStream) -> Result<Peer, String> {
    use std::os::unix::fs::MetadataExt;
    let local = stream.local_addr().map_err(|_| DENIED)?;
    let remote = stream.peer_addr().map_err(|_| DENIED)?;
    fn address(a: std::net::SocketAddr) -> Result<String,String> {
        let std::net::IpAddr::V4(ip) = a.ip() else { return Err(DENIED.into()); };
        if !ip.is_loopback() { return Err(DENIED.into()); }
        Ok(format!("{:08X}:{:04X}", u32::from_le_bytes(ip.octets()), a.port()))
    }
    let client = address(remote)?; let server = address(local)?;
    let uid = unsafe { libc::geteuid() };
    let table = fs::read_to_string("/proc/net/tcp").map_err(|_| DENIED)?;
    let mut inodes = Vec::new();
    for row in table.lines().skip(1) {
        let f: Vec<_> = row.split_whitespace().collect();
        if f.len() > 9 && f[1] == client && f[2] == server && f[3] == "01"
            && f[7].parse::<u32>().ok() == Some(uid) && f[9] != "0" { inodes.push(f[9].to_string()); }
    }
    if inodes.len() != 1 { return Err(DENIED.into()); }
    let wanted = format!("socket:[{}]",inodes[0]);
    let mut owner = None;
    for item in fs::read_dir("/proc").map_err(|_| DENIED)?.take(65536).flatten() {
        let Some(pid) = item.file_name().to_str().and_then(|s| s.parse::<i32>().ok()) else { continue; };
        if !item.metadata().is_ok_and(|m| m.uid() == uid) { continue; }
        let Ok(fds) = fs::read_dir(item.path().join("fd")) else { continue; };
        if fds.take(65536).flatten().any(|fd| fs::read_link(fd.path()).is_ok_and(|p| p.as_os_str() == wanted.as_str())) {
            if owner.replace(pid).is_some() { return Err(DENIED.into()); }
        }
    }
    observed(owner.ok_or(DENIED)?, uid)
}

pub fn alive(peer: &Peer) -> bool {
    fs::read_to_string(format!("/proc/{}/stat",peer.pid)).ok()
        .and_then(|s| s.rsplit_once(')').and_then(|(_,f)| f.split_whitespace().nth(19)).map(str::to_owned))
        .is_some_and(|s| s==peer.started)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn actual_kernel_peer_is_bound_to_process_and_project() {
        let (a,_) = UnixStream::pair().unwrap();
        let p = peer(&a).unwrap();
        assert_eq!(p.pid, std::process::id() as i32);
        assert_eq!(p.project, fs::canonicalize(std::env::current_dir().unwrap()).unwrap().to_str().unwrap());
        assert_eq!(peer(&a).unwrap(), p);
    }
    #[test] fn actual_loopback_connection_has_kernel_observed_identity() {
        let listener=std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let _client=std::net::TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (server,_)=listener.accept().unwrap();
        let p=tcp_peer(&server).unwrap();
        assert_eq!(p.pid,std::process::id() as i32);
        assert!(alive(&p));
        assert_eq!(tcp_peer(&server).unwrap(),p);
    }
    #[test] fn remembered_identity_survives_process_restart_but_changes_with_script_or_project() {
        use std::{io::Write,process::Command};
        let root=std::env::temp_dir().join(format!("kp-identity-{}-{}",std::process::id(),super::super::super::now_epoch_millis()));
        fs::create_dir(&root).unwrap();let script=root.join("app.py");let socket=root.join("peer.sock");
        fs::write(&script,b"import socket,sys\ns=socket.socket(socket.AF_UNIX)\ns.connect(sys.argv[1])\ns.recv(1)\n").unwrap();
        let listener=std::os::unix::net::UnixListener::bind(&socket).unwrap();
        let observe=|cwd:&Path| {
            let mut child=Command::new("python3").arg(&script).arg(&socket).current_dir(cwd).spawn().unwrap();
            let (mut stream,_)=listener.accept().unwrap();let p=peer(&stream).unwrap();
            stream.write_all(b"x").unwrap();assert!(child.wait().unwrap().success());p
        };
        let first=observe(&root);let second=observe(&root);
        assert_ne!(first.pid,second.pid);assert_eq!(first.identity,second.identity);assert!(first.remember_allowed);
        use std::fs::OpenOptions;
        OpenOptions::new().append(true).open(&script).unwrap().write_all(b"# code changed\n").unwrap();
        assert_ne!(first.identity,observe(&root).identity);
        let other=root.join("project-b");fs::create_dir(&other).unwrap();assert_ne!(observe(&root).identity,observe(&other).identity);
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn generic_interpreters_are_distinguished_from_native_binaries() {
        assert!(interpreter("/usr/bin/python3.14")); assert!(interpreter("/usr/bin/node"));
        for path in ["/usr/bin/ruby3.4", "/usr/bin/perl", "/usr/bin/php8.5", "/usr/bin/bash", "/usr/bin/java", "/usr/bin/dotnet"] {
            assert!(interpreter(path));
            assert!(!script_runtime(path));
            assert!(entry(std::process::id() as i32, path).is_none());
        }
        assert!(!interpreter("/usr/bin/my-project"));
    }
}
