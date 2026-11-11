// 백그라운드 작업자: 이펙트의 모든 장을 미리 그려 보낸다 (게임 화면은 멈추지 않는다)
//   반복 이펙트: { kind: 'loop', id, url, spec, frames } / 한 번짜리: { kind: 'shot', id, url, opts }
//   보내는 것: 한 장마다 { id, i, at, col }
import { loopFrame, shotFrames } from './fxFrames.js';

const send = (id) => (i, { at, col }) => self.postMessage({ id, i, at, col }, [at.buffer, col.buffer]);

self.onmessage = async ({ data }) => {
  const mod = await import(data.url);
  if (data.kind === 'loop') {
    for (let i = 0; i < data.frames; i++) send(data.id)(i, loopFrame(mod, data.spec, i));
  } else {
    shotFrames(mod, data.opts, send(data.id));
  }
};
