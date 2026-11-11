// 링크 접속 온라인 (기획서 10장) — PeerJS(WebRTC, P2P). 연결 주선만 PeerJS 공개 서버를 쓰고, 게임 데이터는 두 브라우저가 직접 주고받는다.
// 방식: 호스트(P1)가 게임 전체를 돌리고 게임 화면을 영상으로 보낸다. 친구(P2)는 영상을 보며 입력만 보낸다.
//   → 체스·턴제·실시간 전투 모두 같은 방식으로 동작. 친구 쪽 지연 = 영상이 오는 시간.
// 친구 → 호스트 메시지: { t: 'down' | 'up', action, source } (동작 키), { t: 'click', x, y } (게임 좌표 640×360 클릭)
// 호스트 → 친구 메시지: { t: 'full' } (이미 다른 친구가 들어와 있음)

import { remoteInput, actionFor, mouseCode, online } from '../input/controls.js';

const PREFIX = 'squareoff-';
const GAME_W = 640, GAME_H = 360;
const VIDEO_SCALE = 2; // 보내는 영상 크기 = 게임 화면 × 이 값
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'; // 헷갈리는 글자(i, l, o, 0, 1) 제외

const randomCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

export function roomLink(code) {
  const url = new URL(location.href);
  url.search = `?room=${code}`;
  url.hash = '';
  return url.toString();
}

// 도트 화면이 뭉개지지 않게: 글자·선명도 우선, 해상도 유지, 넉넉한 비트레이트
function tuneVideo(pc) {
  const apply = () => {
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== 'video') continue;
      const params = sender.getParameters();
      params.degradationPreference = 'maintain-resolution';
      for (const enc of params.encodings || []) enc.maxBitrate = 3_000_000;
      sender.setParameters(params).catch(() => {});
    }
  };
  if (pc.connectionState === 'connected') apply();
  else pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'connected') apply(); });
}

const ERROR_TEXT = {
  'peer-unavailable': '방을 찾을 수 없어요. 링크를 다시 확인하세요',
  network: '연결 서버에 닿지 않아요. 인터넷 연결을 확인하세요',
  'server-error': '연결 서버 오류예요. 잠시 뒤 다시 해보세요',
  'browser-incompatible': '이 브라우저는 온라인을 지원하지 않아요 (크롬 권장)',
};
const errorText = (err) => ERROR_TEXT[err.type] || `연결 오류 (${err.type || err.message})`;
const NO_PEERJS = '온라인 연결 도구를 불러오지 못했어요. 페이지를 새로고침해 보세요';
const SERVER_TIMEOUT = 10_000; // 연결 서버에 이 시간 안에 못 닿으면 실패 안내
const JOIN_TIMEOUT = 15_000;   // 친구가 이 시간 안에 호스트 화면을 못 받으면 실패 안내
const JOIN_FAILED = '호스트와 연결이 안 돼요.\n회사·학교 와이파이처럼 직접 연결을 막는 네트워크일 수 있어요.\n둘 중 한 명이 휴대폰 핫스팟 등 다른 네트워크로 바꿔서 다시 해보세요.';

// ───────── 호스트 ─────────

