import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("release", Path(__file__).with_name("publish-release.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

class PublishTests(unittest.TestCase):
    def test_unvalidated_or_wrong_commit_never_prepares_or_publishes(self):
        sha = "a" * 40
        jobs = [{"name": name, "conclusion": "success"} for name in [
            "Frontend (tsc + vitest + build)", "Rust (cargo test)",
            "Fedora native (tests + RPM)", "Release consistency (version:check)",
            "Local release signatures (fake keys only)"]]
        good = {"headSha": sha, "workflowName": "CI", "conclusion": "success", "jobs": jobs}
        cases = [dict(good, headSha="b" * 40), dict(good, conclusion="failure"),
                 dict(good, workflowName="untrusted"), dict(good, jobs=jobs[:-1])]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "src-tauri").mkdir()
            (root / "src-tauri/tauri.conf.json").write_text(json.dumps({"version": "1.5.0"}))
            for status in cases:
                with patch.object(release, "ROOT", root), patch.object(release, "gh_json", return_value=status), patch.object(release.subprocess, "run") as action:
                    with self.assertRaises(ValueError): release.prepare(1, sha, "1.5.0", True)
                    action.assert_not_called()
                    self.assertFalse((root / "dist-release").exists())
            with patch.object(release, "ROOT", root), patch.object(release, "gh_json", side_effect=[good, {"object": {"sha": "b" * 40}}]), patch.object(release.subprocess, "run") as action:
                with self.assertRaises(ValueError): release.prepare(1, sha, "1.5.0", True)
                action.assert_not_called()
                self.assertFalse((root / "dist-release").exists())

if __name__ == "__main__": unittest.main()
