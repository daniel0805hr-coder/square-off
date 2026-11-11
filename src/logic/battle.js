// 탑다운 액션 전투 — 화면·키보드와 무관한 순수 로직.
// 매 프레임 step(dt, inputs)로 진행하고, 화면은 fighters/projectiles/events를 읽어서 그린다.
// inputs = { 1: { up, down, left, right, attack, special }, 2: {...} }
//   이동 4개는 "누르고 있는가", attack/special은 "이번 프레임에 눌렀는가"

import { STATS, MOVES, ULTIMATES, TOPDOWN as T } from './balance.js';
import { WHITE } from './chess.js';
import { maxHp, currentHp, attackStat } from './units.js';

const HW = T.arena.w / 2, HH = T.arena.h / 2;
const sign = (v) => (v < 0 ? -1 : 1);
const norm = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };

// 방향에 가까운 대각선 (정면이면 양쪽 대각선 두 후보) — 비숍 순간이동용
export function diagonalsFor(fx, fy) {
  const D = Math.SQRT1_2;
  if (Math.abs(fx) > 0.3 && Math.abs(fy) > 0.3) return [[sign(fx) * D, sign(fy) * D]];
  if (Math.abs(fx) >= Math.abs(fy)) return [[sign(fx) * D, D], [sign(fx) * D, -D]];
  return [[D, sign(fy) * D], [-D, sign(fy) * D]];
}

function makeFighter(piece, role, shieldReady) {
  const left = piece.color === WHITE; // 백(P1)은 왼쪽, 흑(P2)은 오른쪽에서 시작
  const mv = MOVES[piece.type];
  return {
    role, piece, type: piece.type, mv,
    player: left ? 1 : 2,
    x: left ? -T.startGap / 2 : T.startGap / 2,
    y: 0,
    fx: left ? 1 : -1, fy: 0, // 바라보는 방향
    hp: currentHp(piece), maxHp: maxHp(piece),
    damage: T.damageBase + attackStat(piece),
    speed: T.moveSpeedBase + STATS[piece.type].spd * T.moveSpeedPerSpd,
    body: mv.body,
    attackTime: 0, attackCd: 0, attackHit: false,
    specialCd: 0,
    ult: ULTIMATES[piece.type], ultUsed: false,
    // 대시·점프·돌진은 평소 스킬과 필살기가 같은 움직임을 쓴다. *Spec = 지금 쓰는 쪽의 수치
    dashTime: 0, dashX: 0, dashY: 0, dashSpec: mv.special, dashLeft: 0, dashHit: false,
    jumpTime: 0, jumpFrom: null, jumpTo: null, jumpSpec: mv.special,
    chargeTime: 0, chargeX: 0, chargeY: 0, chargeSpec: mv.special, chargeLeft: 0,
    stun: 0, shieldTime: 0, shieldReady: Boolean(shieldReady), shieldUsed: false,
    invuln: 0, kbx: 0, kby: 0,
  };
}

export class Battle {
  // attacker, defender: 판 위 기물 { type, color, hp?, vet? }
  // opts.shields: { w: bool, b: bool } — 그 색 킹이 실드를 아직 안 썼는가
  // opts.deathmatch: 킹 결전 — 시간 제한 없이 한쪽이 쓰러질 때까지
  constructor(attacker, defender, opts = {}) {
    const shields = opts.shields || {};
    this.fighters = [
      makeFighter(attacker, 'attacker', shields[attacker.color]),
      makeFighter(defender, 'defender', shields[defender.color]),
    ];
    this.projectiles = [];
    this.deathmatch = Boolean(opts.deathmatch);
    this.timeLeft = this.deathmatch ? Infinity : T.duration;
    this.events = []; // 이번 step에서 일어난 일 (화면 연출용)
    this.winner = null; // 'attacker' | 'defender'
    this.reason = null; // 'ko' | 'time'
  }

