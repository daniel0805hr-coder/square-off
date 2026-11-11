// 추격전 (숲) — 화면·키보드와 무관한 순수 로직.
// 공격자 = 술래, 수비자 = 도망자. 술래가 닿으면 공격 성공, 시간까지 버티면 방어 성공.
// 매 프레임 step(dt, inputs). inputs = { 1: { up, down, left, right, special }, 2: {...} }

import { STATS, MOVES, TOPDOWN, CHASE as C, CHASE_MOVES } from './balance.js';
import { WHITE } from './chess.js';
import { diagonalsFor } from './battle.js';

export const OPEN = 0, TREE = 1, GAP = 2, BLOCK = 3; // 미로 칸 종류 (GAP = 폰만 지나가는 덤불)
const HW = (C.cols * C.tile) / 2, HH = (C.rows * C.tile) / 2;
const norm = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };

export const cellOf = (x, y) => ({ c: Math.floor((x + HW) / C.tile), r: Math.floor((y + HH) / C.tile) });
export const cellCenter = (c, r) => ({ x: -HW + (c + 0.5) * C.tile, y: -HH + (r + 0.5) * C.tile });
const inGrid = (c, r) => c >= 0 && c < C.cols && r >= 0 && r < C.rows;

// 나무 미로 만들기. 모든 빈 칸이 서로 이어지도록 막힌 구석은 나무로 메운다.
export function makeMaze(rng = Math.random) {
  const spawns = [cellOf(-C.startGap / 2, 0), cellOf(C.startGap / 2, 0)];
  for (let attempt = 0; attempt < 100; attempt++) {
    const grid = Array.from({ length: C.rows }, () => Array(C.cols).fill(OPEN));
    const nearSpawn = (c, r) => spawns.some((s) => Math.abs(s.c - c) <= 1 && Math.abs(s.r - r) <= 1);
    for (let r = 0; r < C.rows; r++) {
      for (let c = 0; c < C.cols; c++) if (!nearSpawn(c, r) && rng() < C.treeDensity) grid[r][c] = TREE;
    }
    // 연결 확인: 왼쪽 출발점에서 못 가는 빈 칸은 나무로
    const seen = bfs(grid, spawns[0], (v) => v === OPEN);
    if (seen[spawns[1].r][spawns[1].c] < 0) continue;
    for (let r = 0; r < C.rows; r++) for (let c = 0; c < C.cols; c++) if (grid[r][c] === OPEN && seen[r][c] < 0) grid[r][c] = TREE;
    // 좁은 틈(덤불): 양옆 또는 위아래가 빈 칸인 나무
    const candidates = [];
    for (let r = 0; r < C.rows; r++) {
      for (let c = 0; c < C.cols; c++) {
        if (grid[r][c] !== TREE) continue;
        const open = (cc, rr) => inGrid(cc, rr) && grid[rr][cc] === OPEN;
        if ((open(c - 1, r) && open(c + 1, r)) || (open(c, r - 1) && open(c, r + 1))) candidates.push({ c, r });
      }
    }
    for (let i = 0; i < C.gapCount && candidates.length; i++) {
      const { c, r } = candidates.splice(Math.floor(rng() * candidates.length), 1)[0];
      grid[r][c] = GAP;
    }
    return grid;
  }
  return Array.from({ length: C.rows }, () => Array(C.cols).fill(OPEN));
}

// 칸 거리 지도 (못 가는 칸은 -1). passable(값) → 지나갈 수 있는가
export function bfs(grid, from, passable) {
  const dist = grid.map((row) => row.map(() => -1));
  if (!inGrid(from.c, from.r)) return dist;
  dist[from.r][from.c] = 0;
  const q = [from];
  while (q.length) {
    const { c, r } = q.shift();
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (!inGrid(nc, nr) || dist[nr][nc] >= 0 || !passable(grid[nr][nc])) continue;
      dist[nr][nc] = dist[r][c] + 1;
      q.push({ c: nc, r: nr });
    }
  }
  return dist;
}

function makeRunner(piece, role) {
  const left = piece.color === WHITE;
  const mv = CHASE_MOVES[piece.type][role === 'attacker' ? 'chaser' : 'runner'];
  return {
    role, piece, type: piece.type, mv,
    player: left ? 1 : 2,
    x: left ? -C.startGap / 2 : C.startGap / 2, y: 0,
    fx: left ? 1 : -1, fy: 0,
    body: MOVES[piece.type].body,
    speed: (TOPDOWN.moveSpeedBase + STATS[piece.type].spd * TOPDOWN.moveSpeedPerSpd) * C.speedMul * (mv.speedMul || 1)
      * (role === 'attacker' ? C.chaserSpeedMul : 1),
    canGap: mv.passive?.kind === 'gap',
    rampTime: 0, lastDx: 0, lastDy: 0,
    specialCd: 0, usesLeft: mv.special?.uses ?? Infinity,
    jumpTime: 0, jumpFrom: null, jumpTo: null,
    dashTime: 0, dashX: 0, dashY: 0,
    stealthTime: 0,
  };
}

