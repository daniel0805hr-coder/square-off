// 온라인 진단 (인터넷 링크 방). 친구 화면에서 F9(또는 주소 끝 &net=1)로 왼쪽 위 수치판을 켜고 끈다.
//   - 연결 경로: direct(직접 연결) / relay(중계 서버 경유 — 같은 공유기여도 느려진다)
//   - 코덱: 협상된 영상 방식(H264/VP8…)과 풀이 방식(하드웨어=그래픽 칩 / 소프트웨어=CPU)
//   - 친구 쪽: 초당 프레임, 끊긴(버려진) 프레임 수, 한 장 디코딩 시간, 받는 비트레이트, 재생 버퍼
//   - 호스트 쪽: 한 장 압축 시간, 제한 사유(cpu·bandwidth)

const codecName = (byId, id) => byId.get(id)?.mimeType?.replace('video/', '') || '?';
const codecType = (byId, id) => {
  const c = byId.get(id);
  if (!c?.mimeType) return null;
  return c.sdpFmtpLine ? `${c.mimeType};${c.sdpFmtpLine}` : c.mimeType;
};

// 크롬은 개인정보 보호로 인코더·디코더 이름을 숨기는 경우가 많아서, 이 PC가 그 코덱을 '전력 효율적으로'
//   (= 보통 그래픽 칩 하드웨어로) 처리하는지 브라우저에 따로 물어본다. 코덱별로 한 번만 묻고 기억
const powerCache = new Map();
function powerEfficient(kind, contentType) {
  const caps = typeof navigator !== 'undefined' ? navigator.mediaCapabilities : null;
  if (!contentType || !caps) return null;
  const key = `${kind}|${contentType}`;
  if (!powerCache.has(key)) {
    powerCache.set(key, null);
    const config = { type: 'webrtc', video: { contentType, width: 640, height: 360, bitrate: 1_500_000, framerate: 30 } };
    (kind === 'decode' ? caps.decodingInfo(config) : caps.encodingInfo(config))
      .then((r) => powerCache.set(key, r.supported ? r.powerEfficient : null))
      .catch(() => {});
  }
  return powerCache.get(key);
}
// 하드웨어 여부: powerEfficient* 가 있으면 그걸로, 없으면 구현 이름으로 짐작 (libvpx·OpenH264·FFmpeg·dav1d = CPU)
const hwText = (impl, efficient) => {
  if (efficient === true) return '하드웨어';
  if (efficient === false) return 'CPU';
  if (!impl || impl === 'unknown') return '?';
  return /libvpx|openh264|ffmpeg|dav1d|libaom/i.test(impl) ? 'CPU' : '하드웨어?';
};

// 호스트: 보내는 영상 통계
export async function hostVideoStats(pc, prev) {
  const stats = await pc.getStats();
  const byId = new Map();
  stats.forEach((r) => byId.set(r.id, r));
  let out = null;
  stats.forEach((r) => {
    if (r.type !== 'outbound-rtp' || r.kind !== 'video') return;
    const frames = r.framesEncoded - (prev?.framesEncoded || 0);
    const encMs = frames > 0 ? ((r.totalEncodeTime - (prev?.totalEncodeTime || 0)) / frames) * 1000 : 0;
    out = {
      framesEncoded: r.framesEncoded, totalEncodeTime: r.totalEncodeTime,
      encodeMs: Math.round(encMs * 10) / 10, fps: r.framesPerSecond || 0,
      limit: r.qualityLimitationReason || 'none', w: r.frameWidth, h: r.frameHeight,
      codec: codecName(byId, r.codecId),
      hw: hwText(r.encoderImplementation, r.powerEfficientEncoder ?? powerEfficient('encode', codecType(byId, r.codecId))),
      impl: r.encoderImplementation || '?',
    };
  });
  return out;
}

