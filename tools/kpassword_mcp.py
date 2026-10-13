#!/usr/bin/env python3
"""Generic stdio/HTTP bridge client; never reads or exports provider keys.

--headers prints a LOCAL transport bearer for Codex's http_headers_helper.
The default stdio mode connects to the single Rust HTTP server, not another
per-application proxy. No third-party Python packages are required.
"""
import argparse
import concurrent.futures
import http.client
import json
import os
from pathlib import Path
import socket
import stat
import struct
import sys
import threading

LIMIT = 4 * 1024 * 1024 + 16384
HOST, PORT = "127.0.0.1", 8765


class LocalError(Exception):
    pass


def enroll(socket_path=None):
    root = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))
    path = Path(socket_path) if socket_path else root / "com.kpassword.app/secrets-bridge/request.sock"
    try:
        for item, expected in [(path.parent, stat.S_ISDIR), (path, stat.S_ISSOCK)]:
            meta = item.lstat()
            if not expected(meta.st_mode) or meta.st_uid != os.getuid() or meta.st_mode & 0o077:
                raise LocalError("endpoint_unsafe")
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as channel:
            channel.settimeout(5)
            channel.connect(str(path))
            _, uid, _ = struct.unpack("3i", channel.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            if uid != os.getuid():
                raise LocalError("endpoint_unsafe")
            channel.sendall(b'{"version":1,"connect":true}\n')
            with channel.makefile("rb") as source:
                raw = source.readline(8193)
            if len(raw) > 8192 or not raw.endswith(b"\n"):
                raise LocalError("invalid_response")
            response = json.loads(raw)
            token = response.get("token")
            if not isinstance(token, str) or len(token) != 64 or any(c not in "0123456789abcdef" for c in token):
                raise LocalError("bridge_inactive")
            return token
    except LocalError:
        raise
    except (OSError, ValueError, TypeError):
        raise LocalError("bridge_inactive") from None


class Client:
    def __init__(self, token):
        self.token = token
        self.session = None
        self.version = None

    def post(self, message, path="/mcp", extra=None):
        raw = json.dumps(message, separators=(",", ":")).encode()
        if len(raw) > 1024 * 1024:
            raise LocalError("invalid_request")
        headers = {"Authorization": "Bearer " + self.token,
                   "Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
        if path == "/mcp" and self.session:
            headers["Mcp-Session-Id"] = self.session
            headers["MCP-Protocol-Version"] = self.version
        headers.update(extra or {})
        # http.client ignores proxy environment; address is fixed loopback.
        channel = http.client.HTTPConnection(HOST, PORT, timeout=160)
        try:
            channel.request("POST", path, raw, headers)
            response = channel.getresponse()
            data = response.read(LIMIT + 1)
            if len(data) > LIMIT:
                raise LocalError("invalid_response")
            if response.status >= 400:
                raise LocalError("local_http_" + str(response.status))
            result = json.loads(data) if data else None
            if path == "/mcp" and message.get("method") == "initialize" and isinstance(result, dict) and "result" in result:
                self.session = response.getheader("Mcp-Session-Id")
                self.version = result["result"]["protocolVersion"]
                if not self.session:
                    raise LocalError("invalid_response")
            return result
        except LocalError:
            raise
        except (OSError, ValueError, http.client.HTTPException):
            raise LocalError("bridge_unavailable") from None
        finally:
            channel.close()

    def close(self):
        if not self.session:
            return
        channel = http.client.HTTPConnection(HOST, PORT, timeout=5)
        try:
            channel.request("DELETE", "/mcp", headers={"Authorization": "Bearer " + self.token,
                            "Mcp-Session-Id": self.session, "MCP-Protocol-Version": self.version})
            channel.getresponse().read(8192)
        except (OSError, http.client.HTTPException):
            pass
        finally:
            channel.close()
            self.token = ""


def stdio(client):
    output = threading.Lock()

    def send(value):
        if value is not None:
            with output:
                sys.stdout.write(json.dumps(value, separators=(",", ":")) + "\n")
                sys.stdout.flush()

    def dispatch(message):
        try:
            send(client.post(message))
        except LocalError:
            if isinstance(message, dict) and "id" in message:
                send({"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32000, "message": "KPassword Bridge unavailable; activate its session or retry authorization"}})

    # Bounded outstanding requests; initialize/notifications are ordered.
    slots = threading.Semaphore(4)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as workers:
        for raw in sys.stdin.buffer:
            if len(raw) > 1024 * 1024:
                send({"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Invalid request"}})
                continue
            try:
                message = json.loads(raw)
                if not isinstance(message, dict):
                    raise ValueError()
            except (ValueError, UnicodeError):
                send({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}})
                continue
            if message.get("method") == "initialize" or "id" not in message:
                dispatch(message)
            else:
                slots.acquire()
                future = workers.submit(dispatch, message)
                future.add_done_callback(lambda _: slots.release())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--headers", action="store_true", help="Print local transport headers for an HTTP MCP client")
    parser.add_argument("--socket", help="Private KPassword socket path (for isolated installations)")
    args = parser.parse_args()
    try:
        token = enroll(args.socket)
        if args.headers:
            print(json.dumps({"Authorization": "Bearer " + token}))
            return 0
        client = Client(token)
        try:
            stdio(client)
        finally:
            client.close()
        return 0
    except LocalError:
        # Never print exception text, request bodies or credentials.
        print("KPassword Bridge unavailable; activate the Bridge session in KPassword", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
