// 칸 지형 = 그 칸에서 벌어지는 전투 방식 (기획서 8장)
//   arena    = 투기장 → 탑다운 액션
//   fortress = 성채   → 턴제
//   forest   = 숲     → 추격전

export const TERRAIN = {
  arena: { name: '투기장', battle: '탑다운 액션' },
  fortress: { name: '성채', battle: '턴제' },
  forest: { name: '숲', battle: '추격전' },
};
export const KINDS = ['arena', 'fortress', 'forest'];

// 대칭 랜덤 생성 규칙 (기획서 8장)
export const MAP_RULES = {
  perKind: [10, 12],  // 반쪽 32칸 기준 종류별 칸 수 범위
  maxRun: 3,          // 같은 종류가 가로/세로로 이보다 길게 이어지지 않음
  frontMin: 4,        // 3~4랭크(전선 16칸)에 종류별 최소 칸 수 — 골고루 섞기
};

// 반쪽(1~4랭크)을 만들고 5~8랭크는 같은 파일에서 위아래로 뒤집어 복사 (d1 ↔ d8).
// 킹 시작 칸(e1/e8)은 성채 고정. 결과는 board[r][c]와 같은 좌표 (r = 0이 8랭크).
export function generateMap(rng = Math.random) {
  for (let attempt = 0; attempt < 5000; attempt++) {
    const half = tryHalf(rng);
    if (half) return mirror(half);
  }
  return mirror(FALLBACK);
}

// half[i][c]: i = 0이 1랭크
function tryHalf(rng) {
  // 칸 수 정하기: 32칸을 10~12씩 나눔 (성채는 e1 포함)
  const [lo, hi] = MAP_RULES.perKind;
  const counts = {};
  let left = 32;
  const order = shuffle(KINDS.slice(), rng);
  order.forEach((k, i) => {
    if (i === order.length - 1) { counts[k] = left; return; }
    counts[k] = lo + Math.floor(rng() * (hi - lo + 1));
    left -= counts[k];
  });
  if (Object.values(counts).some((n) => n < lo || n > hi)) return null;

  const pool = [];
  for (const k of KINDS) for (let n = 0; n < counts[k]; n++) pool.push(k);
  pool.splice(pool.indexOf('fortress'), 1); // e1 몫
  shuffle(pool, rng);
  const half = Array.from({ length: 4 }, () => Array(8).fill(null));
  half[0][4] = 'fortress';
  let p = 0;
  for (let i = 0; i < 4; i++) for (let c = 0; c < 8; c++) if (!half[i][c]) half[i][c] = pool[p++];
  return validHalf(half) ? half : null;
}

export function validHalf(half) {
  if (half[0][4] !== 'fortress') return false;
  const max = MAP_RULES.maxRun;
  // 가로 연속
  for (const row of half) {
    let run = 1;
    for (let c = 1; c < 8; c++) { run = row[c] === row[c - 1] ? run + 1 : 1; if (run > max) return false; }
  }
  // 세로 연속 (반쪽 경계를 넘어 4랭크-5랭크도 같은 종류로 이어지므로 위아래로 이어 붙여서 확인)
  const full = [...half, ...half.slice().reverse()];
  for (let c = 0; c < 8; c++) {
    let run = 1;
    for (let i = 1; i < 8; i++) { run = full[i][c] === full[i - 1][c] ? run + 1 : 1; if (run > max) return false; }
  }
  // 전선(3~4랭크) 골고루
  const front = [...half[2], ...half[3]];
  return KINDS.every((k) => front.filter((x) => x === k).length >= MAP_RULES.frontMin);
}

function mirror(half) {
  const rows = Array(8);
  half.forEach((row, i) => {
    rows[7 - i] = row.slice(); // 1~4랭크
    rows[i] = row.slice();     // 8~5랭크 (뒤집어 복사)
  });
  return rows;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 혹시 생성에 실패하면 쓰는 고정 맵 (규칙을 만족함)
const A = 'arena', F = 'fortress', W = 'forest';
const FALLBACK = [
  // a  b  c  d  e  f  g  h
  [A, W, W, W, F, W, A, W], // 1랭크
  [F, W, F, A, A, W, F, A], // 2랭크
  [A, F, A, W, W, A, A, F], // 3랭크
  [F, W, W, F, F, W, F, A], // 4랭크
];
