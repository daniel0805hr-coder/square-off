// 영상 코덱 고르기 (SDP 글 고치기). 브라우저끼리 주고받는 연결 설명서(SDP)에서
//   영상 코덱 목록 순서를 H.264가 맨 앞에 오게 바꾼다.
//   저전력 인텔·AMD PC는 H.264를 그래픽 칩(하드웨어)으로 풀어 CPU를 거의 안 쓰지만, VP8·VP9은 CPU로 푸는 경우가 많다.
//   H.264를 못 쓰는 브라우저면 목록에 없으니 원래 순서(VP8 등) 그대로 간다.

// H.264 중에서도 가장 널리 하드웨어로 지원되는 것(Constrained Baseline 42e01f, packetization-mode=1)을 앞에
function h264Rank(fmtp) {
  const pm1 = /packetization-mode=1/.test(fmtp);
  const profile = /profile-level-id=([0-9a-f]{6})/i.exec(fmtp)?.[1]?.toLowerCase() || '';
  if (pm1 && profile.startsWith('42e0')) return 0;
  if (pm1 && profile.startsWith('4200')) return 1;
  if (pm1) return 2;
  return 3;
}

export function preferH264(sdp) {
  const nl = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(nl);
  const mIdx = lines.findIndex((l) => l.startsWith('m=video '));
  if (mIdx < 0) return sdp;
  let end = lines.findIndex((l, i) => i > mIdx && l.startsWith('m='));
  if (end < 0) end = lines.length;
  const section = lines.slice(mIdx, end);
  const rank = new Map(); // 페이로드 번호 → 순위
  for (const l of section) {
    const m = /^a=rtpmap:(\d+) H264\//i.exec(l);
    if (!m) continue;
    const fmtp = section.find((f) => f.startsWith(`a=fmtp:${m[1]} `)) || '';
    rank.set(m[1], h264Rank(fmtp));
  }
  if (!rank.size) return sdp;
  const parts = lines[mIdx].split(' ');
  const head = parts.slice(0, 3), pts = parts.slice(3);
  const h264 = pts.filter((p) => rank.has(p)).sort((a, b) => rank.get(a) - rank.get(b));
  lines[mIdx] = [...head, ...h264, ...pts.filter((p) => !rank.has(p))].join(' ');
  return lines.join(nl);
}
