// pixelfx 도트 이펙트를 Phaser 화면에 그리는 다리
//   라이브러리: lib/pixelfx (MIT, https://github.com/patch-gg/pixelfx) — 이펙트 하나 = 코드 파일 하나
//   이펙트는 자기 캔버스(이 레이어)에 그린 뒤 그림 한 장으로 화면에 올린다
import { createFrame, clearFrame, createFx } from '../../lib/pixelfx/src/core/index.js';
import { compositeInto, loopFrame, SHOT, shotCount } from './fxFrames.js';

import * as parry from '../../lib/pixelfx/src/fx/impacts/parry.js';
import * as hitSpark from '../../lib/pixelfx/src/fx/impacts/hit-spark.js';
import * as critHit from '../../lib/pixelfx/src/fx/impacts/crit-hit.js';
import * as poof from '../../lib/pixelfx/src/fx/spawn/poof.js';
import * as collectBurst from '../../lib/pixelfx/src/fx/pickups/collect-burst.js';
import * as halo from '../../lib/pixelfx/src/fx/holy/halo.js';
import * as holyPillar from '../../lib/pixelfx/src/fx/holy/holy-pillar.js';
import * as confetti from '../../lib/pixelfx/src/fx/ui/confetti.js';
import * as shatterWipe from '../../lib/pixelfx/src/fx/transitions/shatter-wipe.js';
import * as torch from '../../lib/pixelfx/src/fx/fire/torch.js';
import * as fallingLeaves from '../../lib/pixelfx/src/fx/weather/falling-leaves.js';
// 필살기
import * as manaBurst from '../../lib/pixelfx/src/fx/arcane/mana-burst.js';
import * as thrust from '../../lib/pixelfx/src/fx/melee/thrust.js';
import * as spinSlash from '../../lib/pixelfx/src/fx/melee/spin-slash.js';
import * as heavyLanding from '../../lib/pixelfx/src/fx/impacts/heavy-landing.js';
import * as groundSlam from '../../lib/pixelfx/src/fx/impacts/ground-slam.js';
import * as smite from '../../lib/pixelfx/src/fx/holy/smite.js';

export const FX = {
  parry, hitSpark, critHit, poof, collectBurst, halo, holyPillar, confetti, shatterWipe, torch, fallingLeaves,
  manaBurst, thrust, spinSlash, heavyLanding, groundSlam, smite,
};

// 색 띠 (어두운 → 밝은). 플레이어 색에 맞춘 타격 불꽃 등
export const RAMP = {
  1: ['#0c1430', '#162c5c', '#1f4f94', '#3f8cff', '#5aa0ff', '#9bd0ff', '#e0f2ff', '#ffffff'],  // P1 파랑
  2: ['#2a0510', '#5c0a1c', '#a3142a', '#e0302c', '#ff6a5a', '#ffb09a', '#fff0e0', '#ffffff'],  // P2 빨강
  gold: ['#3b1d2a', '#7a3a2c', '#c4652e', '#f0a040', '#ffd25e', '#fff0a0', '#fffbe0', '#ffffff'],
  heal: ['#0e2a24', '#14472f', '#1d6e3a', '#2f9a45', '#5cc654', '#a0e46c', '#dcffb4', '#ffffff'],
  block: ['#0c1430', '#162c5c', '#1f4f94', '#2f7fcc', '#58b4ec', '#9bdcff', '#d8f4ff', '#ffffff'],
  violet: ['#12081e', '#2a1040', '#4a1a6a', '#7a2aa0', '#b04ad8', '#e08aff', '#f6d0ff', '#ffffff'],
  // 킹 결전 유리: 붉은 흑요석
  duel: ['#12060a', '#2a0a12', '#4a0f1a', '#7a1622', '#b02a2a', '#e8603a', '#ffc070', '#ffffff'],
};

// 진영 필살기 색: 백 = 금빛(질서), 흑 = 보랏빛(자유)
export const sideRamp = (color) => (color === 'w' ? RAMP.gold : RAMP.violet);

// 사람 모양 기본 캐릭터 없이 그리기 (헤일로가 머리카락을 칠하지 않게)
export const NO_BODY = { mask: { w: 0, h: 0 }, pixels: [], x: 0, y: 0 };

// 킹 결전 입장: 붉은 유리판이 화면을 덮은 채 시작 → 금이 가고 → 산산조각 나며 전투장이 드러난다
//   (판이 떨어져 자리 잡는 앞부분 1초는 건너뛴다)
export function duelEntrance(scene) {
  new FxLayer(scene, { depth: 20, scale: 2, fixed: true }).cover(shatterWipe, { palette: RAMP.duel, color: '#12060a' }, { start: 1.0 });
  scene.time.delayedCall(320, () => scene.cameras.main.shake(140, 0.006));
  scene.time.delayedCall(620, () => scene.cameras.main.shake(220, 0.012));
}