// 방을 만든다. 친구가 들어오면 화면 영상을 보내고 친구 입력을 P2 명령으로 넘긴다.
//   onStatus({ state: 'waiting', link } | { state: 'joined' } | { state: 'left' } | { state: 'error', message })
//   onClick({ x, y }) — 친구의 화면 클릭 (게임 좌표)
export function hostRoom({ game, onStatus, onClick }) {
  if (typeof Peer === 'undefined') {
    setTimeout(() => onStatus({ state: 'error', message: NO_PEERJS }));
    return { close() {} };
  }
  const code = randomCode();
  const peer = new Peer(PREFIX + code);
  const serverTimer = setTimeout(() => onStatus({ state: 'error', message: ERROR_TEXT.network }), SERVER_TIMEOUT);
  // 게임이 한 장면을 그릴 때마다 그 장면을 영상 한 프레임으로 보낸다 (최대 30fps)
  //   게임 화면(그래픽 가속 WebGL)을 바로 영상으로 뜨면 검은 화면이 될 수 있어서,
  //   그린 직후에 보통 캔버스로 복사해 그걸 보낸다. 2배로 키워 복사하면 영상 압축에도 도트 글자가 덜 뭉개진다
  const mirror = document.createElement('canvas');
  mirror.width = GAME_W * VIDEO_SCALE;
  mirror.height = GAME_H * VIDEO_SCALE;
  const ctx = mirror.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const stream = mirror.captureStream(0);
  const track = stream.getVideoTracks()[0];
  track.contentHint = 'detail';
  let lastFrame = 0;
  const sendFrame = () => {
    const now = performance.now();
    if (now - lastFrame < 1000 / 31) return;
    lastFrame = now;
    ctx.drawImage(game.canvas, 0, 0, mirror.width, mirror.height);
    track.requestFrame();
  };
  game.events.on('postrender', sendFrame);
  let conn = null;
  let call = null;

  const releaseAll = () => {
    for (const action of ['up', 'down', 'left', 'right', 'confirm', 'skill', 'cancel']) remoteInput({ action, down: false });
  };

  peer.on('open', () => { clearTimeout(serverTimer); onStatus({ state: 'waiting', link: roomLink(code) }); });
  peer.on('error', (err) => { clearTimeout(serverTimer); onStatus({ state: 'error', message: errorText(err) }); });
  peer.on('connection', (c) => {
    if (conn) {
      c.on('open', () => { c.send({ t: 'full' }); setTimeout(() => c.close(), 500); });
      return;
    }
    conn = c;
    c.on('open', () => {
      online.role = 'host';
      call = peer.call(c.peer, stream);
      tuneVideo(call.peerConnection);
      onStatus({ state: 'joined' });
    });
    c.on('data', (msg) => {
      if (msg?.t === 'down' || msg?.t === 'up') remoteInput({ action: msg.action, down: msg.t === 'down', source: msg.source });
      else if (msg?.t === 'click' && Number.isFinite(msg.x) && Number.isFinite(msg.y)) onClick({ x: msg.x, y: msg.y });
    });
    c.on('close', () => {
      if (conn !== c) return;
      conn = null;
      call?.close();
      call = null;
      releaseAll();
      online.role = null;
      onStatus({ state: 'left' });
    });
  });

  return {
    close() {
      clearTimeout(serverTimer);
      releaseAll();
      online.role = null;
      game.events.off('postrender', sendFrame);
      track.stop();
      peer.destroy();
    },
  };
}

// 호스트 화면 아래쪽 안내 띠 (링크 복사용 — 캔버스 글자는 복사할 수 없어서 HTML로)
export class HostPanel {
  constructor() {
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'fixed', left: '50%', bottom: '12px', transform: 'translateX(-50%)',
      display: 'flex', gap: '8px', alignItems: 'center', maxWidth: 'calc(100vw - 32px)',
      padding: '8px 12px', background: '#1b1a24', border: '1px solid #4a4658', color: '#f2ead8',
      font: '12px Galmuri11, sans-serif', zIndex: 10,
    });
    document.body.append(this.el);
  }

  show(message, link = null) {
    this.el.replaceChildren(Object.assign(document.createElement('span'), { textContent: message }));
    if (!link) return;
    const input = Object.assign(document.createElement('input'), { value: link, readOnly: true });
    Object.assign(input.style, { width: '260px', minWidth: 0, flex: '1 1 auto', font: 'inherit', background: '#111018', color: '#f2ead8', border: '1px solid #4a4658', padding: '4px' });
    input.addEventListener('focus', () => input.select());
    const copy = Object.assign(document.createElement('button'), { textContent: '복사' });
    Object.assign(copy.style, { font: 'inherit', background: '#f2ead8', color: '#111018', border: 0, padding: '4px 10px', cursor: 'pointer' });
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(link); } catch { input.select(); document.execCommand('copy'); }
      copy.textContent = '복사됨!';
      setTimeout(() => { copy.textContent = '복사'; }, 1500);
    });
    // 링크 칸에서 누른 키가 게임 조작으로 들어가지 않게
    for (const el of [input, copy]) el.addEventListener('keydown', (e) => e.stopPropagation());
    this.el.append(input, copy);
  }

  remove() {
    this.el.remove();
  }
}

// ───────── 친구 (링크로 들어온 쪽) ─────────

