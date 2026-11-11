// 밸런스 수치 모음 — 플레이테스트하면서 여기 숫자만 바꾸면 된다.

// 기획서 4장 기물 스탯 (HP는 내부에서 ×10)
// [밸런스 패치 1] 봇 승률 시뮬레이션 결과 폰 3%·나이트 18% vs 퀸 94%로 격차가 너무 컸다 (퀸·룩이 HP 5에 공격 5).
//   스탯 합을 9/10/10/10/10으로 압축 — 폰 HP+1, 룩 HP·공격 -1, 퀸 HP·공격·속도 -1/-2/-1.
//   기물 우열은 스탯 합이 아니라 기술(MOVES·스킬)로 남긴다. 퀸은 여전히 가장 강하지만 폰/나이트도 칸에 따라 이길 수 있다.
export const STATS = {
  P: { hp: 3, atk: 2, spd: 4 },
  N: { hp: 3, atk: 3, spd: 4 },
  B: { hp: 3, atk: 4, spd: 3 },
  R: { hp: 4, atk: 4, spd: 2 },
  Q: { hp: 4, atk: 3, spd: 3 },
  K: { hp: 4, atk: 3.5, spd: 2 }, // [패치 3] 공격 3→3.5 (요청)
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
    // [패치] 비숍·퀸 대비 너무 약해 공격 쿨 0.5→0.45, 점프 착지 피해 0.8→1.0배, 점프 쿨 2.0→1.6
    attack: { kind: 'melee', reach: 13, radius: 15, active: 0.14, cooldown: 0.45 },
    special: { kind: 'jump', forward: 64, side: 32, time: 0.4, landRadius: 30, damageMul: 1.0, cooldown: 1.6 },
  },
  // 비숍: 투사체 (바라보는 8방향) / 대각선 순간이동
  B: {
    body: 10,
    // [패치] 거리를 두고 쏘는 쪽이 압도(나이트 상대 99%) — 쿨 0.6→1.2, 판정 5→4
    attack: { kind: 'bolt', speed: 220, radius: 4, range: 300, cooldown: 1.2 },
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
      // [패치] 투사체 피해 0.5→0.3배, 대시 쿨 1.0→1.8 (퀸 탑다운 승률 94%→약 70%)
      bolt: { speed: 200, radius: 4, range: 220, damageMul: 0.3 },
    },
    special: { kind: 'dash', aim: 'input', time: 0.16, speedMul: 3.2, cooldown: 1.8 },
  },
  // 킹: 약한 근접 / 실드 — 게임 전체에서 1회, 켜져 있는 동안 모든 피해 무효
  K: {
    body: 10,
    attack: { kind: 'melee', reach: 13, radius: 10, active: 0.12, cooldown: 0.5 },
    special: { kind: 'shield', time: 2.5 }, // [패치] 3.0→2.5: 스탯 압축 뒤 킹이 폰·나이트를 95% 이기는 걸 완화
  },
};

// 탑다운 필살기 — 스킬 키를 길게 누르면 (짧게 누르면 평소 스킬). 전투당 1회.
//   평소 스킬의 강화판이라 기물 개성은 그대로. 하위 기물일수록 세게 (하위 기물이 역전할 기회)
//   rush: 연속 대시 (대시마다 부딪히면 피해) / jump: 큰 점프 / volley: 순간이동 + 8방향 투사체
//   charge: 기절 없는 연속 돌진 / nova: 내 주변 원형 범위 공격
//   봇 시뮬레이션(탑다운 400판): 필살기 전후 평균 승률 폰 30→35 나이트 32→35 비숍 59→54 룩 44→44 퀸 71→65 킹 63→67
//   (순서는 그대로, 격차만 조금 줄어듦). 나이트 착지 피해는 민감해서 1.6이면 나이트가 퀸을 33% 이김
export const ULTIMATE = {
  hold: 0.6, // 이만큼(초) 누르고 있으면 필살기
};
export const ULTIMATES = {
  P: { name: '돌격 연타', kind: 'rush', count: 3, time: 0.13, speedMul: 3.0, damageMul: 1.0 },
  N: { name: '대도약', kind: 'jump', forward: 96, side: 40, time: 0.5, landRadius: 48, damageMul: 1.45 },
  B: { name: '성광', kind: 'volley', distance: 72, invuln: 0.3, bolts: 8, speed: 220, radius: 5, range: 260, damageMul: 0.7 },
  R: { name: '파성추', kind: 'charge', count: 2, speedMul: 3.0, maxTime: 0.7, damageMul: 1.5, knockback: 340, wallStun: 0 },
  Q: { name: '여왕의 일섬', kind: 'nova', radius: 34, damageMul: 1.0, knockback: 260 },
  K: { name: '왕의 위압', kind: 'nova', radius: 44, damageMul: 0.7, knockback: 420 },
};

