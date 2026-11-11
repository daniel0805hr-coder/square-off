import { Battle } from '../logic/battle.js';
import { BattleBot } from '../logic/ai.js';
import { TOPDOWN as T, ULTIMATE } from '../logic/balance.js';
import { PIECE_NAMES } from '../logic/chess.js';
import { InputRouter, keyLabels } from '../input/controls.js';
import { FONT_SMALL, FONT_BIG, text, setLabel, C, PLAYER_COLOR, PLAYER_HEX, SIDE_NAME, endTitle } from '../ui/style.js';
import { FighterView } from '../ui/fighter.js';
import { drawBattleHud, drawBrickWall, wallShadow, bakedLayer } from '../ui/frame.js';
import { FxLayer, FX, RAMP, sideRamp, duelEntrance, wallTorches } from '../ui/pixelfx.js';

const ARENA_X = 320; // 아레나 중심 (화면 좌표)
const ARENA_Y = 190;
const ROLE_NAME = { attacker: '공격', defender: '수비' };
// 투기장 모래에서 튀는 흙먼지·돌 조각 색 (필살기 착지·충격파)
const SAND_DUST = ['#3b2a18', '#6b4e2c', '#8a6a3e', '#a8864e', '#c9a86a', '#e2c992', '#fff4d8'];
const SAND_STONE = '#7a5a2a';
const HEAD = 30; // 판정 중심에서 서 있는 말 머리 위까지 (글자 자리)
const MID = 12;  // 판정 중심에서 말 몸통 가운데까지 (실드 자리)
const SPECIAL_NAME = { P: '대시', N: '점프', B: '순간이동', R: '돌진', Q: '대시', K: '실드' };
const INTRO_TIME = 1.4;
const END_TIME = 1.8;
const READY = 0xffe08a;
const CHARGING = 0x8d8798;
const specialProgress = (f) => (f.mv.special.cooldown ? 1 - f.specialCd / f.mv.special.cooldown : 1);

// 탑다운 액션 전투 화면 (투기장). 로직은 logic/battle.js, 여기는 입력 전달과 그리기만.
export class BattleScene extends Phaser.Scene {
  constructor() {
    super('battle');
  }

  // data = { attacker, defender (판 위 기물), shields: { w, b }, bot: { player, level } | null, duel: 킹 결전인가 }
  create(data) {
    this.duel = Boolean(data.duel);
    this.battle = new Battle(data.attacker, data.defender, { shields: data.shields, deathmatch: this.duel });
    this.bot = data.bot ? new BattleBot(this.battle, data.bot.player, data.bot.level) : null;
    this.phase = 'intro'; // intro | fight | end
    this.phaseTime = 0;
    this.pressed = { 1: {}, 2: {} };
    this.holding = { 1: null, 2: null }; // 스킬 키를 누르고 있는 시간 (길게 누르면 필살기)

    this.router = new InputRouter(this, ({ player, action, repeat }) => {
      if (repeat || this.phase !== 'fight' || this.bot?.player === player) return;
      if (action === 'confirm') this.pressed[player].attack = true;
      if (action !== 'skill') return;
      // 필살기가 남아 있으면 뗄 때까지 기다린다 (짧게 = 스킬, 길게 = 필살기). 다 썼으면 바로 스킬
      if (this.fighterOf(player).ultUsed) this.pressed[player].special = true;
      else this.holding[player] = 0;
    });

    this.drawArena();
    this.fx = this.add.graphics().setDepth(2);
    this.views = this.battle.fighters.map((f) => new FighterView(this, this.toScreen(f), f.piece,
      { body: f.body, color: PLAYER_COLOR[f.player] }).face(f.fx).setDepth(3));
    this.top = this.add.graphics().setDepth(4); // 말 위에 그릴 것 (실드 등)
    this.pfx = new FxLayer(this, { depth: 5 }); // 도트 이펙트 (타격 불꽃 등)
    this.ultUntil = [0, 0]; // 필살기 연출 중인 시각 (말 순서별, ms) — 이 동안의 타격은 큰 불꽃
    // 투기장 양옆 횃불 (위쪽 체력 바와 겹치지 않게 가운데 높이)
    wallTorches(this, [35, 605], 214); // 벽에 걸린 횃불
    this.stunText = this.battle.fighters.map(() => this.add.text(0, 0, '기절', text(10, '#ffe08a', FONT_SMALL))
      .setOrigin(0.5).setStroke('#111018', 3).setDepth(9).setVisible(false));
    this.drawHud();

    this.banner = this.add.text(320, 150, '', text(15, '#f2ead8', FONT_BIG)).setOrigin(0.5).setDepth(10)
      .setStroke('#111018', 4);
    this.subBanner = this.add.text(320, 172, '', text(10, '#d8d2c4', FONT_SMALL)).setOrigin(0.5).setDepth(10)
      .setStroke('#111018', 3);
    const [a, d] = this.battle.fighters;
    this.banner.setText(`${PIECE_NAMES[a.type]} VS ${PIECE_NAMES[d.type]}`);
    this.subBanner.setText(this.duel ? '킹 결전 — 한쪽이 쓰러질 때까지!' : '준비…');

    this.cameras.main.fadeIn(300, 17, 16, 24);
    if (this.duel) duelEntrance(this);
  }

