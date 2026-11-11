import { TurnBattle, ACTIONS, ACTION_LABEL } from '../logic/turnBattle.js';
import { chooseTurnAction } from '../logic/ai.js';
import { TURN } from '../logic/balance.js';
import { PIECE_NAMES } from '../logic/chess.js';
import { InputRouter, keyLabels } from '../input/controls.js';
import { FONT_SMALL, FONT_BIG, text, PLAYER_COLOR, PLAYER_HEX, SIDE_NAME, makePiece, endTitle } from '../ui/style.js';

const ROLE_NAME = { attacker: '공격', defender: '수비' };
const KEY_ACTION = { turnAttack: 'attack', turnDefend: 'defend', turnSkill: 'skill', turnFocus: 'focus', turnHeal: 'heal' };
const SPOT_X = { 1: 190, 2: 450 }; // 백(P1) 왼쪽, 흑(P2) 오른쪽
const SPOT_Y = 160;
const INTRO_TIME = 1.4;
const REVEAL_FIRST_TIME = 1.0;
const RESULT_TIME = 2.4;
const END_TIME = 1.8;
const STONE = 0x8c8f99, STONE_DARK = 0x6c6f79, STONE_LINE = 0x5a5c66;

// 턴제 전투 화면 (성채). 로직은 logic/turnBattle.js, 여기는 입력·진행·그리기.
// 진행: intro → pick (3초 동안 둘 다 몰래 고름, 마지막 입력만 유효) → result → 다음 턴 … → end
//   나이트 '허를 찌름' 다음 턴: pickFirst(공개될 쪽만) → showFirst → pickSecond(나이트 쪽)
export class TurnBattleScene extends Phaser.Scene {
  constructor() {
    super('turnbattle');
  }

  // data = { attacker, defender (판 위 기물), bot: { player, level } | null }
  create(data) {
    this.duel = Boolean(data.duel);
    this.battle = new TurnBattle(data.attacker, data.defender, { deathmatch: this.duel });
    this.bot = data.bot || null;
    this.lastChoice = { 1: null, 2: null };
    this.phase = 'intro';
    this.phaseTime = 0;

    new InputRouter(this, ({ player, action, repeat }) => {
      if (repeat || !KEY_ACTION[action]) return;
      this.choose(player, KEY_ACTION[action]);
    });

    this.drawHall();
    this.views = {};
    for (const f of this.battle.fighters) {
      this.views[f.player] = makePiece(this, { x: SPOT_X[f.player], y: SPOT_Y }, f.piece, 12).setScale(2);
    }
    this.drawHud();
    this.choiceText = {};
    this.readyText = {};
    this.menus = {};
    for (const f of this.battle.fighters) {
      const x = SPOT_X[f.player];
      // 공개된 선택은 말 아래에 (위쪽은 피해 숫자 자리)
      this.choiceText[f.player] = this.add.text(x, SPOT_Y + 32, '', { ...text(15, '#f2ead8', FONT_BIG), align: 'center' }).setOrigin(0.5, 0).setStroke('#111018', 4);
      this.readyText[f.player] = this.add.text(x, SPOT_Y + 34, '', text(10, '#8d8798', FONT_SMALL)).setOrigin(0.5, 0).setStroke('#111018', 3);
      this.menus[f.player] = this.add.text(x, SPOT_Y + 50, '', { ...text(10, '#f2ead8', FONT_SMALL), lineSpacing: 2, align: 'left' }).setOrigin(0.5, 0).setStroke('#111018', 3);
    }
    this.timerBar = this.add.graphics();
    // 결과 설명은 두 말 사이에
    this.center = this.add.text(320, SPOT_Y, '', { ...text(10, '#f2ead8', FONT_SMALL), align: 'center', lineSpacing: 3, wordWrap: { width: 190 } }).setOrigin(0.5).setStroke('#111018', 3);
    this.banner = this.add.text(320, SPOT_Y, '', text(15, '#f2ead8', FONT_BIG)).setOrigin(0.5).setDepth(10).setStroke('#111018', 4);
    this.add.text(320, 326, '공격 → 스킬·회복 끊음 · 방어 → 공격 막고 반격 · 스킬 → 방어 뚫음 · 같은 행동 연속 불가(공격 제외)',
      text(10, '#8d8798', FONT_SMALL)).setOrigin(0.5, 0);

    const [a, d] = this.battle.fighters;
    this.banner.setText(`${PIECE_NAMES[a.type]} VS ${PIECE_NAMES[d.type]}`);
    this.cameras.main.fadeIn(300, 17, 16, 24);
    this.refresh();
  }

