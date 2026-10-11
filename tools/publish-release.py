#!/usr/bin/env python3
"""Publish validated CI installers, signed locally; no private key in CI."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
REPO = "mnstechbr/KPassword"

def gh_json(*args):
    return json.loads(subprocess.check_output(["gh", *args], text=True))

def prepare(run, sha, version, publish=False):
    if not re.fullmatch(r"[0-9a-f]{40}", sha) or not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Invalid SHA or version")
    config = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text())
    if config["version"] != version:
        raise ValueError("Local version does not match release")
    status = gh_json("run", "view", str(run), "--repo", REPO, "--json", "headSha,status,conclusion,jobs,workflowName")
    required = {"Frontend (tsc + vitest + build)", "Rust (cargo test)",
                "Fedora native (tests + RPM)", "Release consistency (version:check)",
                "Local release signatures (fake keys only)"}
    passed = {job["name"] for job in status["jobs"] if job["conclusion"] == "success"}
    if status["headSha"] != sha or status["workflowName"] != "CI" or status["conclusion"] != "success" or not required <= passed:
        raise ValueError("CI did not validate the exact release commit")
    # Publish only commits that are incorporated in main. No git state mutation.
    main_sha = gh_json("api", f"repos/{REPO}/git/ref/heads/main")["object"]["sha"]
    if main_sha != sha:
        raise ValueError("Release SHA is not the current main commit")
    output = ROOT / "dist-release" / f"v{version}"
    output.mkdir(parents=True, exist_ok=False)
    incoming = output / "validation"
    for name in ["kpassword-windows-validation", "kpassword-fedora-validation"]:
        subprocess.run(["gh", "run", "download", str(run), "--repo", REPO, "--name", name,
                        "--dir", str(incoming / name)], check=True)
    exes = list(incoming.rglob("*.exe"))
    rpms = list(incoming.rglob("*.rpm"))
    if len(exes) != 1 or len(rpms) != 1 or any(p.is_symlink() for p in exes + rpms):
        raise ValueError("Missing or ambiguous installers")
    # Verify RPM NEVRA; Windows embedded version is checked by CI consistency.
    rpm_version = subprocess.check_output(["rpm", "-qp", "--qf", "%{VERSION}", str(rpms[0])], text=True)
    if rpm_version != version or not exes[0].name.endswith("_x64-setup.exe") or version not in exes[0].name:
        raise ValueError("Installer version or architecture mismatch")
    exe = output / f"KPassword-Setup-v{version}.exe"
    rpm = output / rpms[0].name
    exe.write_bytes(exes[0].read_bytes())
    rpm.write_bytes(rpms[0].read_bytes())
    subprocess.run([sys.executable, str(ROOT / "tools/sign-release.py"), "sign", str(exe), str(rpm)], check=True)
    # The manifest must contain the signature of this exact Windows installer.
    base = f"https://github.com/{REPO}/releases/download/v{version}"
    manifest = {
        "version": version,
        "notes": "Windows e Fedora nativo. Consulte as notas da Release para alterações e requisitos de atualização.",
        "pub_date": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "platforms": {"windows-x86_64": {"url": f"{base}/{exe.name}", "signature": Path(str(exe) + ".sig").read_text().strip()}}
    }
    (output / "latest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    assets = [exe, Path(str(exe) + ".sig"), rpm, Path(str(rpm) + ".sig"), output / "latest.json"]
    sums = output / "SHA256SUMS.txt"
    sums.write_text("".join(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n" for p in assets))
    assets.append(sums)
    # No wildcards: signing keys, vaults and validation directories cannot leak.
    print("Assets preparados:", ", ".join(p.name for p in assets))
    if publish:
        if gh_json("api", f"repos/{REPO}/git/ref/heads/main")["object"]["sha"] != sha:
            raise ValueError("Main changed during preparation; review the release again")
        notes = ROOT / "docs/releases" / f"v{version}.md"
        subprocess.run(["gh", "release", "create", f"v{version}", "--repo", REPO,
                        "--target", sha, "--title", f"KPassword v{version} — Windows e Fedora",
                        "--notes-file", str(notes), *map(str, assets)], check=True)
    return output

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", required=True, type=int)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args()
    prepare(args.run, args.sha, args.version, args.publish)
