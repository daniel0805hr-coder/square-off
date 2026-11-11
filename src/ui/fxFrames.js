// pixelfx 그림 한 장을 색 숫자 배열로 만드는 부분 (화면 없이 돌아서 백그라운드 작업자에서도 쓴다)
import { createFrame, clearFrame, createFx, composite } from '../../lib/pixelfx/src/core/index.js';

// 리틀 엔디언이면 pixelfx 색 숫자(ABGR)를 RGBA 바이트 4개로 한 번에 옮길 수 있다 (사실상 모든 PC)
export const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

// pixelfx composite(f, out, null)과 같은 결과. 빛이 없는 칸(거의 전부)은 색을 그대로 복사해서 몇 배 빠르다
//   out: RGBA 바이트, px: 같은 메모리를 4바이트씩 본 것
export function compositeInto(f, out, px) {
  if (!LITTLE_ENDIAN) return composite(f, out, null);
  const C = f.color, L = f.light, n = f.w * f.h;
  for (let i = 0; i < n; i++) {
    const l = L[i];
    if (!(l & 0xffffff)) { px[i] = C[i]; continue; }
    const c = C[i], lr = l & 255, lg = (l >>> 8) & 255, lb = (l >>> 16) & 255;
    let r = c & 255, g = (c >>> 8) & 255, b = (c >>> 16) & 255, a = c >>> 24;
    if (a < 255) {
      // 투명 위의 빛: 있는 색에 알파를 곱하고 빛을 더한 뒤 새 알파로 나눈다
      const pa = a / 255, pr = r * pa + lr, pg = g * pa + lg, pb = b * pa + lb;
      const na = Math.min(1, Math.max(pa, Math.max(lr, lg, lb) / 255));
      if (na > 0) { r = Math.min(255, pr / na); g = Math.min(255, pg / na); b = Math.min(255, pb / na); a = na * 255; }
    } else {
      r = Math.min(255, r + lr); g = Math.min(255, g + lg); b = Math.min(255, b + lb);
    }
    const j = i * 4;
    out[j] = r; out[j + 1] = g; out[j + 2] = b; out[j + 3] = a;
  }
}

// 시각만으로 모양이 정해지는 반복 이펙트(나뭇잎 등)의 i번째 장을 "칠해진 칸만" 담아 돌려준다
//   spec = { w, h, x, y (영역의 화면 위치), plays: [{ x, y, seed, … }], layer, fps }
//   돌려주는 것: { at: 칸 번호들, col: 그 칸의 RGBA(4바이트 숫자) } — 빈 칸은 빼서 수백 장도 메모리가 작다
const scratch = new Map();
export function loopFrame(mod, spec, i) {
  let s = scratch.get(spec);
  if (!s) {
    const frame = createFrame(spec.w, spec.h, spec.x, spec.y);
    const bytes = new Uint8ClampedArray(spec.w * spec.h * 4);
    s = { frame, bytes, px: new Uint32Array(bytes.buffer) };
    scratch.set(spec, s);
  }
  clearFrame(s.frame);
  for (const o of spec.plays) {
    const fx = createFx(mod, o);
    fx.update(i / spec.fps);
    fx.draw(s.frame, spec.layer);
  }
  compositeInto(s.frame, s.bytes, s.px);
  return sparse(s.px);
}

// 칠해진 칸만 골라 담기
function sparse(px) {
  let n = 0;
  for (let k = 0; k < px.length; k++) if (px[k]) n++;
  const at = new Uint32Array(n), col = new Uint32Array(n);
  for (let k = 0, j = 0; k < px.length; k++) if (px[k]) { at[j] = k; col[j++] = px[k]; }
  return { at, col };
}

// 한 번짜리 이펙트(필살기 등)를 처음부터 끝까지 30fps로 그려 장마다 onFrame(i, { at, col })
//   SHOT 판 위에 이펙트 원점을 (SHOT.ox, SHOT.oy)에 두고 그린다 — 화면에 붙일 때 그만큼 옮긴다
//   i번째 장 = 이펙트가 i/30초 흘렀을 때 (0번은 비워 둔다)
export const SHOT = { w: 640, h: 480, ox: 320, oy: 320, fps: 30 };
export function shotFrames(mod, o, onFrame) {
  const frame = createFrame(SHOT.w, SHOT.h, 0, 0);
  const bytes = new Uint8ClampedArray(SHOT.w * SHOT.h * 4), px = new Uint32Array(bytes.buffer);
  const fx = createFx(mod, { ...o, x: SHOT.ox, y: SHOT.oy });
  const n = shotCount(mod);
  for (let i = 1; i < n; i++) {
    fx.update(1 / SHOT.fps);
    clearFrame(frame);
    fx.draw(frame);
    compositeInto(frame, bytes, px);
    onFrame(i, sparse(px));
  }
}
export const shotCount = (mod) => Math.ceil(mod.meta.duration * SHOT.fps) + 1;
