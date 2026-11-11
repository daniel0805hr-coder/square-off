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
