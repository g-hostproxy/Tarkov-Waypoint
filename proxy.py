"""Serve this folder and forward /graphql to api.tarkov.dev (avoids browser CORS).

Run from the folder that contains your HTML file:
    python proxy.py
Then open http://localhost:8000/raid-route_3.html
"""
import json
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

UPSTREAM = "https://api.tarkov.dev/graphql"
PORT = 8000


class Handler(SimpleHTTPRequestHandler):
    def _forward(self, payload):
        req = urllib.request.Request(
            UPSTREAM,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "raid-route-local/1.0",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                status, body = r.status, r.read()
        except urllib.error.HTTPError as e:
            status, body = e.code, e.read()
        except Exception as e:  # network down, DNS, timeout...
            status = 502
            body = json.dumps({"errors": [{"message": "Proxy could not reach api.tarkov.dev: %s" % e}]}).encode()
        print("proxy -> tarkov.dev: HTTP", status, "(%d bytes)" % len(body))
        if status != 200:
            print("  upstream said:", body.decode("utf-8", "replace")[:500])
            print("  we sent:", json.dumps(payload)[:200])
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/graphql":
            qs = urllib.parse.parse_qs(parsed.query)
            payload = {"query": (qs.get("query") or [""])[0]}
            if qs.get("variables"):
                try:
                    payload["variables"] = json.loads(qs["variables"][0])
                except ValueError:
                    pass
            return self._forward(payload)
        return super().do_GET()

    def do_POST(self):
        if urllib.parse.urlparse(self.path).path == "/graphql":
            length = int(self.headers.get("Content-Length") or 0)
            try:
                payload = json.loads(self.rfile.read(length) or b"{}")
            except ValueError:
                payload = {}
            return self._forward(payload)
        self.send_error(404)


if __name__ == "__main__":
    print("Serving on http://localhost:%d  (Ctrl+C to stop)" % PORT)
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()
