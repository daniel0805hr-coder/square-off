import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle, diagonalsFor } from '../src/logic/battle.js';
import { ChessGame, parseSquare as sq } from '../src/logic/chess.js';
import { BattleBot } from '../src/logic/ai.js';
import { maxHp, currentHp } from '../src/logic/units.js';

const DT = 1 / 60;
const W = (type, extra = {}) => ({ type, color: 'w', ...extra });
const B = (type, extra = {}) => ({ type, color: 'b', ...extra });
const steps = (b, n, inputs = {}) => { for (let i = 0; i < n; i++) b.step(DT, typeof inputs === 'function' ? inputs(i) : inputs); };

// ───────── 전투: 기물별 기술 ─────────

test('비숍: 투사체는 바라보는 방향으로 한 발 — 정면의 상대도 맞음', () => {
  const b = new Battle(W('B'), B('P'));
  b.step(DT, { 1: { attack: true } });
  assert.equal(b.projectiles.length, 1);
  assert.ok(b.projectiles[0].vx > 0 && b.projectiles[0].vy === 0);
  steps(b, 90);
  assert.ok(b.defender.hp < b.defender.maxHp);
});

test('비숍 순간이동: 정면이면 두 대각선 후보', () => {
  assert.equal(diagonalsFor(1, 0).length, 2);
  assert.equal(diagonalsFor(Math.SQRT1_2, Math.SQRT1_2).length, 1);
});

test('비숍: 대각선 투사체가 대각선에 있는 상대를 맞힘', () => {
  const b = new Battle(W('B'), B('P'));
  b.defender.x = b.attacker.x + 100; b.defender.y = b.attacker.y + 100;
  b.step(DT, { 1: { down: true, right: true, attack: true } });
  steps(b, 60);
  assert.ok(b.defender.hp < b.defender.maxHp);
});

test('비숍: 순간이동은 대각선으로 이동', () => {
  const b = new Battle(W('B'), B('P'));
  const x0 = b.attacker.x, y0 = b.attacker.y;
  b.step(DT, { 1: { up: true, right: true, special: true } });
  assert.ok(Math.abs(Math.abs(b.attacker.x - x0) - Math.abs(b.attacker.y - y0)) < 6);
  assert.ok(b.attacker.x > x0 + 40);
});

test('나이트: 점프 중엔 무적, 착지할 때 주변 피해', () => {
  const b = new Battle(W('N'), B('P'));
  b.defender.x = b.attacker.x + 64; b.defender.y = 32; // L자 착지 지점 근처
  b.step(DT, { 1: { special: true } });
  assert.ok(b.attacker.jumpTime > 0);
  assert.equal(b.canBeHit(b.attacker), false);
  steps(b, 30);
  assert.equal(b.attacker.jumpTime, 0);
  assert.ok(b.defender.hp < b.defender.maxHp);
});

test('룩: 벽에 돌진하면 기절', () => {
  const b = new Battle(W('R'), B('P'));
  b.attacker.fx = 0; b.attacker.fy = -1; // 위쪽 벽을 보고
  b.step(DT, { 1: { special: true } });
  steps(b, 40);
  assert.ok(b.attacker.stun > 0 || b.events.some((e) => e.type === 'wallStun') || b.attacker.y <= -100);
});

test('룩: 돌진으로 상대를 들이받으면 큰 피해', () => {
  const b = new Battle(W('R'), B('P'));
  b.defender.x = b.attacker.x + 80;
  b.step(DT, { 1: { special: true } });
  steps(b, 30);
  assert.ok(b.defender.hp < b.defender.maxHp);
  assert.equal(b.attacker.stun, 0);
});

test('룩은 덜 밀려남', () => {
  const r = new Battle(W('Q'), B('R')), p = new Battle(W('Q'), B('P'));
  for (const b of [r, p]) { b.defender.x = b.attacker.x + 20; b.step(DT, { 1: { attack: true } }); }
  assert.ok(Math.abs(r.defender.kbx) < Math.abs(p.defender.kbx));
});

test('퀸: 공격하면 근접 + 투사체', () => {
  const b = new Battle(W('Q'), B('P'));
  b.step(DT, { 1: { attack: true } });
  assert.ok(b.attacker.attackTime > 0);
  assert.equal(b.projectiles.length, 1);
});

test('킹 실드: 켜져 있으면 피해 무효, 게임당 1회', () => {
  const b = new Battle(W('Q'), B('K'), { shields: { b: true } });
  b.defender.x = b.attacker.x + 20;
  b.step(DT, { 2: { special: true } });
  assert.ok(b.defender.shieldTime > 0);
  b.step(DT, { 1: { attack: true } });
  assert.equal(b.defender.hp, b.defender.maxHp);
  assert.equal(b.defender.shieldUsed, true);
  // 이미 쓴 실드
  const c = new Battle(W('Q'), B('K'), { shields: { b: false } });
  c.step(DT, { 2: { special: true } });
  assert.equal(c.defender.shieldTime, 0);
});

