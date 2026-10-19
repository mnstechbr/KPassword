//! Optional, owner-controlled quotas for one observed application and credential.
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Limits {
    // Zero means unlimited. Only the main KPassword window can change these.
    pub calls_per_minute: u32,
    pub output_tokens_per_hour: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Exceeded {
    pub limit: Kind,
    pub limit_value: u64,
    pub used: u64,
    pub remaining: u64,
    pub requested: u64,
    pub retry_after: Option<u64>,
    pub retry_at: Option<u128>,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind { CallsPerMinute, OutputTokensPerHour }

impl Exceeded {
    fn new(limit: Kind, cap: u64, used: u64, requested: u64, wait: Duration) -> Self {
        let retry_after = (requested <= cap).then_some(wait.as_secs() + u64::from(wait.subsec_nanos() > 0));
        Self { limit, limit_value: cap, used, remaining: cap.saturating_sub(used), requested,
            retry_after, retry_at: retry_after.map(|s| super::super::now_epoch_millis() + u128::from(s) * 1000) }
    }
    pub fn error(&self) -> String { format!("quota_exceeded:{}", serde_json::to_string(self).expect("quota metadata")) }
    pub fn parse(error: &str) -> Option<Self> {
        if error.len() > 1024 { return None; }
        serde_json::from_str(error.strip_prefix("quota_exceeded:")?).ok()
    }
}

pub struct Usage { pub minute: Instant, pub calls: u32, pub hour: Instant, pub output: u64 }
impl Default for Usage {
    fn default() -> Self { Self { minute: Instant::now(), calls: 0, hour: Instant::now(), output: 0 } }
}
#[derive(Clone, Copy, Debug)]
pub struct Booking { minute: Instant, hour: Instant, output: u64 }
impl Usage {
    pub fn reserve(&mut self, limits: Limits, output: u64) -> Result<Booking, Exceeded> {
        if self.minute.elapsed() >= Duration::from_secs(60) { self.minute = Instant::now(); self.calls = 0; }
        if self.hour.elapsed() >= Duration::from_secs(3600) { self.hour = Instant::now(); self.output = 0; }
        let mut blocked = Vec::new();
        if limits.calls_per_minute > 0 && self.calls >= limits.calls_per_minute {
            blocked.push(Exceeded::new(Kind::CallsPerMinute, limits.calls_per_minute.into(), self.calls.into(), 1, Duration::from_secs(60).saturating_sub(self.minute.elapsed())));
        }
        if limits.output_tokens_per_hour > 0 && output > limits.output_tokens_per_hour.saturating_sub(self.output) {
            blocked.push(Exceeded::new(Kind::OutputTokensPerHour, limits.output_tokens_per_hour, self.output, output, Duration::from_secs(3600).saturating_sub(self.hour.elapsed())));
        }
        // If both windows block, return the constraint with the longest wait.
        if let Some(error) = blocked.into_iter().max_by_key(|e| e.retry_after.unwrap_or(u64::MAX)) { return Err(error); }
        self.calls = self.calls.saturating_add(1);
        self.output = self.output.saturating_add(output);
        Ok(Booking { minute: self.minute, hour: self.hour, output })
    }
    pub fn settle(&mut self, booking: Booking, dispatched: bool, actual: u64) {
        if !dispatched && self.minute == booking.minute { self.calls = self.calls.saturating_sub(1); }
        // A delayed response must never refund or charge a newer hour's bucket.
        if self.hour == booking.hour { self.output = self.output.saturating_sub(booking.output).saturating_add(actual); }
    }
}

/// Provider-reported output includes reasoning where the protocol includes it.
/// Anthropic deltas report cumulative output; taking the maximum avoids doubles.
pub fn output_usage(value: &serde_json::Value) -> Option<u64> {
    ["/usage/output_tokens", "/usage/completion_tokens", "/response/usage/output_tokens", "/message/usage/output_tokens"]
        .iter().filter_map(|p| value.pointer(p).and_then(serde_json::Value::as_u64)).max()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn default_has_no_implicit_call_or_token_budget() {
        let mut usage = Usage::default();
        for _ in 0..200 { usage.reserve(Limits::default(), 32768).unwrap(); }
        assert_eq!(usage.output, 6553600);
    }
    #[test] fn refunds_surplus_failures_and_preflight_calls() {
        let mut u = Usage::default(); let limits = Limits { calls_per_minute: 1000, output_tokens_per_hour: 524288 };
        for _ in 0..100 { let b=u.reserve(limits,8192).unwrap(); u.settle(b,true,10); }
        assert_eq!(u.output,1000); assert_eq!(u.calls,100);
        let b=u.reserve(limits,8192).unwrap();u.settle(b,true,0);assert_eq!(u.output,1000);assert_eq!(u.calls,101);
        let b=u.reserve(limits,8192).unwrap();u.settle(b,false,0);assert_eq!(u.output,1000);assert_eq!(u.calls,101);
    }
    #[test] fn separate_windows_and_concurrent_reservations_are_precise() {
        let mut u=Usage::default();let limits=Limits { calls_per_minute:2,output_tokens_per_hour:100 };
        let a=u.reserve(limits,60).unwrap(); let e=u.reserve(limits,60).err().unwrap();
        assert!(matches!(e.limit,Kind::OutputTokensPerHour));assert_eq!(e.remaining,40);assert_eq!(e.retry_after,Some(3600));
        u.settle(a,true,5);u.reserve(limits,60).unwrap();let e=u.reserve(limits,1).err().unwrap();
        assert!(matches!(e.limit,Kind::CallsPerMinute));assert_eq!(e.remaining,0);
        u.minute=Instant::now()-Duration::from_secs(61);u.reserve(limits,1).unwrap();
        let e=u.reserve(limits,101).err().unwrap();assert_eq!(e.retry_after,None);assert_eq!(e.retry_at,None);
    }
    #[test] fn late_responses_do_not_change_new_buckets() {
        let mut u=Usage::default();let b=u.reserve(Limits::default(),8192).unwrap();
        u.hour=Instant::now()-Duration::from_secs(3601);u.reserve(Limits::default(),20).unwrap();
        u.settle(b,true,10);assert_eq!(u.output,20);
    }
    #[test] fn usage_parses_all_protocols_and_errors_have_bounded_metadata() {
        for v in [serde_json::json!({"usage":{"completion_tokens":12}}),serde_json::json!({"usage":{"output_tokens":12}}),serde_json::json!({"response":{"usage":{"output_tokens":12}}})] { assert_eq!(output_usage(&v),Some(12)); }
        assert_eq!(output_usage(&serde_json::json!({"usage":{"total_tokens":100}})),None);
        assert!(Exceeded::parse("secret").is_none());
    }
}
