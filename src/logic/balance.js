// 밸런스 수치 모음 — 플레이테스트하면서 여기 숫자만 바꾸면 된다.

// 기획서 4장 기물 스탯 (HP는 내부에서 ×10)
export const STATS = {
  P: { hp: 2, atk: 2, spd: 4 },
  N: { hp: 3, atk: 3, spd: 4 },
  B: { hp: 3, atk: 4, spd: 3 },
  R: { hp: 5, atk: 5, spd: 2 },
  Q: { hp: 5, atk: 5, spd: 4 },
  K: { hp: 4, atk: 3, spd: 2 },
};

// 체스 기물 가치 (자이언트 킬 판정용)
export const VALUE = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 100 };

// 체스판 규칙 (기획서 7장)
export const BOARD = {
  healPerTurn: 10,   // 킹 주변 8칸 아군 회복량 (자기 수를 둘 때마다, 눈금 1칸 = 10)
  winReward: 10,     // 공격 승리 시 HP 회복
  veteranHp: 10,     // 베테랑 승격: 최대 HP 증가량
  veteranAtk: 1,     // 베테랑 승격: 공격 스탯 증가량
};

// 탑다운 액션 전투 — 공통
export const TOPDOWN = {
  duration: 20,          // 전투 시간(초). 끝날 때까지 KO가 없으면 방어 성공 (둘 다 제자리)
  hpScale: 10,           // HP 스탯 × 이 값 = 실제 HP
  moveSpeedBase: 50,     // 이동 속도(px/초) = base + 속도 스탯 × perSpd
  moveSpeedPerSpd: 20,
  damageBase: 3,         // 한 대 피해 = base + 공격 스탯 (기술마다 배율)
  attackMoveSlow: 0.5,   // 근접 공격 중 이동 속도 배율
  hitInvuln: 0.35,       // 맞은 뒤 무적 시간(초)
  knockback: 180,        // 맞았을 때 밀려나는 속도
  arena: { w: 560, h: 240 }, // 경기장 크기 (화면은 640×360)
  startGap: 260,         // 시작할 때 두 말 사이 거리
};

// 탑다운 액션 전투 — 기물별 공격(attack)·특수(special) (기획서 5장)
//   melee: reach = 판정 위치(몸 중심에서 앞으로), radius = 판정 크기, active = 판정 유지 시간
//   cooldown은 모두 초 단위
export const MOVES = {
  // 폰: 작고 빠름 / 짧은 찌르기 / 짧은 앞 대시
  P: {
    body: 7,
    attack: { kind: 'melee', reach: 16, radius: 8, active: 0.1, cooldown: 0.35 },
    special: { kind: 'dash', aim: 'facing', time: 0.12, speedMul: 3.0, cooldown: 1.0 },
  },
  // 나이트: 근접 베기(넓음) / L자 점프 — 공중에선 무적, 착지할 때 주변 피해
  N: {
    body: 10,
    attack: { kind: 'melee', reach: 13, radius: 15, active: 0.14, cooldown: 0.5 },
    special: { kind: 'jump', forward: 64, side: 32, time: 0.4, landRadius: 30, damageMul: 0.8, cooldown: 2.0 },
  },
  // 비숍: 투사체 (바라보는 8방향) / 대각선 순간이동
  B: {
    body: 10,
    attack: { kind: 'bolt', speed: 220, radius: 5, range: 300, cooldown: 0.6 },
    special: { kind: 'blink', distance: 72, invuln: 0.15, cooldown: 1.6 },
  },
  // 룩: 높은 맷집(덜 밀림) / 강한 근접 타격 / 직선 돌진 — 벽에 부딪히면 기절
  R: {
    body: 11,
    knockbackTaken: 0.4,
    attack: { kind: 'melee', reach: 16, radius: 13, active: 0.14, cooldown: 0.7 },
    special: { kind: 'charge', speedMul: 3.0, maxTime: 0.7, damageMul: 1.0, knockback: 340, wallStun: 0.9, cooldown: 2.0 },
  },
  // 퀸: 만능 / 근접 + 약한 투사체 / 8방향 대시
  Q: {
    body: 10,
    attack: {
      kind: 'melee', reach: 14, radius: 12, active: 0.12, cooldown: 0.5,
      bolt: { speed: 200, radius: 4, range: 220, damageMul: 0.5 },
    },
    special: { kind: 'dash', aim: 'input', time: 0.16, speedMul: 3.2, cooldown: 1.0 },
  },
  // 킹: 약한 근접 / 실드 — 게임 전체에서 1회, 켜져 있는 동안 모든 피해 무효
  K: {
    body: 10,
    attack: { kind: 'melee', reach: 13, radius: 10, active: 0.12, cooldown: 0.5 },
    special: { kind: 'shield', time: 3.0 },
  },
};

