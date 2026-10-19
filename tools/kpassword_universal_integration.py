#!/usr/bin/env python3
"""Opt-in integration checks against the running KPassword Bridge.

Only deepseek-flash is used. No provider key is read. --real makes billable
requests after KPassword's ordinary approval dialog. Printed results contain
status/model/event counts only, never tokens, headers or request/response bodies.
"""
import argparse
import concurrent.futures
import http.client
import json
import subprocess
import sys
from kpassword_mcp import Client, enroll

MODEL = "deepseek-flash"
PROVIDER = "DEEPSEEK_API_KEY"


def report(check, **values):
    print(json.dumps({"check": check, **values}), flush=True)


def request(token, path, body=None, headers=None, method="POST"):
    channel = http.client.HTTPConnection("127.0.0.1", 8765, timeout=160)
    auth = {"Authorization": "Bearer " + token, "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream", "X-KPassword-Provider": PROVIDER}
    auth.update(headers or {})
    try:
        channel.request(method, path, json.dumps(body).encode() if body is not None else None, auth)
        response = channel.getresponse()
        raw = response.read(4 * 1024 * 1024 + 1)
        assert len(raw) <= 4 * 1024 * 1024
        return response.status, response.getheader("Content-Type", ""), raw
    finally:
        channel.close()


def initialize(client):
    result = client.post({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "untrusted-test-label", "version": "1"}}})
    assert result["result"]["serverInfo"]["name"] == "KPassword Secrets Bridge"
    client.post({"jsonrpc": "2.0", "method": "notifications/initialized"})


def body(operation, stream=False):
    common = {"model": MODEL, "stream": stream}
    if operation == "responses":
        return {**common, "input": "Reply only OK.", "max_output_tokens": 64,
                "reasoning": {"effort": "none"}}
    return {**common, "messages": [{"role": "user", "content": "Reply only OK."}],
            "max_tokens": 64, "thinking": {"type": "disabled"}}


def metadata(a, b):
    initialize(a)
    initialize(b)
    tools = a.post({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
    assert [t["name"] for t in tools["result"]["tools"]] == ["api_request"]
    report("mcp_initialize_and_discovery", passed=True)
    forged = {"Mcp-Session-Id": a.session, "MCP-Protocol-Version": a.version}
    message = {"jsonrpc": "2.0", "id": 3, "method": "tools/list"}
    status, _, _ = request(b.token, "/mcp", message, forged)
    assert status == 404
    report("cross_token_session_rejected", passed=True, status=status)
    status, _, _ = request(a.token, "/mcp", message, {**forged, "MCP-Protocol-Version": "unsupported"})
    assert status == 400
    report("invalid_protocol_rejected", passed=True, status=status)
    status, _, _ = request("0" * 64, "/mcp", message, forged)
    assert status == 401
    report("invalid_token_rejected", passed=True, status=status)
    status, _, _ = request(a.token, "/mcp", message, {**forged, "Origin": "https://evil.invalid"})
    assert status == 403
    report("dns_rebinding_origin_rejected", passed=True, status=status)
    # Pass a transport token only through a private stdin pipe to another PID.
    child = subprocess.run([sys.executable, "-c", "import http.client,json,sys;c=http.client.HTTPConnection('127.0.0.1',8765);c.request('POST','/mcp',b'{}',{'Authorization':'Bearer '+sys.stdin.read(),'Content-Type':'application/json'});print(c.getresponse().status)"], input=a.token, text=True, capture_output=True, timeout=15)
    assert child.returncode == 0 and child.stdout.strip() == "401"
    report("stolen_token_other_process_rejected", passed=True)


def call_mcp(client, number):
    result = client.post({"jsonrpc": "2.0", "id": number, "method": "tools/call", "params": {
        "name": "api_request", "arguments": {"provider": PROVIDER, "operation": "chat", "body": body("chat")}}})
    assert result["result"].get("isError") is False, "mcp_tool_failed"
    value = json.loads(result["result"]["content"][0]["text"])
    assert value["status"] == 200 and value["body"].get("choices")
    report("mcp_real_call", passed=True, status=value["status"], model=value["body"].get("model"))


def call_gateway(client, operation, stream=False):
    path = {"chat": "/v1/chat/completions", "responses": "/v1/responses", "messages": "/v1/messages"}[operation]
    status, content_type, raw = request(client.token, path, body(operation, stream))
    assert status == 200, f"gateway_{operation}_http_{status}"
    if stream:
        assert content_type.startswith("text/event-stream")
        records = [line[6:] for line in raw.decode().splitlines() if line.startswith("data: ")]
        events = [json.loads(r) for r in records if r != "[DONE]"]
        assert events and not any("error" in e or e.get("type") == "error" for e in events)
        if operation == "chat":
            assert "[DONE]" in records
        else:
            assert any(e.get("type") == ("response.completed" if operation == "responses" else "message_stop") for e in events)
        report("gateway_stream_" + operation, passed=True, status=status, events=len(events))
    else:
        value = json.loads(raw)
        assert value.get("choices") or value.get("output") or value.get("content")
        report("gateway_json_" + operation, passed=True, status=status, model=value.get("model"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--real", action="store_true")
    args = parser.parse_args()
    clients = []
    try:
        a, b = Client(enroll()), Client(enroll())
        clients = [a, b]
        metadata(a, b)
        if args.real:
            call_mcp(a, 10)
            call_mcp(a, 11)  # Same session permission, no quantity approval.
            call_mcp(b, 12)  # Same observed app/project reuses remembered approval.
            for operation in ["chat", "responses", "messages"]:
                call_gateway(a, operation)
                call_gateway(a, operation, stream=True)
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(call_gateway, a, "chat") for _ in range(2)]
                for future in futures:
                    future.result()
            report("concurrent_real_calls", passed=True, count=2)
        return 0
    except Exception as error:
        # Do not print exception text: an upstream/client exception may include
        # headers or response content. Only the error's class is diagnostic.
        report("integration_failed", passed=False, error_type=type(error).__name__)
        return 1
    finally:
        for client in clients:
            client.close()


if __name__ == "__main__":
    raise SystemExit(main())