// 턴제 전투 (기획서 3장·5장) — 매 턴 양쪽이 행동 하나를 몰래 고르고 동시 공개
//   상성: 공격 → 스킬·회복을 끊음 / 방어 → 공격을 막고 반격 / 스킬 → 방어를 뚫음
//   집중: 이번 턴은 아무것도 안 하고 다음 턴 피해 2배 (집중하는 턴에 맞으면 그대로 맞음)
//   회복: HP 회복 (공격받으면 끊김)
//   한 번 피해 D = (damageBase + 공격 스탯) × damageMul
export const TURN = {
  maxTurns: 8,          // 이 턴 수 동안 KO가 없으면 판정: 남은 HP 비율이 높은 쪽 승리, 동률이면 방어자 승리 (기획서 3장 원안)
                        //   [패치] 예전엔 무조건 방어 성공(둘 다 제자리)이라 같은 말을 계속 다시 공격하게 됐다
  suddenDeathFrom: 5,   // 서든데스: 이 턴부터 양쪽 피해 증가
  suddenDeathStep: 0.25, //   턴마다 +25%씩 (5턴 ×1.25, 6턴 ×1.5, 7턴 ×1.75, 8턴 ×2)
  hpMul: 1.5,           // 턴제에서는 HP를 이만큼 늘려서 싸운다 (끝나면 원래 비율로 판에 돌아감)
  pickTime: 3,          // 선택 시간(초). 마지막 입력만 유효, 안 고르면 방어
  damageMul: 2.5,       // [패치] 1.5→2.5: 8턴 안에 KO가 거의 안 나서(공격 승률 4~15%) 시간 종료 방어 성공만 나왔다. 이제 동급 공격 승률 ~45%
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
  P: { name: '찌르기 연타', desc: '약한 피해 2회', hits: 2, dmg: 0.8 }, // [패치] 0.6→0.8
  N: { name: '허를 찌름', desc: '다음 턴 상대가 먼저 고르고 공개됨', dmg: 1.0, // [패치] 0.6→1.0
     foresight: true },
  B: { name: '저주', desc: '2턴 동안 상대 피해 50% 감소', dmg: 0.8, curseTurns: 2, curseMul: 0.5 }, // [패치] dmg 0.4→0.8, 감소 40→50%
  R: { name: '성벽', desc: '이번 턴 받는 피해 모두 무효', dmg: 0, wall: true, cuttable: false },
  // [패치] comboDmg: 공격 부분 피해 배율 (신설, 기본 1). 퀸 연속 행동이 같은 스탯의 비숍을 80% 이길 만큼 강해 0.5로
  Q: { name: '연속 행동', desc: '공격 + 방어를 동시에 (1회)', combo: true, comboDmg: 0.5, cuttable: false, once: true },
  K: { name: '위엄', desc: '상대가 이번에 고른 행동을 다음 턴 봉인', dmg: 1.0, seal: true }, // [패치 2] 0.4→1.0: 턴제 킹 평균 43%→55%
};

// 추격전 (기획서 3장·5장) — 공격자 = 술래, 수비자 = 도망자. 잡으면 공격 성공, 버티면 방어 성공 (둘 다 제자리)
//   추격전은 HP가 변하지 않는다 (승자 보상도 없음, 기획서 7장)
export const CHASE = {
  duration: 8,           // 버텨야 하는 시간(초). [패치] 12→8: 술래가 95%+ 잡아서 역할 승률이 기물 차이를 덮었다
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
    chaser: { passive: { kind: 'ramp', from: 1.0, to: 1.25, time: 0.8 }, desc: '빠르지만 앞으로만 가속' },
    runner: { passive: { kind: 'gap' }, desc: '작은 몸집으로 좁은 틈(덤불) 통과' },
  },
  N: {
    chaser: { special: { kind: 'jump', distance: 50, time: 0.35, cooldown: 2.8 }, desc: '벽(나무) 넘기 점프' }, // [패치] 점프 쿨 2.0→2.8 (추격전 최강이던 나이트 완화)
    runner: { special: { kind: 'jump', distance: 50, time: 0.35, cooldown: 2.8 }, desc: '점프로 막다른 길 탈출' },
  },
  B: {
    chaser: { passive: { kind: 'diagonal', mul: 1.35 }, desc: '대각선 이동 시 가속' },
    runner: { special: { kind: 'blink', distance: 64, uses: 1 }, desc: '대각선 순간이동 1회' },
  },
  R: {
    chaser: { passive: { kind: 'ramp', from: 0.8, to: 1.5, time: 0.7 }, desc: '직선 질주 최고 속도, 커브 약함' },
    runner: { speedMul: 0.9, special: { kind: 'block', cooldown: 2.5, uses: 4 }, desc: '느림, 뒤에 벽 블록 설치' },
  },
  Q: {
    chaser: { special: { kind: 'dash', time: 0.18, speedMul: 3.0, cooldown: 1.3 }, desc: '균형형 (대시)' },
    runner: { special: { kind: 'dash', time: 0.18, speedMul: 3.0, cooldown: 1.3 }, desc: '균형형 (대시)' },
  },
  K: {
    // [패치 2] 추격전 킹 평균 30%→39%: 술래 속도 0.9→1.05, 은신 3초 1회 → 4.5초 2회
    chaser: { speedMul: 1.05, desc: '약간 빠름' },
    runner: { special: { kind: 'stealth', time: 4.5, uses: 2 }, desc: '은신 4.5초 (2회)' },
  },
};
