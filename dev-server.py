#!/usr/bin/env python3
"""Local dev server that disables all caching, so edits are always reflected
immediately in the browser (no stale JS modules, no service-worker surprises)."""
import http.server
import sys

PORT = 8790


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    http.server.test(HandlerClass=NoCacheHandler, port=port)
