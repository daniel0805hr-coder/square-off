// 턴제 전투 (성채) — 화면·키보드와 무관한 순수 로직.
// 매 턴 options()로 고를 수 있는 행동을 확인하고, resolve({ attacker, defender })로 한 턴을 처리한다.
// 행동: 'attack' | 'defend' | 'skill' | 'focus' | 'heal'
// 턴제에서는 HP를 TURN.hpMul배로 늘려서 싸우고, 끝나면 boardHp()로 판 위 HP로 되돌린다.
// 최대 턴까지 KO가 없으면 남은 HP 비율로 판정. 서든데스 턴부터는 피해가 매 턴 커진다.

import { TOPDOWN, TURN, TURN_SKILLS } from './balance.js';
import { WHITE } from './chess.js';
import { maxHp, currentHp, attackStat } from './units.js';

export const ACTIONS = ['attack', 'defend', 'skill', 'focus', 'heal'];
export const ACTION_LABEL = { attack: '공격', defend: '방어', skill: '스킬', focus: '집중', heal: '회복' };

function makeFighter(piece, role) {
  return {
    role, piece, type: piece.type,
    player: piece.color === WHITE ? 1 : 2,
    hp: Math.round(currentHp(piece) * TURN.hpMul), maxHp: Math.round(maxHp(piece) * TURN.hpMul),
    D: Math.round((TOPDOWN.damageBase + attackStat(piece)) * TURN.damageMul),
    skill: TURN_SKILLS[piece.type],
    skillCd: 0, skillUsed: false,
    defendCd: 0,            // 방어를 쓴 다음 턴은 방어 불가
    focusCd: 0, focused: false, // focused = 이번 턴 피해 2배 (직전 턴에 집중함)
    healCd: 0, healsLeft: TURN.healUses,
    curse: 0, curseMul: 1,  // 저주: 남은 턴, 피해 배율
    sealed: null,           // 이번 턴 못 고르는 행동 (킹 위엄)
    foresight: false,       // 이번 턴 상대가 먼저 고르고 공개됨 (나이트 허를 찌름)
  };
}

export class TurnBattle {
  // opts.deathmatch: 킹 결전 — 턴 제한 없이 한쪽이 쓰러질 때까지
  constructor(attacker, defender, opts = {}) {
    this.deathmatch = Boolean(opts.deathmatch);
    this.fighters = [makeFighter(attacker, 'attacker'), makeFighter(defender, 'defender')];
    this.turn = 1;
    this.winner = null; // 'attacker' | 'defender'
    this.reason = null; // 'ko' | 'time'
  }

  get attacker() { return this.fighters[0]; }
  get defender() { return this.fighters[1]; }
  get finished() { return this.winner !== null; }
  foeOf(f) { return f === this.fighters[0] ? this.fighters[1] : this.fighters[0]; }

  // 이번 턴에 고를 수 있는 행동
  options(f) {
    const opts = ACTIONS.filter((a) => {
      if (a === f.sealed) return false;
      if (a === 'skill') return f.skillCd <= 0 && !(f.skill.once && f.skillUsed);
      if (a === 'defend') return f.defendCd <= 0;
      if (a === 'focus') return f.focusCd <= 0;
      if (a === 'heal') return f.healCd <= 0 && f.healsLeft > 0;
      return true;
    });
    return opts.length ? opts : ['attack']; // 다 막히면 공격은 항상 가능
  }

  // 서든데스: 이번 턴 피해 배율 (킹 결전도 똑같이 적용 — 무한히 끌지 않도록)
  get suddenMul() {
    return 1 + Math.max(0, this.turn - TURN.suddenDeathFrom + 1) * TURN.suddenDeathStep;
  }

  // 판 위로 돌아갈 HP (살아 있으면 최소 1)
  boardHp(f) {
    return f.hp > 0 ? Math.max(1, Math.round(f.hp / TURN.hpMul)) : 0;
  }

  // 이번 턴에 먼저 골라서 공개해야 하는 쪽 (상대가 나이트 스킬을 성공했을 때)
  revealedFirst() {
    const seer = this.fighters.find((f) => f.foresight);
    return seer ? this.foeOf(seer) : null;
  }

  // 고르지 않았거나 못 고르는 행동이면 방어 (방어를 못 쓰면 공격)
  normalize(f, choice) {
    const opts = this.options(f);
    if (opts.includes(choice)) return choice;
    return opts.includes('defend') ? 'defend' : 'attack';
  }