// 턴제 전투 (기획서 3장·5장) — 매 턴 양쪽이 행동 하나를 몰래 고르고 동시 공개
//   상성: 공격 → 스킬·회복을 끊음 / 방어 → 공격을 막고 반격 / 스킬 → 방어를 뚫음
//   집중: 이번 턴은 아무것도 안 하고 다음 턴 피해 2배 (집중하는 턴에 맞으면 그대로 맞음)
//   회복: HP 회복 (공격받으면 끊김)
//   한 번 피해 D = (damageBase + 공격 스탯) × damageMul
export const TURN = {
  maxTurns: 8,          // 이 턴 수 동안 KO가 없으면 방어 성공 (둘 다 제자리) — 탑다운과 같은 규칙
  hpMul: 1.5,           // 턴제에서는 HP를 이만큼 늘려서 싸운다 (끝나면 원래 비율로 판에 돌아감)
  pickTime: 3,          // 선택 시간(초). 마지막 입력만 유효, 안 고르면 방어
  damageMul: 1.5,
  counterMul: 0.6,      // 방어 성공 시 반격 = D × 이 값
  skillCooldown: 1,     // 스킬을 쓴 다음 턴은 스킬 사용 불가 (연속 사용 금지)
  defendCooldown: 1,    // 방어도 연속 사용 금지 — 방어만 눌러서 5턴 버티는 걸 막는다
  pierceMul: 1.5,       // 스킬이 방어를 뚫으면 스킬 피해 × 이 값
  focusMul: 2,          // 집중한 다음 턴 피해 배율
  focusCooldown: 1,     // 집중 연속 사용 금지
  healRatio: 0.25,      // 회복량 = 최대 HP × 이 값
  healCooldown: 1,      // 회복 연속 사용 금지
  healUses: 2,          // 전투당 회복 횟수
};

// 기물별 턴제 스킬 (dmg = D에 곱하는 배율)
//   cuttable: false 이면 상대의 '공격'에 끊기지 않음
export const TURN_SKILLS = {
  P: { name: '찌르기 연타', desc: '약한 피해 2회', hits: 2, dmg: 0.6 },
  N: { name: '허를 찌름', desc: '다음 턴 상대가 먼저 고르고 공개됨', dmg: 0.6, foresight: true },
  B: { name: '저주', desc: '2턴 동안 상대 피해 40% 감소', dmg: 0.4, curseTurns: 2, curseMul: 0.6 },
  R: { name: '성벽', desc: '이번 턴 받는 피해 모두 무효', dmg: 0, wall: true, cuttable: false },
  Q: { name: '연속 행동', desc: '공격 + 방어를 동시에 (1회)', combo: true, cuttable: false, once: true },
  K: { name: '위엄', desc: '상대가 이번에 고른 행동을 다음 턴 봉인', dmg: 0.4, seal: true },
};

// 추격전 (기획서 3장·5장) — 공격자 = 술래, 수비자 = 도망자. 잡으면 공격 성공, 버티면 방어 성공 (둘 다 제자리)
//   추격전은 HP가 변하지 않는다 (승자 보상도 없음, 기획서 7장)
export const CHASE = {
  duration: 12,          // 버텨야 하는 시간(초)
  tile: 20,              // 미로 한 칸 크기
  cols: 28, rows: 12,    // 미로 크기 (28×20 = 560, 12×20 = 240 → 투기장과 같은 크기)
  treeDensity: 0.24,     // 나무 비율
  gapCount: 8,           // 폰만 지나가는 좁은 틈(덤불) 개수
  startGap: 300,         // 시작 거리
  speedMul: 1.0,         // 추격전 이동 속도 = 탑다운 이동 속도 × 이 값
  chaserSpeedMul: 1.0,   // 술래 속도 보정 (1 = 보정 없음)
  hitHalf: 6,            // 미로 벽 충돌 크기(정사각형 반지름). 한 칸 통로를 편하게 지나가도록 몸보다 작게
};

// 기물별 추격전 능력 — chaser = 술래일 때, runner = 도망자일 때
//   passive: 'ramp'(같은 방향으로 계속 가면 가속, 꺾으면 감속) / 'diagonal'(대각선 이동 시 가속) / 'gap'(좁은 틈 통과)
//   special: 스킬 키로 쓰는 능력. uses = 전투당 횟수 (없으면 쿨타임만)
export const CHASE_MOVES = {
  P: {
    chaser: { passive: { kind: 'ramp', from: 1.0, to: 1.4, time: 0.8 }, desc: '빠르지만 앞으로만 가속' },
    runner: { passive: { kind: 'gap' }, desc: '작은 몸집으로 좁은 틈(덤불) 통과' },
  },
  N: {
    chaser: { special: { kind: 'jump', distance: 50, time: 0.35, cooldown: 2.0 }, desc: '벽(나무) 넘기 점프' },
    runner: { special: { kind: 'jump', distance: 50, time: 0.35, cooldown: 2.0 }, desc: '점프로 막다른 길 탈출' },
  },
  B: {
    chaser: { passive: { kind: 'diagonal', mul: 1.35 }, desc: '대각선 이동 시 가속' },
    runner: { special: { kind: 'blink', distance: 64, uses: 1 }, desc: '대각선 순간이동 1회' },
  },
  R: {
    chaser: { passive: { kind: 'ramp', from: 0.8, to: 1.9, time: 0.7 }, desc: '직선 질주 최고 속도, 커브 약함' },
    runner: { speedMul: 0.85, special: { kind: 'block', cooldown: 2.5, uses: 4 }, desc: '느림, 뒤에 벽 블록 설치' },
  },
  Q: {
    chaser: { special: { kind: 'dash', time: 0.18, speedMul: 2.6, cooldown: 1.6 }, desc: '균형형 (대시)' },
    runner: { special: { kind: 'dash', time: 0.18, speedMul: 2.6, cooldown: 1.6 }, desc: '균형형 (대시)' },
  },
  K: {
    chaser: { speedMul: 0.9, desc: '느림' },
    runner: { special: { kind: 'stealth', time: 3.0, uses: 1 }, desc: '은신 3초 (1회)' },
  },
};
