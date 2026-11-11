import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../src/logic/battle.js';
import { ChessGame, parseSquare as sq } from '../src/logic/chess.js';

const DT = 1 / 60;
const run = (battle, inputsFn, maxSec = 30) => {
  for (let t = 0; t < maxSec && !battle.finished; t += DT) battle.step(DT, inputsFn(t));
  return battle;
};

test('아무도 안 움직이면 시간 종료 → 방어 성공', () => {
  const b = run(new Battle({ type: 'N', color: 'w' }, { type: 'N', color: 'b' }), () => ({}));
  assert.equal(b.reason, 'time');
  assert.equal(b.winner, 'defender');
});

test('시간 종료 시 HP와 상관없이 방어 성공', () => {
  const b = run(new Battle({ type: 'Q', color: 'w' }, { type: 'P', color: 'b' }), () => ({}));
  assert.equal(b.reason, 'time');
  assert.equal(b.winner, 'defender');
});

test('계속 다가가서 때리면 KO로 이김', () => {
  // 백 퀸이 오른쪽으로 걸어가며 공격 연타, 흑 폰은 가만히
  const b = run(new Battle({ type: 'Q', color: 'w' }, { type: 'P', color: 'b' }),
    (t) => ({ 1: { right: true, attack: Math.floor(t * 60) % 10 === 0 } }));
  assert.equal(b.reason, 'ko');
  assert.equal(b.winner, 'attacker');
  assert.equal(b.defender.hp, 0);
});

test('대시 중에는 맞지 않음', () => {
  const b = new Battle({ type: 'Q', color: 'w' }, { type: 'P', color: 'b' });
  b.defender.x = b.attacker.x + 20; // 바로 앞
  b.step(DT, { 2: { special: true } });
  b.step(DT, { 1: { attack: true } });
  assert.equal(b.defender.hp, b.defender.maxHp);
});

test('체스: 수비 승리 → 공격한 말이 사라지고 차례가 넘어감', () => {
  const g = new ChessGame();
  for (const [f, t] of [['e2', 'e4'], ['d7', 'd5']]) g.move(sq(f), sq(t));
  const rec = g.move(sq('e4'), sq('d5'), 'Q', 'defender');
  assert.equal(g.pieceAt(sq('e4')), null);
  assert.equal(g.pieceAt(sq('d5')).color, 'b');
  assert.deepEqual(g.captured.w, ['P']);
  assert.equal(g.turn, 'b');
  assert.equal(rec.notation, 'e4xd5 실패');
});

test('체스: 수비 승리 시 앙파상 기회 없음, 승급 안 됨', () => {
  const g = new ChessGame().loadFen('1n5k/P7/8/8/8/8/8/K7 w - -');
  g.move(sq('a7'), sq('b8'), 'Q', 'defender');
  assert.equal(g.pieceAt(sq('b8')).type, 'N');
  assert.equal(g.pieceAt(sq('a7')), null);
});

test('체스: 킹이 공격했다가 KO로 지면 게임 종료', () => {
  const g = new ChessGame().loadFen('7k/8/8/8/8/8/4r3/4K3 w - -');
  g.move(sq('e1'), sq('e2'), 'Q', 'defender');
  assert.deepEqual(g.result, { type: 'kingslain', winner: 'b' });
});

test('체스: 시간 종료(방어 성공)면 둘 다 제자리', () => {
  const g = new ChessGame().loadFen('7k/8/8/8/8/8/4r3/4K3 w - -');
  const rec = g.move(sq('e1'), sq('e2'), 'Q', 'retreat');
  assert.equal(g.pieceAt(sq('e1')).type, 'K');
  assert.equal(g.pieceAt(sq('e2')).type, 'R');
  assert.equal(rec.notation, 'Ke1xe2 후퇴');
  assert.equal(g.result, null);
});

test('체스: 체크를 풀려던 공격이 실패하면 상대가 킹을 공격할 수 있음', () => {
  const g = new ChessGame().loadFen('7k/8/8/4r3/8/2B5/8/4K3 w - -'); // 흑 룩 e5가 백 킹 체크
  g.move(sq('c3'), sq('e5'), 'Q', 'defender'); // 비숍이 룩을 잡으려다 실패
  assert.equal(g.turn, 'b');
  const m = g.findMove(sq('e5'), sq('e1'));
  assert.equal(m.captured.type, 'K');
  g.move(sq('e5'), sq('e1'), 'Q', 'attacker');
  assert.deepEqual(g.result, { type: 'kingslain', winner: 'b' });
});