// 벽에 걸린 횃불: 2초짜리 반복 그림(30fps × 60장)이라 장마다 한 번만 그려 그림으로 저장해 두고 돌려 쓴다
//   (매번 새로 그리면 횃불 하나에 프레임마다 몇 ms — 저사양 PC 렉의 주범이었다)
//   저장한 그림은 게임 전체 공용이라 첫 전투의 처음 2초만 그리고, 그 뒤 전투들은 꺼내 쓰기만 한다
//   두 횃불은 같은 그림을 좌우로 뒤집고 반 바퀴 어긋나게 돌려 서로 다르게 흔들린다
//   크기: 실제로 그려지는 범위(좌우 64, 위 100, 아래 39px)에 벽에 비치는 불빛 여유를 둠
const TORCH_BOX = { left: 72, right: 72, up: 112, down: 48 };
const TORCH_FRAMES = Math.round(torch.meta.duration * torch.meta.fps);
let torchPainter = null;

function torchFrame(scene, i) {
  const key = `pixelfx-torch-${i}`;
  if (scene.textures.exists(key)) return key;
  const { left, right, up, down } = TORCH_BOX;
  if (!torchPainter) {
    const w = left + right, h = up + down;
    const frame = createFrame(w, h, 0, 0), img = new ImageData(w, h);
    torchPainter = { frame, img, px: new Uint32Array(img.data.buffer) };
  }
  const p = torchPainter;
  const fx = createFx(torch, { x: left, y: up, seed: 4 });
  fx.update(i / torch.meta.fps); // 그 장의 시각으로 (횃불은 시각만으로 모양이 정해지는 그림)
  clearFrame(p.frame);
  fx.draw(p.frame);
  compositeInto(p.frame, p.img.data, p.px);
  const tex = scene.textures.createCanvas(key, p.frame.w, p.frame.h);
  tex.context.putImageData(p.img, 0, 0);
  tex.refresh();
  return key;
}

export function wallTorches(scene, xs, y, depth = 5) {
  const { left, up } = TORCH_BOX;
  const views = xs.map((x, n) => ({
    img: scene.add.image(x - left, y - up, torchFrame(scene, 0)).setOrigin(0).setDepth(depth).setFlipX(x > 320),
    shift: (n * TORCH_FRAMES) / 2,
    shown: -1,
  }));
  let t = 0;
  const tick = (_time, deltaMs) => {
    t += Math.min(deltaMs / 1000, 1 / 20);
    const base = Math.floor(t * torch.meta.fps);
    for (const v of views) {
      const i = (base + v.shift) % TORCH_FRAMES;
      if (i !== v.shown) { v.img.setTexture(torchFrame(scene, i)); v.shown = i; }
    }
  };
  scene.events.on('update', tick);
  scene.events.once('shutdown', () => scene.events.off('update', tick));
}

let uid = 0;

// ───────── 미리 그려 두기 ─────────
// 그리는 데 오래 걸리는 이펙트(숲의 나뭇잎, 필살기 등)는 백그라운드 작업자가 모든 장을 미리 그려 두고
//   화면은 꺼내 붙이기만 한다. 한 장 새로 그리는 데 빠른 PC에서도 수 ms~20ms — 저사양 PC 렉의 주범이었다
//   저장은 게임 내내 공용이고 칠해진 칸만 담아 메모리가 작다. 다 그려지기 전에는 원래처럼 그 자리에서 그린다
const FX_PATH = {
  parry: 'impacts/parry', hitSpark: 'impacts/hit-spark', critHit: 'impacts/crit-hit', poof: 'spawn/poof',
  collectBurst: 'pickups/collect-burst', halo: 'holy/halo', holyPillar: 'holy/holy-pillar', confetti: 'ui/confetti',
  shatterWipe: 'transitions/shatter-wipe', torch: 'fire/torch', fallingLeaves: 'weather/falling-leaves',
  manaBurst: 'arcane/mana-burst', thrust: 'melee/thrust', spinSlash: 'melee/spin-slash',
  heavyLanding: 'impacts/heavy-landing', groundSlam: 'impacts/ground-slam', smite: 'holy/smite',
};
const NAME_OF = new Map(Object.entries(FX).map(([name, mod]) => [mod, name]));
const fxUrl = (name) => new URL(`../../lib/pixelfx/src/fx/${FX_PATH[name]}.js`, import.meta.url).href;

