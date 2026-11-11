import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TurnBattle } from '../src/logic/turnBattle.js';
import { chooseTurnAction } from '../src/logic/ai.js';
import { ChessGame, parseSquare as sq } from '../src/logic/chess.js';
import { TURN } from '../src/logic/balance.js';

const W = (type, extra = {}) => ({ type, color: 'w', ...extra });
const B = (type, extra = {}) => ({ type, color: 'b', ...extra });
const turn = (b, attacker, defender) => b.resolve({ attacker, defender });

test('상성: 방어는 공격을 막고 반격', () => {
  const b = new TurnBattle(W('N'), B('N'));
  const r = turn(b, 'attack', 'defend');
  assert.equal(b.defender.hp, b.defender.maxHp);
  assert.ok(b.attacker.hp < b.attacker.maxHp);
  assert.equal(r.side.defender.countered, true);
});

test('상성: 공격은 스킬을 끊음', () => {
  const b = new TurnBattle(W('N'), B('B'));
  const r = turn(b, 'attack', 'skill');
  assert.equal(r.side.defender.cut, true);
  assert.equal(b.attacker.hp, b.attacker.maxHp);
  assert.ok(b.defender.hp < b.defender.maxHp);
});

test('상성: 스킬은 방어를 뚫음', () => {
  const b = new TurnBattle(W('P'), B('N'));
  turn(b, 'skill', 'defend');
  assert.ok(b.defender.hp < b.defender.maxHp);
});

test('공격끼리는 서로 맞음', () => {
  const b = new TurnBattle(W('Q'), B('R'));
  turn(b, 'attack', 'attack');
  assert.ok(b.attacker.hp < b.attacker.maxHp && b.defender.hp < b.defender.maxHp);
});

test('폰 스킬: 2회 타격', () => {
  const b = new TurnBattle(W('P'), B('N'));
  const r = turn(b, 'skill', 'defend');
  assert.equal(r.side.attacker.hits.length, 2);
});

test('룩 성벽: 공격에도 안 끊기고 모든 피해 무효', () => {
  const b = new TurnBattle(W('Q'), B('R'));
  turn(b, 'attack', 'skill');
  assert.equal(b.defender.hp, b.defender.maxHp);
});

test('스킬은 연속으로 못 씀', () => {
  const b = new TurnBattle(W('P'), B('N'));
  turn(b, 'skill', 'defend');
  assert.ok(!b.options(b.attacker).includes('skill'));
  turn(b, 'attack', 'defend');
  assert.ok(b.options(b.attacker).includes('skill'));
});

test('퀸 연속 행동: 공격+방어, 1회만', () => {
  const b = new TurnBattle(W('Q'), B('N'));
  const r = turn(b, 'skill', 'attack');
  assert.equal(r.side.attacker.cut, false);
  assert.equal(b.attacker.hp, b.attacker.maxHp); // 방어 부분이 막음
  assert.equal(r.side.attacker.hits.length, 2);  // 공격 + 반격
  turn(b, 'defend', 'defend'); turn(b, 'defend', 'defend');
  assert.ok(!b.options(b.attacker).includes('skill'));
});

test('나이트 허를 찌름: 다음 턴 상대가 먼저 공개', () => {
  const b = new TurnBattle(W('N'), B('R'));
  turn(b, 'skill', 'defend');
  assert.equal(b.revealedFirst(), b.defender);
  turn(b, 'defend', 'defend');
  assert.equal(b.revealedFirst(), null);
});

test('비숍 저주: 2턴 동안 상대 피해 감소', () => {
  const plain = new TurnBattle(W('B'), B('Q'));
  turn(plain, 'defend', 'defend'); turn(plain, 'attack', 'attack');
  const cursed = new TurnBattle(W('B'), B('Q'));
  turn(cursed, 'skill', 'defend'); turn(cursed, 'attack', 'attack');
  assert.ok(cursed.attacker.hp > plain.attacker.hp); // 저주받은 퀸의 공격이 약함
});

test('킹 위엄: 상대가 고른 행동을 다음 턴 봉인', () => {
  const b = new TurnBattle(W('K'), B('N'));
  turn(b, 'skill', 'defend');
  assert.ok(!b.options(b.defender).includes('defend'));
  assert.equal(b.normalize(b.defender, 'defend'), 'attack');
});

test('방어도 연속으로 못 씀 — 방어만 누르면 다음 턴은 자동 공격', () => {
  const b = new TurnBattle(W('Q'), B('R'));
  turn(b, 'attack', 'defend');
  assert.ok(!b.options(b.defender).includes('defend'));
  assert.equal(b.normalize(b.defender, 'defend'), 'attack');
  turn(b, 'attack', 'attack');
  assert.ok(b.options(b.defender).includes('defend'));
});