export class Chase {
  constructor(attacker, defender, opts = {}) {
    this.grid = opts.grid || makeMaze(opts.rng);
    this.fighters = [makeRunner(attacker, 'attacker'), makeRunner(defender, 'defender')];
    this.timeLeft = C.duration;
    this.events = [];
    this.winner = null; // 'attacker' | 'defender'
    this.reason = null; // 'catch' | 'time'
  }

  get attacker() { return this.fighters[0]; }
  get defender() { return this.fighters[1]; }
  get finished() { return this.winner !== null; }
  foeOf(f) { return f === this.fighters[0] ? this.fighters[1] : this.fighters[0]; }

  solidFor(f, value) {
    return value === TREE || value === BLOCK || (value === GAP && !f.canGap);
  }

  // 몸(정사각형)이 막힌 칸과 겹치는가
  blocked(f, x, y) {
    const h = Math.min(f.body - 1, C.hitHalf);
    const a = cellOf(x - h, y - h), b = cellOf(x + h, y + h);
    for (let r = a.r; r <= b.r; r++) {
      for (let c = a.c; c <= b.c; c++) {
        if (!inGrid(c, r) || this.solidFor(f, this.grid[r][c])) return true;
      }
    }
    return false;
  }

  step(dt, inputs) {
    this.events = [];
    if (this.finished) return;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    for (const f of this.fighters) this.control(f, inputs[f.player] || {}, dt);

    const [a, d] = this.fighters;
    if (a.jumpTime <= 0 && d.jumpTime <= 0 && Math.hypot(a.x - d.x, a.y - d.y) < a.body + d.body + 1) {
      this.finish('attacker', 'catch');
    } else if (this.timeLeft <= 0) {
      this.finish('defender', 'time');
    }
  }

  control(f, inp, dt) {
    let dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    let dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
    const moving = dx !== 0 || dy !== 0;
    const diagonalInput = dx !== 0 && dy !== 0;
    if (moving) [dx, dy] = norm(dx, dy);

    f.specialCd = Math.max(0, f.specialCd - dt);
    f.stealthTime = Math.max(0, f.stealthTime - dt);

    if (f.jumpTime > 0) { this.updateJump(f, dt); return; }
    if (moving) { f.fx = dx; f.fy = dy; }
    if (inp.special) this.doSpecial(f, moving ? dx : f.fx, moving ? dy : f.fy);
    if (f.jumpTime > 0) return;

    // 속도 배율: 같은 방향으로 계속 가면 가속(ramp) / 대각선 가속
    let mul = 1;
    const pas = f.mv.passive;
    if (pas?.kind === 'ramp') {
      const same = moving && dx === f.lastDx && dy === f.lastDy;
      f.rampTime = same ? f.rampTime + dt : 0;
      mul = pas.from + (pas.to - pas.from) * Math.min(1, f.rampTime / pas.time);
    } else if (pas?.kind === 'diagonal' && diagonalInput) {
      mul = pas.mul;
    }
    f.lastDx = moving ? dx : 0; f.lastDy = moving ? dy : 0;

    let vx = dx * f.speed * mul, vy = dy * f.speed * mul;
    if (f.dashTime > 0) {
      f.dashTime = Math.max(0, f.dashTime - dt);
      vx = f.dashX * f.speed * f.mv.special.speedMul;
      vy = f.dashY * f.speed * f.mv.special.speedMul;
    }
    const movedX = this.moveAxis(f, vx * dt, 0);
    const movedY = this.moveAxis(f, 0, vy * dt);
    // 모서리 보정: 한 방향으로만 가려는데 막혔으면 통로 가운데로 살짝 밀어준다
    const assist = f.speed * dt;
    if (vx && !vy && !movedX) this.nudge(f, 'y', assist);
    if (vy && !vx && !movedY) this.nudge(f, 'x', assist);
  }

  nudge(f, axis, amount) {
    const { c, r } = cellOf(f.x, f.y);
    const center = cellCenter(c, r)[axis];
    const diff = center - f[axis];
    if (Math.abs(diff) < 0.5) return;
    const step = Math.sign(diff) * Math.min(Math.abs(diff), amount);
    const nx = axis === 'x' ? f.x + step : f.x, ny = axis === 'y' ? f.y + step : f.y;
    if (!this.blocked(f, nx, ny)) { f.x = nx; f.y = ny; }
  }

