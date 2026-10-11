import base64
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BIN = ROOT / "tools/release-signer/target/release/kpassword-release-signer"

class SignerTests(unittest.TestCase):
    def test_encrypted_key_signatures_and_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            key = root / "fake.key"
            asset = root / "fake-installer.exe"
            asset.write_bytes(b"fictitious installer bytes")
            password = b"Fictitious-signing-password-2026!"
            def run(*args, secret=None):
                return subprocess.run([str(BIN), *map(str, args)], input=secret,
                                      capture_output=True)
            self.assertEqual(run("generate", key, secret=password).returncode, 0)
            self.assertIn(b"encrypted secret key", base64.b64decode(key.read_bytes()))
            original = key.read_bytes()
            self.assertNotEqual(run("generate", key, secret=password).returncode, 0)
            self.assertEqual(key.read_bytes(), original)
            bad = run("sign", key, asset, secret=b"Incorrect-password-2026!")
            self.assertNotEqual(bad.returncode, 0)
            self.assertNotIn(password, bad.stdout + bad.stderr)
            self.assertFalse(Path(str(asset) + ".sig").exists())
            self.assertEqual(run("sign", key, asset, secret=password).returncode, 0)
            self.assertEqual(run("verify", str(key) + ".pub", asset, str(asset) + ".sig").returncode, 0)
            asset.write_bytes(b"tampered installer bytes")
            self.assertNotEqual(run("verify", str(key) + ".pub", asset, str(asset) + ".sig").returncode, 0)
            self.assertEqual(key.stat().st_mode & 0o777, 0o600)

if __name__ == "__main__":
    unittest.main()
