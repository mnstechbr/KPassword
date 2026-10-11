"""Local Fedora connector: request an API call, never retrieve an API key.

Import request_api from application code. No environment variable containing a
provider key is required. Python's executable is the OS identity, not the script.
"""
import json
import os
from pathlib import Path
import socket
import stat
import struct
import sys


class BridgeDenied(RuntimeError):
    pass


def request_api(key_id, operation, body, *, socket_path=None):
    if not isinstance(body, dict) or body.get("stream", False) is not False:
        raise BridgeDenied("Only non-streaming JSON requests are supported")
    data = json.dumps({"version": 1, "key_id": key_id, "operation": operation,
                       "body": body}, separators=(",", ":")).encode()
    if len(data) > 1024 * 1024:
        raise BridgeDenied("Request exceeds Bridge limit")
    if socket_path is None:
        root = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))
        socket_path = root / "com.kpassword.app/secrets-bridge/request.sock"
    path = Path(socket_path)
    for item, expected in [(path.parent, stat.S_ISDIR), (path, stat.S_ISSOCK)]:
        meta = item.lstat()
        if not expected(meta.st_mode) or meta.st_uid != os.getuid() or meta.st_mode & 0o077:
            raise BridgeDenied("Bridge endpoint is not private")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as channel:
        channel.settimeout(120)
        channel.connect(str(path))
        _, uid, _ = struct.unpack("3i", channel.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        if uid != os.getuid():
            raise BridgeDenied("Bridge owner mismatch")
        channel.sendall(data + b"\n")
        with channel.makefile("rb") as source:
            raw = source.readline(4 * 1024 * 1024 + 8192)
        if not raw.endswith(b"\n") or len(raw) >= 4 * 1024 * 1024 + 8192:
            raise BridgeDenied("Invalid Bridge response")
    reply = json.loads(raw)
    if reply.get("ok") is not True:
        raise BridgeDenied("Request denied, expired or unavailable")
    if set(reply) != {"ok", "status", "body"}:
        raise BridgeDenied("Invalid Bridge response fields")
    if not 200 <= reply["status"] < 300:
        raise BridgeDenied(f"Provider returned HTTP {reply['status']}")
    return reply["body"]


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Request an API call through KPassword; never export a key")
    parser.add_argument("key_id")
    parser.add_argument("operation", choices=["responses", "chat", "embeddings", "messages"])
    args = parser.parse_args()
    try:
        raw = sys.stdin.buffer.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise BridgeDenied("Request exceeds Bridge limit")
        result = request_api(args.key_id, args.operation, json.loads(raw))
        print(json.dumps(result, ensure_ascii=False))
    except Exception:
        # Do not echo input, responses, exception payloads or credentials.
        print("KPassword: call denied, expired, unavailable or failed.", file=sys.stderr)
        sys.exit(1)