  update(_time, deltaMs) {
    const dt = Math.min(deltaMs / 1000, 1 / 20); // 탭 전환 등으로 프레임이 튀어도 안전하게
    this.dt = dt;
    this.phaseTime += dt;

    if (this.phase === 'intro') {
      if (this.phaseTime > INTRO_TIME - 0.4) { this.banner.setText('시작!'); this.subBanner.setText(''); }
      if (this.phaseTime > INTRO_TIME) { this.phase = 'fight'; this.phaseTime = 0; this.banner.setText(''); }
    } else if (this.phase === 'fight') {
      this.battle.step(dt, this.readInputs(dt));
      this.pressed = { 1: {}, 2: {} };
      for (const ev of this.battle.events) this.playEvent(ev);
    } else if (this.phase === 'end' && this.phaseTime > END_TIME) {
      this.phase = 'done';
      this.cameras.main.fadeOut(300, 17, 16, 24);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        const b = this.battle;
        const shieldUsed = {};
        for (const f of b.fighters) if (f.shieldUsed) shieldUsed[f.piece.color] = true;
        this.scene.wake('board', {
          winner: b.winner, reason: b.reason,
          hp: { attacker: Math.ceil(b.attacker.hp), defender: Math.ceil(b.defender.hp) },
          shieldUsed,
        });
        this.scene.stop();
      });
    }
    this.draw();
  }

  fighterOf(player) {
    return this.battle.fighters.find((f) => f.player === player);
  }

  readInputs(dt) {
    const inputs = {};
    for (const p of [1, 2]) {
      if (this.bot?.player === p) { inputs[p] = this.bot.think(dt); continue; }
      if (this.holding[p] !== null) {
        if (!this.router.isDown(p, 'skill')) { this.pressed[p].special = true; this.holding[p] = null; }
        else if ((this.holding[p] += dt) >= ULTIMATE.hold) { this.pressed[p].ultimate = true; this.holding[p] = null; }
      }
      inputs[p] = { ...this.pressed[p], ...this.router.directions(p) };
    }
    return inputs;
  }

  floatText(f, msg, color) {
    const pos = this.toScreen(f);
    const t = this.add.text(pos.x, pos.y - HEAD, msg, text(12, color)).setOrigin(0.5).setStroke('#111018', 3).setDepth(9);
    this.tweens.add({ targets: t, y: pos.y - HEAD - 20, alpha: 0, duration: 650, onComplete: () => t.destroy() });
  }

  ghost(f, at = f, duration = 250) {
    const g = new FighterView(this, this.toScreen(at), f.piece, { body: f.body, ring: false }).face(f.fx).setAlpha(0.5).setDepth(1);
    this.tweens.add({ targets: g, alpha: 0, duration, onComplete: () => g.destroy() });
  }

  ring(at, radius, color) {
    const pos = this.toScreen(at);
    const c = this.add.circle(pos.x, pos.y, radius).setStrokeStyle(2, color).setDepth(2);
    this.tweens.add({ targets: c, scale: 1.4, alpha: 0, duration: 300, onComplete: () => c.destroy() });
  }

  playEvent(ev) {
    const f = ev.fighter;
    switch (ev.type) {
      case 'hit': {
        const ult = this.inUltimate(ev.from);
        this.cameras.main.shake(ult ? 160 : 90, ult ? 0.014 : 0.008);
        this.views[this.battle.fighters.indexOf(ev.to)].flash();
        this.spark(ev.from, ev.to, ult ? sideRamp(ev.from.piece.color) : RAMP[ev.from.player], ult ? FX.critHit : FX.hitSpark);
        this.floatText(ev.to, `-${ev.damage}`, '#ffe08a');
        break;
      }
      case 'blocked':
        this.spark(ev.from, ev.to, RAMP.block);
        this.floatText(ev.to, '막힘!', '#9fd8ff');
        break;
      case 'dash':
      case 'charge':
        this.ghost(f);
        // 폰 돌격 연타 · 룩 파성추: 돌진마다 창끝 같은 섬광
        if ((ev.type === 'dash' ? f.dashSpec : f.chargeSpec) === f.ult) this.ultFx(f, FX.thrust, { angle: Math.atan2(f.fy, f.fx), reach: f.type === 'R' ? 90 : 60 });
        break;
      case 'blink':
        this.ghost(f, ev.from, 350);
        // 비숍 성광: 도착 지점에 빛기둥 (내리꽂히는 순간부터 재생)
        if (this.inUltimate(f)) this.ultFx(f, FX.smite, {}, 0.48);
        break;
      case 'land':
        this.ring(f, f.jumpSpec.landRadius, PLAYER_COLOR[f.player]);
        this.cameras.main.shake(70, 0.005);
        // 나이트 대도약: 땅이 꺼지는 착지
        if (f.jumpSpec === f.ult) { this.ultFx(f, FX.heavyLanding, { palette: SAND_DUST, stone: SAND_STONE }); this.cameras.main.shake(180, 0.014); }
        break;
      case 'wallStun':
        this.cameras.main.shake(120, 0.01);
        break;
      case 'shield':
        this.floatText(f, '실드!', '#9fd8ff');
        break;
      case 'ultimate':
        this.ultimateMoment(f, ev.name);
        break;
      case 'nova':
        // 퀸 여왕의 일섬 = 원형 베기, 킹 왕의 위압 = 바닥을 타고 퍼지는 충격파
        if (f.type === 'Q') this.ultFx(f, FX.spinSlash, { radius: ev.radius });
        else this.ultFx(f, FX.groundSlam, { reach: ev.radius * 2, stone: SAND_STONE });
        this.cameras.main.shake(160, 0.012);
        break;
      case 'end': {
        this.phase = 'end';
        this.phaseTime = 0;
        const winner = this.battle[ev.winner];
        const loser = this.battle.foeOf(winner);
        this.banner.setText(endTitle(ev.winner, this.duel)).setColor(PLAYER_HEX[winner.player]);
        const retreat = ev.reason === 'time';
        this.subBanner.setText(retreat ? '시간 종료 — 둘 다 제자리로' : 'KO');
        const view = this.views[this.battle.fighters.indexOf(loser)];
        // KO = 맞은 쪽 반대로 쓰러짐, 시간 종료 = 흐리게
        if (retreat) view.setAlpha(0.6);
        else { view.fall(loser.x >= winner.x ? 1 : -1); this.knockout(winner, loser); }
        break;
      }
      default:
    }
  }

  inUltimate(f) {
    return this.ultUntil[this.battle.fighters.indexOf(f)] > this.time.now;
  }

  // 필살기 이펙트: 말 발밑 기준, 진영 색 (백 금빛 · 흑 보랏빛)
  ultFx(f, mod, o = {}, start = 0) {
    const pos = this.toScreen(f);
    this.pfx.play(mod, { x: pos.x, y: pos.y + 2, palette: sideRamp(f.piece.color), ...o }, { start });
  }

  // 필살기 발동 (모든 말 공통): 화면이 어두워지고 말만 남음 → 팀 색 띠가 가로질러 이름을 보여 줌 → 말에게서 기운이 터짐
  ultimateMoment(f, name) {
    this.ultUntil[this.battle.fighters.indexOf(f)] = this.time.now + 1600;
    this.ultFx(f, FX.manaBurst);
    const dim = this.add.rectangle(320, 180, 640, 360, 0x000000).setAlpha(0).setDepth(2.9); // 말(3) 바로 아래
    this.tweens.chain({
      targets: dim,
      tweens: [{ alpha: 0.5, duration: 80 }, { alpha: 0.5, duration: 260 }, { alpha: 0, duration: 320 }],
      onComplete: () => dim.destroy(),
    });
    // 이름 띠: 시전한 쪽에서 들어와 반대쪽으로 빠진다
    const from = f.player === 1 ? -1 : 1, y = 132;
    const band = this.add.container(from * 640, 0).setDepth(9);
    const g = this.add.graphics();
    g.fillStyle(0x0b0a10, 0.85).fillRect(0, y - 15, 640, 30);
    g.fillStyle(PLAYER_COLOR[f.player], 0.55).fillRect(0, y - 13, 640, 26);
    g.fillStyle(C.gold).fillRect(0, y - 13, 640, 1).fillRect(0, y + 12, 640, 1);
    band.add(g);
    band.add(this.add.text(320, y, `${PIECE_NAMES[f.type]} · ${name}`, text(15, '#fff6d8', FONT_BIG)).setOrigin(0.5).setStroke('#0b0a10', 4));
    this.tweens.chain({
      targets: band,
      tweens: [
        { x: 0, duration: 140, ease: 'Cubic.easeOut' },
        { x: 0, duration: 520 },
        { x: -from * 640, duration: 160, ease: 'Cubic.easeIn' },
      ],
      onComplete: () => band.destroy(),
    });
  }

  // 맞은 말 위에 타격 불꽃 (때린 방향으로 튐)
  spark(from, to, palette, mod = FX.hitSpark) {
    const pos = this.toScreen(to);
    const aim = Math.atan2(to.y - from.y, to.x - from.x);
    this.pfx.play(mod, { x: pos.x, y: pos.y + to.body, height: to.body + MID, aim, palette }); // 서 있는 말 몸통에
  }

  // KO: 큰 타격 + 쓰러진 말이 연기로 사라짐
  knockout(winner, loser) {
    this.spark(winner, loser, RAMP[winner.player], FX.critHit);
    const pos = this.toScreen(loser);
    this.time.delayedCall(250, () => this.pfx.play(FX.poof, { x: pos.x, y: pos.y + loser.body }));
  }

  // ───────── 그리기 ─────────

  toScreen(f) {
    return { x: ARENA_X + f.x, y: ARENA_Y + f.y };
  }

  drawArena() {
    bakedLayer(this, (g) => this.paintArena(g));
    this.add.text(320, 40, '투기장', text(10, '#a59db3', FONT_SMALL)).setOrigin(0.5, 0);
  }

  paintArena(g) {
    const { w, h } = T.arena;
    const x0 = ARENA_X - w / 2, y0 = ARENA_Y - h / 2;
    g.fillStyle(0x111018).fillRect(0, 0, 640, 360);
    drawBrickWall(g, x0, y0, w, h, 10);
    g.fillStyle(C.sand).fillRect(x0, y0, w, h);
    wallShadow(g, x0, y0, w, h);
    // 모래 바닥 점 무늬
    const rnd = new Phaser.Math.RandomDataGenerator(['arena']);
    g.fillStyle(C.sandDark, 0.6);
    for (let i = 0; i < Math.round(w * h / 500); i++) {
      g.fillRect(Math.floor(ARENA_X - w / 2 + rnd.between(2, w - 4)), Math.floor(ARENA_Y - h / 2 + rnd.between(2, h - 4)), 2, 1);
    }
    // 가운데 문양: 두 겹 원 + 네 방향 눈금
    g.lineStyle(1, C.sandDark).strokeCircle(ARENA_X, ARENA_Y, 40).strokeCircle(ARENA_X, ARENA_Y, 34);
    g.fillStyle(C.sandDark);
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) g.fillRect(ARENA_X + dx * 44 - (dx ? 3 : 0), ARENA_Y + dy * 44 - (dy ? 3 : 0), dx ? 6 : 1, dy ? 6 : 1);
    drawBattleHud(g);
  }

  drawHud() {
    this.hud = {};
    for (const f of this.battle.fighters) {
      const left = f.player === 1;
      const x = left ? 24 : 616;
      const vet = f.piece.vet ? ' ★' : '';
      this.add.text(x, 14, `P${f.player} ${SIDE_NAME[f.piece.color]} ${PIECE_NAMES[f.type]}${vet} · ${ROLE_NAME[f.role]}`,
        text(12, PLAYER_HEX[f.player])).setOrigin(left ? 0 : 1, 0);
      const keys = keyLabels(f.player);
      const help = this.bot?.player === f.player ? '컴퓨터가 조종'
        : `이동 ${keys.move}  공격 ${keys.confirm}  스킬(${SPECIAL_NAME[f.type]}) ${keys.skill} · 길게 = 필살기`;
      this.add.text(x, 326, help, text(10, '#8d8798', FONT_SMALL)).setOrigin(left ? 0 : 1, 0);
      this.hud[f.role] = {
        bar: this.add.graphics(),
        hp: this.add.text(left ? x + 164 : x - 164, 32, '', text(10, '#d8d2c4', FONT_SMALL)).setOrigin(left ? 0 : 1, 0),
        special: this.add.text(left ? x + 164 : x - 164, 44, '', text(10, '#8d8798', FONT_SMALL)).setOrigin(left ? 0 : 1, 0),
        ult: this.add.text(left ? x + 222 : x - 222, 16, '', text(10, '#8d8798', FONT_SMALL)).setOrigin(left ? 1 : 0, 0),
        x: left ? x : x - 160,
      };
    }
    this.timer = this.add.text(320, 16, '', text(15, '#f2ead8', FONT_BIG)).setOrigin(0.5, 0);
  }

  // 특수기 상태 글자와 게이지 (킹 실드는 1회용이라 따로)
  specialState(f) {
    const name = SPECIAL_NAME[f.type];
    if (f.mv.special.kind === 'shield') {
      if (f.shieldTime > 0) return { label: `${name} 켜짐`, ready: true, progress: f.shieldTime / f.mv.special.time };
      if (f.shieldReady && !f.shieldUsed) return { label: `${name} 1회 남음`, ready: true, progress: 1 };
      return { label: `${name} 사용함`, ready: false, progress: 0 };
    }
    const ready = f.specialCd <= 0;
    return { label: ready ? `${name} 준비` : `${name} ${f.specialCd.toFixed(1)}`, ready, progress: specialProgress(f) };
  }

  draw() {
    const b = this.battle;
    for (const f of b.fighters) {
      const h = this.hud[f.role];
      h.bar.clear();
      h.bar.fillStyle(0x3a3746).fillRect(h.x, 33, 160, 8);
      h.bar.fillStyle(PLAYER_COLOR[f.player]).fillRect(h.x, 33, Math.round(160 * f.hp / f.maxHp), 8);
      h.hp.setText(`${Math.ceil(f.hp)}/${f.maxHp}`);
      // 특수기 쿨타임 바: 차오르는 중이면 회색, 다 차면 노란색
      const s = this.specialState(f);
      h.bar.fillStyle(0x3a3746).fillRect(h.x, 46, 160, 4);
      h.bar.fillStyle(s.ready ? READY : CHARGING).fillRect(h.x, 46, Math.round(160 * s.progress), 4);
      setLabel(h.special, s.label, s.ready ? '#ffe08a' : '#8d8798');
      setLabel(h.ult, f.ultUsed ? '필살기 사용함' : '필살기 준비', f.ultUsed ? '#5a5566' : '#ffe08a');
    }
    setLabel(this.timer, b.deathmatch ? '결전' : String(Math.ceil(b.timeLeft)), b.timeLeft <= 3 && this.phase === 'fight' ? '#ff6a5a' : '#f2ead8');

    const g = this.fx.clear();
    const top = this.top.clear();

    // 투사체
    for (const p of b.projectiles) {
      const col = PLAYER_COLOR[p.owner.player];
      g.fillStyle(col).fillCircle(ARENA_X + p.x, ARENA_Y + p.y, p.radius);
      g.fillStyle(0xffffff, 0.8).fillCircle(ARENA_X + p.x, ARENA_Y + p.y, Math.max(1, p.radius - 2));
    }

    b.fighters.forEach((f, i) => {
      const pos = this.toScreen(f);
      const view = this.views[i];
      const col = PLAYER_COLOR[f.player];

      // 점프: 발밑 링은 바닥에 남아 그림자가 되고, 말만 떠오름
      let lift = 0;
      if (f.jumpTime > 0) {
        const t = 1 - f.jumpTime / f.jumpSpec.time;
        lift = Math.sin(t * Math.PI) * 18;
      }
      if (this.phase !== 'end' && this.phase !== 'done') {
        view.face(f.fx).place(pos.x, pos.y, { lift, lean: f.attackTime > 0 ? f.fx : 0, dt: this.dt });
        view.setDepth(3 + pos.y / 1000); // 아래쪽 말이 앞에
      }
      // 맞은 직후 깜빡임 (대시·순간이동 무적은 깜빡이지 않음)
      if (this.phase === 'fight') {
        const blink = f.invuln > 0 && f.dashTime <= 0 && f.jumpTime <= 0 && Math.floor(f.invuln * 20) % 2;
        view.setAlpha(blink ? 0.3 : 1);
      }

      // 바라보는 방향
      const r = f.body + 6;
      const tipX = pos.x + f.fx * r, tipY = pos.y - lift + f.fy * r;
      const px = -f.fy * 4, py = f.fx * 4;
      g.fillStyle(col).fillTriangle(tipX + f.fx * 4, tipY + f.fy * 4, tipX + px, tipY + py, tipX - px, tipY - py);

      // 특수기 충전 중이면 말 아래 작은 바
      const s = this.specialState(f);
      if (!s.ready && f.mv.special.kind !== 'shield') {
        g.fillStyle(0x111018, 0.7).fillRect(pos.x - 11, pos.y + f.body + 5, 22, 3);
        g.fillStyle(CHARGING).fillRect(pos.x - 11, pos.y + f.body + 5, Math.round(22 * s.progress), 3);
      }
      // 스킬 키를 누르고 있으면 필살기 충전 원 (다 차면 발동)
      const held = this.holding[f.player];
      if (held !== null && this.phase === 'fight' && held > 0.12) {
        const t = Math.min(1, held / ULTIMATE.hold);
        top.lineStyle(2, 0xffe08a, 0.4 + t * 0.6).beginPath()
          .arc(pos.x, pos.y - MID, f.body + 10, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2).strokePath();
      }
      // 근접 공격 판정
      if (f.attackTime > 0) {
        const hp = b.hitPoint(f);
        const rad = f.mv.attack.radius;
        g.fillStyle(0xffffff, 0.55).fillCircle(ARENA_X + hp.x, ARENA_Y + hp.y, rad);
        g.lineStyle(2, col).strokeCircle(ARENA_X + hp.x, ARENA_Y + hp.y, rad);
      }
      // 실드
      if (f.shieldTime > 0) {
        top.lineStyle(2, 0x9fd8ff, 0.9).strokeCircle(pos.x, pos.y - MID, f.body + 8);
        top.fillStyle(0x9fd8ff, 0.18).fillCircle(pos.x, pos.y - MID, f.body + 8);
      }
      // 기절
      this.stunText[i].setVisible(f.stun > 0).setPosition(pos.x, pos.y - HEAD);
    });
  }
}
