#!/usr/bin/env python3
"""Local encrypted key management. Never sends private material to GitHub."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
KEY_DIR = Path.home() / ".local/share/kpassword-signing"
KEY = KEY_DIR / "kpassword-v2.key"

def signer():
    target = ROOT / "tools/release-signer/target"
    subprocess.run(["cargo", "build", "--locked", "--release", "--manifest-path",
                    str(ROOT / "tools/release-signer/Cargo.toml")], check=True)
    return target / "release/kpassword-release-signer"

def local_password(confirm=False):
    def prompt(text):
        result = subprocess.run(["kdialog", "--title", "KPassword — assinatura local",
                                 "--password", text], capture_output=True, check=True)
        value = result.stdout.removesuffix(b"\n")
        if len(value) < 12 or b"\n" in value or b"\0" in value:
            raise ValueError("Use uma senha de assinatura com pelo menos 12 caracteres.")
        return value
    password = prompt("Crie uma senha forte para proteger a chave de assinatura.\n"
                      "Guarde esta senha e um backup da chave. Não é a senha do cofre."
                      if confirm else "Digite a senha da chave de assinatura para assinar a Release.\n"
                      "A senha será usada apenas nesta execução local.")
    if confirm and prompt("Repita a senha de assinatura escolhida.") != password:
        raise ValueError("As senhas não coincidem. Nenhuma chave foi criada.")
    return password

def run_signer(binary, args, password=None):
    subprocess.run([str(binary), *map(str, args)], input=password,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["generate", "sign"])
    parser.add_argument("files", nargs="*", type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    binary = signer()
    if args.action == "generate":
        if KEY_DIR.is_symlink() or KEY.exists() or KEY.with_suffix(".key.pub").exists():
            raise ValueError("Uma chave já existe ou o diretório é inseguro; nada foi sobrescrito.")
        KEY_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
        KEY_DIR.chmod(0o700)
        password = local_password(confirm=True)
        run_signer(binary, ["generate", KEY], password)
        print(f"Chave criptografada criada em {KEY}. Faça um backup fora deste computador.")
    else:
        if not args.files or KEY.is_symlink() or not KEY.is_file():
            raise ValueError("Informe os arquivos e uma chave local regular.")
        config = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text())
        if KEY.with_suffix(".key.pub").read_text().strip() != config["plugins"]["updater"]["pubkey"]:
            raise ValueError("A chave local não corresponde à chave pública do aplicativo.")
        password = local_password()
        for path in args.files:
            if path.is_symlink() or not path.is_file():
                raise ValueError("Somente arquivos regulares podem ser assinados.")
            run_signer(binary, ["sign", KEY, path], password)
            run_signer(binary, ["verify", KEY.with_suffix(".key.pub"), path, str(path) + ".sig"])
        print("Assinaturas geradas e verificadas localmente.")

if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Never print subprocess output, input, password or private key.
        print("Operação local cancelada ou recusada. Nenhum segredo foi publicado.", file=sys.stderr)
        sys.exit(1)
