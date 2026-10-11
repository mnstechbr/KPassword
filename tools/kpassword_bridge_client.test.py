import importlib.util
import json
from pathlib import Path
import socket
import tempfile
import threading
import unittest

spec = importlib.util.spec_from_file_location("bridge", Path(__file__).with_name("kpassword_bridge_client.py"))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class ConnectorTests(unittest.TestCase):
    def exchange(self, reply, expected_error=False):
        with tempfile.TemporaryDirectory(prefix="kpassword-connector-test-") as directory:
            path = Path(directory) / "request.sock"
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
                server.bind(str(path))
                path.chmod(0o600)
                server.listen(1)
                received = []
                def respond():
                    with server.accept()[0] as channel:
                        with channel.makefile("rb") as reader:
                            received.append(json.loads(reader.readline()))
                        channel.sendall(json.dumps(reply).encode() + b"\n")
                thread = threading.Thread(target=respond)
                thread.start()
                try:
                    if expected_error:
                        with self.assertRaises(bridge.BridgeDenied):
                            bridge.request_api("key-a", "chat", {"model":"fictional"}, socket_path=path)
                    else:
                        result = bridge.request_api("key-a", "chat", {"model":"fictional"}, socket_path=path)
                        self.assertEqual(result, {"result":"fictional answer"})
                finally:
                    thread.join(3)
                self.assertFalse(thread.is_alive())
                self.assertEqual(set(received[0]), {"version", "key_id", "operation", "body"})
                self.assertNotIn("secret", received[0])

    def test_only_provider_response_is_returned(self):
        self.exchange({"ok":True,"status":200,"body":{"result":"fictional answer"}})

    def test_denial_does_not_return_provider_data(self):
        self.exchange({"ok":False}, True)

    def test_secret_delivery_protocol_is_rejected(self):
        self.exchange({"ok":True,"status":200,"body":{},"secret":"fictitious-invalid-key"}, True)

    def test_provider_error_does_not_echo_response_body(self):
        self.exchange({"ok":True,"status":401,"body":{"error":"do not echo"}}, True)

    def test_streaming_and_oversized_requests_are_denied_before_connecting(self):
        for body in [{"stream":True}, {"content":"x" * (1024*1024)}]:
            with self.assertRaises(bridge.BridgeDenied):
                bridge.request_api("key-a", "chat", body, socket_path="/nonexistent")

    def test_non_private_socket_is_denied(self):
        with tempfile.TemporaryDirectory(prefix="kpassword-connector-mode-") as directory:
            path = Path(directory) / "request.sock"
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
                server.bind(str(path)); path.chmod(0o666)
                with self.assertRaises(bridge.BridgeDenied):
                    bridge.request_api("key-a", "chat", {}, socket_path=path)


if __name__ == "__main__":
    unittest.main()