test('킹 결전(데스매치): 시간이 지나도 끝나지 않음', () => {
  const b = new Battle({ type: 'R', color: 'w' }, { type: 'K', color: 'b' }, { deathmatch: true });
  for (let t = 0; t < 30; t += 1 / 60) b.step(1 / 60, {});
  assert.equal(b.finished, false);
});

// ───────── 필살기 (스킬 키 길게) ─────────

// 두 말을 가까이 붙여 놓고 시작 (a = 공격자, d = 수비자, gap = 몸 중심 거리)
const close = (a, d, gap) => {
  const b = new Battle({ type: a, color: 'w' }, { type: d, color: 'b' });
  b.attacker.x = -gap / 2; b.defender.x = gap / 2;
  return b;
};

test('필살기: 전투당 1회만', () => {
  const b = close('Q', 'R', 40);
  b.step(DT, { 1: { ultimate: true } });
  assert.equal(b.attacker.ultUsed, true);
  const hp = b.defender.hp;
  for (let t = 0; t < 1; t += DT) b.step(DT, {});
  b.step(DT, { 1: { ultimate: true } });
  assert.equal(b.events.some((e) => e.type === 'ultimate'), false);
  assert.ok(b.defender.hp < hp + 1);
});

test('필살기: 퀸 일섬은 주변에 피해, 멀면 빗나감', () => {
  const near = close('Q', 'R', 40);
  near.step(DT, { 1: { ultimate: true } });
  assert.ok(near.defender.hp < near.defender.maxHp);
  const far = close('Q', 'R', 150);
  far.step(DT, { 1: { ultimate: true } });
  assert.equal(far.defender.hp, far.defender.maxHp);
});

test('필살기: 폰 돌격 연타는 대시 3번', () => {
  const b = close('P', 'R', 120);
  b.step(DT, { 1: { right: true, ultimate: true } });
  let dashes = 1;
  for (let t = 0; t < 1; t += DT) { b.step(DT, { 1: { right: true } }); dashes += b.events.filter((e) => e.type === 'dash').length; }
  assert.equal(dashes, 3);
  assert.ok(b.defender.hp < b.defender.maxHp); // 부딪혀서 피해
});

test('필살기: 룩 파성추는 벽에 부딪혀도 기절하지 않음', () => {
  const b = close('R', 'P', 40);
  b.attacker.x = 200; b.defender.x = 260; // 오른쪽 벽 가까이
  b.step(DT, { 1: { ultimate: true } });
  for (let t = 0; t < 1.5; t += DT) b.step(DT, {});
  assert.equal(b.attacker.stun, 0);
});

test('필살기: 비숍 성광은 순간이동 + 8방향 투사체', () => {
  const b = close('B', 'N', 150);
  b.step(DT, { 1: { ultimate: true } });
  assert.ok(b.events.some((e) => e.type === 'blink'));
  assert.equal(b.projectiles.length, 8);
});

test('필살기: 나이트 대도약은 평소 점프보다 멀리', () => {
  const jump = (inp) => {
    const b = close('N', 'R', 250);
    const x = b.attacker.x;
    b.step(DT, { 1: inp });
    for (let t = 0; t < 0.6; t += DT) b.step(DT, {});
    return b.attacker.x - x;
  };
  assert.ok(jump({ ultimate: true }) > jump({ special: true }) + 20);
});

test('동시에 쓰러지면 수비자가 HP 1로 버팀 (HP 0인 말이 판에 남지 않음)', () => {
  // 둘 다 한 대면 쓰러지는 HP로 마주 걸어가 같은 순간에 때린다
  const b = new Battle({ type: 'N', color: 'w', hp: 1 }, { type: 'N', color: 'b', hp: 1 });
  b.attacker.x = -12; b.defender.x = 12;
  b.step(DT, { 1: { attack: true }, 2: { attack: true } });
  assert.equal(b.reason, 'ko');
  assert.equal(b.winner, 'defender');
  assert.equal(b.attacker.hp, 0);
  assert.equal(b.defender.hp, 1);
});
