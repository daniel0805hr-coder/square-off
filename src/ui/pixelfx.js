// pixelfx 도트 이펙트를 Phaser 화면에 그리는 다리
//   라이브러리: lib/pixelfx (MIT, https://github.com/patch-gg/pixelfx) — 이펙트 하나 = 코드 파일 하나
//   이펙트는 자기 캔버스(이 레이어)에 그린 뒤 그림 한 장으로 화면에 올린다
import { createFrame, clearFrame, createFx, composite } from '../../lib/pixelfx/src/core/index.js';

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

// 벽에 걸린 횃불: 횃불마다 둘레만 한 작은 레이어에 30fps로 (전투 내내 켜져 있어 화면 전체 레이어에 두면 매 프레임 무겁다)
//   벽에 비치는 불빛까지 담는 크기: 실제로 그려지는 범위(좌우 64, 위 100, 아래 39px)에 여유를 둠
const TORCH_BOX = { left: 72, right: 72, up: 112, down: 48 };
export function wallTorches(scene, xs, y, depth = 5) {
  const { left, right, up, down } = TORCH_BOX;
  for (const x of xs) {
    const rect = { x: x - left, y: y - up, w: left + right, h: up + down };
    new FxLayer(scene, { depth, rect, fps: torch.meta.fps }).play(torch, { x, y, flip: x > 320, seed: x });
  }
}

// 리틀 엔디언이면 pixelfx 색 숫자(ABGR)를 RGBA 바이트 4개로 한 번에 옮길 수 있다 (사실상 모든 PC)
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

// pixelfx composite(f, out, null)과 같은 결과. 빛이 없는 칸(거의 전부)은 색을 그대로 복사해서 몇 배 빠르다
function compositeFast(f, out, px) {
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

let uid = 0;

export class FxLayer {
  // depth: 그릴 순서, scale: 2면 320×180 이펙트(화면 전환·날씨)를 화면 전체에 2배로, fixed: 카메라 줌·이동을 따르지 않음
  //   rect: { x, y, w, h } 이 화면 영역만 그린다 (밖은 잘림). 작을수록 가볍다 — 매 프레임 영역 전체를 칠하고 올리므로
  //   fps: 다시 그리는 빈도 상한 (늘 켜 둔 배경 이펙트용. 날씨·횃불은 원래 30fps 그림이라 30이면 똑같이 보인다)
  constructor(scene, { depth = 8, scale = 1, fixed = false, rect = null, fps = 0 } = {}) {
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
    const fx = createFx(mod, { ...o, x: (o.x ?? 0) / this.scale, y: (o.y ?? 0) / this.scale });
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
    clearFrame(this.frame);
    for (const fx of this.list) {
      fx.update(dt);
      fx.draw(this.frame, fx.layer);
    }
    this.list = this.list.filter((fx) => !fx.done());
    if (LITTLE_ENDIAN) compositeFast(this.frame, this.img.data, this.px);
    else composite(this.frame, this.img.data, null);
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
