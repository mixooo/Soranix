"""Soranix local server: serves this folder at http://127.0.0.1:8888/ and tells the
browser never to cache, so every refresh picks up the newest files."""
import http.server
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, *args):
        pass


print("Soranix is running at http://127.0.0.1:8888/  (close this window to stop)")
http.server.ThreadingHTTPServer(("127.0.0.1", 8888), NoCache).serve_forever()
