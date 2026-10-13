import io
import json
import unittest
from unittest.mock import patch
import kpassword_mcp as mcp


class Reply:
    def __init__(self, status=200, body=None, session=None):
        self.status, self.body, self.session = status, body, session
    def read(self, limit):
        return json.dumps(self.body).encode() if self.body is not None else b""
    def getheader(self, name):
        return self.session if name == "Mcp-Session-Id" else None


class Channel:
    replies = []
    calls = []
    def __init__(self, host, port, timeout):
        assert (host, port) == ("127.0.0.1", 8765)
    def request(self, method, path, body=None, headers=None):
        self.calls.append((method, path, json.loads(body) if body else None, headers))
    def getresponse(self):
        return self.replies.pop(0)
    def close(self):
        pass


class Tests(unittest.TestCase):
    def setUp(self):
        Channel.calls, Channel.replies = [], []

    @patch.object(mcp.http.client, "HTTPConnection", Channel)
    def test_initialization_propagates_session_version_and_local_auth(self):
        Channel.replies = [Reply(body={"result": {"protocolVersion": "2025-11-25"}}, session="session-a"),
                           Reply(body={"result": {"tools": []}}), Reply(body={})]
        client = mcp.Client("a" * 64)
        client.post({"jsonrpc": "2.0", "id": 1, "method": "initialize"})
        client.post({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
        client.close()
        self.assertNotIn("Mcp-Session-Id", Channel.calls[0][3])
        self.assertEqual(Channel.calls[1][3]["Mcp-Session-Id"], "session-a")
        self.assertEqual(Channel.calls[1][3]["MCP-Protocol-Version"], "2025-11-25")
        self.assertEqual(Channel.calls[1][3]["Authorization"], "Bearer " + "a" * 64)
        self.assertEqual(Channel.calls[2][:2], ("DELETE", "/mcp"))
        self.assertEqual(client.token, "")

    @patch.object(mcp.http.client, "HTTPConnection", Channel)
    def test_failed_init_does_not_accept_a_forged_session(self):
        Channel.replies = [Reply(status=401, body={"provider_secret": "fictitious-never-print"})]
        client = mcp.Client("a" * 64)
        with self.assertRaises(mcp.LocalError) as error:
            client.post({"id": 1, "method": "initialize"})
        self.assertEqual(str(error.exception), "local_http_401")
        self.assertIsNone(client.session)
        self.assertNotIn("fictitious-never-print", str(error.exception))

    @patch.object(mcp.http.client, "HTTPConnection", Channel)
    def test_oversized_requests_and_missing_session_fail_closed(self):
        client = mcp.Client("a" * 64)
        with self.assertRaises(mcp.LocalError):
            client.post({"body": "x" * (1024 * 1024)})
        self.assertEqual(Channel.calls, [])
        Channel.replies = [Reply(body={"result": {"protocolVersion": "2025-11-25"}})]
        with self.assertRaises(mcp.LocalError):
            client.post({"id": 1, "method": "initialize"})

    def test_stdio_parse_errors_and_notifications_never_echo_payloads(self):
        class Client:
            def post(self, message):
                raise mcp.LocalError("fictitious-private-error")
        fake_in = type("Input", (), {"buffer": io.BytesIO(b'invalid-private-body\n{"method":"notifications/initialized"}\n{"id":2,"method":"tools/list"}\n')})()
        output = io.StringIO()
        with patch.object(mcp.sys, "stdin", fake_in), patch.object(mcp.sys, "stdout", output):
            mcp.stdio(Client())
        records = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(len(records), 2)
        self.assertEqual(records[0]["error"]["code"], -32700)
        self.assertEqual(records[1]["id"], 2)
        self.assertNotIn("private", output.getvalue())


if __name__ == "__main__":
    unittest.main()
