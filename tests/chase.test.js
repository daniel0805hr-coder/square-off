import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chase, makeMaze, bfs, cellOf, cellCenter, OPEN, TREE, GAP, BLOCK } from '../src/logic/chase.js';
import { ChaseBot } from '../src/logic/ai.js';
import { generateMap, validHalf, KINDS, MAP_RULES } from '../src/logic/terrain.js';
import { ChessGame, parseSquare as sq } from '../src/logic/chess.js';
import { CHASE } from '../src/logic/balance.js';
import { currentHp } from '../src/logic/units.js';

const DT = 1 / 60;
const W = (type) => ({ type, color: 'w' });
const B = (type) => ({ type, color: 'b' });
const open = () => Array.from({ length: CHASE.rows }, () => Array(CHASE.cols).fill(OPEN));
const steps = (ch, n, inputs = {}) => { for (let i = 0; i < n && !ch.finished; i++) ch.step(DT, typeof inputs === 'function' ? inputs(i) : inputs); };

test('미로: 두 출발점이 이어져 있고, 모든 빈 칸이 연결됨', () => {
  for (let i = 0; i < 30; i++) {
    const g = makeMaze();
    const start = cellOf(-CHASE.startGap / 2, 0), end = cellOf(CHASE.startGap / 2, 0);
    const d = bfs(g, start, (v) => v === OPEN);
    assert.ok(d[end.r][end.c] >= 0);
    for (let r = 0; r < g.length; r++) for (let c = 0; c < g[r].length; c++) if (g[r][c] === OPEN) assert.ok(d[r][c] >= 0);
  }
});

test('술래가 닿으면 공격 성공, 시간까지 버티면 방어 성공', () => {
  const ch = new Chase(W('Q'), B('Q'), { grid: open() });
  steps(ch, 600, { 1: { right: true } });
  assert.equal(ch.winner, 'attacker');
  assert.equal(ch.reason, 'catch');
  const t = new Chase(W('Q'), B('Q'), { grid: open() });
  steps(t, 60 * (CHASE.duration + 1));
  assert.equal(t.winner, 'defender');
  assert.equal(t.reason, 'time');
});

test('나무는 못 지나가고, 덤불(좁은 틈)은 도망자 폰만 통과', () => {
  const g = open();
  const c0 = cellOf(-CHASE.startGap / 2, 0);
  for (let r = 0; r < CHASE.rows; r++) g[r][c0.c + 2] = GAP;
  const pawn = new Chase(W('Q'), B('P'), { grid: g.map((r) => r.slice()) });
  pawn.defender.x = pawn.attacker.x; pawn.attacker.x -= 30; pawn.attacker.y = -100;
  const x0 = pawn.defender.x;
  steps(pawn, 60, { 2: { right: true } });
  assert.ok(pawn.defender.x > x0 + 50); // 덤불 통과
  const queen = new Chase(W('P'), B('Q'), { grid: g.map((r) => r.slice()) });
  queen.attacker.x = queen.defender.x = x0; queen.attacker.y = -100;
  steps(queen, 60, { 2: { right: true } });
  assert.ok(queen.defender.x < x0 + 40); // 막힘
});

test('나이트: 나무를 넘어 점프', () => {
  const g = open();
  const s = cellOf(CHASE.startGap / 2, 0);
  for (let r = 0; r < CHASE.rows; r++) g[r][s.c - 2] = TREE;
  const ch = new Chase(W('Q'), B('N'), { grid: g });
  ch.attacker.y = -100;
  const x0 = ch.defender.x;
  ch.step(DT, { 2: { left: true, special: true } });
  assert.ok(ch.defender.jumpTime > 0);
  steps(ch, 30);
  assert.ok(ch.defender.x < x0 - 30);
});

test('룩 도망자: 등 뒤에 벽 블록 설치 (최대 4개)', () => {
  const ch = new Chase(W('Q'), B('R'), { grid: open() });
  ch.defender.fx = 1; ch.defender.fy = 0;
  ch.step(DT, { 2: { special: true } });
  assert.equal(ch.grid.flat().filter((v) => v === BLOCK).length, 1);
});

test('킹 도망자: 은신 1회', () => {
  const ch = new Chase(W('Q'), B('K'), { grid: open() });
  ch.step(DT, { 2: { special: true } });
  assert.ok(ch.defender.stealthTime > 0);
  assert.equal(ch.defender.usesLeft, 0);
});

test('비숍 도망자: 대각선 순간이동 1회', () => {
  const ch = new Chase(W('Q'), B('B'), { grid: open() });
  const { x, y } = ch.defender;
  ch.step(DT, { 2: { up: true, right: true, special: true } });
  assert.ok(Math.abs(Math.abs(ch.defender.x - x) - Math.abs(ch.defender.y - y)) < 4);
  assert.equal(ch.defender.usesLeft, 0);
});

test('룩 술래: 직선으로 계속 달리면 점점 빨라짐', () => {
  const ch = new Chase(W('R'), B('K'), { grid: open() });
  ch.defender.y = 100;
  const xs = [];
  for (let i = 0; i < 70; i++) { ch.step(DT, { 1: { right: true } }); xs.push(ch.attacker.x); }
  assert.ok(xs[69] - xs[59] > (xs[10] - xs[0]) * 1.5);
});

test('모든 조합에서 봇끼리 추격전이 정상 종료', () => {
  const types = ['P', 'N', 'B', 'R', 'Q', 'K'];
  for (const a of types) for (const d of types) {
    const ch = new Chase(W(a), B(d));
    const bots = [new ChaseBot(ch, 1), new ChaseBot(ch, 2)];
    for (let t = 0; t < 20 && !ch.finished; t += DT) ch.step(DT, { 1: bots[0].think(DT), 2: bots[1].think(DT) });
    assert.ok(ch.finished, `${a} vs ${d}`);
  }
});

test('지형 생성: 대칭 · e1/e8 성채 · 종류별 10~12칸 · 3칸 넘게 연속 없음 · 전선 골고루', () => {
  for (let i = 0; i < 200; i++) {
    const m = generateMap();
    const half = [m[7], m[6], m[5], m[4]];
    assert.ok(validHalf(half));
    for (let r = 0; r < 4; r++) assert.deepEqual(m[r], m[7 - r]);
    for (const k of KINDS) {
      const n = half.flat().filter((x) => x === k).length;
      assert.ok(n >= MAP_RULES.perKind[0] && n <= MAP_RULES.perKind[1], `${k} ${n}`);
    }
  }
});

test('체스판: 추격전 승리는 HP 보상 없음', () => {
  const g = new ChessGame().loadFen('4k3/8/8/3n4/8/8/8/3Q3K w - -');
  g.move(sq('d1'), sq('d5'), 'Q', 'attacker', { attacker: 40, defender: 30, noReward: true });
  assert.equal(currentHp(g.pieceAt(sq('d5'))), 40);
});
