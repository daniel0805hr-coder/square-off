import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preferH264 } from '../src/net/codec.js';

const SDP = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=rtpmap:111 opus/48000/2',
  'm=video 9 UDP/TLS/RTP/SAVPF 96 97 98 99 102 103 45',
  'a=rtpmap:96 VP8/90000',
  'a=rtpmap:97 rtx/90000',
  'a=fmtp:97 apt=96',
  'a=rtpmap:98 VP9/90000',
  'a=rtpmap:99 H264/90000',
  'a=fmtp:99 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f',
  'a=rtpmap:102 H264/90000',
  'a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f',
  'a=rtpmap:103 H264/90000',
  'a=fmtp:103 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640c1f',
  'a=rtpmap:45 AV1/90000',
  '',
].join('\r\n');

test('온라인 영상: H.264(하드웨어로 잘 풀리는 42e01f·모드1)가 맨 앞으로', () => {
  const out = preferH264(SDP);
  assert.ok(out.includes('m=video 9 UDP/TLS/RTP/SAVPF 102 103 99 96 97 98 45\r\n'));
  assert.ok(out.includes('m=audio 9 UDP/TLS/RTP/SAVPF 111\r\n')); // 소리 줄은 그대로
});

test('온라인 영상: H.264가 없으면 그대로', () => {
  const noH264 = 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96 98\r\na=rtpmap:96 VP8/90000\r\na=rtpmap:98 VP9/90000\r\n';
  assert.equal(preferH264(noH264), noH264);
});
