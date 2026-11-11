import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChessGame, parseSquare as sq, squareName } from '../src/logic/chess.js';
import { Battle } from '../src/logic/battle.js';
import { chooseChessMove, captureWinChance, BattleBot } from '../src/logic/ai.js';

const DT = 1 / 60;

test('체스 AI: 한 판 끝까지 항상 둘 수 있는 수를 고름', () => {
  const g = new ChessGame();
  for (let i = 0; i < 200 && !g.result; i++) {
    if (g.duel) { g.resolveDuel(Math.random() < 0.5 ? 'attacker' : 'defender'); continue; }
    const m = chooseChessMove(g);
    assert.ok(g.move(m.from, m.to, 'Q', Math.random() < 0.5 ? 'attacker' : 'defender'));
  }
});

test('체스 AI: 한 수 체크메이트를 놓치지 않음', () => {
  const g = new ChessGame().loadFen('6k1/5ppp/8/8/8/8/8/R5K1 w - -');
  const m = chooseChessMove(g, () => 0);
  assert.equal(squareName(m.to), 'a8');
});

test('체스 AI: 공짜로 잡을 수 있는 퀸은 잡음', () => {
  const g = new ChessGame().loadFen('4k3/8/8/3q4/8/8/8/3QK3 w - -');
  const m = chooseChessMove(g, () => 0);
  assert.equal(squareName(m.to), 'd5');
});

test('잡기 승률 어림: 폰으로 퀸은 낮고 퀸으로 폰은 높음', () => {
  assert.ok(captureWinChance({ type: 'P' }, { type: 'Q' }) < 0.2);
  assert.ok(captureWinChance({ type: 'Q' }, { type: 'P' }) > 0.8);
  // 다친 퀸은 덜 무섭다
  assert.ok(captureWinChance({ type: 'P' }, { type: 'Q', hp: 10 }) > captureWinChance({ type: 'P' }, { type: 'Q' }));
});

test('전투 봇(보통): 가만히 있는 폰을 20초 안에 KO', () => {
  const b = new Battle({ type: 'Q', color: 'w' }, { type: 'P', color: 'b' });
  const bot = new BattleBot(b, 1, 'normal');
  for (let t = 0; t < 30 && !b.finished; t += DT) b.step(DT, { 1: bot.think(DT) });
  assert.equal(b.reason, 'ko');
  assert.equal(b.winner, 'attacker');
});

test('전투 봇끼리 싸워도 정상 종료', () => {
  for (const level of ['easy', 'normal']) {
    const b = new Battle({ type: 'N', color: 'w' }, { type: 'B', color: 'b' });
    const bots = [new BattleBot(b, 1, level), new BattleBot(b, 2, level)];
    for (let t = 0; t < 30 && !b.finished; t += DT) b.step(DT, { 1: bots[0].think(DT), 2: bots[1].think(DT) });
    assert.ok(b.finished);
  }
});
