import { Chase, TREE, GAP, BLOCK, cellCenter } from '../logic/chase.js';
import { ChaseBot } from '../logic/ai.js';
import { CHASE as CH } from '../logic/balance.js';
import { PIECE_NAMES } from '../logic/chess.js';
import { currentHp } from '../logic/units.js';
import { InputRouter, keyLabels, rumble } from '../input/controls.js';
import { FONT_SMALL, FONT_BIG, text, setLabel, PLAYER_COLOR, PLAYER_HEX, SIDE_NAME } from '../ui/style.js';
import { FighterView } from '../ui/fighter.js';
import { drawBattleHud, drawBrickWall, bakedLayer } from '../ui/frame.js';
import { FxLayer, FX, RAMP, cachedLoop, prepareLoop } from '../ui/pixelfx.js';

const ARENA_X = 320; // 미로 중심 (화면 좌표)
const ARENA_Y = 190;
const ROLE_NAME = { attacker: '술래', defender: '도망자' };
const SPECIAL_NAME = { jump: '점프', blink: '순간이동', block: '벽 블록', dash: '대시', stealth: '은신' };
// 아래 키 안내: 한쪽이 화면 절반을 넘지 않게 접는다 (두 줄까지)
const HELP_W = 290;
const INTRO_TIME = 1.4;
const END_TIME = 1.8;
const MAZE_W = CH.cols * CH.tile, MAZE_H = CH.rows * CH.tile;
// 숲에 떨어지는 나뭇잎: 원래 크기로 화면 대각선 두 조각만 (추격을 가리지 않을 만큼), 미로 안에서만 보이게 (영역을 미로 크기로)
//   앞면만: 뒷면은 화면을 덮는 저녁 안개와 땅에 쌓인 낙엽이라 미로를 가린다
const LEAVES = (() => {
  const [ox, oy] = FX.fallingLeaves.meta.origin;
  return {
    x: ARENA_X - MAZE_W / 2, y: ARENA_Y - MAZE_H / 2, w: MAZE_W, h: MAZE_H,
    plays: [[0, 0], [320, 180]].map(([dx, dy]) => ({ x: ox + dx, y: oy + dy, seed: 8 + dx })),
    layer: 'front', fps: FX.fallingLeaves.meta.fps,
  };
})();
// 게임을 켤 때 나뭇잎 그림을 백그라운드에서 미리 그려 두기 시작 (main.js)
export const prepareChase = () => prepareLoop('fallingLeaves', LEAVES);
const GRASS = 0x3d5a34, GRASS_DARK = 0x34502c, TREE_TOP = 0x1f3a1c, TREE_EDGE = 0x152814, BUSH = 0x6f9a4a, STONE = 0x8c8f99;

// 추격전 화면 (숲). 로직은 logic/chase.js, 여기는 입력 전달과 그리기만.
export class ChaseScene extends Phaser.Scene {
  constructor() {
    super('chase');
  }

  // data = { attacker, defender (판 위 기물), bot: { player, level } | null }
  create(data) {
    this.pieces = { attacker: data.attacker, defender: data.defender };
    this.chase = new Chase(data.attacker, data.defender);
    this.bot = data.bot ? new ChaseBot(this.chase, data.bot.player, data.bot.level) : null;
    this.phase = 'intro';
    this.phaseTime = 0;
    this.pressed = { 1: {}, 2: {} };

    this.router = new InputRouter(this, ({ player, action, repeat }) => {
      if (repeat || this.phase !== 'fight' || this.bot?.player === player) return;
      if (action === 'skill') this.pressed[player].special = true;
    });

    const mw = MAZE_W, mh = MAZE_H;
    this.ground = bakedLayer(this, (g) => {
      g.fillStyle(0x111018).fillRect(0, 0, 640, 360);
      // 숲 테두리: 빽빽한 덤불 울타리
      drawBrickWall(g, ARENA_X - mw / 2, ARENA_Y - mh / 2, mw, mh, 8, { stone: 0x24401f, mortar: 0x132612, hi: 0x3a6a30 });
      drawBattleHud(g);
      this.drawMaze(g);
    });
    this.fx = this.add.graphics().setDepth(2);
    this.views = this.chase.fighters.map((f) => new FighterView(this, this.toScreen(f), f.piece,
      { body: f.body, color: PLAYER_COLOR[f.player] }).face(f.fx).setDepth(3));
    cachedLoop(this, 'fallingLeaves', LEAVES, 4); // 떨어지는 나뭇잎
    this.pfx = new FxLayer(this, { depth: 5 });
    this.drawHud();

    this.banner = this.add.text(320, 150, '', text(15, '#f2ead8', FONT_BIG)).setOrigin(0.5).setDepth(10).setStroke('#111018', 4);
    this.subBanner = this.add.text(320, 172, '', text(10, '#d8d2c4', FONT_SMALL)).setOrigin(0.5).setDepth(10).setStroke('#111018', 3);
    const [a, d] = this.chase.fighters;
    this.banner.setText(`${PIECE_NAMES[a.type]}(술래) VS ${PIECE_NAMES[d.type]}(도망자)`);
    this.subBanner.setText(`${CH.duration}초 버티면 도망 성공 · ${CH.tagsToCatch}번 닿으면 잡힘`);
    this.cameras.main.fadeIn(300, 17, 16, 24);
  }

