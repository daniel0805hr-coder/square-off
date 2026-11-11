// 체스말 도트 그림 (32×32). 화면·입력과 분리된 순수 데이터라 브라우저와 Node(시안 그리기) 둘 다 쓴다
//   대칭인 말(폰·룩·비숍·퀸·킹)은 줄마다 반폭(가운데에서 가장자리까지)을 적은 '옆모습'을 돌려 깎은 것처럼 그린다
//   나이트만 손으로 그린 격자
//   명암: 왼쪽 위에서 빛 → 원기둥 명암을 5단계로 끊어 칠함 (부드러운 그라데이션 대신 또렷한 면)

export const SIZE = 32;
const CX = 16; // 가운데 (15|16 사이)

// 색: o 테두리, 0~4 어두운 면 → 밝은 면 (4 = 하이라이트 한 줄)
//   metal: 장식 테·왕관 (0~4, 몸과 같은 명암 단계), gem: 보석 (어두운 · 가운데 · 밝은 · 반짝)
//   백 = 상아 대리석 + 금 + 사파이어(P1 파랑), 흑 = 흑단 + 은 + 루비(P2 빨강)
export const PALETTES = {
  w: {
    o: '#1c1418', 0: '#6e6258', 1: '#a3957f', 2: '#cfc3aa', 3: '#ece3cf', 4: '#fffdf6',
    metal: ['#5a3214', '#9a5e1c', '#d89a2a', '#ffd250', '#fff4b8'],
    gem: ['#14286a', '#2f6fe0', '#8cc4ff', '#ffffff'],
    grain: 'marble',
  },
  b: {
    o: '#08060a', 0: '#18121e', 1: '#2a2233', 2: '#3d3248', 3: '#5a4c68', 4: '#9a88aa',
    metal: ['#2c2f3c', '#5d6478', '#9aa3b8', '#d4dae6', '#ffffff'],
    gem: ['#5a0a18', '#d0283a', '#ff9a8a', '#ffffff'],
    grain: 'ebony',
  },
};
export const VETERAN_OUTLINE = '#ffd34a'; // 베테랑은 금 테두리
const FLASH = '#ffffff';
// 받침 맨 아랫줄 (테두리 포함 바닥은 이 한 칸 아래). 전투에서 말을 발 기준으로 세울 때 쓴다
export const BASE_Y = 28;

// ───────── 옆모습 조각 ─────────
// 한 줄(y)의 반폭을 정하는 조각들. 나중 조각이 앞 조각을 덮는다
const line = (y0, y1, w0, w1) => (y) => (y >= y0 && y <= y1 ? w0 + (w1 - w0) * ((y - y0) / Math.max(1, y1 - y0)) : null);
const ball = (cy, r) => (y) => {
  const d = y + 0.5 - cy;
  return Math.abs(d) <= r ? Math.sqrt(r * r - d * d) : null;
};
const row = (y, w) => line(y, y, w, w);

// 모든 말이 같이 쓰는 받침: 테 + 넓은 받침판
const BASE = [row(24, 6.5), row(25, 7.5), line(26, 27, 8.5, 8.5), row(28, 8)];

const PROFILES = {
  P: [ball(11.5, 4), row(16, 4.5), line(17, 23, 2.5, 5.5), ...BASE],
  R: [line(6, 11, 7, 7), row(12, 6), line(13, 22, 4.5, 5.5), row(23, 6.5), ...BASE],
  B: [ball(4, 1.6), line(6, 11, 1.5, 4.5), line(12, 15, 4.5, 3), row(16, 4.5), row(17, 3.5), line(18, 23, 2.5, 5.5), ...BASE],
  Q: [ball(2.5, 1.6), line(7, 9, 5.5, 4), row(10, 4.5), line(11, 23, 2, 5.5), row(14, 3.5), ...BASE],
  K: [line(7, 11, 5, 3.5), row(12, 4.5), line(13, 23, 2.5, 5.5), row(15, 3.5), ...BASE],
};

