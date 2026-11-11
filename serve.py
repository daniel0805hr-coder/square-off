# 개발용 웹 서버: python3 -m http.server 와 같지만 브라우저 캐시를 끈다.
# (캐시가 남으면 코드를 고친 뒤 새로고침해도 예전 파일이 섞여서 실행될 수 있음)
# 사용법: python3 serve.py   → http://localhost:8000
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
http.server.ThreadingHTTPServer(('', port), NoCacheHandler).serve_forever()