  update(_time, deltaMs) {
    const dt = Math.min(deltaMs / 1000, 1 / 20);
    this.phaseTime += dt;
    const p = this.phase;
    if (p === 'intro' && this.phaseTime > INTRO_TIME) this.startTurn();
    else if ((p === 'pick' || p === 'pickFirst' || p === 'pickSecond') && this.phaseTime > TURN.pickTime) this.endPick();
    else if (p === 'showFirst' && this.phaseTime > REVEAL_FIRST_TIME) this.setPhase('pickSecond');
    else if (p === 'result' && this.phaseTime > RESULT_TIME) {
      if (this.battle.finished) this.showEnd();
      else this.startTurn();
    } else if (p === 'end' && this.phaseTime > END_TIME) this.leave();
    this.drawTimer();
  }

  // ───────── 진행 ─────────

  setPhase(phase) {
    this.phase = phase;
    this.phaseTime = 0;
    if (this.bot && this.picking(this.bot.player)) this.scheduleBot();
    this.refresh();
  }

  startTurn() {
    this.banner.setText('');
    this.center.setText('');
    this.choice = { 1: null, 2: null };
    for (const p of [1, 2]) this.choiceText[p].setText('');
    const first = this.battle.revealedFirst();
    this.firstPlayer = first ? first.player : null;
    this.setPhase(first ? 'pickFirst' : 'pick');
  }

  // 지금 이 플레이어가 고르는 중인가
  picking(player) {
    if (this.phase === 'pick') return true;
    if (this.phase === 'pickFirst') return player === this.firstPlayer;
    if (this.phase === 'pickSecond') return player !== this.firstPlayer;
    return false;
  }

  fighterOf(player) {
    return this.battle.fighters.find((f) => f.player === player);
  }

  choose(player, action) {
    if (!this.picking(player) || this.bot?.player === player) return;
    if (!this.battle.options(this.fighterOf(player)).includes(action)) return;
    this.choice[player] = action; // 마지막 입력만 유효
    this.refresh();
  }

  scheduleBot() {
    const player = this.bot.player;
    const f = this.fighterOf(player);
    const foeShown = this.phase === 'pickSecond' ? this.choice[this.foeOfPlayer(player)] : null;
    this.time.delayedCall(500 + Math.random() * 1500, () => {
      if (!this.picking(player)) return;
      this.choice[player] = chooseTurnAction(this.battle, f, this.bot.level, foeShown, this.lastChoice[this.foeOfPlayer(player)]);
      this.refresh();
    });
  }

  foeOfPlayer(player) {
    return player === 1 ? 2 : 1;
  }

  endPick() {
    if (this.phase === 'pickFirst') {
      // 먼저 고른 쪽 공개
      const p = this.firstPlayer;
      this.choice[p] = this.battle.normalize(this.fighterOf(p), this.choice[p]);
      this.choiceText[p].setText(ACTION_LABEL[this.choice[p]]);
      this.center.setText(`허를 찔렸다! P${p}의 선택이 먼저 공개됩니다`);
      this.setPhase('showFirst');
      return;
    }
    this.resolveTurn();
  }