  get attacker() { return this.fighters[0]; }
  get defender() { return this.fighters[1]; }
  get finished() { return this.winner !== null; }
  foeOf(f) { return f === this.fighters[0] ? this.fighters[1] : this.fighters[0]; }

  step(dt, inputs) {
    this.events = [];
    if (this.finished) return;
    this.timeLeft = Math.max(0, this.timeLeft - dt);

    for (const f of this.fighters) this.control(f, inputs[f.player] || {}, dt);
    this.separate();
    for (const f of this.fighters) this.checkMelee(f, this.foeOf(f));
    this.updateProjectiles(dt);

    const dead = this.fighters.find((f) => f.hp <= 0);
    if (dead) this.finish(dead.role === 'attacker' ? 'defender' : 'attacker', 'ko');
    else if (this.timeLeft <= 0) this.finish('defender', 'time'); // 버티면 방어 성공
  }

  busy(f) {
    return f.stun > 0 || f.jumpTime > 0 || f.chargeTime > 0 || f.dashTime > 0;
  }

  // 공중(점프)이나 무적 상태가 아니면 맞을 수 있다
  canBeHit(f) {
    return f.invuln <= 0 && f.jumpTime <= 0;
  }

  control(f, inp, dt) {
    let dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    let dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
    const moving = dx !== 0 || dy !== 0;
    if (moving) [dx, dy] = norm(dx, dy);
    if (moving && !this.busy(f)) { f.fx = dx; f.fy = dy; }

    if (!this.busy(f)) {
      if (inp.attack && f.attackCd <= 0) this.doAttack(f);
      if (inp.ultimate && !f.ultUsed) this.doUltimate(f, moving ? dx : f.fx, moving ? dy : f.fy, moving ? dx : 0, moving ? dy : 0);
      else if (inp.special && f.specialCd <= 0) this.doSpecial(f, moving ? dx : f.fx, moving ? dy : f.fy, moving ? dx : 0, moving ? dy : 0);
    }

    // 이동
    let vx = 0, vy = 0;
    if (f.stun > 0) {
      // 기절: 넉백만
    } else if (f.jumpTime > 0) {
      this.updateJump(f, dt);
    } else if (f.chargeTime > 0) {
      vx = f.chargeX * f.speed * f.chargeSpec.speedMul;
      vy = f.chargeY * f.speed * f.chargeSpec.speedMul;
    } else if (f.dashTime > 0) {
      vx = f.dashX * f.speed * f.dashSpec.speedMul;
      vy = f.dashY * f.speed * f.dashSpec.speedMul;
    } else {
      const mul = f.attackTime > 0 ? T.attackMoveSlow : 1;
      vx = dx * f.speed * mul;
      vy = dy * f.speed * mul;
    }
    f.x += (vx + f.kbx) * dt;
    f.y += (vy + f.kby) * dt;
    const decay = Math.exp(-10 * dt);
    f.kbx *= decay; f.kby *= decay;

    const hitWall = this.clamp(f);
    if (f.chargeTime > 0) {
      if (hitWall) {
        f.chargeTime = 0;
        if (f.chargeSpec.wallStun > 0) {
          f.stun = f.chargeSpec.wallStun;
          f.chargeLeft = 0;
          this.events.push({ type: 'wallStun', fighter: f });
        }
      } else {
        f.chargeTime = Math.max(0, f.chargeTime - dt);
        this.checkCharge(f, this.foeOf(f));
      }
      if (f.chargeTime <= 0 && f.chargeLeft > 0 && f.stun <= 0) { f.chargeLeft--; this.startCharge(f, this.foeOf(f).x - f.x, this.foeOf(f).y - f.y); }
    }
    if (f.dashTime > 0 && f.dashSpec.damageMul) this.checkRush(f, this.foeOf(f));

    f.attackTime = Math.max(0, f.attackTime - dt);
    f.attackCd = Math.max(0, f.attackCd - dt);
    f.specialCd = Math.max(0, f.specialCd - dt);
    f.dashTime = Math.max(0, f.dashTime - dt);
    if (f.dashTime <= 0 && f.dashLeft > 0) { f.dashLeft--; this.startDash(f, f.fx, f.fy); } // 필살기 연속 대시
    f.stun = Math.max(0, f.stun - dt);
    f.shieldTime = Math.max(0, f.shieldTime - dt);
    f.invuln = Math.max(0, f.invuln - dt);
  }