  // 한 축씩 움직이고 막히면 그 축만 멈춘다 (벽을 따라 미끄러지듯)
  // 움직였으면 true
  moveAxis(f, mx, my) {
    if (!mx && !my) return true;
    const nx = Math.max(-HW + f.body, Math.min(HW - f.body, f.x + mx));
    const ny = Math.max(-HH + f.body, Math.min(HH - f.body, f.y + my));
    if (!this.blocked(f, nx, ny)) { f.x = nx; f.y = ny; return true; }
    // 조금씩 다가가서 벽에 붙는다
    const steps = 4;
    for (let i = steps - 1; i > 0; i--) {
      const px = f.x + (nx - f.x) * (i / steps), py = f.y + (ny - f.y) * (i / steps);
      if (!this.blocked(f, px, py)) { f.x = px; f.y = py; return true; }
    }
    return false;
  }

  doSpecial(f, ax, ay) {
    const sp = f.mv.special;
    if (!sp || f.specialCd > 0 || f.usesLeft <= 0) return;
    let used = false;
    if (sp.kind === 'jump') used = this.startJump(f, sp);
    else if (sp.kind === 'blink') used = this.blink(f, sp, ax, ay);
    else if (sp.kind === 'block') used = this.placeBlock(f);
    else if (sp.kind === 'dash') {
      [f.dashX, f.dashY] = norm(ax, ay);
      f.dashTime = sp.time;
      used = true;
      this.events.push({ type: 'dash', fighter: f });
    } else if (sp.kind === 'stealth') {
      f.stealthTime = sp.time;
      used = true;
      this.events.push({ type: 'stealth', fighter: f });
    }
    if (!used) return;
    f.specialCd = sp.cooldown || 0;
    f.usesLeft--;
  }

  // 바라보는 방향으로 나무를 넘어 점프. 착지할 곳이 막혀 있으면 거리를 바꿔 보고, 다 막히면 안 뛴다
  startJump(f, sp) {
    for (const k of [1, 0.8, 1.25, 0.6, 1.5]) {
      const x = Math.max(-HW + f.body, Math.min(HW - f.body, f.x + f.fx * sp.distance * k));
      const y = Math.max(-HH + f.body, Math.min(HH - f.body, f.y + f.fy * sp.distance * k));
      if (this.blocked(f, x, y)) continue;
      f.jumpFrom = { x: f.x, y: f.y };
      f.jumpTo = { x, y };
      f.jumpTime = sp.time;
      this.events.push({ type: 'jump', fighter: f });
      return true;
    }
    return false;
  }

  updateJump(f, dt) {
    const sp = f.mv.special;
    f.jumpTime = Math.max(0, f.jumpTime - dt);
    const t = 1 - f.jumpTime / sp.time;
    f.x = f.jumpFrom.x + (f.jumpTo.x - f.jumpFrom.x) * t;
    f.y = f.jumpFrom.y + (f.jumpTo.y - f.jumpFrom.y) * t;
    if (f.jumpTime <= 0) this.events.push({ type: 'land', fighter: f });
  }

  blink(f, sp, ax, ay) {
    const options = diagonalsFor(ax, ay);
    for (const [bx, by] of options) {
      for (const k of [1, 0.75, 0.5]) {
        const x = Math.max(-HW + f.body, Math.min(HW - f.body, f.x + bx * sp.distance * k));
        const y = Math.max(-HH + f.body, Math.min(HH - f.body, f.y + by * sp.distance * k));
        if (this.blocked(f, x, y)) continue;
        this.events.push({ type: 'blink', fighter: f, from: { x: f.x, y: f.y } });
        f.x = x; f.y = y; f.fx = bx; f.fy = by;
        return true;
      }
    }
    return false;
  }

  // 등 뒤 칸에 벽 블록 설치 (술래가 서 있는 칸에는 못 놓음)
  //   바로 뒤 칸이 내 몸과 겹치면 (칸 경계 가까이 서 있을 때) 한 뼘씩 더 뒤 칸을 본다 — 자기 블록에 끼어 못 움직이지 않게
  placeBlock(f) {
    const foe = this.foeOf(f);
    const fc = cellOf(foe.x, foe.y), mine = cellOf(f.x, f.y);
    for (const back of [12, 18, 24, 30]) {
      const { c, r } = cellOf(f.x - f.fx * (f.body + back), f.y - f.fy * (f.body + back));
      if (!inGrid(c, r) || this.grid[r][c] !== OPEN) continue;
      if ((fc.c === c && fc.r === r) || (mine.c === c && mine.r === r)) continue;
      this.grid[r][c] = BLOCK;
      // 블록이 누군가의 몸(점프 중인 술래는 착지할 자리)과 겹치면 취소
      const landing = foe.jumpTime > 0 ? foe.jumpTo : foe;
      if (this.blocked(f, f.x, f.y) || this.blocked(foe, foe.x, foe.y) || this.blocked(foe, landing.x, landing.y)) {
        this.grid[r][c] = OPEN;
        continue;
      }
      this.events.push({ type: 'block', fighter: f, c, r });
      return true;
    }
    return false;
  }

  finish(winner, reason) {
    this.winner = winner;
    this.reason = reason;
    this.events.push({ type: 'end', winner, reason });
  }
}
