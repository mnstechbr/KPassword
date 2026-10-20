//! The exact same independent fixtures run on Windows and Fedora.
use super::crypto_vault::{decrypt_vault_file, encrypt_vault_v2_default};
use serde_json::Value;

#[test]
fn independent_v1_v2_vectors_open_with_exact_utf8_payload_on_every_platform() {
    let vectors: Value =
        serde_json::from_str(include_str!("../tests/fixtures/vault-vectors.json")).unwrap();
    for version in ["v1", "v2"] {
        let plain =
            decrypt_vault_file(&vectors[version], vectors["password"].as_str().unwrap()).unwrap();
        assert_eq!(plain, vectors["plaintext"].as_str().unwrap());
        assert!(decrypt_vault_file(&vectors[version], "wrong fictitious password").is_err());
    }
}

#[test]
fn new_optional_api_fields_round_trip_without_changing_the_envelope() {
    let vectors: Value =
        serde_json::from_str(include_str!("../tests/fixtures/vault-vectors.json")).unwrap();
    let mut plain: Value = serde_json::from_str(vectors["plaintext"].as_str().unwrap()).unwrap();
    plain["credentials"][0]["itemType"] = serde_json::json!("api_key");
    plain["credentials"][0]["apiProvider"] = serde_json::json!("Test only");
    plain["credentials"][0]["apiIdentifier"] = serde_json::json!("EXAMPLE_API_KEY");
    plain["credentials"][0]["apiApplications"] = serde_json::json!([]);
    let raw = serde_json::to_string(&plain).unwrap();
    let encrypted =
        encrypt_vault_v2_default(&raw, vectors["password"].as_str().unwrap(), None).unwrap();
    let file = serde_json::to_value(encrypted).unwrap();
    assert_eq!(file["version"], 1);
    assert_eq!(file["cryptoVersion"], 2);
    assert_eq!(
        decrypt_vault_file(&file, vectors["password"].as_str().unwrap()).unwrap(),
        raw
    );
}