// 친구: 받는 영상 통계 + 연결 경로
export async function guestVideoStats(pc, prev) {
  const stats = await pc.getStats();
  const now = performance.now();
  const out = { path: '?', rttMs: 0, at: now };
  let pair = null;
  const byId = new Map();
  stats.forEach((r) => byId.set(r.id, r));
  stats.forEach((r) => {
    if (r.type === 'transport' && r.selectedCandidatePairId) pair = byId.get(r.selectedCandidatePairId);
    if (r.type === 'inbound-rtp' && r.kind === 'video') {
      const emitted = r.jitterBufferEmittedCount - (prev?.emitted || 0);
      const jb = emitted > 0 ? ((r.jitterBufferDelay - (prev?.jbDelay || 0)) / emitted) * 1000 : 0;
      const dec = r.framesDecoded - (prev?.framesDecoded || 0);
      const decMs = dec > 0 ? ((r.totalDecodeTime - (prev?.totalDecodeTime || 0)) / dec) * 1000 : 0;
      const secs = prev?.at ? (now - prev.at) / 1000 : 0;
      const kbps = secs > 0 ? Math.round(((r.bytesReceived - (prev?.bytes || 0)) * 8) / 1000 / secs) : 0;
      Object.assign(out, {
        emitted: r.jitterBufferEmittedCount, jbDelay: r.jitterBufferDelay, framesDecoded: r.framesDecoded,
        totalDecodeTime: r.totalDecodeTime, bytes: r.bytesReceived, kbps,
        bufferMs: Math.round(jb), decodeMs: Math.round(decMs * 10) / 10,
        fps: r.framesPerSecond || 0, dropped: r.framesDropped || 0, w: r.frameWidth, h: r.frameHeight,
        codec: codecName(byId, r.codecId),
        hw: hwText(r.decoderImplementation, r.powerEfficientDecoder ?? powerEfficient('decode', codecType(byId, r.codecId))),
        impl: r.decoderImplementation || '?',
      });
    }
  });
  if (pair) {
    out.rttMs = Math.round((pair.currentRoundTripTime || 0) * 1000);
    const l = byId.get(pair.localCandidateId), rm = byId.get(pair.remoteCandidateId);
    const types = [l?.candidateType, rm?.candidateType];
    out.path = types.includes('relay') ? 'relay(중계)' : `direct(${types.join('/')})`;
  }
  return out;
}

// 친구 화면 왼쪽 위 수치판. 반환값: { update(친구, 호스트, 핑ms, 가벼운모드), toggle() }
export function createStatsPanel(root, visible) {
  const el = document.createElement('pre');
  Object.assign(el.style, {
    position: 'fixed', left: '6px', top: '6px', margin: 0, padding: '4px 6px', background: 'rgba(0,0,0,.65)',
    color: '#9fe870', font: '11px monospace', pointerEvents: 'none', zIndex: 20, whiteSpace: 'pre',
    display: visible ? 'block' : 'none',
  });
  el.textContent = '진단 수치 모으는 중… (F9 = 끄기)';
  root.append(el);
  return {
    get visible() { return visible; },
    toggle() { visible = !visible; el.style.display = visible ? 'block' : 'none'; },
    update(g, host, pingMs, lite) {
      if (!visible) return;
      el.textContent = [
        `[친구] ${Math.round(g.fps || 0)}fps  끊김(버려짐) ${g.dropped ?? 0}장  디코딩 ${g.decodeMs ?? '-'}ms/장`,
        `       받는 양 ${g.kbps ?? '-'}kbps  재생 버퍼 ${g.bufferMs ?? '-'}ms  ${g.w || '-'}x${g.h || '-'}`,
        `       코덱 ${g.codec ?? '?'} (풀기: ${g.hw ?? '?'}${g.impl && g.impl !== '?' ? ` ${g.impl}` : ''})`,
        `[연결] ${g.path}  왕복 ${g.rttMs}ms  핑 ${pingMs ?? '-'}ms`,
        `[호스트] ${Math.round(host?.fps || 0)}fps  압축 ${host?.encodeMs ?? '-'}ms/장  제한 ${host?.limit ?? '-'}`,
        `       코덱 ${host?.codec ?? '?'} (압축: ${host?.hw ?? '?'}${host?.impl && host.impl !== '?' ? ` ${host.impl}` : ''})`,
        `가벼운 모드 ${lite ? '켜짐' : '꺼짐'} (F8)   F9 = 수치판 끄기`,
      ].join('\n');
    },
  };
}