// 옆모습 위에 덧그리는 것 (x는 왼쪽부터 0~31)
//   cut: 지우기, ink: 테두리색으로 칠하기, add: 채우기(명암은 그 줄 기준)
const DETAILS = {
  // 룩: 성벽 톱니
  R: { cut: [[12, 6], [13, 6], [18, 6], [19, 6], [12, 7], [13, 7], [18, 7], [19, 7]] },
  // 비숍: 모자에 비스듬한 홈
  B: { ink: [[18, 8], [19, 8], [17, 9], [18, 9], [16, 10], [17, 10], [15, 11], [16, 11]] },
  // 퀸: 왕관 뾰족 4개 + 가운데 구슬 기둥
  Q: { add: [[10, 5], [10, 6], [13, 5], [13, 6], [15, 4], [16, 4], [15, 5], [16, 5], [15, 6], [16, 6], [18, 5], [18, 6], [21, 5], [21, 6]] },
  // 킹: 십자가
  K: { add: [[15, 1], [16, 1], [15, 2], [16, 2], [13, 3], [14, 3], [15, 3], [16, 3], [17, 3], [18, 3], [15, 4], [16, 4], [15, 5], [16, 5], [15, 6], [16, 6]] },
};

// 나이트: 왼쪽을 보는 말머리. 줄마다 [y, 앞(얼굴) x, 뒤(목덜미) x]
//   긴 주둥이 · 깊게 파인 목 아래 · 가는 목(7px) → 가슴으로 퍼짐
const KNIGHT = [
  [5, 16, 20], [6, 14, 21], [7, 13, 21], [8, 12, 22], [9, 11, 22], [10, 10, 22], [11, 9, 22], [12, 8, 22],
  [13, 7, 22], [14, 7, 22], [15, 8, 21], [16, 10, 21], [17, 14, 21], [18, 15, 21], [19, 14, 21],
  [20, 13, 22], [21, 12, 22], [22, 12, 22], [23, 11, 22],
];
// 귀: 앞 귀는 길고 뾰족, 뒤 귀는 짧게. [x, y, 명암]
const KNIGHT_EARS = [[16, 2, 3], [15, 3, 3], [16, 3, 2], [15, 4, 3], [16, 4, 2], [17, 4, 1], [20, 3, 1], [19, 4, 1], [20, 4, 1]];
// 갈기: 목덜미 뒤로 위를 향한 큰 가시 3개. [y, 길이] — 아랫줄로 갈수록 1칸씩 짧아진다
const KNIGHT_MANE = [[6, 3], [10, 3], [14, 3]];
const KNIGHT_INK = [[15, 9], [16, 9], [8, 13], [9, 15], [10, 15], [11, 15]]; // 눈썹·콧구멍·입

// ───────── 판타지 장식 ─────────
//   metalRows: 그 줄의 몸 전체를 금속 테로, metal: 낱 칸을 금속으로
//   gemRows: 그 줄을 보석으로 (둥근 보석 꼭지), gems: 사각 보석 { x, y, w, h } (왼쪽 위가 반짝)
const BASE_TRIM = [25, 28]; // 받침 테와 받침판 아래 테
const ORNAMENT = {
  P: { metalRows: [16, ...BASE_TRIM] },
  N: {
    metalRows: BASE_TRIM,
    // 굴레: 이마 끈 · 볼 끈 · 코 끈, 만나는 곳에 보석
    metal: [[15, 7], [16, 7], [17, 7], [18, 7], [19, 7], [19, 8], [18, 9], [17, 10], [16, 11], [15, 12],
      [8, 14], [9, 14], [10, 14], [11, 14], [12, 14]],
    gems: [{ x: 13, y: 13, w: 2, h: 2 }, { x: 14, y: 10, w: 2, h: 1 }], // 볼 보석, 빛나는 눈
  },
  B: { metalRows: [2, 3, 4, 5, 16, ...BASE_TRIM], gems: [{ x: 13, y: 10, w: 2, h: 3 }] }, // 모자 앞 보석
  R: { metalRows: [6, 12, 23, ...BASE_TRIM], gems: [{ x: 15, y: 15, w: 2, h: 4 }] }, // 빛나는 창
  Q: { metalRows: [4, 5, 6, 7, 8, 9, 10, 14, ...BASE_TRIM], gemRows: [1, 2, 3], gems: [{ x: 15, y: 7, w: 2, h: 2 }] },
  K: { metalRows: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, ...BASE_TRIM], gems: [{ x: 15, y: 3, w: 2, h: 1 }, { x: 15, y: 8, w: 2, h: 3 }] },
};

