// 온라인 지연 점검 도구 (인터넷 링크 방). 친구 주소 끝에 &net=1 을 붙이면 친구 화면 왼쪽 위에 수치가 뜬다.
//   - 연결 경로: direct(직접 연결) / relay(중계 서버 경유 — 같은 공유기여도 느려진다)
//   - 핑: 친구→호스트→친구 데이터 왕복 시간
//   - 호스트 인코딩: 영상 한 장 압축하는 데 걸리는 시간, 제한 사유(cpu·bandwidth)
//   - 친구 버퍼: 영상을 받아 재생하기 전에 쌓아 두는 시간, 디코딩 시간, 초당 프레임, 버려진 프레임

// 호스트: 보내는 영상 통계 (인코딩 시간 등)
export async function hostVideoStats(pc, prev) {
  const stats = await pc.getStats();
  let out = null;
  stats.forEach((r) => {
    if (r.type !== 'outbound-rtp' || r.kind !== 'video') return;
    const frames = r.framesEncoded - (prev?.framesEncoded || 0);
    const encMs = frames > 0 ? ((r.totalEncodeTime - (prev?.totalEncodeTime || 0)) / frames) * 1000 : 0;
    out = {
      framesEncoded: r.framesEncoded, totalEncodeTime: r.totalEncodeTime,
      encodeMs: Math.round(encMs * 10) / 10, fps: r.framesPerSecond || 0,
      limit: r.qualityLimitationReason || 'none', w: r.frameWidth, h: r.frameHeight,
    };
  });
  return out;
}

// 친구: 받는 영상 통계 + 연결 경로
export async function guestVideoStats(pc, prev) {
  const stats = await pc.getStats();
  let out = { path: '?', rttMs: 0 };
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
      Object.assign(out, {
        emitted: r.jitterBufferEmittedCount, jbDelay: r.jitterBufferDelay, framesDecoded: r.framesDecoded,
        totalDecodeTime: r.totalDecodeTime, bufferMs: Math.round(jb), decodeMs: Math.round(decMs * 10) / 10,
        fps: r.framesPerSecond || 0, dropped: r.framesDropped || 0, w: r.frameWidth, h: r.frameHeight,
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

// 친구 화면 왼쪽 위 수치판
export function createStatsPanel(root) {
  const el = document.createElement('pre');
  Object.assign(el.style, {
    position: 'fixed', left: '6px', top: '6px', margin: 0, padding: '4px 6px', background: 'rgba(0,0,0,.65)',
    color: '#9fe870', font: '11px monospace', pointerEvents: 'none', zIndex: 20, whiteSpace: 'pre',
  });
  root.append(el);
  return (g, host, pingMs) => {
    el.textContent = [
      `경로 ${g.path}  네트워크 왕복 ${g.rttMs}ms  핑 ${pingMs ?? '-'}ms`,
      `영상 ${g.w || '-'}x${g.h || '-'}  ${Math.round(g.fps || 0)}fps  버려짐 ${g.dropped ?? 0}`,
      `친구 버퍼 ${g.bufferMs ?? '-'}ms  디코딩 ${g.decodeMs ?? '-'}ms`,
      `호스트 인코딩 ${host?.encodeMs ?? '-'}ms  ${Math.round(host?.fps || 0)}fps  제한 ${host?.limit ?? '-'}`,
    ].join('\n');
  };
}