test('스킬이 방어를 뚫으면 추가 피해', () => {
  const vsDefend = new TurnBattle(W('P'), B('N'));
  const r1 = turn(vsDefend, 'skill', 'defend');
  const vsSkill = new TurnBattle(W('P'), B('N'));
  const r2 = turn(vsSkill, 'skill', 'skill');
  assert.ok(r1.side.attacker.dealt > r2.side.attacker.dealt);
  assert.equal(r1.side.attacker.pierced, true);
});

test('5턴 동안 KO 없으면 방어 성공 (시간 종료)', () => {
  const b = new TurnBattle(W('R'), B('R'));
  for (let i = 0; i < TURN.maxTurns; i++) turn(b, i % 2 ? 'skill' : 'defend', i % 2 ? 'skill' : 'defend');
  assert.equal(b.winner, 'defender');
  assert.equal(b.reason, 'time');
});

test('KO', () => {
  const b = new TurnBattle(W('Q'), B('P', { hp: 5 }));
  turn(b, 'attack', 'attack');
  assert.equal(b.winner, 'attacker');
  assert.equal(b.reason, 'ko');
});

test('컴퓨터: 고를 수 있는 것만 고르고, 공개된 선택엔 상성으로 받아침', () => {
  const b = new TurnBattle(W('N'), B('R'));
  for (let i = 0; i < 50; i++) assert.ok(b.options(b.attacker).includes(chooseTurnAction(b, b.attacker)));
  assert.equal(chooseTurnAction(b, b.attacker, 'normal', 'attack'), 'defend');
});

test('체스판: 지형 고정 맵은 대칭이고 킹 칸은 성채', () => {
  const g = new ChessGame();
  assert.equal(g.terrainAt(sq('e1')), 'fortress');
  assert.equal(g.terrainAt(sq('e8')), 'fortress');
  for (const f of 'abcdefgh') for (let r = 1; r <= 4; r++) {
    assert.equal(g.terrainAt(sq(f + r)), g.terrainAt(sq(f + (9 - r))));
  }
});

test('집중: 다음 턴 피해 2배, 집중 중에 맞으면 그대로 맞음', () => {
  const plain = new TurnBattle(W('N'), B('N'));
  turn(plain, 'defend', 'defend');
  const r1 = turn(plain, 'attack', 'skill');
  const focus = new TurnBattle(W('N'), B('N'));
  turn(focus, 'focus', 'attack');
  assert.ok(focus.attacker.hp < focus.attacker.maxHp); // 집중 중 맞음
  assert.ok(!focus.options(focus.attacker).includes('focus')); // 연속 집중 불가
  const r2 = turn(focus, 'attack', 'skill');
  assert.equal(r2.side.attacker.dealt, r1.side.attacker.dealt * 2);
});

test('회복: HP 회복, 공격받으면 끊김, 전투당 2회', () => {
  const b = new TurnBattle(W('R', { hp: 20 }), B('N'));
  const before = b.attacker.hp;
  turn(b, 'heal', 'defend');
  assert.ok(b.attacker.hp > before);
  turn(b, 'attack', 'attack');
  const mid = b.attacker.hp;
  turn(b, 'heal', 'attack');
  assert.ok(b.attacker.hp < mid); // 끊기고 맞음
  turn(b, 'attack', 'attack');
  assert.ok(!b.options(b.attacker).includes('heal')); // 2회 다 씀
});

test('턴제는 HP가 늘어난 상태로 싸우고, 판으로는 원래 비율로 돌아감', () => {
  const b = new TurnBattle(W('Q'), B('P', { hp: 10 }));
  assert.equal(b.attacker.maxHp, 40 * TURN.hpMul);
  assert.equal(b.defender.hp, 10 * TURN.hpMul);
  assert.equal(b.boardHp(b.defender), 10);
  b.defender.hp = 1;
  assert.equal(b.boardHp(b.defender), 1); // 살아 있으면 최소 1
});

test('킹 결전(데스매치): 턴 제한이 없어 쓰러질 때까지 계속', () => {
  const b = new TurnBattle(W('R'), B('K'), { deathmatch: true });
  // 공격 ↔ 방어를 번갈아 → 피해는 조금씩, 제한 턴을 넘겨도 끝나지 않음
  for (let i = 0; i < TURN.maxTurns + 2 && !b.finished; i++) turn(b, 'focus', i % 2 ? 'focus' : 'heal');
  assert.equal(b.finished, false);
  while (!b.finished) turn(b, 'attack', 'focus');
  assert.equal(b.reason, 'ko');
});