// 재질 결: 대리석은 드문 사선 결, 흑단은 짧은 세로 결. 가장 밝은 면(3)에서만 한 단계 어둡게 — 1배 크기에서 얼룩으로 보이지 않을 만큼만
const GRAIN = {
  marble: (x, y) => (x + y * 2) % 11 === 0 && y % 3 !== 0,
  ebony: (x, y) => x % 4 === 1 && y % 5 < 2,
};

// ───────── 그리기 ─────────

// 반폭 → 그 줄에 칠할 x 범위
const span = (hw) => [Math.round(CX - hw), Math.round(CX + hw) - 1];

// 원기둥 명암: u = -1(왼쪽 끝) ~ 1(오른쪽 끝). 왼쪽 위 빛
function shade(u) {
  if (u > -0.62 && u < -0.36) return 4; // 하이라이트 띠
  const lit = Math.sqrt(Math.max(0, 1 - u * u)) * 0.55 - u * 0.5;
  return lit > 0.62 ? 3 : lit > 0.3 ? 2 : lit > 0.02 ? 1 : 0;
}

// 몸 모양: 32×32 격자에 { tone: 0~4 } 또는 { ink } 또는 null
function bodyOf(type) {
  const g = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  const spans = Array(SIZE).fill(null); // 줄마다 [왼, 오른] (명암 계산용)
  if (type === 'N') {
    for (const [y, a, b] of KNIGHT) fillSpan(g, spans, y, a, b);
    for (const f of BASE) for (let y = 0; y < SIZE; y++) { const hw = f(y); if (hw !== null) fillRow(g, spans, y, hw); }
    for (const [x, y] of KNIGHT_INK) g[y][x] = { ink: true };
    // 귀와 갈기는 명암을 미리 정해 둔다 (줄 명암에 섞이면 얼룩 줄무늬가 생김)
    for (const [x, y, tone] of KNIGHT_EARS) g[y][x] = { tone };
    for (const [y0, len] of KNIGHT_MANE) {
      for (let j = 0; j < len; j++) {
        const y = y0 + j, back = KNIGHT.find((k) => k[0] === y)[2];
        // 윗줄(가시 윗면)은 빛을 받고 아래는 그늘
        for (let i = 1; i <= len - j; i++) g[y][back + i] ??= { tone: j === 0 ? 2 : 1 };
      }
    }
  } else {
    for (let y = 0; y < SIZE; y++) {
      let hw = null;
      for (const f of PROFILES[type]) { const v = f(y); if (v !== null) hw = v; }
      if (hw !== null && hw > 0.4) fillRow(g, spans, y, hw);
    }
    const d = DETAILS[type] || {};
    for (const [x, y] of d.cut || []) g[y][x] = null;
    for (const [x, y] of d.ink || []) g[y][x] = { ink: true };
    for (const [x, y] of d.add || []) {
      g[y][x] = { tone: null };
      if (!spans[y]) spans[y] = [x, x];
      spans[y] = [Math.min(spans[y][0], x), Math.max(spans[y][1], x)];
    }
  }
  // 명암: 줄마다 원기둥처럼, 턱(윗줄이 좁으면 밝은 윗면, 아랫줄이 좁으면 어두운 밑면)
  for (let y = 0; y < SIZE; y++) {
    if (!spans[y]) continue;
    const [a, b] = spans[y], mid = (a + b + 1) / 2, half = Math.max(1, (b - a + 1) / 2); // 칸 밖(귀 등)은 끝 명암
    for (let x = 0; x < SIZE; x++) {
      const c = g[y][x];
      if (!c || c.ink || c.tone !== null) continue;
      let t = shade(Math.max(-1, Math.min(1, (x + 0.5 - mid) / half)));
      const above = y > 0 && !g[y - 1][x], below = y < SIZE - 1 && !g[y + 1][x];
      if (above && t < 4) t = Math.min(3, t + 1);
      if (below && !above) t = Math.max(0, t - 1);
      c.tone = t;
    }
  }
  decorate(g, ORNAMENT[type] || {});
  return g;
}