  // 경기장 밖으로 못 나가게. 벽에 닿았으면 true
  clamp(f) {
    const hw = HW - f.body, hh = HH - f.body;
    const cx = Math.max(-hw, Math.min(hw, f.x)), cy = Math.max(-hh, Math.min(hh, f.y));
    const hit = cx !== f.x || cy !== f.y;
    f.x = cx; f.y = cy;
    return hit;
  }

  // ───────── 공격 ─────────

  doAttack(f) {
    const atk = f.mv.attack;
    f.attackCd = atk.cooldown;
    if (atk.kind === 'melee') {
      f.attackTime = atk.active;
      f.attackHit = false;
      this.events.push({ type: 'swing', fighter: f });
      if (atk.bolt) this.fire(f, f.fx, f.fy, atk.bolt, atk.bolt.damageMul);
    } else if (atk.kind === 'bolt') {
      this.fire(f, f.fx, f.fy, atk, 1);
    }
  }

  fire(f, dx, dy, spec, damageMul) {
    this.projectiles.push({
      owner: f, x: f.x + dx * f.body, y: f.y + dy * f.body,
      vx: dx * spec.speed, vy: dy * spec.speed, radius: spec.radius,
      damage: Math.max(1, Math.round(f.damage * damageMul)), travelled: 0, range: spec.range,
    });
    this.events.push({ type: 'shoot', fighter: f });
  }

  // 근접 공격 판정 위치 (화면에서 휘두르는 모양 그릴 때도 사용)
  hitPoint(f) {
    const reach = f.mv.attack.reach;
    return { x: f.x + f.fx * reach, y: f.y + f.fy * reach };
  }

  checkMelee(from, to) {
    if (from.attackTime <= 0 || from.attackHit || !this.canBeHit(to)) return;
    const p = this.hitPoint(from);
    if (Math.hypot(p.x - to.x, p.y - to.y) > from.mv.attack.radius + to.body) return;
    from.attackHit = true;
    this.damage(from, to, from.damage, from.fx, from.fy, T.knockback);
  }