  update(_time, deltaMs) {
    const dt = Math.min(deltaMs / 1000, 1 / 20);
    this.dt = dt;
    this.phaseTime += dt;
    if (this.phase === 'intro') {
      if (this.phaseTime > INTRO_TIME - 0.4) { this.banner.setText('시작!'); this.subBanner.setText(''); }
      if (this.phaseTime > INTRO_TIME) { this.phase = 'fight'; this.phaseTime = 0; this.banner.setText(''); }
    } else if (this.phase === 'fight') {
      this.chase.step(dt, this.readInputs(dt));
      this.pressed = { 1: {}, 2: {} };
      for (const ev of this.chase.events) this.playEvent(ev);
    } else if (this.phase === 'end' && this.phaseTime > END_TIME) {
      this.leave();
    }
    this.draw();
  }

  readInputs(dt) {
    const inputs = {};
    for (const p of [1, 2]) {
      if (this.bot?.player === p) { inputs[p] = this.bot.think(dt); continue; }
      inputs[p] = { ...this.pressed[p], ...this.router.directions(p) };
    }
    return inputs;
  }

  playEvent(ev) {
    const f = ev.fighter;
    switch (ev.type) {
      case 'dash':
      case 'blink':
        this.ghost(f, ev.from || f);
        break;
      case 'block':
        this.ground.redraw();
        break;
      case 'land':
        this.cameras.main.shake(60, 0.004);
        break;
      case 'stealth':
        this.ghost(f, f);
        break;
      case 'tag': { // 술래가 닿음 (아직 안 잡힘이면 도망자는 잠깐 무적·가속)
        const pos = this.toScreen(ev.to);
        this.cameras.main.shake(100, 0.007);
        rumble(ev.to.player, 'hit');
        this.pfx.play(FX.hitSpark, { x: pos.x, y: pos.y + ev.to.body, height: ev.to.body + 12, aim: Math.atan2(ev.to.y - f.y, ev.to.x - f.x), palette: RAMP[f.player] });
        this.views[1].flash();
        const t = this.add.text(pos.x, pos.y - 24, `-${ev.damage}  터치 ${ev.tags}/${CH.tagsToCatch}`, text(12, '#ffe08a'))
          .setOrigin(0.5).setStroke('#111018', 3).setDepth(9);
        this.tweens.add({ targets: t, y: pos.y - 44, alpha: 0, duration: 800, onComplete: () => t.destroy() });
        break;
      }
      case 'end': {
        this.phase = 'end';
        this.phaseTime = 0;
        const winner = this.chase[ev.winner];
        const caught = ev.reason === 'catch';
        if (caught) {
          this.cameras.main.shake(150, 0.01);
          const [hunter, prey] = [this.chase.attacker, this.chase.defender];
          rumble(prey.player, 'ko');
          const pos = this.toScreen(prey);
          const aim = Math.atan2(prey.y - hunter.y, prey.x - hunter.x);
          this.pfx.play(FX.critHit, { x: pos.x, y: pos.y + prey.body, height: prey.body + 12, aim, palette: RAMP[hunter.player] });
          this.time.delayedCall(250, () => this.pfx.play(FX.poof, { x: pos.x, y: pos.y + prey.body }));
        }
        this.banner.setText(caught ? '잡았다! 공격 성공!' : '도망 성공! 방어 성공!').setColor(PLAYER_HEX[winner.player]);
        const lost = currentHp(this.pieces.defender) - this.chase.defender.hp;
        this.subBanner.setText(caught ? '도망자 제거' : `시간 종료 — 둘 다 제자리로${lost > 0 ? ` (도망자 HP -${lost})` : ''}`);
        if (caught) this.views[1].fall(this.chase.defender.x >= this.chase.attacker.x ? 1 : -1);
        break;
      }
      default:
    }
  }

