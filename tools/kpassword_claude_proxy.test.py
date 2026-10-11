import http.client
import importlib.util
import json
from pathlib import Path
import os
import threading
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location("proxy",Path(__file__).with_name("kpassword_claude_proxy.py"))
proxy=importlib.util.module_from_spec(spec);spec.loader.exec_module(proxy)

class ProxyTests(unittest.TestCase):
    def setUp(self):
        self.server=proxy.ProxyServer("fictional-key-id","fictional-model")
        self.thread=threading.Thread(target=self.server.serve_forever);self.thread.start()
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join(3)
    def call(self,body,token=None,path="/v1/messages",headers=None):
        c=http.client.HTTPConnection("127.0.0.1",self.server.server_port,timeout=3)
        h={"Authorization":"Bearer "+(token or self.server.token),"Content-Type":"application/json"}
        h.update(headers or {})
        c.request("POST",path,json.dumps(body),h);r=c.getresponse();result=(r.status,r.read());c.close();return result
    def test_non_streaming_uses_bridge_and_forces_approved_model(self):
        with patch.object(proxy,"request_api",return_value={"type":"message","content":[]}) as call:
            status,body=self.call({"model":"different","messages":[]})
            self.assertEqual(status,200);self.assertEqual(json.loads(body)["type"],"message")
            self.assertEqual(call.call_args.args[:2],("fictional-key-id","messages"))
            self.assertEqual(call.call_args.args[2]["model"],"fictional-model")
    def test_stream_preserves_anthropic_events_and_tool_arguments(self):
        events=[{"event":"content_block_delta","data":{"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\"file\":\"app.ts\"}"}}},{"event":"message_stop","data":{"type":"message_stop"}}]
        with patch.object(proxy,"stream_api",return_value=(e for e in events)):
            status,body=self.call({"stream":True,"messages":[]})
            self.assertEqual(status,200);self.assertIn(b"event: content_block_delta",body);self.assertIn(b"input_json_delta",body);self.assertIn(b"event: message_stop",body)
    def test_wrong_token_browser_origin_and_host_are_denied_before_bridge(self):
        with patch.object(proxy,"request_api") as call:
            for headers in [{"Origin":"https://evil.invalid"},{"Host":"evil.invalid"}]:self.assertEqual(self.call({},headers=headers)[0],403)
            self.assertEqual(self.call({},token="invalid")[0],403);call.assert_not_called()
    def test_timeout_and_denial_are_distinct_without_exception_payloads(self):
        for code in ["user_denied","approval_expired","key_not_found","bridge_inactive"]:
            with patch.object(proxy,"request_api",side_effect=proxy.BridgeDenied(code)):
                status,body=self.call({});self.assertEqual(status,503);self.assertEqual(json.loads(body)["error"]["message"],code)
    def test_unknown_endpoints_are_explicitly_unsupported(self):
        self.assertEqual(self.call({},path="/v1/messages/count_tokens")[0],501)
    def test_environment_contains_only_local_token_for_provider_auth(self):
        with patch.dict(os.environ,{"DEEPSEEK_API_KEY":"fictitious-secret","ANTHROPIC_API_KEY":"another-fake","OPENAI_API_KEY":"fake-openai"}):
            env=proxy.client_environment(self.server)
            self.assertNotIn("DEEPSEEK_API_KEY",env);self.assertNotIn("OPENAI_API_KEY",env)
            self.assertEqual(env["ANTHROPIC_API_KEY"],self.server.token)
            self.assertTrue(env["ANTHROPIC_BASE_URL"].startswith("http://127.0.0.1:"))

if __name__=="__main__":unittest.main()