const jobs = new Map(); // 작업 번호 → 저장소 { n: 장 수, frames: [], left: 남은 장 수 }
let worker; // 작업자 하나가 받은 순서대로 그린다
function order(store, msg) {
  const id = jobs.size + 1;
  jobs.set(id, store);
  try {
    if (worker === undefined) {
      worker = new Worker(new URL('./fxWorker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        const c = jobs.get(data.id);
        if (c.frames[data.i]) return;
        c.frames[data.i] = { at: data.at, col: data.col };
        c.left--;
      };
      worker.onerror = () => { worker.terminate(); worker = null; }; // 작업자를 못 쓰는 환경: 그 자리에서 그린다
    }
    worker?.postMessage({ ...msg, id });
  } catch { worker = null; }
}

// 늘 켜 둔 배경 반복 이펙트 (숲의 나뭇잎)
//   spec = { x, y, w, h (화면 영역), plays: [{ x, y, seed, … } 이펙트 위치들], layer, fps }
const loops = new Map();
export function prepareLoop(name, spec) {
  let c = loops.get(spec);
  if (c) return c;
  const n = Math.round(FX[name].meta.duration * spec.fps);
  c = { n, frames: [], left: n };
  loops.set(spec, c);
  order(c, { kind: 'loop', url: fxUrl(name), spec, frames: n });
  return c;
}

export function cachedLoop(scene, name, spec, depth) {
  const c = prepareLoop(name, spec);
  const img = new ImageData(spec.w, spec.h), px = new Uint32Array(img.data.buffer);
  const key = `pixelfx-${uid++}`;
  const tex = scene.textures.createCanvas(key, spec.w, spec.h);
  const view = scene.add.image(spec.x, spec.y, key).setOrigin(0).setDepth(depth);
  let t = 0, shown = -1;
  const tick = (_time, deltaMs) => {
    t += Math.min(deltaMs / 1000, 1 / 20);
    const i = Math.floor(t * spec.fps) % c.n;
    if (i === shown) return;
    shown = i;
    if (!c.frames[i]) { c.frames[i] = loopFrame(FX[name], spec, i); c.left--; }
    const { at, col } = c.frames[i];
    px.fill(0);
    for (let k = 0; k < at.length; k++) px[at[k]] = col[k];
    tex.context.putImageData(img, 0, 0);
    tex.refresh();
  };
  scene.events.on('update', tick);
  scene.events.once('shutdown', () => {
    scene.events.off('update', tick);
    view.destroy();
    scene.textures.remove(key);
  });
}

// 한 번짜리 이펙트: 위치를 뺀 옵션이 같으면 같은 그림이라 옵션별로 한 벌씩 저장
//   prepareFx를 미리 불러 두면(전투 시작 때 등) FxLayer.play가 다 그려진 그림을 꺼내 쓴다
const shots = new Map();
const shotKey = (name, o) => name + JSON.stringify(o);
export function prepareFx(mod, o = {}) {
  const name = NAME_OF.get(mod), key = shotKey(name, o);
  if (shots.has(key) || mod.meta.loop) return;
  const n = shotCount(mod);
  const c = { n, frames: [], left: n - 1 };
  shots.set(key, c);
  order(c, { kind: 'shot', url: fxUrl(name), opts: o });
}

// 미리 그린 한 번짜리를 레이어 px(RGBA 숫자)에 겹쳐 그린다. 겹치는 칸은 반투명 덧칠
function blit(s, px, w, h, lx, ly) {
  const i = Math.min(s.shot.n - 1, Math.max(1, Math.round(s.t * SHOT.fps)));
  const { at, col } = s.shot.frames[i];
  for (let k = 0; k < at.length; k++) {
    const a = at[k], x = (a % SHOT.w) + lx, y = ((a / SHOT.w) | 0) + ly;
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const j = y * w + x, d = px[j], c = col[k], ca = c >>> 24;
    if (ca === 255 || !(d >>> 24)) { px[j] = c; continue; }
    const sa = ca / 255, da = (d >>> 24) / 255, oa = sa + da * (1 - sa), m = (da * (1 - sa)) / oa, n = sa / oa;
    const ch = (sh) => Math.round(((c >>> sh) & 255) * n + ((d >>> sh) & 255) * m);
    px[j] = ((Math.round(oa * 255) << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0;
  }
}

export class FxLayer {
  // depth: 그릴 순서, scale: 2면 320×180 이펙트(화면 전환·날씨)를 화면 전체에 2배로, fixed: 카메라 줌·이동을 따르지 않음
  //   rect: { x, y, w, h } 이 화면 영역만 그린다 (밖은 잘림). 작을수록 가볍다 — 매 프레임 영역 전체를 칠하고 올리므로
  //   fps: 다시 그리는 빈도 상한. pixelfx 이펙트는 모두 30fps로 만든 그림이라 30이면 똑같이 보이면서 계산은 절반
  //     (60Hz 화면이면 두 프레임에 한 번, 144Hz 화면이면 다섯 프레임에 한 번 그린다)
  constructor(scene, { depth = 8, scale = 1, fixed = false, rect = null, fps = 30 } = {}) {
    const { x = 0, y = 0, w: rw = 640, h: rh = 360 } = rect ?? {};
    const w = Math.ceil(rw / scale), h = Math.ceil(rh / scale);
    this.scene = scene;
    this.scale = scale;
    this.frame = createFrame(w, h, Math.floor(x / scale), Math.floor(y / scale));
    this.img = new ImageData(w, h);
    this.px = new Uint32Array(this.img.data.buffer);
    this.step = fps ? 1 / fps : 0;
    this.wait = 0;
    this.key = `pixelfx-${uid++}`;
    this.tex = scene.textures.createCanvas(this.key, w, h);
    this.view = scene.add.image(this.frame.ox * scale, this.frame.oy * scale, this.key).setOrigin(0).setScale(scale).setDepth(depth).setVisible(false);
    if (fixed) this.view.setScrollFactor(0);
    this.list = [];
    scene.events.on('update', this.tick, this);
    scene.events.once('shutdown', this.destroy, this);
  }

  // 이펙트 재생. o = { x, y (화면 좌표), flip, angle, palette, seed, 이펙트별 옵션 }
  //   한 번짜리는 끝나면 저절로 사라지고, 반복(loop)은 돌려받은 것의 stop()으로 끈다
  //   start: 이펙트 중간(초)부터 시작
  //   layer: 'front'면 앞면만 (날씨 이펙트의 뒷면은 화면 전체를 덮는 어두운 하늘이라 빼야 할 때)
  play(mod, o = {}, { start = 0, layer } = {}) {
    // 미리 다 그려 둔 그림이 있으면 그걸 붙인다 (prepareFx)
    const { x = 0, y = 0, ...rest } = o;
    const c = this.scale === 1 && !layer && shots.get(shotKey(NAME_OF.get(mod), rest));
    if (c && !c.left) {
      const s = { shot: c, meta: mod.meta, t: start, x: Math.round(x), y: Math.round(y),
        update(dt) { this.t += dt; }, done() { return this.t >= mod.meta.duration; }, stop() { this.t = Infinity; } };
      this.list.push(s);
      return s;
    }
    const fx = createFx(mod, { ...o, x: x / this.scale, y: y / this.scale });
    if (start) fx.update(start);
    fx.layer = layer;
    this.list.push(fx);
    return fx;
  }

  // 화면 전체 이펙트(날씨·화면 전환): 이펙트 자기 원점에 두면 화면을 꽉 채운다
  cover(mod, o = {}, opts) {
    const [ox, oy] = mod.meta.origin ?? [0, 0];
    return this.play(mod, { ...o, x: ox * this.scale, y: oy * this.scale }, opts);
  }

  // 한 번짜리만 지우고 반복 이펙트(헤일로 등)는 남김
  clearOneShots() {
    this.list = this.list.filter((fx) => fx.meta.loop);
  }

  tick(_time, deltaMs) {
    if (!this.list.length) {
      if (this.view.visible) this.view.setVisible(false);
      return;
    }
    // fps 상한이 있으면 그 간격이 찰 때까지 모았다가 한 번에 진행 (2ms 여유: 60Hz 화면에서 두 프레임마다 확실히 그리게)
    this.wait += Math.min(deltaMs / 1000, 1 / 20);
    if (this.wait < this.step - 0.002) return;
    const dt = this.wait;
    this.wait = 0;
    // 그 자리에서 그릴 이펙트가 없으면(미리 그린 것만) 빈 판에 붙이기만
    const live = this.list.some((fx) => !fx.shot);
    if (live) clearFrame(this.frame);
    for (const fx of this.list) {
      fx.update(dt);
      if (!fx.shot) fx.draw(this.frame, fx.layer);
    }
    if (live) compositeInto(this.frame, this.img.data, this.px);
    else this.px.fill(0);
    const { w, h, ox, oy } = this.frame;
    for (const s of this.list) if (s.shot && !s.done()) blit(s, this.px, w, h, s.x - SHOT.ox - ox, s.y - SHOT.oy - oy);
    this.list = this.list.filter((fx) => !fx.done());
    this.tex.context.putImageData(this.img, 0, 0);
    this.tex.refresh();
    this.view.setVisible(true);
  }

  destroy() {
    this.scene.events.off('update', this.tick, this);
    this.list = [];
    this.view.destroy();
    this.scene.textures.remove(this.key);
  }
}
