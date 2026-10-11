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
fn interpreter(path: &str) -> bool {
    let name = Path::new(path).file_name().unwrap_or_default().to_string_lossy();
    name.starts_with("python") || ["node", "nodejs", "bun", "deno"].contains(&name.as_ref())
}
fn entry(pid: i32, executable: &str) -> Option<(String, String)> {
    if !interpreter(executable) { return None; }
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
    let (mut parent, started, executable, sha256) = process(cred.pid)?;
    let project = fs::canonicalize(fs::read_link(format!("/proc/{}/cwd", cred.pid)).map_err(|_| DENIED)?).map_err(|_| DENIED)?.to_str().ok_or(DENIED)?.to_owned();
    let mut application = executable.clone();
    let mut application_hash = sha256.clone();
    let mut script = entry(cred.pid, &executable);
    let transport_script = script.clone();
    // The packaged connector is a transport, not an application. Inspect a
    // bounded launcher chain; never trust names sent in the request or env vars.
    if script.as_ref().is_some_and(|(p, _)| Path::new(p).file_name().is_some_and(|n| n == "kpassword_bridge_client.py")) {
        script = None;
        for _ in 0..6 {
            if parent <= 1 { break; }
            use std::os::unix::fs::MetadataExt;
            if !fs::metadata(format!("/proc/{parent}")).is_ok_and(|m| m.uid() == cred.uid) { break; }
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
    Ok(Peer { pid:cred.pid, started, executable, sha256, application, entry_script, project, identity, remember_allowed })
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
    #[test] fn generic_interpreters_are_distinguished_from_native_binaries() {
        assert!(interpreter("/usr/bin/python3.14")); assert!(interpreter("/usr/bin/node"));
        assert!(!interpreter("/usr/bin/my-project"));
    }
}
