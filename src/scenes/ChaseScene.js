import { Chase, TREE, GAP, BLOCK, cellCenter } from '../logic/chase.js';
import { ChaseBot } from '../logic/ai.js';
import { CHASE as CH } from '../logic/balance.js';
import { PIECE_NAMES } from '../logic/chess.js';
import { currentHp } from '../logic/units.js';
import { InputRouter, keyLabels } from '../input/controls.js';
import { FONT_SMALL, FONT_BIG, text, PLAYER_COLOR, PLAYER_HEX, SIDE_NAME, makePiece } from '../ui/style.js';

const ARENA_X = 320; // 미로 중심 (화면 좌표)
const ARENA_Y = 190;
const ROLE_NAME = { attacker: '술래', defender: '도망자' };
const SPECIAL_NAME = { jump: '점프', blink: '순간이동', block: '벽 블록', dash: '대시', stealth: '은신' };
const INTRO_TIME = 1.4;
const END_TIME = 1.8;
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

    this.add.graphics().fillStyle(0x111018).fillRect(0, 0, 640, 360);
    this.mazeGfx = this.add.graphics();
    this.drawMaze();
    this.fx = this.add.graphics().setDepth(2);
    this.views = this.chase.fighters.map((f) => makePiece(this, this.toScreen(f), f.piece, f.body + 1).setDepth(3));
    this.drawHud();

    this.banner = this.add.text(320, 150, '', text(15, '#f2ead8', FONT_BIG)).setOrigin(0.5).setDepth(10).setStroke('#111018', 4);
    this.subBanner = this.add.text(320, 172, '', text(10, '#d8d2c4', FONT_SMALL)).setOrigin(0.5).setDepth(10).setStroke('#111018', 3);
    const [a, d] = this.chase.fighters;
    this.banner.setText(`${PIECE_NAMES[a.type]}(술래) VS ${PIECE_NAMES[d.type]}(도망자)`);
    this.subBanner.setText(`${CH.duration}초 버티면 도망 성공`);
    this.cameras.main.fadeIn(300, 17, 16, 24);
  }

  update(_time, deltaMs) {
    const dt = Math.min(deltaMs / 1000, 1 / 20);
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
        this.drawMaze();
        break;
      case 'land':
        this.cameras.main.shake(60, 0.004);
        break;
      case 'stealth':
        this.ghost(f, f);
        break;
      case 'end': {
        this.phase = 'end';
        this.phaseTime = 0;
        const winner = this.chase[ev.winner];
        const caught = ev.reason === 'catch';
        if (caught) this.cameras.main.shake(150, 0.01);
        this.banner.setText(caught ? '잡았다! 공격 성공!' : '도망 성공! 방어 성공!').setColor(PLAYER_HEX[winner.player]);
        this.subBanner.setText(caught ? '도망자 제거' : '시간 종료 — 둘 다 제자리로');
        this.views[1].setAlpha(caught ? 0.25 : 1);
        break;
      }
      default:
    }
  }

  ghost(f, at) {
    const g = makePiece(this, this.toScreen(at), f.piece, f.body + 1).setAlpha(0.5).setDepth(1);
    this.tweens.add({ targets: g, alpha: 0, duration: 300, onComplete: () => g.destroy() });
  }

  leave() {
    this.phase = 'done';
    this.cameras.main.fadeOut(300, 17, 16, 24);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      const ch = this.chase;
      this.scene.wake('board', {
        winner: ch.winner, reason: ch.reason,
        // 추격전은 HP가 변하지 않고 승리 보상도 없다
        hp: { attacker: currentHp(this.pieces.attacker), defender: currentHp(this.pieces.defender), noReward: true },
        shieldUsed: {},
      });
      this.scene.stop();
    });
  }

  // ───────── 그리기 ─────────

  toScreen(f) {
    return { x: ARENA_X + f.x, y: ARENA_Y + f.y };
  }

  drawMaze() {
    const g = this.mazeGfx.clear();
    const w = CH.cols * CH.tile, h = CH.rows * CH.tile;
    const x0 = ARENA_X - w / 2, y0 = ARENA_Y - h / 2;
    g.fillStyle(TREE_EDGE).fillRect(x0 - 4, y0 - 4, w + 8, h + 8);
    const grid = this.chase.grid;
    for (let r = 0; r < CH.rows; r++) {
      for (let c = 0; c < CH.cols; c++) {
        const x = x0 + c * CH.tile, y = y0 + r * CH.tile;
        g.fillStyle((r + c) % 2 ? GRASS : GRASS_DARK).fillRect(x, y, CH.tile, CH.tile);
        const v = grid[r][c];
        const { x: cx, y: cy } = cellCenter(c, r);
        const sx = ARENA_X + cx, sy = ARENA_Y + cy;
        if (v === TREE) {
          g.fillStyle(0x4a3220).fillRect(sx - 2, sy + 2, 4, 7);
          g.fillStyle(TREE_EDGE).fillCircle(sx, sy - 1, 10);
          g.fillStyle(TREE_TOP).fillCircle(sx, sy - 2, 8);
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
        : `이동 ${keys.move}` + (sp ? `  스킬(${SPECIAL_NAME[sp.kind]}) ${keys.skill}` : '  (스킬 없음 — 자동 능력)');
      this.add.text(x, 326, help, text(10, '#8d8798', FONT_SMALL)).setOrigin(left ? 0 : 1, 0);
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
    this.timer.setText(String(Math.ceil(ch.timeLeft)));
    this.timer.setColor(ch.timeLeft <= 3 && this.phase === 'fight' ? '#6fd36f' : '#f2ead8');
    for (const f of ch.fighters) {
      const s = this.specialLabel(f);
      this.hud[f.role].special.setText(s.label).setColor(s.ready ? '#ffe08a' : '#8d8798');
    }

    const g = this.fx.clear();
    ch.fighters.forEach((f, i) => {
      const pos = this.toScreen(f);
      const view = this.views[i];
      let lift = 0;
      if (f.jumpTime > 0) {
        const t = 1 - f.jumpTime / f.mv.special.time;
        lift = Math.sin(t * Math.PI) * 16;
        g.fillStyle(0x000000, 0.3).fillEllipse(pos.x, pos.y + f.body * 0.6, f.body * 2, f.body);
      }
      view.setPosition(pos.x, pos.y - lift).setScale(1 + lift / 50);
      // 은신: 거의 안 보임
      if (this.phase === 'fight') view.setAlpha(f.stealthTime > 0 ? 0.06 : 1);
      if (f.stealthTime > 0) return;
      const col = PLAYER_COLOR[f.player];
      const r = f.body + 5;
      const tipX = pos.x + f.fx * r, tipY = pos.y - lift + f.fy * r;
      const px = -f.fy * 3, py = f.fx * 3;
      g.fillStyle(col).fillTriangle(tipX + f.fx * 3, tipY + f.fy * 3, tipX + px, tipY + py, tipX - px, tipY - py);
    });
  }
}
