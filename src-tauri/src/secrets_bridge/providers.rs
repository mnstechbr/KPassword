//! Provider configuration comes exclusively from the authenticated vault.
//! A requesting application cannot override its origin or authentication.
use serde::{Deserialize,Serialize};
use std::net::{IpAddr,SocketAddr,ToSocketAddrs};

#[derive(Clone,Default,Deserialize,Serialize)]
pub struct Config {
    #[serde(default,rename="apiBaseUrl")] pub base_url:String,
    #[serde(default,rename="apiProtocol")] pub protocol:String,
    #[serde(default,rename="apiAuthType")] pub auth:String,
}
impl Config {
    pub fn validate(&self) -> Result<(),String> {
        if self.base_url.is_empty() && (self.protocol.is_empty() || self.protocol=="auto") { return Ok(()); }
        if !["openai","anthropic","json"].contains(&self.protocol.as_str()) || !["", "bearer","x-api-key","x-goog-api-key","api-key"].contains(&self.auth.as_str()) { return Err("invalid_request".into()); }
        checked_url(&self.base_url).map(|_| ())
    }
    pub fn endpoint(&self, operation:&str) -> Result<Option<String>,String> {
        if self.base_url.is_empty() { return Ok(None); }
        self.validate()?;
        let path=match (self.protocol.as_str(),operation) {
            ("openai","chat")=>"chat/completions", ("openai","responses")=>"responses", ("openai","embeddings")=>"embeddings",
            ("anthropic","messages")=>"messages", ("json","http.get" | "http.post")=>"",
            _=>return Err("unsupported_operation".into()),
        };
        let mut url=self.base_url.trim_end_matches('/').to_string();
        if !path.is_empty() { url.push('/');url.push_str(path); }
        checked_url(&url)?;
        Ok(Some(url))
    }
}
fn checked_url(url:&str)->Result<reqwest::Url,String> {
    let url=reqwest::Url::parse(url).map_err(|_| "invalid_request")?;
    let host=url.host_str().ok_or("invalid_request")?;
    if url.scheme()!="https" || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() || url.port_or_known_default()!=Some(443)
        || host.parse::<IpAddr>().is_ok() || !host.contains('.') || host.ends_with(".localhost") || host.ends_with(".local") || host.ends_with(".internal")
        || url.as_str().len()>2048 { return Err("invalid_request".into()); }
    Ok(url)
}
fn public_ip(ip:IpAddr)->bool {
    match ip {
        IpAddr::V4(ip)=> {
            let [a,b,c,_]=ip.octets();
            !ip.is_private() && !ip.is_loopback() && !ip.is_link_local() && !ip.is_broadcast() && !ip.is_documentation()
            && a!=0 && a<224 && !(a==100 && (64..=127).contains(&b)) && !(a==192 && b==0 && c==0)
            && !(a==198 && (b==18 || b==19))
        },
        // IPv4 mappings, translation prefixes, local/multicast/documentation
        // and special ranges fail closed; public unicast is currently 2000::/3.
        IpAddr::V6(ip)=> { let s=ip.segments(); s[0]&0xe000==0x2000 && !(s[0]==0x2001 && (s[1]==0 || s[1]==2 || s[1]==0x10 || s[1]==0xdb8)) && !(s[0]==0x2002) },
    }
}
pub fn pinned_client(url:&str)->Result<reqwest::blocking::Client,String> {
    let url=checked_url(url)?;
    let host=url.host_str().ok_or("invalid_request")?;
    let addresses:Vec<SocketAddr>=(host,443).to_socket_addrs().map_err(|_| "provider_unavailable")?.take(33).collect();
    if addresses.is_empty() || addresses.len()>32 || addresses.iter().any(|a| !public_ip(a.ip())) { return Err("destination_blocked".into()); }
    reqwest::blocking::Client::builder().https_only(true).no_proxy().redirect(reqwest::redirect::Policy::none())
        .resolve_to_addrs(host,&addresses).connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(120)).build().map_err(|_| "provider_unavailable".into())
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn custom_configuration_cannot_escape_origin_or_inject_credentials() {
        for url in ["http://example.com/v1","https://127.0.0.1/v1","https://[::1]/v1","https://localhost/v1","https://secret@example.com/v1","https://example.com:444/v1","https://example.com/v1?key=secret","https://example.com/v1#secret"] { assert!(checked_url(url).is_err(),"{url}"); }
        let c=Config{base_url:"https://example.com/v1".into(),protocol:"openai".into(),auth:"bearer".into()};
        assert_eq!(c.endpoint("chat").unwrap().unwrap(),"https://example.com/v1/chat/completions");
        assert!(c.endpoint("https://evil.invalid").is_err());
        assert!(c.endpoint("messages").is_err());
    }
    #[test] fn private_and_special_dns_addresses_are_blocked() {
        for ip in ["0.0.0.0","127.0.0.1","10.1.2.3","172.16.0.1","192.168.1.2","169.254.169.254","100.64.0.1","198.18.0.1","224.0.0.1","::1","::ffff:127.0.0.1","fc00::1","fe80::1","2001:db8::1","2002:7f00:1::1"] { assert!(!public_ip(ip.parse().unwrap()),"{ip}"); }
        assert!(public_ip("8.8.8.8".parse().unwrap()));
        assert!(public_ip("2606:4700:4700::1111".parse().unwrap()));
    }
}