  ghost(f, at) {
    const g = new FighterView(this, this.toScreen(at), f.piece, { body: f.body, ring: false }).face(f.fx).setAlpha(0.5).setDepth(1);
    this.tweens.add({ targets: g, alpha: 0, duration: 300, onComplete: () => g.destroy() });
  }

  leave() {
    this.phase = 'done';
    this.cameras.main.fadeOut(300, 17, 16, 24);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      const ch = this.chase;
      this.scene.wake('board', {
        winner: ch.winner, reason: ch.reason,
        // 추격전은 승리 보상이 없다. 도망자는 터치당한 만큼 HP가 깎인 채 돌아간다
        hp: { attacker: currentHp(this.pieces.attacker), defender: ch.defender.hp, noReward: true },
        shieldUsed: {},
      });
      this.scene.stop();
    });
  }

  // ───────── 그리기 ─────────

  toScreen(f) {
    return { x: ARENA_X + f.x, y: ARENA_Y + f.y };
  }

  drawMaze(g) {
    const w = CH.cols * CH.tile, h = CH.rows * CH.tile;
    const x0 = ARENA_X - w / 2, y0 = ARENA_Y - h / 2;
    const grid = this.chase.grid;
    for (let r = 0; r < CH.rows; r++) {
      for (let c = 0; c < CH.cols; c++) {
        const x = x0 + c * CH.tile, y = y0 + r * CH.tile;
        g.fillStyle((r + c) % 2 ? GRASS : GRASS_DARK).fillRect(x, y, CH.tile, CH.tile);
        const v = grid[r][c];
        const { x: cx, y: cy } = cellCenter(c, r);
        const sx = ARENA_X + cx, sy = ARENA_Y + cy;
        if (v === TREE) {
          // 그림자 → 줄기 → 수관(테두리·몸·빛 받는 쪽)
          g.fillStyle(0x000000, 0.25).fillEllipse(sx + 2, sy + 7, 16, 6);
          g.fillStyle(0x4a3220).fillRect(sx - 2, sy + 2, 4, 7);
          g.fillStyle(TREE_EDGE).fillCircle(sx, sy - 1, 10);
          g.fillStyle(TREE_TOP).fillCircle(sx, sy - 2, 8);
          g.fillStyle(0x2f5a28).fillCircle(sx - 3, sy - 5, 4);
          g.fillStyle(0x4f8a3e).fillRect(sx - 5, sy - 7, 2, 1).fillRect(sx - 1, sy - 8, 1, 1);
        } else if (v === GAP) {
          // 덤불: 폰만 지나감
          g.fillStyle(BUSH).fillCircle(sx - 5, sy, 5).fillCircle(sx + 5, sy, 5).fillCircle(sx, sy - 4, 5);
        } else if (v === BLOCK) {
          g.fillStyle(0x5a5c66).fillRect(x + 1, y + 1, CH.tile - 2, CH.tile - 2);
          g.fillStyle(STONE).fillRect(x + 3, y + 3, CH.tile - 6, CH.tile - 6);
        }
      }
    }
  }

  drawHud() {
    this.hud = {};
    for (const f of this.chase.fighters) {
      const left = f.player === 1;
      const x = left ? 24 : 616;
      const vet = f.piece.vet ? ' ★' : '';
      this.add.text(x, 14, `P${f.player} ${SIDE_NAME[f.piece.color]} ${PIECE_NAMES[f.type]}${vet} · ${ROLE_NAME[f.role]}`,
        text(12, PLAYER_HEX[f.player])).setOrigin(left ? 0 : 1, 0);
      this.add.text(x, 32, f.mv.desc, text(10, '#d8d2c4', FONT_SMALL)).setOrigin(left ? 0 : 1, 0);
      const keys = keyLabels(f.player);
      const sp = f.mv.special;
      const help = this.bot?.player === f.player ? '컴퓨터가 조종'
        : `이동 ${keys.move}` + (sp ? ` · 스킬(${SPECIAL_NAME[sp.kind]}) ${keys.skill}` : ' · 스킬 없음 (자동 능력)');
      this.add.text(x, 324, help, { ...text(10, '#8d8798', FONT_SMALL), align: left ? 'left' : 'right', lineSpacing: 1, wordWrap: { width: HELP_W } }).setOrigin(left ? 0 : 1, 0);
      this.hud[f.role] = {
        special: this.add.text(x, 46, '', text(10, '#8d8798', FONT_SMALL)).setOrigin(left ? 0 : 1, 0),
      };
    }
    this.timer = this.add.text(320, 16, '', text(15, '#f2ead8', FONT_BIG)).setOrigin(0.5, 0);
    this.add.text(320, 40, '숲', text(10, '#8d8798', FONT_SMALL)).setOrigin(0.5, 0);
  }

  specialLabel(f) {
    const sp = f.mv.special;
    if (!sp) return { label: '', ready: false };
    const name = SPECIAL_NAME[sp.kind];
    if (f.stealthTime > 0) return { label: `${name} 중 ${f.stealthTime.toFixed(1)}`, ready: true };
    if (f.usesLeft <= 0) return { label: `${name} 다 씀`, ready: false };
    const uses = Number.isFinite(f.usesLeft) ? ` (${f.usesLeft}회)` : '';
    if (f.specialCd > 0) return { label: `${name} ${f.specialCd.toFixed(1)}${uses}`, ready: false };
    return { label: `${name} 준비${uses}`, ready: true };
  }

  draw() {
    const ch = this.chase;
    setLabel(this.timer, String(Math.ceil(ch.timeLeft)), ch.timeLeft <= 3 && this.phase === 'fight' ? '#6fd36f' : '#f2ead8');
    for (const f of ch.fighters) {
      const s = this.specialLabel(f);
      // 술래 = 터치 횟수, 도망자 = 남은 HP
      const head = f.role === 'attacker' ? `터치 ${ch.tags}/${CH.tagsToCatch}` : `HP ${f.hp}/${f.maxHp}`;
      setLabel(this.hud[f.role].special, s.label ? `${head} · ${s.label}` : head, s.ready ? '#ffe08a' : '#8d8798');
    }

    const g = this.fx.clear();
    ch.fighters.forEach((f, i) => {
      const pos = this.toScreen(f);
      const view = this.views[i];
      let lift = 0;
      if (f.jumpTime > 0) {
        const t = 1 - f.jumpTime / f.mv.special.time;
        lift = Math.sin(t * Math.PI) * 16;
      }
      if (this.phase !== 'end' && this.phase !== 'done') {
        view.face(f.fx).place(pos.x, pos.y, { lift, dt: this.dt });
        view.setDepth(3 + pos.y / 1000); // 아래쪽 말이 앞에
      }
      // 은신: 거의 안 보임
      // 터치당한 직후 무적: 깜빡임
      const blink = f.invuln > 0 && Math.floor(f.invuln * 20) % 2;
      if (this.phase === 'fight') view.setAlpha(f.stealthTime > 0 ? 0.06 : blink ? 0.35 : 1);
      if (f.stealthTime > 0) return;
      const col = PLAYER_COLOR[f.player];
      const r = f.body + 5;
      const tipX = pos.x + f.fx * r, tipY = pos.y - lift + f.fy * r;
      const px = -f.fy * 3, py = f.fx * 3;
      g.fillStyle(col).fillTriangle(tipX + f.fx * 3, tipY + f.fy * 3, tipX + px, tipY + py, tipX - px, tipY - py);
    });
  }
}
