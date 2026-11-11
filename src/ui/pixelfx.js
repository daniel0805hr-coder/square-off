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

let uid = 0;

export class FxLayer {
  // depth: 그릴 순서, scale: 2면 320×180 이펙트(화면 전환·날씨)를 화면 전체에 2배로, fixed: 카메라 줌·이동을 따르지 않음
  constructor(scene, { depth = 8, scale = 1, fixed = false } = {}) {
    const w = 640 / scale, h = 360 / scale;
    this.scene = scene;
    this.scale = scale;
    this.frame = createFrame(w, h);
    this.img = new ImageData(w, h);
    this.key = `pixelfx-${uid++}`;
    this.tex = scene.textures.createCanvas(this.key, w, h);
    this.view = scene.add.image(0, 0, this.key).setOrigin(0).setScale(scale).setDepth(depth).setVisible(false);
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
    const dt = Math.min(deltaMs / 1000, 1 / 20);
    clearFrame(this.frame);
    for (const fx of this.list) {
      fx.update(dt);
      fx.draw(this.frame, fx.layer);
    }
    this.list = this.list.filter((fx) => !fx.done());
    composite(this.frame, this.img.data, null);
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
