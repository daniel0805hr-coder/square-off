# 개발용 웹 서버: python3 -m http.server 와 같지만 브라우저 캐시를 끈다.
# (캐시가 남으면 코드를 고친 뒤 새로고침해도 예전 파일이 섞여서 실행될 수 있음)
# 사용법: python3 serve.py   → http://localhost:8000
#
# 같은 네트워크(LAN·VPN) 방 중계도 맡는다 (src/net/lan.js). 인터넷 없이 이 PC를 거쳐 주고받는다.
#   호스트 브라우저 → POST /lan/frame (게임 화면 JPEG)   → 친구 브라우저 GET /lan/stream (MJPEG 영상)
#   친구 브라우저   → POST /lan/input (키·클릭 JSON)     → 호스트 브라우저 GET /lan/events (SSE)
#   호스트 브라우저 → POST /lan/toguest (진동 등 JSON) → 친구 브라우저 GET /lan/guest-events (SSE)
#   GET /lan/info → 이 PC의 IP 주소들 (친구에게 보낼 링크용)
import http.server
import json
import socket
import subprocess
import sys
import threading
from urllib.parse import urlparse, parse_qs

BOUNDARY = 'squareoff-frame'


class LanRelay:
    """방 하나(호스트 1 + 친구 1)의 화면·입력 중계"""

    def __init__(self):
        self.cond = threading.Condition()
        self.frame = None
        self.frame_id = 0
        self.events = []  # (번호, JSON 문자열)
        self.event_id = 0
        self.guest = None  # 지금 들어와 있는 친구의 표식
        self.to_guest = []  # 호스트 → 친구 (번호, JSON 문자열)
        self.to_guest_id = 0

    def push_event(self, msg):
        with self.cond:
            self.event_id += 1
            self.events.append((self.event_id, json.dumps(msg)))
            del self.events[:-500]
            self.cond.notify_all()

    def push_guest(self, msg):
        with self.cond:
            self.to_guest_id += 1
            self.to_guest.append((self.to_guest_id, json.dumps(msg)))
            del self.to_guest[:-100]
            self.cond.notify_all()


relay = LanRelay()


def local_ips():
    """친구가 접속할 수 있는 이 PC의 IPv4 주소들 (VPN 주소 포함)"""
    ips = []
    try:
        out = subprocess.run(['hostname', '-I'], capture_output=True, text=True, timeout=2).stdout
        ips = [ip for ip in out.split() if '.' in ip]
    except (OSError, subprocess.SubprocessError):
        pass
    if not ips:
        try:
            ips = sorted({info[4][0] for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)})
        except OSError:
            pass
    return [ip for ip in ips if not ip.startswith('127.')]


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        if '/lan/' not in self.path:  # 중계 요청은 너무 많아서 기록하지 않는다
            super().log_message(fmt, *args)

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get('Content-Length') or 0)
        return self.rfile.read(min(length, 5_000_000))

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == '/lan/info':
            return self.send_json({'ips': local_ips(), 'port': self.server.server_address[1]})
        if url.path == '/lan/events':
            return self.serve_events()
        if url.path == '/lan/guest-events':
            return self.serve_guest_events(parse_qs(url.query).get('id', [''])[0])
        if url.path == '/lan/stream':
            return self.serve_stream(parse_qs(url.query).get('id', [''])[0])
        return super().do_GET()

    def do_POST(self):
        url = urlparse(self.path)
        if url.path == '/lan/frame':
            data = self.read_body()
            with relay.cond:
                relay.frame = data
                relay.frame_id += 1
                relay.cond.notify_all()
            return self.send_json({'ok': True})
        if url.path == '/lan/input':
            token = parse_qs(url.query).get('id', [''])[0]
            try:
                msg = json.loads(self.read_body() or b'null')
            except ValueError:
                msg = None
            if token != relay.guest or not isinstance(msg, dict):
                return self.send_json({'ok': False}, 409)
            relay.push_event(msg)
            return self.send_json({'ok': True})
        if url.path == '/lan/toguest':
            try:
                msg = json.loads(self.read_body() or b'null')
            except ValueError:
                msg = None
            if not isinstance(msg, dict):
                return self.send_json({'ok': False}, 400)
            relay.push_guest(msg)
            return self.send_json({'ok': True})
        self.send_error(404)

    # 친구: 호스트가 보내는 것(패드 진동)을 실시간으로 받는다 (Server-Sent Events)
    def serve_guest_events(self, token):
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.end_headers()
        with relay.cond:
            last = relay.to_guest_id
        try:
            while True:
                with relay.cond:
                    relay.cond.wait_for(lambda: relay.to_guest_id > last, timeout=15)
                    new = [m for i, m in relay.to_guest if i > last]
                    last = relay.to_guest_id
                    mine = relay.guest == token
                if new and mine:
                    self.wfile.write(''.join(f'data: {m}\n\n' for m in new).encode())
                else:
                    self.wfile.write(b': keepalive\n\n')
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass

    # 호스트: 친구 입력·입장·퇴장을 실시간으로 받는다 (Server-Sent Events)
    def serve_events(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.end_headers()
        with relay.cond:
            last = relay.event_id
            joined = relay.guest is not None
        try:
            if joined:  # 호스트가 늦게 열었어도 이미 들어온 친구를 알려 준다
                self.wfile.write(b'data: {"t": "join"}\n\n')
                self.wfile.flush()
            while True:
                with relay.cond:
                    relay.cond.wait_for(lambda: relay.event_id > last, timeout=15)
                    new = [(i, m) for i, m in relay.events if i > last]
                    last = relay.event_id
                if new:
                    self.wfile.write(''.join(f'data: {m}\n\n' for _, m in new).encode())
                else:
                    self.wfile.write(b': keepalive\n\n')
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass

    # 친구: 호스트 화면을 MJPEG 영상으로 받는다 (<img src="/lan/stream">)
    def serve_stream(self, token):
        with relay.cond:
            if relay.guest is not None and relay.guest != token:
                busy = True
            else:
                busy = False
                is_new = relay.guest != token
                relay.guest = token
        if busy:
            return self.send_error(409, 'room full')
        if is_new:
            relay.push_event({'t': 'join'})
        self.send_response(200)
        self.send_header('Content-Type', f'multipart/x-mixed-replace; boundary={BOUNDARY}')
        self.end_headers()
        last = 0
        try:
            while True:
                with relay.cond:
                    relay.cond.wait_for(lambda: relay.frame_id > last, timeout=5)
                    frame, last = relay.frame, relay.frame_id
                if frame is None:
                    continue
                self.wfile.write(f'--{BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: {len(frame)}\r\n\r\n'.encode())
                self.wfile.write(frame)
                self.wfile.write(b'\r\n')
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with relay.cond:
                left = relay.guest == token
                if left:
                    relay.guest = None
            if left:
                relay.push_event({'t': 'leave'})


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True  # 끌 때 열려 있는 영상·이벤트 연결을 기다리지 않는다


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
print(f'Square Off 서버: http://localhost:{port}')
for ip in local_ips():
    print(f'  같은 네트워크(LAN·VPN) 친구 접속 주소: http://{ip}:{port}/?lan=1')
Server(('', port), NoCacheHandler).serve_forever()