  resolveTurn() {
    const b = this.battle;
    const choices = {};
    for (const f of b.fighters) choices[f.role] = this.choice[f.player];
    const report = b.resolve(choices);
    for (const f of b.fighters) {
      const s = report.side[f.role];
      this.lastChoice[f.player] = s.choice;
      this.choiceText[f.player].setText(ACTION_LABEL[s.choice] + (s.choice === 'skill' ? `\n${f.skill.name}` : ''))
        .setColor(s.cut ? '#8d8798' : PLAYER_HEX[f.player]);
    }
    this.center.setText(this.describe(report));
    // 피해 숫자
    for (const f of b.fighters) {
      const s = report.side[f.role];
      const target = this.foeOfPlayer(f.player);
      s.hits.forEach((dmg, i) => this.time.delayedCall(350 + i * 250, () => this.floatDamage(target, dmg)));
      if (s.healed) this.time.delayedCall(500, () => this.floatText(f.player, `+${s.healed}`, '#6fd36f'));
    }
    this.setPhase('result');
  }

  // 결과 설명 (가운데 글자)
  describe(report) {
    const lines = [`턴 ${report.turn}`];
    for (const f of this.battle.fighters) {
      const s = report.side[f.role];
      const who = `P${f.player}`;
      if (s.blocked) lines.push(`${who} 방어 성공!`);
      if (s.countered) lines.push(`${who} 반격`);
      if (s.pierced) lines.push(`${who} 스킬이 방어를 뚫음!`);
      for (const e of s.effects) lines.push(`${who} ${e}`);
    }
    if (lines.length === 1) lines.push(report.side.attacker.dealt + report.side.defender.dealt ? '서로 맞붙었다' : '아무 일도 없었다');
    return lines.join('\n');
  }

  floatText(player, msg, color) {
    const v = this.views[player];
    const t = this.add.text(v.x, v.y - 30, msg, text(12, color)).setOrigin(0.5).setStroke('#111018', 3).setDepth(9);
    this.tweens.add({ targets: t, y: v.y - 54, alpha: 0, duration: 700, onComplete: () => t.destroy() });
    this.refresh();
  }

  floatDamage(player, dmg) {
    this.cameras.main.shake(90, 0.006);
    this.tweens.add({ targets: this.views[player], alpha: 0.3, duration: 80, yoyo: true, repeat: 1 });
    this.floatText(player, `-${dmg}`, '#ffe08a');
  }

  showEnd() {
    const b = this.battle;
    const winner = b[b.winner];
    this.banner.setText(endTitle(b.winner, this.duel)).setColor(PLAYER_HEX[winner.player]);
    this.center.setText(b.reason === 'ko' ? 'KO' : `${TURN.maxTurns}턴 종료 — 둘 다 제자리로`);
    for (const p of [1, 2]) this.choiceText[p].setText('');
    const loser = b.foeOf(winner);
    this.views[loser.player].setAlpha(b.reason === 'ko' ? 0.25 : 0.6);
    this.setPhase('end');
  }

