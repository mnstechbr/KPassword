"""Private local connector. Returns provider responses, never provider keys."""
import argparse
import json
import os
from pathlib import Path
import socket
import stat
import struct
import sys

ERRORS = {
    "bridge_timeout": "Bridge did not respond before the local deadline",
    "bridge_inactive": "Bridge is inactive; activate its session in KPassword",
    "session_expired": "Bridge session expired",
    "key_not_found": "API key ID was not found in this Bridge session",
    "user_denied": "User refused the request",
    "approval_expired": "Approval expired without a decision",
    "permission_revoked": "Bridge permission was revoked",
    "quota_exceeded": "Automatic Bridge rate or consumption limit exceeded",
    "bridge_busy": "Another approval is pending; retry later",
    "unsupported_operation": "Operation is not supported for this API key",
    "invalid_request": "Invalid or oversized request",
    "provider_unavailable": "Provider connection failed or timed out",
    "identity_changed": "Requesting application identity changed",
    "vault_changed": "Vault changed; reactivate the Bridge session",
    "destination_blocked": "Provider address resolved to a private or blocked network",
    "request_failed": "Bridge request failed",
    "endpoint_unsafe": "Bridge endpoint is not private or has an invalid owner",
    "invalid_response": "Invalid Bridge response",
    "provider_http_error": "Provider returned an HTTP error",
}
LIMIT = 4 * 1024 * 1024


class BridgeDenied(RuntimeError):
    def __init__(self, code="request_failed", *, status=None):
        self.code = code if code in ERRORS else "request_failed"
        self.status = status
        super().__init__(ERRORS[self.code] + (f" (HTTP {status})" if status is not None else ""))


def _records(key_id, operation, body, socket_path=None):
    if not isinstance(body, dict):
        raise BridgeDenied("invalid_request")
    data = json.dumps({"version": 1, "key_id": key_id, "operation": operation,
                       "body": body}, separators=(",", ":")).encode()
    if len(data) > 1024 * 1024:
        raise BridgeDenied("invalid_request")
    if socket_path is None:
        root = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))
        socket_path = root / "com.kpassword.app/secrets-bridge/request.sock"
    path = Path(socket_path)
    try:
        for item, expected in [(path.parent, stat.S_ISDIR), (path, stat.S_ISSOCK)]:
            meta = item.lstat()
            if not expected(meta.st_mode) or meta.st_uid != os.getuid() or meta.st_mode & 0o077:
                raise BridgeDenied("endpoint_unsafe")
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as channel:
            channel.settimeout(160)
            channel.connect(str(path))
            _, uid, _ = struct.unpack("3i", channel.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            if uid != os.getuid():
                raise BridgeDenied("endpoint_unsafe")
            channel.sendall(data + b"\n")
            with channel.makefile("rb") as source:
                total = 0
                while True:
                    raw = source.readline(LIMIT + 8192)
                    if not raw:
                        return
                    total += len(raw)
                    if not raw.endswith(b"\n") or len(raw) >= LIMIT + 8192 or total > 32 * LIMIT:
                        raise BridgeDenied("invalid_response")
                    try:
                        reply = json.loads(raw)
                    except (ValueError, UnicodeError):
                        raise BridgeDenied("invalid_response") from None
                    if not isinstance(reply, dict):
                        raise BridgeDenied("invalid_response")
                    if reply.get("ok") is False:
                        error = reply.get("error", {})
                        raise BridgeDenied(error.get("code") if isinstance(error, dict) else "request_failed")
                    yield reply
    except (FileNotFoundError, ConnectionRefusedError, ConnectionResetError):
        raise BridgeDenied("bridge_inactive") from None
    except socket.timeout:
        raise BridgeDenied("bridge_timeout") from None
    except OSError:
        raise BridgeDenied("request_failed") from None


def request_api(key_id, operation, body, *, socket_path=None):
    if not isinstance(body, dict) or body.get("stream", False) is not False:
        raise BridgeDenied("invalid_request")
    records = _records(key_id, operation, body, socket_path)
    try:
        reply = next(records, {})
        if set(reply) != {"ok", "status", "body"} or reply["ok"] is not True or type(reply["status"]) is not int:
            raise BridgeDenied("invalid_response")
        if not 200 <= reply["status"] < 300:
            raise BridgeDenied("provider_http_error", status=reply["status"])
        return reply["body"]
    finally:
        records.close()


def stream_api(key_id, operation, body, *, socket_path=None):
    if not isinstance(body, dict):
        raise BridgeDenied("invalid_request")
    records = _records(key_id, operation, dict(body, stream=True), socket_path)
    try:
        header = next(records, {})
        if set(header) != {"ok", "status", "stream"} or header["ok"] is not True or header["stream"] is not True or type(header["status"]) is not int:
            raise BridgeDenied("invalid_response")
        if not 200 <= header["status"] < 300:
            raise BridgeDenied("provider_http_error", status=header["status"])
        for event in records:
            if event == {"done": True}:
                return
            if set(event) != {"event", "data"} or not isinstance(event["event"], str) or not isinstance(event["data"], dict):
                raise BridgeDenied("invalid_response")
            yield event
        raise BridgeDenied("invalid_response")
    finally:
        records.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Call through KPassword; never export a key")
    parser.add_argument("key_id")
    parser.add_argument("operation")
    args = parser.parse_args()
    try:
        raw = sys.stdin.buffer.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise BridgeDenied("invalid_request")
        body = json.loads(raw)
        if isinstance(body, dict) and body.get("stream") is True:
            for event in stream_api(args.key_id, args.operation, body):
                print(json.dumps(event, ensure_ascii=False), flush=True)
        else:
            print(json.dumps(request_api(args.key_id, args.operation, body), ensure_ascii=False))
    except BridgeDenied as error:
        print(f"KPassword [{error.code}]: {error}", file=sys.stderr)
        sys.exit(1)
    except Exception:
        print("KPassword [invalid_request]: invalid request or response.", file=sys.stderr)
        sys.exit(1)
