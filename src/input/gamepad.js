// 게임패드 → 키 입력. 패드 버튼을 누르고 떼는 것을 'Pad1:B0' 같은 코드의 키보드 이벤트로 바꿔 window에 보낸다.
// 그래서 키 설정·전투·체스판·온라인 친구 화면 모두 키보드와 같은 길로 패드를 받는다.
//   'Pad{번호}:B{버튼}' — 번호 = 연결된 순서(1부터), 버튼 = 표준 배치 번호 (0 = A, 12~15 = 십자키)
//   왼쪽 스틱은 십자키와 같은 코드로 보낸다 (스틱·십자키 어느 쪽으로든 이동)

const STICK_ON = 0.5;   // 이만큼 기울이면 누름
const STICK_OFF = 0.35; // 이 밑으로 돌아오면 뗌 (경계에서 떨리지 않게)
const DPAD = { up: 12, down: 13, left: 14, right: 15 };

const pads = new Map(); // gamepad.index → { slot, down: Set(코드) }
let running = false;

export const padCode = (slot, button) => `Pad${slot}:B${button}`;

// 실제 키처럼 문서 안(포커스된 곳)에서 보내야 window의 capture 단계 처리(키 설정 화면 등)가 먼저 받는다
function send(type, code) {
  const target = document.activeElement || document.body || window;
  target.dispatchEvent(new KeyboardEvent(type, { code, key: '', bubbles: true, cancelable: true }));
}

function releaseAll(state) {
  for (const code of state.down) send('keyup', code);
  state.down.clear();
}

function poll() {
  const list = [...(navigator.getGamepads?.() || [])].filter((g) => g?.connected).sort((a, b) => a.index - b.index);
  const seen = new Set();
  list.forEach((g, i) => {
    const slot = i + 1;
    let state = pads.get(g.index);
    if (!state) pads.set(g.index, (state = { slot, down: new Set(), stick: {} }));
    if (state.slot !== slot) { releaseAll(state); state.slot = slot; } // 앞 패드가 빠져서 번호가 바뀜
    seen.add(g.index);

    const now = new Set();
    g.buttons.forEach((b, i) => { if (b.pressed) now.add(i); });
    // 왼쪽 스틱 → 십자키
    const [x = 0, y = 0] = g.axes;
    const tilt = { left: -x, right: x, up: -y, down: y };
    for (const [dir, v] of Object.entries(tilt)) {
      state.stick[dir] = state.stick[dir] ? v > STICK_OFF : v > STICK_ON;
      if (state.stick[dir]) now.add(DPAD[dir]);
    }

    const codes = new Set([...now].map((b) => padCode(slot, b)));
    for (const code of [...state.down]) if (!codes.has(code)) { state.down.delete(code); send('keyup', code); }
    for (const code of codes) if (!state.down.has(code)) { state.down.add(code); send('keydown', code); }
  });
  for (const [index, state] of pads) {
    if (!seen.has(index)) { releaseAll(state); pads.delete(index); }
  }
  requestAnimationFrame(poll);
}

// 한 번만 켠다 (main.js에서 호스트·친구 화면 모두)
export function startGamepads() {
  if (running || !navigator.getGamepads) return;
  running = true;
  requestAnimationFrame(poll);
}

// 이 번호의 패드가 지금 연결돼 있는가
export function padSlotConnected(slot) {
  return [...pads.values()].some((s) => s.slot === slot);
}

// 패드 버튼 이름 (Xbox 배치 기준. PS 패드는 A = ✕, B = ○, X = □, Y = △)
const BUTTON_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Select', 'Start', 'L스틱', 'R스틱', '↑', '↓', '←', '→', '홈'];
export function padName(code) {
  const m = /^Pad(\d+):B(\d+)$/.exec(code);
  if (!m) return null;
  return `패드${m[1]} ${BUTTON_NAMES[m[2]] ?? `버튼${m[2]}`}`;
}
