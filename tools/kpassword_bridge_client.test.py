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
                        with self.assertRaises(bridge.BridgeDenied) as caught:
                            bridge.request_api("key-a", "chat", {"model":"fictional"}, socket_path=path)
                    else:
                        result = bridge.request_api("key-a", "chat", {"model":"fictional"}, socket_path=path)
                        self.assertEqual(result, {"result":"fictional answer"})
                finally:
                    thread.join(3)
                self.assertFalse(thread.is_alive())
                self.assertEqual(set(received[0]), {"version", "key_id", "operation", "body"})
                self.assertNotIn("secret", received[0])
                if expected_error:
                    return caught.exception

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

    def test_diagnostic_codes_are_distinct_and_unknown_payloads_are_sanitized(self):
        for code in ["bridge_inactive","key_not_found","user_denied","approval_expired","session_expired"]:
            error=bridge.BridgeDenied(code)
            self.assertEqual(error.code,code)
            self.assertNotIn("secret",str(error))
        self.assertEqual(bridge.BridgeDenied("fake-key-secret").code,"request_failed")
        self.exchange({"ok":False,"error":{"code":"user_denied","message":"do not echo"}},True)

    def test_streaming_records_preserve_events_and_require_completion(self):
        with tempfile.TemporaryDirectory(prefix="kpassword-stream-test-") as directory:
            path=Path(directory)/"request.sock"
            with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as server:
                server.bind(str(path));path.chmod(0o600);server.listen(1)
                def respond():
                    with server.accept()[0] as channel:
                        with channel.makefile("rb") as reader: request=json.loads(reader.readline())
                        self.assertTrue(request["body"]["stream"])
                        for record in [{"ok":True,"status":200,"stream":True},{"event":"message_stop","data":{"type":"message_stop"}},{"done":True}]:
                            channel.sendall(json.dumps(record).encode()+b"\n")
                thread=threading.Thread(target=respond);thread.start()
                events=list(bridge.stream_api("key-a","messages",{"model":"fictional"},socket_path=path));thread.join(3)
                self.assertEqual(events,[{"event":"message_stop","data":{"type":"message_stop"}}])

    def test_quota_metadata_survives_the_socket(self):
        error=self.exchange({"ok":False,"error":{"code":"quota_exceeded","limit":"calls_per_minute","remaining":0,"retry_after":42,"retry_at":1792400000000,"message":"never echo secret"}},True)
        self.assertEqual(error.code,"quota_exceeded")
        self.assertEqual(error.limit,"calls_per_minute")
        self.assertEqual(error.retry_after,42)
        self.assertEqual(error.retry_at,1792400000000)
        self.assertNotIn("secret",str(error))
        self.assertEqual(bridge.BridgeDenied(["injected"]).code,"request_failed")

    def test_quota_details_are_preserved_and_payloads_are_filtered(self):
        detail={"code":"quota_exceeded","limit":"output_tokens_per_hour","scope":"application_credential","source":"kpassword","limit_value":100,"used":90,"remaining":10,"requested":20,"retry_after":120,"retry_at":1792400000000,"message":"never echo secret"}
        error=bridge.BridgeDenied("quota_exceeded",details=detail)
        self.assertEqual(error.limit,"output_tokens_per_hour")
        self.assertEqual(error.remaining,10)
        self.assertEqual(error.retry_after,120)
        self.assertNotIn("message",error.details)
        self.assertNotIn("secret",str(error))
        error=bridge.BridgeDenied("quota_exceeded",details={"limit":"secret","retry_after":"secret","remaining":-1})
        self.assertIsNone(error.limit)
        self.assertNotIn("secret",str(error))
        self.assertIsNone(error.remaining)

    def test_non_private_socket_is_denied(self):
        with tempfile.TemporaryDirectory(prefix="kpassword-connector-mode-") as directory:
            path = Path(directory) / "request.sock"
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
                server.bind(str(path)); path.chmod(0o666)
                with self.assertRaises(bridge.BridgeDenied):
                    bridge.request_api("key-a", "chat", {}, socket_path=path)


if __name__ == "__main__":
    unittest.main()
