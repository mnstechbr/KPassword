"""Launch a client through a loopback Anthropic proxy, without a provider key.

The ephemeral local token authorizes this proxy only. It is never a DeepSeek or
Anthropic API key. KPassword authenticates this adapter's script and project.
"""
import argparse
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import secrets
import subprocess
import threading
import sys
from urllib.parse import urlsplit

from kpassword_bridge_client import BridgeDenied, request_api, stream_api


class ProxyServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 2

    def __init__(self, key_id, model, *, socket_path=None):
        self.key_id = key_id
        self.model = model
        self.socket_path = socket_path
        self.token = secrets.token_urlsafe(32)
        self.slots = threading.BoundedSemaphore(2)
        self.workers = threading.BoundedSemaphore(4)
        super().__init__(("127.0.0.1", 0), Handler)

    def process_request(self, request, client_address):
        if not self.workers.acquire(blocking=False):
            request.close()
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.workers.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.workers.release()

    def handle_error(self, request, client_address):
        pass  # No exception payloads from untrusted requests in terminal logs.


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, *args):
        pass  # Never log request paths, headers, prompts or response bodies.

    def reply(self, status, code, details=None):
        data = json.dumps({"type": "error", "error": {"type": "api_error", "message": code, **(details or {})}}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        if details and type(details.get("retry_after")) is int:
            self.send_header("Retry-After", str(details["retry_after"]))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        expected_host = f"127.0.0.1:{self.server.server_port}"
        auth = self.headers.get("Authorization", "")
        supplied = auth[7:] if auth.startswith("Bearer ") else self.headers.get("x-api-key", "")
        if (self.headers.get("Host") != expected_host or self.headers.get("Origin") is not None
                or len(supplied) > 128 or not supplied.isascii() or not hmac.compare_digest(supplied, self.server.token)):
            self.reply(403, "local_proxy_unauthorized")
            return
        if urlsplit(self.path).path != "/v1/messages" or urlsplit(self.path).query:
            self.reply(501, "unsupported_endpoint")
            return
        if not self.server.slots.acquire(blocking=False):
            self.reply(429, "bridge_busy")
            return
        streaming = False
        events = None
        try:
            if self.headers.get("Transfer-Encoding") or len(self.headers.get_all("Content-Length", [])) != 1:
                raise BridgeDenied("invalid_request")
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 1024 * 1024:
                raise BridgeDenied("invalid_request")
            body = json.loads(self.rfile.read(size))
            if not isinstance(body, dict) or type(body.get("stream", False)) is not bool:
                raise BridgeDenied("invalid_request")
            # Keep the selected model and its approved scope stable, including
            # Claude's default small/large model aliases.
            self.connection.settimeout(130)
            body["model"] = self.server.model
            options = {"socket_path": self.server.socket_path}
            if body.get("stream", False):
                events = stream_api(self.server.key_id, "messages", body, **options)
                first = next(events, None)  # Wait for KPassword approval before HTTP 200.
                if first is None:
                    raise BridgeDenied("invalid_response")
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                streaming = True
                def send(event):
                    name = event["event"] or event["data"].get("type", "message")
                    if not isinstance(name, str) or not name or len(name) > 128 or not all(c.isascii() and (c.isalnum() or c in "_.") for c in name):
                        raise BridgeDenied("invalid_response")
                    data = json.dumps(event["data"], separators=(",", ":"))
                    self.wfile.write(f"event: {name}\ndata: {data}\n\n".encode())
                    self.wfile.flush()
                send(first)
                for event in events:
                    send(event)
            else:
                data = json.dumps(request_api(self.server.key_id, "messages", body, **options)).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(data)
        except BridgeDenied as error:
            if streaming:
                data = json.dumps({"type": "error", "error": {"type": "api_error", "message": error.code, **error.details}})
                self.wfile.write(f"event: error\ndata: {data}\n\n".encode())
            else:
                self.reply(429 if error.code in {"quota_exceeded", "bridge_busy"} else error.status if error.status and 400 <= error.status <= 599 else 503, error.code, error.details)
        except (ValueError, TypeError):
            if not streaming:
                self.reply(400, "invalid_request")
        except (OSError, StopIteration):
            pass
        finally:
            if events is not None:
                events.close()
            self.server.slots.release()
            self.close_connection = True


def client_environment(server):
    env = {k: v for k, v in os.environ.items()
           if not k.endswith(("_API_KEY", "_TOKEN", "_SECRET")) and not k.startswith("ANTHROPIC_")}
    env.update({"ANTHROPIC_BASE_URL": f"http://127.0.0.1:{server.server_port}",
                "ANTHROPIC_AUTH_TOKEN": server.token,
                "ANTHROPIC_API_KEY": server.token,
                "ANTHROPIC_MODEL": server.model,
                "ANTHROPIC_DEFAULT_HAIKU_MODEL": server.model,
                "ANTHROPIC_DEFAULT_SONNET_MODEL": server.model,
                "ANTHROPIC_DEFAULT_OPUS_MODEL": server.model,
                "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"})
    return env


def main():
    parser = argparse.ArgumentParser(description="Launch Claude through KPassword without exporting an API key")
    parser.add_argument("--key-id", required=True)
    parser.add_argument("--model", default="deepseek-flash")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("specify -- claude [arguments]")
    server = ProxyServer(args.key_id, args.model)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        return subprocess.call(command, env=client_environment(server))
    except KeyboardInterrupt:
        return 130
    except OSError:
        print("KPassword: client could not be started.", file=sys.stderr)
        return 1
    finally:
        server.shutdown()
        server.server_close()
        worker.join(3)


if __name__ == "__main__":
    sys.exit(main())