// 게임 대신 호스트 화면 영상을 띄우고, 내 키·클릭을 호스트로 보낸다
export function joinRoom(code, root) {
  root.replaceChildren();
  const video = Object.assign(document.createElement('video'), { autoplay: true, muted: true, playsInline: true });
  Object.assign(video.style, { width: '100%', height: '100%', objectFit: 'contain', imageRendering: 'pixelated', display: 'block' });
  const status = document.createElement('div');
  Object.assign(status.style, {
    position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', maxWidth: 'calc(100vw - 32px)',
    color: '#f2ead8', font: '14px Galmuri11, sans-serif', textAlign: 'center', lineHeight: '1.6', whiteSpace: 'pre-line',
  });
  const badge = document.createElement('div');
  Object.assign(badge.style, {
    position: 'fixed', left: '8px', bottom: '8px', color: '#8d8798', font: '11px Galmuri9, sans-serif', pointerEvents: 'none',
  });
  badge.textContent = '온라인 · 나는 P2(흑) · 내 키 설정의 P1·P2 키 모두 사용 가능';
  root.append(video, status, badge);
  // 안내 문구. retry = true 면 '다시 시도' 버튼(새로고침)도 보여 준다
  const say = (text, retry = false) => {
    status.textContent = text;
    status.style.display = text ? 'block' : 'none';
    if (!retry) return;
    const btn = Object.assign(document.createElement('button'), { textContent: '다시 시도' });
    Object.assign(btn.style, { display: 'block', margin: '12px auto 0', font: 'inherit', background: '#f2ead8', color: '#111018', border: 0, padding: '6px 14px', cursor: 'pointer' });
    btn.addEventListener('click', () => location.reload());
    status.append(btn);
  };
  say('방에 들어가는 중…');
  if (typeof Peer === 'undefined') { say(NO_PEERJS, true); return; }

  const peer = new Peer();
  let conn = null;
  const held = new Set();
  const send = (msg) => { if (conn?.open) conn.send(msg); };
  // 정해진 시간 안에 호스트 화면이 안 오면 (네트워크가 직접 연결을 막는 경우 등) 안내
  const joinTimer = setTimeout(() => say(JOIN_FAILED, true), JOIN_TIMEOUT);
  const fail = (text) => { clearTimeout(joinTimer); say(text, true); };
  // 실제로 화면(영상 프레임)이 들어와야 연결 완료
  video.addEventListener('loadeddata', () => { clearTimeout(joinTimer); say(''); });

  peer.on('error', (err) => fail(errorText(err)));
  peer.on('open', () => {
    conn = peer.connect(PREFIX + code, { reliable: true });
    conn.on('open', () => say('연결됨! 호스트 화면을 기다리는 중…'));
    conn.on('data', (msg) => { if (msg?.t === 'full') fail('이미 다른 친구가 들어와 있어요'); });
    conn.on('close', () => { video.srcObject = null; fail('연결이 끊겼어요. 호스트에게 새 링크를 받아 다시 들어오세요'); });
  });
  peer.on('call', (call) => {
    call.answer();
    call.on('stream', (stream) => {
      video.srcObject = stream;
      video.play().catch(() => {});
      say('호스트 화면을 받는 중…');
    });
  });

  // 키보드: 내 키 설정으로 동작을 읽어 보낸다 (누르고 있는 동안 한 번만 'down')
  const press = (action, down, source) => {
    if (down === held.has(action)) return;
    if (down) held.add(action); else held.delete(action);
    send({ t: down ? 'down' : 'up', action, source });
  };
  window.addEventListener('keydown', (e) => {
    const action = actionFor(e.code, e.key);
    if (!action) return;
    e.preventDefault();
    press(action, true, 'key');
  });
  window.addEventListener('keyup', (e) => {
    const action = actionFor(e.code, e.key);
    if (action) press(action, false, 'key');
  });
  window.addEventListener('blur', () => { for (const action of [...held]) press(action, false, 'key'); });

  // 마우스: 화면 클릭은 게임 좌표로 바꿔 보내고, 동작에 지정된 버튼이면 그 동작도 보낸다
  const toGame = (e) => {
    const rect = video.getBoundingClientRect();
    const scale = Math.min(rect.width / GAME_W, rect.height / GAME_H);
    const x = (e.clientX - rect.left - (rect.width - GAME_W * scale) / 2) / scale;
    const y = (e.clientY - rect.top - (rect.height - GAME_H * scale) / 2) / scale;
    return x >= 0 && x <= GAME_W && y >= 0 && y <= GAME_H ? { x, y } : null;
  };
  video.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const at = toGame(e);
    if (at) send({ t: 'click', ...at });
    const action = actionFor(mouseCode(e.button));
    if (action) press(action, true, 'mouse');
  });
  window.addEventListener('mouseup', (e) => {
    const action = actionFor(mouseCode(e.button));
    if (action) press(action, false, 'mouse');
  });
  video.addEventListener('contextmenu', (e) => e.preventDefault());
}
