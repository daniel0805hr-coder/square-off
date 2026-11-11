// 화면 공통 틀: 패널·창·판 테두리. 모든 화면이 같은 재질(흑단 + 금 장식)을 쓴다
export const UI = {
  bg: 0x111018,
  ink: 0x0b0a10,         // 가장 바깥 선
  panel: 0x1f1d28,       // 패널 바탕
  panelHi: 0x2b2836,     // 패널 안 띠·구역
  bevelHi: 0x4a4658,     // 입체 테두리 밝은 쪽 (왼쪽 위)
  bevelLo: 0x15131c,     // 입체 테두리 어두운 쪽 (오른쪽 아래)
  rule: 0x3a3746,        // 구분선
  gold: 0xc99a3a,        // 금 장식
  goldHi: 0xffd98a,
  wood: 0x2e211b,        // 판 테두리 흑단
  woodHi: 0x4a362b,
};
export const UI_HEX = {
  title: '#ffd98a', text: '#f2ead8', body: '#d8d2c4', muted: '#8d8798', label: '#a59db3', gold: '#c99a3a',
};

// 패널: 바깥 검은 선 → 입체 테두리 → 바탕, 네 모서리에 금 장식. accent가 있으면 테두리를 그 색으로 (차례 표시 등)
export function drawPanel(g, x, y, w, h, { accent = null, fill = UI.panel, alpha = 1 } = {}) {
  g.fillStyle(UI.ink, alpha).fillRect(x - 1, y - 1, w + 2, h + 2);
  g.fillStyle(accent ?? UI.bevelHi, alpha).fillRect(x, y, w, h);
  g.fillStyle(accent ?? UI.bevelLo, alpha).fillRect(x + 1, y + 1, w - 1, h - 1);
  g.fillStyle(fill, alpha).fillRect(x + 2, y + 2, w - 4, h - 4);
  corners(g, x, y, w, h, accent ? UI.goldHi : UI.gold);
  return g;
}

// 모서리 금 장식: ㄱ자 3px
export function corners(g, x, y, w, h, color = UI.gold) {
  g.fillStyle(color);
  for (const [cx, sx] of [[x, 1], [x + w - 1, -1]]) {
    for (const [cy, sy] of [[y, 1], [y + h - 1, -1]]) {
      g.fillRect(Math.min(cx, cx + sx * 2), cy, 3, 1);
      g.fillRect(cx, Math.min(cy, cy + sy * 2), 1, 3);
    }
  }
}

// 가운데 기준 창 (메뉴·안내). 컨테이너에 넣어 쓰도록 그래픽 객체를 돌려준다
export function windowAt(scene, cx, cy, w, h, opts) {
  return drawPanel(scene.add.graphics(), Math.round(cx - w / 2), Math.round(cy - h / 2), w, h, { alpha: 0.96, ...opts });
}

// 선택 표시 막대: 메뉴에서 고른 줄. 왼쪽에 도트 화살표
export function drawSelectBar(g, cx, cy, w, color = UI.gold) {
  const x = Math.round(cx - w / 2), y = Math.round(cy - 8);
  g.fillStyle(color, 0.18).fillRect(x, y, w, 16);
  g.fillStyle(color).fillRect(x, y, w, 1).fillRect(x, y + 15, w, 1);
  // 화살표 (오른쪽을 향한 4px 삼각형)
  for (let i = 0; i < 4; i++) g.fillRect(x + 6 + i, y + 4 + i, 1, 8 - i * 2);
  return g;
}

// 전투 화면 위쪽 정보 판: 양쪽 플레이어 판 + 가운데 시간 판 (세 전투 화면이 같은 자리)
export function drawBattleHud(g) {
  drawPanel(g, 12, 6, 238, 52);
  drawPanel(g, 390, 6, 238, 52);
  drawPanel(g, 278, 6, 84, 46);
  return g;
}

// 돌벽 테두리: 안쪽 사각형(x, y, w, h) 바깥으로 두께 t만큼 벽돌을 엇갈려 쌓는다 (안쪽은 비워 둠)
export function drawBrickWall(g, x, y, w, h, t, { stone = 0x5a5262, mortar = 0x2a2631, hi = 0x786e82 } = {}) {
  const X = x - t, Y = y - t, W = w + t * 2, H = h + t * 2;
  g.fillStyle(UI.ink).fillRect(X - 1, Y - 1, W + 2, H + 2);
  // 벽 네 줄기 (위·아래·왼쪽·오른쪽)
  for (const [sx, sy, sw, sh] of [[X, Y, W, t], [X, y + h, W, t], [X, y, t, h], [x + w, y, t, h]]) {
    g.fillStyle(mortar).fillRect(sx, sy, sw, sh);
    for (let by = Y; by < sy + sh; by += 5) {
      const row = (by - Y) / 5, y0 = Math.max(by, sy), y1 = Math.min(by + 4, sy + sh);
      if (y1 <= y0) continue;
      for (let bx = X - (row % 2) * 6; bx < sx + sw; bx += 12) {
        const x0 = Math.max(bx, sx), x1 = Math.min(bx + 11, sx + sw);
        if (x1 <= x0) continue;
        g.fillStyle(stone).fillRect(x0, y0, x1 - x0, y1 - y0);
        if (y0 === by) g.fillStyle(hi).fillRect(x0, y0, x1 - x0, 1);
      }
    }
  }
  return g;
}

// 벽 안쪽 바닥에 지는 그림자 (위·왼쪽 벽). 바닥을 칠한 뒤에 그린다
export function wallShadow(g, x, y, w, h) {
  return g.fillStyle(0x000000, 0.28).fillRect(x, y, w, 3).fillRect(x, y, 2, h);
}
