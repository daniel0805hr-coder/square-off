// 테스트용 컴퓨터 상대 (기획서 10장: AI는 개발 테스트용). 화면과 무관한 순수 로직.

import { isAttacked, opponent } from './chess.js';
import { STATS } from './balance.js';
import { currentHp, attackStat } from './units.js';
import { bfs, cellOf, cellCenter } from './chase.js';

const VALUE = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 20 };
// 남은 HP(눈금) + 공격 + 속도
const power = (piece) => currentHp(piece) / 10 + attackStat(piece) + STATS[piece.type].spd;

// 잡기 = 전투이므로 확실한 이득이 아니다. 스탯 합 차이로 대충 승률을 어림한다.
export function captureWinChance(attacker, defender) {
  return Math.min(0.9, Math.max(0.1, 0.5 + (power(attacker) - power(defender)) * 0.06));
}

// 체스판에서 둘 수 고르기. 한 수 앞만 보는 단순한 방식 + 약간의 무작위.
export function chooseChessMove(game, rng = Math.random) {
  const moves = game.allLegalMoves();
  if (!moves.length) return null;
  const me = game.turn, enemy = opponent(me);
  let best = null, bestScore = -Infinity;

  for (const m of moves) {
    const after = game.boardAfter(m, 'Q');
    let score = rng() * 0.3;
    if (m.captured) {
      const p = captureWinChance(m.piece, m.captured);
      // 지면 공격한 말을 잃거나(KO) 그냥 제자리(시간 종료) → 손실은 절반 정도로 본다
      score += p * VALUE[m.captured.type] - (1 - p) * VALUE[m.piece.type] * 0.5;
    }
    // 도착한 칸이 상대에게 공격받으면 위험
    if (isAttacked(after, m.to.r, m.to.c, enemy)) score -= VALUE[m.piece.type] * 0.6;
    // 원래 칸이 공격받고 있었다면 피하는 게 이득
    if (isAttacked(game.board, m.from.r, m.from.c, enemy)) score += VALUE[m.piece.type] * 0.3;
    if (m.promotion) score += 8;
    if (game.inCheck(enemy, after)) score += 0.4;
    // 중앙 선호, 초반 킹은 가만히
    score += (3.5 - Math.abs(3.5 - m.to.c)) * 0.05 + (3.5 - Math.abs(3.5 - m.to.r)) * 0.05;
    if (m.piece.type === 'K' && !m.castle) score -= 0.3;
    if (m.castle) score += 0.5;
    // 체크메이트면 무조건
    if (!m.captured && game.inCheck(enemy, after) && isMateAfter(game, m)) score += 1000;

    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best;
}

function isMateAfter(game, move) {
  const saved = { board: game.board, turn: game.turn, epSquare: game.epSquare, castling: game.castling };
  game.board = game.boardAfter(move, 'Q');
  game.turn = opponent(game.turn);
  game.epSquare = null;
  const mate = game.allLegalMoves().length === 0;
  Object.assign(game, saved);
  return mate;
}

// 전투 봇 난이도
export const BOT_LEVELS = {
  easy: { name: '쉬움', think: 0.3, attackChance: 0.45, dodgeChance: 0.08 },
  normal: { name: '보통', think: 0.12, attackChance: 0.85, dodgeChance: 0.3 },
};

// 탑다운 전투에서 한 플레이어를 대신 조종한다. think()가 그 플레이어의 입력을 돌려준다.
export class BattleBot {
  constructor(battle, player, level = 'normal', rng = Math.random) {
    this.battle = battle;
    this.player = player;
    this.cfg = BOT_LEVELS[level];
    this.rng = rng;
    this.timer = 0;
    this.hold = {}; // 다음 판단까지 유지할 이동 입력
  }

  think(dt) {
    const b = this.battle;
    const me = b.fighters.find((f) => f.player === this.player);
    const foe = b.foeOf(me);
    this.timer -= dt;
    if (this.timer > 0) return { ...this.hold };
    this.timer = this.cfg.think * (0.7 + this.rng() * 0.6);

    const dx = foe.x - me.x, dy = foe.y - me.y;
    const dist = Math.hypot(dx, dy) || 1;
    const atk = me.mv.attack, sp = me.mv.special;
    const reach = atk.kind === 'melee' ? atk.reach + atk.radius + foe.body : 0;
    const toward = toKeys(dx, dy);
    const facing = (me.fx * dx + me.fy * dy) / dist;
    const chance = (p) => this.rng() < p;
    let input = {};

    // 이동: 비숍은 거리를 두고 8방향 직선 위에 서려고 한다, 나머지는 다가간다
    if (me.type === 'B') {
      const off = Math.abs(dx) - Math.abs(dy);
      if (dist < 80) input = toKeys(-dx, -dy);
      else if (Math.abs(off) > 12) input = off > 0 ? toKeys(dx, 0) : toKeys(0, dy);
    } else if (dist > reach * 0.7) {
      input = { ...toward };
    } else if (chance(0.5)) {
      input = { ...toward };
    }

    // 위협받으면 피한다 (실드 / 점프 / 순간이동 / 대시)
    const threatened = (dist < 60 && (foe.attackTime > 0 || foe.attackCd < 0.1 || foe.chargeTime > 0))
      || b.projectiles.some((p) => p.owner === foe && Math.hypot(p.x - me.x, p.y - me.y) < 50);
    if (threatened && me.specialCd <= 0 && chance(this.cfg.dodgeChance)) {
      if (sp.kind === 'shield') {
        if (me.shieldReady && !me.shieldUsed && me.hp < me.maxHp * 0.6) return { special: true };
      } else if (sp.kind !== 'charge') {
        const side = chance(0.5) ? 1 : -1;
        return { ...toKeys(-dy * side - dx * 0.5, dx * side - dy * 0.5), special: true };
      }
    }

    // 특수기로 공격·접근
    if (me.specialCd <= 0) {
      if (sp.kind === 'charge' && dist > 50 && dist < 220 && (Math.abs(dx) < 12 || Math.abs(dy) < 12) && chance(this.cfg.attackChance * 0.5)) {
        return { ...toKeys(Math.abs(dx) >= Math.abs(dy) ? dx : 0, Math.abs(dx) >= Math.abs(dy) ? 0 : dy), special: true };
      }
      if (sp.kind === 'jump' && dist > 40 && dist < 90 && facing > 0.7 && chance(0.2)) return { special: true };
      if (sp.kind === 'dash' && sp.aim === 'facing' && dist > 30 && dist < 70 && facing > 0.9 && chance(0.3)) return { special: true };
    }

    // 공격
    if (me.attackCd <= 0) {
      if (atk.kind === 'bolt') {
        // 상대가 가로·세로·대각선 위에 있으면 그 방향으로 쏜다
        const aligned = Math.abs(dx) < 12 || Math.abs(dy) < 12 || Math.abs(Math.abs(dx) - Math.abs(dy)) < 18;
        if (aligned && dist < atk.range && chance(this.cfg.attackChance)) {
          const aim = toKeys(Math.abs(dx) < 12 ? 0 : dx, Math.abs(dy) < 12 ? 0 : dy);
          return { ...aim, attack: true };
        }
      } else if (dist < reach && facing > 0.5 && chance(this.cfg.attackChance)) {
        input.attack = true;
      } else if (atk.bolt && dist < atk.bolt.range && facing > 0.97 && chance(this.cfg.attackChance * 0.5)) {
        input.attack = true;
      }
    }

    this.hold = { up: input.up, down: input.down, left: input.left, right: input.right };
    return input;
  }
}

// 방향 벡터 → 8방향 키 입력
function toKeys(dx, dy) {
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len, ny = dy / len, t = 0.38;
  return { right: nx > t, left: nx < -t, down: ny > t, up: ny < -t };
}

// 턴제 전투에서 한 쪽의 행동을 고른다.
// foeChoice: 상대가 먼저 공개한 선택 (나이트 '허를 찌름'일 때만), 아니면 null
// 보통 난이도는 상대가 직전 턴과 같은 걸 낼 거라 보고 상성으로 받아친다.
const BEATS = { attack: 'skill', defend: 'attack', skill: 'defend' }; // 키가 값을 이긴다
const COUNTER = { skill: 'attack', attack: 'defend', defend: 'skill', focus: 'attack', heal: 'attack' }; // 값이 키를 이긴다
export function chooseTurnAction(battle, fighter, level = 'normal', foeChoice = null, lastFoeChoice = null, rng = Math.random) {
  const opts = battle.options(fighter);
  const has = (a) => opts.includes(a);
  if (foeChoice && has(COUNTER[foeChoice])) return COUNTER[foeChoice];
  if (level === 'normal' && lastFoeChoice && rng() < 0.5 && has(COUNTER[lastFoeChoice])) return COUNTER[lastFoeChoice];
  // 집중한 다음 턴엔 세게 치고, HP가 낮으면 회복을 노린다
  if (fighter.focused) return has('skill') && rng() < 0.4 ? 'skill' : 'attack';
  if (has('heal') && fighter.hp < fighter.maxHp * 0.45 && rng() < 0.5) return 'heal';
  // 그 외엔 가중치 무작위 (공격 위주)
  const weights = { attack: 0.4, defend: 0.25, skill: 0.2, focus: 0.1, heal: 0.05 };
  const total = opts.reduce((s, a) => s + weights[a], 0);
  let r = rng() * total;
  for (const a of opts) { r -= weights[a]; if (r <= 0) return a; }
  return opts[0];
}
export { BEATS };

// 추격전 봇. 술래는 미로 최단 경로로 쫓고, 도망자는 술래에게서 미로 거리가 먼 칸으로 달아난다.
export class ChaseBot {
  constructor(chase, player, level = 'normal', rng = Math.random) {
    this.chase = chase;
    this.player = player;
    this.cfg = BOT_LEVELS[level];
    this.rng = rng;
    this.timer = 0;
    this.hold = {};
  }

  think(dt) {
    const ch = this.chase;
    const me = ch.fighters.find((f) => f.player === this.player);
    const foe = ch.foeOf(me);
    this.timer -= dt;
    if (this.timer > 0) return { ...this.hold };
    this.timer = this.cfg.think * (0.7 + this.rng() * 0.6);

    const pass = (v) => !ch.solidFor(me, v);
    const here = cellOf(me.x, me.y), there = cellOf(foe.x, foe.y);
    const dist = Math.hypot(foe.x - me.x, foe.y - me.y);
    let target;
    if (me.role === 'attacker') {
      // 상대 칸에서 거꾸로 거리 지도를 만들고, 내 주변에서 가장 가까워지는 칸으로
      const map = bfs(ch.grid, there, pass);
      target = bestNeighbor(here, map, (d) => -d) || there;
      if (dist < 40) target = there;
    } else {
      // 술래로부터의 거리가 가장 먼 쪽으로 (몇 칸 앞까지 보고)
      const fromFoe = bfs(ch.grid, there, (v) => !ch.solidFor(foe, v));
      const mine = bfs(ch.grid, here, pass);
      let best = null, bestScore = -Infinity;
      for (let r = 0; r < mine.length; r++) {
        for (let c = 0; c < mine[r].length; c++) {
          const d = mine[r][c];
          if (d < 0 || d > 4) continue;
          const score = (fromFoe[r][c] < 0 ? 40 : fromFoe[r][c]) - d * 0.5 + this.rng() * 0.5;
          if (score > bestScore) { bestScore = score; best = { c, r }; }
        }
      }
      const toward = best ? bfs(ch.grid, best, pass) : null;
      target = (toward && bestNeighbor(here, toward, (d) => -d)) || best || here;
    }
    const p = cellCenter(target.c, target.r);
    const input = toKeys(p.x - me.x, p.y - me.y);

    // 특수 능력
    const sp = me.mv.special;
    if (sp && me.specialCd <= 0 && me.usesLeft > 0 && this.rng() < this.cfg.dodgeChance * 2) {
      const close = dist < 55;
      if (me.role === 'defender' && close) input.special = true;
      if (me.role === 'attacker' && (sp.kind === 'jump' || sp.kind === 'dash') && dist < 80) {
        Object.assign(input, toKeys(foe.x - me.x, foe.y - me.y));
        input.special = true;
      }
    }
    this.hold = { up: input.up, down: input.down, left: input.left, right: input.right };
    return input;
  }
}

// here 칸의 상하좌우 이웃 중 거리 지도 값이 가장 좋은 칸
function bestNeighbor(here, map, score) {
  let best = null, bestScore = -Infinity;
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const c = here.c + dc, r = here.r + dr;
    const d = map[r]?.[c];
    if (d === undefined || d < 0) continue;
    if (score(d) > bestScore) { bestScore = score(d); best = { c, r }; }
  }
  return best;
}
