//! Explicit service operations. Caller URLs and headers are never accepted.
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

fn id(value: &Value) -> Result<String, String> {
    let s = match value {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => return Err("invalid_request".into()),
    };
    if s.is_empty()
        || s.len() > 128
        || !s
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("invalid_request".into());
    }
    Ok(s)
}
fn fields(body: &Value, allowed: &[&str]) -> Result<(), String> {
    if !body
        .as_object()
        .is_some_and(|o| o.keys().all(|k| allowed.contains(&k.as_str())))
    {
        return Err("invalid_request".into());
    }
    Ok(())
}
pub fn provider(identifier: &str, op: &str) -> Option<&'static str> {
    match (identifier, op) {
        (
            "TELEGRAM_BOT_TOKEN" | "TELEGRAM_TOKEN",
            "telegram.get_me" | "telegram.send_message" | "telegram.get_updates",
        ) => Some("Telegram"),
        (
            "MERCADO_PAGO_ACCESS_TOKEN" | "MERCADOPAGO_ACCESS_TOKEN",
            "mercadopago.get_payment"
            | "mercadopago.create_payment"
            | "mercadopago.create_preference"
            | "mercadopago.get_preapproval"
            | "mercadopago.create_preapproval"
            | "mercadopago.update_preapproval",
        ) => Some("Mercado Pago"),
        (
            "MERCADO_PAGO_WEBHOOK_SECRET" | "MERCADOPAGO_WEBHOOK_SECRET",
            "mercadopago.verify_webhook",
        ) => Some("Mercado Pago Webhook"),
        _ => None,
    }
}
/// The extra grant scope includes the recipient/resource for read/update calls.
pub fn scope(op: &str, body: &Value) -> Result<String, String> {
    match op {
        "telegram.get_me" => {
            fields(body, &[])?;
            Ok("bot".into())
        }
        "telegram.send_message" => {
            fields(
                body,
                &[
                    "chat_id",
                    "text",
                    "parse_mode",
                    "disable_notification",
                    "protect_content",
                    "message_thread_id",
                ],
            )?;
            if !body["text"]
                .as_str()
                .is_some_and(|s| !s.is_empty() && s.chars().count() <= 4096)
            {
                return Err("invalid_request".into());
            }
            id(&body["chat_id"])
        }
        "telegram.get_updates" => {
            fields(body, &["offset", "limit", "timeout", "allowed_updates"])?;
            if body
                .get("timeout")
                .is_some_and(|n| !n.as_u64().is_some_and(|n| n <= 50))
            {
                return Err("invalid_request".into());
            }
            if body
                .get("limit")
                .is_some_and(|n| !n.as_u64().is_some_and(|n| (1..=100).contains(&n)))
            {
                return Err("invalid_request".into());
            }
            Ok("bot".into())
        }
        "mercadopago.get_payment" | "mercadopago.get_preapproval" => {
            fields(body, &["id"])?;
            id(&body["id"])
        }
        "mercadopago.create_payment" => {
            fields(body, &["idempotency_key", "payment"])?;
            let key = id(&body["idempotency_key"])?;
            if key.len() < 16 || !body["payment"].is_object() {
                return Err("invalid_request".into());
            }
            Ok("create_payment".into())
        }
        "mercadopago.create_preference" | "mercadopago.create_preapproval" => {
            fields(body, &["body"])?;
            if !body["body"].is_object() {
                return Err("invalid_request".into());
            }
            Ok("create".into())
        }
        "mercadopago.update_preapproval" => {
            fields(body, &["id", "body"])?;
            if !body["body"].is_object() {
                return Err("invalid_request".into());
            }
            id(&body["id"])
        }
        "mercadopago.verify_webhook" => {
            fields(body, &["data_id", "x_request_id", "x_signature"])?;
            id(&body["data_id"])?;
            id(&body["x_request_id"])?;
            if !body["x_signature"].as_str().is_some_and(|s| s.len() <= 256) {
                return Err("invalid_request".into());
            }
            Ok("verify_only".into())
        }
        _ => Err("unsupported_operation".into()),
    }
}
fn webhook(secret: &str, body: &Value, now: u64) -> Value {
    let valid = (|| {
        let signature = body["x_signature"].as_str()?;
        let mut ts = None;
        let mut digest = None;
        for part in signature.split(',') {
            let (key, value) = part.trim().split_once('=')?;
            match key.trim() {
                "ts" if ts.is_none() => ts = Some(value.trim()),
                "v1" if digest.is_none() => digest = Some(value.trim()),
                _ => return None,
            }
        }
        let ts = ts?;
        let digest = digest?;
        if ts.is_empty()
            || !ts.bytes().all(|b| b.is_ascii_digit())
            || (digest.len() != 64 || !digest.bytes().all(|b| b.is_ascii_hexdigit()))
        {
            return None;
        }
        let stamp = ts.parse::<u64>().ok()?;
        let seconds = if stamp >= 1_000_000_000_000 {
            stamp / 1000
        } else {
            stamp
        };
        if now.saturating_sub(seconds) > 300 || seconds.saturating_sub(now) > 30 {
            return None;
        }
        let bytes = (0..32)
            .map(|n| u8::from_str_radix(&digest[n * 2..n * 2 + 2], 16).ok())
            .collect::<Option<Vec<_>>>()?;
        let manifest = format!(
            "id:{};request-id:{};ts:{};",
            id(&body["data_id"]).ok()?.to_ascii_lowercase(),
            id(&body["x_request_id"]).ok()?,
            ts
        );
        let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).ok()?;
        mac.update(manifest.as_bytes());
        mac.verify_slice(&bytes).ok()
    })()
    .is_some();
    json!({"valid":valid})
}
pub fn call(
    identifier: &str,
    op: &str,
    secret: &str,
    body: &Value,
) -> Result<(u16, Value), String> {
    if provider(identifier, op).is_none() {
        return Err("unsupported_operation".into());
    }
    scope(op, body)?;
    if op == "mercadopago.verify_webhook" {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "request_failed")?
            .as_secs();
        return Ok((200, webhook(secret, body, now)));
    }
    let client = reqwest::blocking::Client::builder()
        .https_only(true)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(65))
        .build()
        .map_err(|_| "provider_unavailable")?;
    let request = if op.starts_with("telegram.") {
        if !secret
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b':' || b == b'_' || b == b'-')
            || !secret.contains(':')
        {
            return Err("invalid_request".into());
        }
        let method = match op {
            "telegram.get_me" => "getMe",
            "telegram.send_message" => "sendMessage",
            "telegram.get_updates" => "getUpdates",
            _ => return Err("unsupported_operation".into()),
        };
        client
            .post(format!("https://api.telegram.org/bot{secret}/{method}"))
            .json(body)
    } else {
        let mut auth = reqwest::header::HeaderValue::from_str(&format!("Bearer {secret}"))
            .map_err(|_| "invalid_request")?;
        auth.set_sensitive(true);
        let origin = "https://api.mercadopago.com";
        let request = match op {
            "mercadopago.get_payment" => {
                client.get(format!("{origin}/v1/payments/{}", id(&body["id"])?))
            }
            "mercadopago.create_payment" => client
                .post(format!("{origin}/v1/payments"))
                .header("X-Idempotency-Key", id(&body["idempotency_key"])?)
                .json(&body["payment"]),
            "mercadopago.create_preference" => client
                .post(format!("{origin}/checkout/preferences"))
                .json(&body["body"]),
            "mercadopago.get_preapproval" => {
                client.get(format!("{origin}/preapproval/{}", id(&body["id"])?))
            }
            "mercadopago.create_preapproval" => client
                .post(format!("{origin}/preapproval"))
                .json(&body["body"]),
            "mercadopago.update_preapproval" => client
                .put(format!("{origin}/preapproval/{}", id(&body["id"])?))
                .json(&body["body"]),
            _ => return Err("unsupported_operation".into()),
        };
        request.header(reqwest::header::AUTHORIZATION, auth)
    };
    let response = request.send().map_err(|_| "provider_unavailable")?;
    super::broker::service_response(response, secret)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn webhook_validates_hmac_and_freshness_without_returning_secret() {
        let secret = "fictitious-webhook-secret";
        let ts = 1_780_000_000u64;
        let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(format!("id:orderabc;request-id:request-1;ts:{ts};").as_bytes());
        let digest = mac
            .finalize()
            .into_bytes()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        let mut body = json!({"data_id":"ORDERABC","x_request_id":"request-1","x_signature":format!("ts={ts},v1={digest}")});
        assert_eq!(webhook(secret, &body, ts), json!({"valid":true}));
        assert_eq!(webhook("wrong", &body, ts), json!({"valid":false}));
        assert_eq!(webhook(secret, &body, ts + 301), json!({"valid":false}));
        assert_eq!(webhook(secret, &body, ts - 31), json!({"valid":false}));
        body["data_id"] = json!("other");
        assert_eq!(webhook(secret, &body, ts), json!({"valid":false}));
        for signature in ["ts=1,ts=2,v1=aa", "ts=1,v1=👾", "ts=1,v1=zz"] {
            body["x_signature"] = json!(signature);
            assert_eq!(webhook(secret, &body, ts), json!({"valid":false}));
        }
    }
    #[test]
    fn service_scope_rejects_urls_headers_traversal_and_missing_idempotency() {
        for body in [
            json!({"id":"../other"}),
            json!({"id":"abc","url":"https://evil.invalid"}),
            json!({"id":"abc","headers":{}}),
        ] {
            assert!(scope("mercadopago.get_payment", &body).is_err());
        }
        assert!(scope("mercadopago.create_payment", &json!({"payment":{}})).is_err());
        assert!(scope(
            "telegram.send_message",
            &json!({"chat_id":"a","text":"hi","url":"evil"})
        )
        .is_err());
        assert_ne!(
            scope("telegram.send_message", &json!({"chat_id":"a","text":"hi"})).unwrap(),
            scope("telegram.send_message", &json!({"chat_id":"b","text":"hi"})).unwrap()
        );
        assert!(provider("MERCADO_PAGO_WEBHOOK_SECRET", "mercadopago.create_payment").is_none());
        assert!(provider("MERCADO_PAGO_ACCESS_TOKEN", "mercadopago.verify_webhook").is_none());
    }
}