  updateProjectiles(dt) {
    for (const p of this.projectiles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.travelled += Math.hypot(p.vx, p.vy) * dt;
      const target = this.foeOf(p.owner);
      if (!p.dead && this.canBeHit(target) && Math.hypot(p.x - target.x, p.y - target.y) < p.radius + target.body) {
        const [nx, ny] = norm(p.vx, p.vy);
        this.damage(p.owner, target, p.damage, nx, ny, T.knockback * 0.5);
        p.dead = true;
      }
      if (Math.abs(p.x) > HW || Math.abs(p.y) > HH || p.travelled > p.range) p.dead = true;
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  // 피해 처리 (실드 중이면 막힘)
  damage(from, to, amount, nx, ny, knockback) {
    if (to.shieldTime > 0) {
      to.invuln = T.hitInvuln;
      this.events.push({ type: 'blocked', from, to });
      return;
    }
    to.hp = Math.max(0, to.hp - amount);
    to.invuln = T.hitInvuln;
    const kbMul = to.mv.knockbackTaken ?? 1;
    to.kbx = nx * knockback * kbMul;
    to.kby = ny * knockback * kbMul;
    this.events.push({ type: 'hit', from, to, damage: amount });
  }

  // ───────── 특수 ─────────

  // (ax, ay) = 조준 방향(입력 또는 바라보는 방향), (ix, iy) = 지금 누르고 있는 이동 방향
  doSpecial(f, ax, ay, ix, iy) {
    const sp = f.mv.special;
    if (sp.kind === 'shield') {
      if (!f.shieldReady || f.shieldUsed) return;
      f.shieldUsed = true;
      f.shieldTime = sp.time;
      f.specialCd = Infinity;
      this.events.push({ type: 'shield', fighter: f });
      return;
    }
    f.specialCd = sp.cooldown;

    if (sp.kind === 'dash') {
      f.dashSpec = sp;
      f.dashLeft = 0;
      if (sp.aim === 'facing') this.startDash(f, f.fx, f.fy);
      else this.startDash(f, ...norm(ax, ay));
    } else if (sp.kind === 'jump') {
      this.startJump(f, sp, ix, iy);
    } else if (sp.kind === 'blink') {
      this.blink(f, sp, ax, ay);
    } else if (sp.kind === 'charge') {
      f.chargeSpec = sp;
      f.chargeLeft = 0;
      this.startCharge(f, f.fx, f.fy);
    }
  }

  // 필살기 (전투당 1회). 평소 스킬의 강화판
  doUltimate(f, ax, ay, ix, iy) {
    const u = f.ult;
    f.ultUsed = true;
    this.events.push({ type: 'ultimate', fighter: f, name: u.name });
    if (u.kind === 'rush') {
      f.dashSpec = u;
      f.dashLeft = u.count - 1;
      this.startDash(f, ...norm(ax, ay));
    } else if (u.kind === 'jump') {
      this.startJump(f, u, ix, iy);
    } else if (u.kind === 'volley') {
      this.blink(f, u, ax, ay);
      for (let i = 0; i < u.bolts; i++) {
        const a = (i / u.bolts) * Math.PI * 2;
        this.fire(f, Math.cos(a), Math.sin(a), u, u.damageMul);
      }
    } else if (u.kind === 'charge') {
      f.chargeSpec = u;
      f.chargeLeft = u.count - 1;
      const foe = this.foeOf(f);
      this.startCharge(f, foe.x - f.x, foe.y - f.y);
    } else if (u.kind === 'nova') {
      const foe = this.foeOf(f);
      this.events.push({ type: 'nova', fighter: f, radius: u.radius });
      if (Math.hypot(foe.x - f.x, foe.y - f.y) < u.radius + foe.body && this.canBeHit(foe)) {
        const [nx, ny] = norm(foe.x - f.x, foe.y - f.y);
        this.damage(f, foe, Math.max(1, Math.round(f.damage * u.damageMul)), nx, ny, u.knockback);
      }
    }
  }

  startDash(f, dx, dy) {
    [f.dashX, f.dashY] = [dx, dy];
    f.fx = dx; f.fy = dy;
    f.dashTime = f.dashSpec.time;
    f.dashHit = false;
    f.invuln = Math.max(f.invuln, f.dashSpec.time);
    this.events.push({ type: 'dash', fighter: f });
  }

  // 필살기 대시: 부딪히면 피해 (대시마다 1번)
  checkRush(f, foe) {
    if (f.dashHit || Math.hypot(foe.x - f.x, foe.y - f.y) > f.body + foe.body + 4 || !this.canBeHit(foe)) return;
    f.dashHit = true;
    this.damage(f, foe, Math.max(1, Math.round(f.damage * f.dashSpec.damageMul)), f.dashX, f.dashY, T.knockback);
  }

  // 직선 4방향으로만 돌진
  startCharge(f, dx, dy) {
    if (Math.abs(dx) >= Math.abs(dy)) { f.chargeX = sign(dx); f.chargeY = 0; } else { f.chargeX = 0; f.chargeY = sign(dy); }
    f.fx = f.chargeX; f.fy = f.chargeY;
    f.chargeTime = f.chargeSpec.maxTime;
    this.events.push({ type: 'charge', fighter: f });
  }

  startJump(f, sp, ix, iy) {
    // L자: 앞으로 2칸 + 옆으로 1칸. 옆 방향은 누르고 있는 방향 쪽 (없으면 오른쪽)
    f.jumpSpec = sp;
    const px = -f.fy, py = f.fx;
    const side = ix * px + iy * py < 0 ? -1 : 1;
    f.jumpFrom = { x: f.x, y: f.y };
    f.jumpTo = {
      x: Math.max(-HW + f.body, Math.min(HW - f.body, f.x + f.fx * sp.forward + px * side * sp.side)),
      y: Math.max(-HH + f.body, Math.min(HH - f.body, f.y + f.fy * sp.forward + py * side * sp.side)),
    };
    f.jumpTime = sp.time;
    this.events.push({ type: 'jump', fighter: f });
  }

  blink(f, sp, ax, ay) {
    const options = diagonalsFor(ax, ay);
    // 정면이면 두 대각선 중 경기장 가운데 쪽으로
    const [bx, by] = options.length > 1
      ? options.sort((p, q) => (p[0] * f.x + p[1] * f.y) - (q[0] * f.x + q[1] * f.y))[0]
      : options[0];
    const from = { x: f.x, y: f.y };
    f.x += bx * sp.distance; f.y += by * sp.distance;
    this.clamp(f);
    f.fx = bx; f.fy = by;
    f.invuln = Math.max(f.invuln, sp.invuln);
    this.events.push({ type: 'blink', fighter: f, from });
  }

  updateJump(f, dt) {
    const sp = f.jumpSpec;
    f.jumpTime = Math.max(0, f.jumpTime - dt);
    const t = 1 - f.jumpTime / sp.time;
    f.x = f.jumpFrom.x + (f.jumpTo.x - f.jumpFrom.x) * t;
    f.y = f.jumpFrom.y + (f.jumpTo.y - f.jumpFrom.y) * t;
    if (f.jumpTime > 0) return;
    // 착지 — 주변 피해
    this.events.push({ type: 'land', fighter: f });
    const foe = this.foeOf(f);
    const dist = Math.hypot(foe.x - f.x, foe.y - f.y);
    if (dist < sp.landRadius + foe.body && this.canBeHit(foe)) {
      const [nx, ny] = norm(foe.x - f.x, foe.y - f.y);
      this.damage(f, foe, Math.max(1, Math.round(f.damage * sp.damageMul)), nx, ny, T.knockback);
    }
  }

  checkCharge(f, foe) {
    if (Math.hypot(foe.x - f.x, foe.y - f.y) > f.body + foe.body + 4) return;
    f.chargeTime = 0;
    if (!this.canBeHit(foe)) return;
    const sp = f.chargeSpec;
    this.damage(f, foe, Math.max(1, Math.round(f.damage * sp.damageMul)), f.chargeX, f.chargeY, sp.knockback);
  }

  // 두 몸이 겹치지 않게 밀어낸다 (점프 중이면 넘어간다)
  separate() {
    const [a, b] = this.fighters;
    if (a.jumpTime > 0 || b.jumpTime > 0) return;
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 0.01;
    const overlap = a.body + b.body - dist;
    if (overlap > 0) {
      const nx = dx / dist, ny = dy / dist;
      a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
      b.x += nx * overlap / 2; b.y += ny * overlap / 2;
      this.clamp(a); this.clamp(b);
    }
  }

  finish(winner, reason) {
    this.winner = winner;
    this.reason = reason;
    // 같은 순간에 둘 다 쓰러지면 수비자 승리 — HP 1로 버틴다 (HP 0인 말이 판에 남지 않게, 턴제와 같은 규칙)
    if (this[winner].hp <= 0) this[winner].hp = 1;
    this.events.push({ type: 'end', winner, reason });
  }
}