test('폰은 몸이 작음', () => {
  const b = new Battle(W('P'), B('Q'));
  assert.ok(b.attacker.body < b.defender.body);
});

test('남은 HP·베테랑 공격력이 전투에 반영됨', () => {
  const b = new Battle(W('Q', { hp: 12 }), B('P', { vet: 'atk' }));
  assert.equal(b.attacker.hp, 12);
  assert.equal(b.defender.damage, 3 + 2 + 1);
});

test('모든 기물 조합에서 봇끼리 싸워도 정상 종료', () => {
  const types = ['P', 'N', 'B', 'R', 'Q', 'K'];
  for (const a of types) for (const d of types) {
    const b = new Battle(W(a), B(d), { shields: { w: true, b: true } });
    const bots = [new BattleBot(b, 1), new BattleBot(b, 2)];
    for (let t = 0; t < 30 && !b.finished; t += DT) b.step(DT, { 1: bots[0].think(DT), 2: bots[1].think(DT) });
    assert.ok(b.finished, `${a} vs ${d}`);
  }
});

// ───────── 체스판: HP 유지·보상·회복 ─────────

test('공격 승리: 남은 HP + 보상 10, 최대 HP 초과 안 함', () => {
  const g = new ChessGame().loadFen('4k3/8/8/3n4/8/8/8/3QK3 w - -');
  g.move(sq('d1'), sq('d5'), 'Q', 'attacker', { attacker: 30, defender: 0 });
  assert.equal(currentHp(g.pieceAt(sq('d5'))), 40);
  const h = new ChessGame().loadFen('4k3/8/8/3n4/8/8/8/3QK3 w - -');
  h.move(sq('d1'), sq('d5'), 'Q', 'attacker', { attacker: 48, defender: 0 });
  assert.equal(currentHp(h.pieceAt(sq('d5'))), 50);
});

test('방어 성공·시간 종료: 깎인 HP 유지', () => {
  const g = new ChessGame().loadFen('4k3/8/8/3n4/8/8/8/3Q3K w - -'); // 킹이 멀리 있어 회복 없음
  g.move(sq('d1'), sq('d5'), 'Q', 'retreat', { attacker: 35, defender: 12 });
  assert.equal(currentHp(g.pieceAt(sq('d1'))), 35);
  assert.equal(currentHp(g.pieceAt(sq('d5'))), 12);
});

test('자이언트 킬 → 베테랑 승격 대기, 선택하면 적용 (1회)', () => {
  const g = new ChessGame().loadFen('4k3/8/8/3q4/4P3/8/8/4K3 w - -');
  const rec = g.move(sq('e4'), sq('d5'), 'Q', 'attacker', { attacker: 4, defender: 0 });
  assert.deepEqual(rec.veteranPending, sq('d5'));
  g.promoteVeteran(sq('d5'), 'hp');
  const p = g.pieceAt(sq('d5'));
  assert.equal(p.vet, 'hp');
  assert.equal(maxHp(p), 30);
  assert.equal(currentHp(p), 24); // 4 + 보상 10 + 승격 10
});

test('같은 가치끼리는 베테랑 아님', () => {
  const g = new ChessGame().loadFen('4k3/8/8/3b4/8/4N3/8/4K3 w - -');
  const rec = g.move(sq('e3'), sq('d5'), 'Q', 'attacker', { attacker: 20, defender: 0 });
  assert.equal(rec.veteranPending, undefined);
});

test('킹 주변 아군은 자기 수를 둘 때마다 회복, 킹 자신은 제외', () => {
  const g = new ChessGame().loadFen('4k3/8/8/8/8/8/3R4/3K4 w - -');
  g.pieceAt(sq('d2')).hp = 20;
  g.pieceAt(sq('d1')).hp = 10;
  g.move(sq('d1'), sq('e1')); // 킹 이동 후에도 d2는 e1 옆
  assert.equal(currentHp(g.pieceAt(sq('d2'))), 30);
  assert.equal(currentHp(g.pieceAt(sq('e1'))), 10);
});

test('승급하면 풀 HP', () => {
  const g = new ChessGame().loadFen('7k/P7/8/8/8/8/8/K7 w - -');
  g.pieceAt(sq('a7')).hp = 5;
  g.move(sq('a7'), sq('a8'), 'Q');
  assert.equal(currentHp(g.pieceAt(sq('a8'))), 50);
});