  leave() {
    this.phase = 'done';
    this.cameras.main.fadeOut(300, 17, 16, 24);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      const b = this.battle;
      this.scene.wake('board', {
        winner: b.winner, reason: b.reason,
        hp: { attacker: b.boardHp(b.attacker), defender: b.boardHp(b.defender) },
        shieldUsed: {},
      });
      this.scene.stop();
    });
  }

  // ───────── 그리기 ─────────

  drawHall() {
    const g = this.add.graphics();
    g.fillStyle(0x111018).fillRect(0, 0, 640, 360);
    const x0 = 40, y0 = 70, w = 560, h = 240;
    g.fillStyle(STONE_LINE).fillRect(x0 - 4, y0 - 4, w + 8, h + 8);
    // 돌바닥 타일
    for (let y = y0; y < y0 + h; y += 20) {
      for (let x = x0; x < x0 + w + 40; x += 40) {
        const off = ((y - y0) / 20) % 2 ? 20 : 0;
        const bx = x + off - 20;
        const left = Math.max(x0, bx), right = Math.min(x0 + w, bx + 40);
        if (right <= left) continue;
        g.fillStyle(((x + y) / 20) % 3 ? STONE : STONE_DARK).fillRect(left, y, right - left - 1, 19);
      }
    }
    this.add.text(320, 40, '성채', text(10, '#8d8798', FONT_SMALL)).setOrigin(0.5, 0);
  }

  drawHud() {
    this.hud = {};
    for (const f of this.battle.fighters) {
      const left = f.player === 1;
      const x = left ? 24 : 616;
      const vet = f.piece.vet ? ' ★' : '';
      this.add.text(x, 14, `P${f.player} ${SIDE_NAME[f.piece.color]} ${PIECE_NAMES[f.type]}${vet} · ${ROLE_NAME[f.role]}`,
        text(12, PLAYER_HEX[f.player])).setOrigin(left ? 0 : 1, 0);
      this.hud[f.player] = {
        bar: this.add.graphics(),
        hp: this.add.text(left ? x + 164 : x - 164, 32, '', text(10, '#d8d2c4', FONT_SMALL)).setOrigin(left ? 0 : 1, 0),
        status: this.add.text(x, 44, '', text(10, '#ffe08a', FONT_SMALL)).setOrigin(left ? 0 : 1, 0),
        x: left ? x : x - 160,
      };
    }
    this.turnText = this.add.text(320, 16, '', text(15, '#f2ead8', FONT_BIG)).setOrigin(0.5, 0);
  }

  refresh() {
    const b = this.battle;
    this.turnText.setText(b.deathmatch ? `턴 ${b.turn} · 결전` : `턴 ${Math.min(b.turn, TURN.maxTurns)}/${TURN.maxTurns}`);
    for (const f of b.fighters) {
      const p = f.player;
      const h = this.hud[p];
      h.bar.clear();
      h.bar.fillStyle(0x3a3746).fillRect(h.x, 33, 160, 8);
      h.bar.fillStyle(PLAYER_COLOR[p]).fillRect(h.x, 33, Math.round(160 * f.hp / f.maxHp), 8);
      h.hp.setText(`${f.hp}/${f.maxHp}`);
      const st = [];
      if (f.curse > 0) st.push(`저주 ${f.curse}턴`);
      if (f.sealed) st.push(`${ACTION_LABEL[f.sealed]} 봉인`);
      if (f.foresight) st.push('상대 선택을 먼저 봄');
      if (f.focused) st.push('집중: 피해 2배');
      h.status.setText(st.join(' · '));

      // 고르는 메뉴 (고른 내용은 숨기고 준비 완료만 표시)
      const isBot = this.bot?.player === p;
      const picking = this.picking(p);
      const opts = b.options(f);
      const keys = keyLabels(p).turn;
      const line = (a, i) => {
        const name = a === 'skill' ? `스킬: ${f.skill.name}` : a === 'heal' ? `회복 (${f.healsLeft}회 남음)` : ACTION_LABEL[a];
        const why = !opts.includes(a) ? (a === f.sealed ? ' (봉인)' : a === 'heal' && f.healsLeft <= 0 ? '' : ' (연속 불가)') : '';
        return `${keys[i]}  ${name}${why}`;
      };
      // 고르는 동안만 메뉴를 보여준다 (결과 때는 그 자리에 공개된 선택이 나옴)
      const showMenu = picking || this.phase === 'intro' || (this.phase === 'pickFirst' || this.phase === 'showFirst');
      this.menus[p].setText(isBot ? '컴퓨터가 고르는 중' : ACTIONS.map(line).join('\n'))
        .setVisible(showMenu && !this.choiceText[p].text).setAlpha(picking || this.phase === 'intro' ? 1 : 0.35);
      let ready = '';
      if (picking) ready = this.choice?.[p] ? '준비 완료 ✓' : '고르는 중…';
      else if (this.phase === 'pickFirst') ready = '상대가 먼저 고르는 중';
      this.readyText[p].setText(ready).setColor(this.choice?.[p] && picking ? '#6fd36f' : '#d8d2c4');
    }
  }

  drawTimer() {
    const g = this.timerBar.clear();
    if (!['pick', 'pickFirst', 'pickSecond'].includes(this.phase)) return;
    const left = Math.max(0, 1 - this.phaseTime / TURN.pickTime);
    g.fillStyle(0x3a3746).fillRect(220, 78, 200, 6);
    g.fillStyle(left < 0.34 ? 0xff6a5a : 0xffe08a).fillRect(220, 78, Math.round(200 * left), 6);
  }
}
