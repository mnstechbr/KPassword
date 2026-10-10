"""Generate public test vectors only; never read user vaults or credentials.

Independent implementation: argon2-cffi 25.1.0 and cryptography 50.0.2.
Fixed salts/nonces are for reproducible fixtures ONLY, never production saves.
"""
import base64
import hashlib
import json
from pathlib import Path
from argon2.low_level import Type, hash_secret_raw
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

password = "KPassword-fictitious-vector-only-2026"
plain = {"version": 1, "createdAt": "2026-01-01T00:00:00.000Z",
         "updatedAt": "2026-01-01T00:00:00.000Z", "credentials": [
             {"id": "test-only", "itemType": "credential", "title": "Exemplo ç 🔑",
              "username": "test@example.invalid", "password": "fake-secret-only"}],
         "settings": {"autoLockMinutes": 3, "backupIntervalHours": 4,
                      "clipboardClearSeconds": 60}}
payload = json.dumps(plain, ensure_ascii=False, separators=(",", ":"))
salt, nonce = bytes(range(32)), bytes(range(12))
def b64(data): return base64.b64encode(data).decode("ascii")
base = {"version": 1, "app": "KPassword", "createdAt": plain["createdAt"], "updatedAt": plain["updatedAt"]}
legacy_key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 10000, 32)
v1 = {**base, "cryptoVersion": 1, "crypto": {"algorithm": "AES-GCM", "kdf": "PBKDF2-SHA-256", "iterations": 10000, "salt": b64(salt), "iv": b64(nonce)},
      "payload": b64(AESGCM(legacy_key).encrypt(nonce, payload.encode(), b"KPassword:Vault:v1"))}
params = {"memoryKiB": 65536, "timeCost": 3, "parallelism": 1, "outputLength": 32}
aad = (f"KPassword|cryptoVersion=2|kdf.algorithm=argon2id|kdf.memoryKiB=65536|kdf.timeCost=3|kdf.parallelism=1|kdf.outputLength=32|kdf.salt={b64(salt)}|cipher.algorithm=AES-256-GCM|cipher.nonce={b64(nonce)}").encode()
key = hash_secret_raw(password.encode(), salt, 3, 65536, 1, 32, Type.ID, version=19)
v2 = {**base, "cryptoVersion": 2, "kdf": {"algorithm": "argon2id", "params": params, "salt": b64(salt)},
      "cipher": {"algorithm": "AES-256-GCM", "nonce": b64(nonce)},
      "payload": b64(AESGCM(key).encrypt(nonce, payload.encode(), aad))}
target = Path(__file__).resolve().parent.parent / "src-tauri/tests/fixtures/vault-vectors.json"
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps({"password": password, "plaintext": payload, "v1": v1, "v2": v2}, ensure_ascii=False, indent=2) + "\n")
print("Generated synthetic v1/v2 vectors; no user files were read.")