// 장식 입히기: 명암은 그대로 두고 재질만 바꾼다
function decorate(g, o) {
  for (const y of o.metalRows || []) for (const c of g[y]) if (c && !c.ink) c.mat = 'metal';
  for (const [x, y] of o.metal || []) if (g[y][x] && !g[y][x].ink) g[y][x].mat = 'metal';
  for (const y of o.gemRows || []) for (const c of g[y]) if (c && !c.ink) c.mat = 'gem';
  for (const { x, y, w, h } of o.gems || []) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        // 왼쪽 위 반짝 · 위쪽 밝게 · 맨 아랫줄 어둡게
        const level = i === 0 && j === 0 ? 3 : j === h - 1 && h > 1 ? 0 : j === 0 ? 2 : 1;
        g[y + j][x + i] = { gem: level };
      }
    }
  }
}

function fillRow(g, spans, y, hw) {
  const [a, b] = span(hw);
  fillSpan(g, spans, y, a, b);
}

function fillSpan(g, spans, y, a, b) {
  for (let x = a; x <= b; x++) g[y][x] = { tone: null };
  spans[y] = [a, b];
}

const shapes = {};

function colorOf(c, pal, x, y) {
  if (c.ink) return pal.o;
  if (c.gem !== undefined) return pal.gem[c.gem];
  if (c.mat === 'metal') return pal.metal[c.tone];
  if (c.mat === 'gem') return pal.gem[c.tone >= 4 ? 3 : c.tone >= 3 ? 2 : c.tone >= 1 ? 1 : 0];
  const t = c.tone === 3 && GRAIN[pal.grain](x, y) ? 2 : c.tone;
  return pal[t];
}

// 말 그림 → RGBA 바이트 (32×32×4). color: 'w' | 'b'
//   vet: 베테랑 금 테두리, flash: 맞은 순간 하얗게 번쩍 (테두리는 남겨 모양 유지)
//   shadow: 바닥 그림자 (전투에서는 발밑 링이 그림자를 대신하므로 끔)
export function pieceRGBA(type, color, { vet = false, flash = false, shadow = true } = {}) {
  const g = (shapes[type] ??= bodyOf(type));
  const pal = PALETTES[color];
  const outline = vet ? VETERAN_OUTLINE : pal.o;
  const out = new Uint8ClampedArray(SIZE * SIZE * 4);
  const put = (x, y, hex, a = 255) => {
    const i = (y * SIZE + x) * 4, v = parseInt(hex.slice(1), 16);
    out[i] = v >> 16; out[i + 1] = (v >> 8) & 255; out[i + 2] = v & 255; out[i + 3] = a;
  };
  if (shadow) for (let x = 6; x <= 25; x++) put(x, BASE_Y + 2, '#000000', Math.abs(x - 15.5) < 8 ? 90 : 50);
  // 테두리: 몸 바깥 1칸 (대각선 제외 → 모서리가 날카롭게)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (g[y][x]) continue;
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g[y + dy]?.[x + dx]);
      if (near) put(x, y, outline);
    }
  }
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const c = g[y][x];
      if (c) put(x, y, flash ? FLASH : colorOf(c, pal, x, y));
    }
  }
  return out;
}