  // 한 턴 처리. 결과 보고서를 돌려준다 (화면 연출용)
  resolve(choices) {
    const [a, d] = this.fighters;
    const pick = { attacker: this.normalize(a, choices.attacker), defender: this.normalize(d, choices.defender) };
    const side = {};
    for (const f of this.fighters) {
      const c = pick[f.role], o = pick[this.foeOf(f).role];
      const skillOn = c === 'skill';
      const cut = skillOn && o === 'attack' && f.skill.cuttable !== false;
      side[f.role] = {
        choice: c, cut,
        skillActive: skillOn && !cut,
        wall: skillOn && !cut && Boolean(f.skill.wall),
        combo: skillOn && Boolean(f.skill.combo),
        hits: [], effects: [], blocked: false, countered: false,
      };
    }
    // 피해 계산 (동시에 적용)
    const sudden = this.suddenMul;
    for (const f of this.fighters) {
      const me = side[f.role], foe = this.foeOf(f), them = side[foe.role];
      const mul = (f.curse > 0 ? f.curseMul : 1) * (f.focused ? TURN.focusMul : 1) * sudden;
      const hit = (x) => me.hits.push(Math.max(1, Math.round(f.D * x * mul)));
      const foeBlocks = them.choice === 'defend' || them.combo;
      if (me.choice === 'attack') {
        if (foeBlocks) them.blocked = true;
        else hit(1);
      } else if (me.combo) {
        hit(f.skill.comboDmg ?? 1); // 공격 부분 — 스킬이라 방어를 뚫는다
        if (them.choice === 'attack') { hit(TURN.counterMul); me.countered = true; }
      } else if (me.choice === 'defend') {
        if (them.choice === 'attack') { hit(TURN.counterMul); me.countered = true; }
      } else if (me.skillActive && f.skill.dmg > 0) {
        // 방어를 뚫으면 추가 피해
        const pierce = them.choice === 'defend' ? TURN.pierceMul : 1;
        if (pierce > 1) me.pierced = true;
        for (let i = 0; i < (f.skill.hits || 1); i++) hit(f.skill.dmg * pierce);
      }
    }
    for (const f of this.fighters) {
      const me = side[f.role], them = side[this.foeOf(f).role];
      if (them.wall && me.hits.length) { me.hits = []; them.effects.push('성벽이 모든 피해를 막음'); }
    }
    for (const f of this.fighters) {
      const dealt = side[f.role].hits.reduce((s, x) => s + x, 0);
      const foe = this.foeOf(f);
      foe.hp = Math.max(0, foe.hp - dealt);
      side[f.role].dealt = dealt;
    }
    // 회복 (공격받으면 끊김, 쓰러졌으면 소용없음)
    for (const f of this.fighters) {
      const me = side[f.role], them = side[this.foeOf(f).role];
      if (me.choice !== 'heal') continue;
      f.healsLeft--;
      if (them.choice === 'attack' || them.combo) { me.effects.push('회복이 공격에 끊김'); continue; }
      if (f.hp <= 0) continue;
      const before = f.hp;
      f.hp = Math.min(f.maxHp, f.hp + Math.round(f.maxHp * TURN.healRatio));
      me.healed = f.hp - before;
      me.effects.push(`회복 +${me.healed}`);
    }

    // 상태 갱신: 저주·봉인·예지·스킬 쿨타임
    const next = new Map(this.fighters.map((f) => [f, { sealed: null, foresight: false, focused: false }]));
    for (const f of this.fighters) {
      const me = side[f.role], foe = this.foeOf(f), them = side[foe.role];
      if (f.curse > 0) f.curse--;
      if (me.choice === 'skill') {
        f.skillCd = TURN.skillCooldown;
        f.skillUsed = true;
      } else {
        f.skillCd = Math.max(0, f.skillCd - 1);
      }
      f.defendCd = me.choice === 'defend' ? TURN.defendCooldown : Math.max(0, f.defendCd - 1);
      f.focusCd = me.choice === 'focus' ? TURN.focusCooldown : Math.max(0, f.focusCd - 1);
      f.healCd = me.choice === 'heal' ? TURN.healCooldown : Math.max(0, f.healCd - 1);
      if (me.choice === 'focus') { next.get(f).focused = true; me.effects.push(`집중! 다음 턴 피해 ${TURN.focusMul}배`); }
      if (me.cut) me.effects.push('스킬이 공격에 끊김');
      if (!me.skillActive) continue;
      if (f.skill.foresight) { next.get(f).foresight = true; me.effects.push('다음 턴 상대의 선택을 먼저 봄'); }
      if (f.skill.curseTurns) { foe.pendingCurse = f.skill; me.effects.push(`저주: ${f.skill.curseTurns}턴 동안 상대 피해 감소`); }
      if (f.skill.seal) { next.get(foe).sealed = them.choice; me.effects.push(`다음 턴 상대 '${ACTION_LABEL[them.choice]}' 봉인`); }
    }
    for (const f of this.fighters) {
      if (f.pendingCurse) { f.curse = f.pendingCurse.curseTurns; f.curseMul = f.pendingCurse.curseMul; delete f.pendingCurse; }
      Object.assign(f, next.get(f));
    }

    const report = { turn: this.turn, side, sudden };
    // 끝났는가
    if (a.hp <= 0 || d.hp <= 0) {
      // 동시에 쓰러지면 수비자 승리 (HP 1로 버팀)
      if (d.hp <= 0 && a.hp > 0) this.finish('attacker', 'ko');
      else { if (d.hp <= 0) d.hp = 1; this.finish('defender', 'ko'); }
    } else if (!this.deathmatch && this.turn >= TURN.maxTurns) {
      // 판정: 남은 HP 비율이 높은 쪽 승리, 동률이면 방어자 (공격자 판정승 = 잡기 성공, 방어자 판정승 = 둘 다 제자리)
      this.finish(a.hp / a.maxHp > d.hp / d.maxHp ? 'attacker' : 'defender', 'time');
    }
    this.turn++;
    return report;
  }

  finish(winner, reason) {
    this.winner = winner;
    this.reason = reason;
  }
}
