// 입력 → 명령 변환. 게임 로직은 키가 아니라 { player, action } 명령만 받는다.
// 키 배치는 키 설정 화면에서 바꿀 수 있고, 브라우저(localStorage)에 저장된다.
// 'key:x' = 키 위치(code)가 아니라 입력된 글자로 인식 (code가 비어 오는 환경 대비)
// 'Mouse0'~'Mouse4' = 마우스 버튼 (왼쪽, 가운데, 오른쪽, 뒤로, 앞으로)
// 'Pad1:B0' = 게임패드 버튼 (gamepad.js). 동작마다 키(키보드·마우스) 하나와 패드 버튼 하나를 따로 가진다

import { padCode, padName, padSlotConnected, rumbleSlots } from './gamepad.js';

export const ACTIONS = ['up', 'down', 'left', 'right', 'confirm', 'skill', 'cancel', 'turnAttack', 'turnDefend', 'turnSkill', 'turnFocus', 'turnHeal'];
// confirm = 체스판에서 선택 / 전투에서 공격, skill = 전투에서 기물별 특수기, cancel = 체스판·메뉴에서 취소
// turnAttack/Defend/Skill/Focus/Heal = 턴제 전투에서 몰래 고르는 키 (기획서 10장)
export const ACTION_NAMES = {
  up: '위', down: '아래', left: '왼쪽', right: '오른쪽', confirm: '선택 · 공격', skill: '스킬', cancel: '취소',
  turnAttack: '턴제 공격', turnDefend: '턴제 방어', turnSkill: '턴제 스킬', turnFocus: '턴제 집중', turnHeal: '턴제 회복',
};

// 패드 기본 배치 (P1 = 패드1, P2 = 패드2): 십자키·왼쪽 스틱 이동, A 선택, X 스킬, B 취소,
// 턴제 = Y 공격 · RB 방어 · LB 스킬 · RT 집중 · LT 회복
const PAD_DEFAULT = {
  up: 12, down: 13, left: 14, right: 15, confirm: 0, skill: 2, cancel: 1,
  turnAttack: 3, turnDefend: 5, turnSkill: 4, turnFocus: 7, turnHeal: 6,
};
export const isPad = (code) => code.startsWith('Pad');

// 패드 고정 버튼: 어느 화면에서나 같은 뜻이라 키 설정에서 바꿀 수 없다
//   십자키·왼쪽 스틱 = 이동, A = 선택·확인(클릭), B = 취소·뒤로, Start = 그만두기·나가기
// 나머지 버튼(X·Y·LB·RB·LT·RT 등)만 스킬·턴제 동작에 자유롭게 지정한다
export const PAD_FIXED = { up: 12, down: 13, left: 14, right: 15, confirm: 0, cancel: 1 };
export const PAD_START = 9;
const RESERVED = new Set([...Object.values(PAD_FIXED), PAD_START]);
const padButton = (code) => Number(/:B(\d+)$/.exec(code)?.[1]);
export const isFixedPadAction = (action) => action in PAD_FIXED;
export const isReservedPad = (code) => isPad(code) && RESERVED.has(padButton(code));
export const isStartButton = (code) => /^Pad\d+:B9$/.test(code);

const KEY_DEFAULTS = {
  1: {
    up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
    confirm: ['KeyF'], skill: ['KeyG'], cancel: ['KeyQ'],
    turnAttack: ['Digit1'], turnDefend: ['Digit2'], turnSkill: ['Digit3'], turnFocus: ['Digit4'], turnHeal: ['Digit5'],
  },
  2: {
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    confirm: ['Numpad1', 'Comma', 'key:,'], skill: ['Numpad2', 'Period', 'key:.'], cancel: ['Numpad3', 'Slash', 'key:/'],
    turnAttack: ['Numpad4', 'KeyJ'], turnDefend: ['Numpad5', 'KeyK'], turnSkill: ['Numpad6', 'KeyL'], turnFocus: ['Numpad7', 'KeyU'], turnHeal: ['Numpad8', 'KeyI'],
  },
};
const padDefaults = (player) => Object.fromEntries(ACTIONS.map((a) => [a, [padCode(player, PAD_DEFAULT[a])]]));
export const DEFAULT_BINDINGS = Object.fromEntries([1, 2].map((p) => [p,
  Object.fromEntries(ACTIONS.map((a) => [a, [...KEY_DEFAULTS[p][a], ...padDefaults(p)[a]]]))]));

const STORAGE_KEY = 'squareoff.keys.v1';
const clone = (b) => JSON.parse(JSON.stringify(b));

let bindings = loadBindings();
let version = 0; // 키 배치가 바뀔 때마다 증가 → 입력기가 다시 읽는다

function loadBindings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && [1, 2].every((p) => ACTIONS.every((a) => Array.isArray(saved[p]?.[a])))) return withPads(saved);
    // 스킬 키가 따로 없던 예전 저장값: 예전 '취소' 키가 스킬 역할이었으므로 스킬로 옮기고, 취소는 기본값
    if (saved && [1, 2].every((p) => Array.isArray(saved[p]?.cancel) && !saved[p].skill)) {
      for (const p of [1, 2]) saved[p].skill = saved[p].cancel;
      const used = new Set([1, 2].flatMap((p) => Object.values(saved[p]).flat()));
      for (const p of [1, 2]) saved[p].cancel = DEFAULT_BINDINGS[p].cancel.filter((c) => !used.has(c));
    }
    // 나중에 생긴 동작(턴제 키 등)은 기본 키로 채운다 (이미 다른 동작이 쓰는 키는 빼고)
    if (saved && [1, 2].every((p) => saved[p] && typeof saved[p] === 'object')) {
      const used = new Set([1, 2].flatMap((p) => Object.values(saved[p]).flat()));
      for (const p of [1, 2]) {
        for (const a of ACTIONS) {
          if (!Array.isArray(saved[p][a])) saved[p][a] = DEFAULT_BINDINGS[p][a].filter((c) => !used.has(c));
        }
      }
      return withPads(saved);
    }
  } catch { /* 저장소를 못 쓰는 환경이면 기본값 */ }
  return clone(DEFAULT_BINDINGS);
}

// 패드 지원 전에 저장된 배치면 패드 기본 버튼을 붙이고, 고정 버튼은 늘 제자리로 맞춘다
function withPads(saved) {
  if (![1, 2].some((p) => Object.values(saved[p]).flat().some(isPad))) {
    for (const p of [1, 2]) for (const a of ACTIONS) saved[p][a].push(...padDefaults(p)[a]);
  }
  return fixPads(saved);
}

// 고정 동작은 자기 패드의 고정 버튼만, 다른 동작은 고정 버튼을 쓰지 못하게 (예전에 바꿔 둔 배치 고치기)
function fixPads(b) {
  for (const p of [1, 2]) {
    for (const a of ACTIONS) {
      const keys = b[p][a].filter((c) => !isPad(c));
      const pads = isFixedPadAction(a) ? [padCode(p, PAD_FIXED[a])] : b[p][a].filter((c) => isPad(c) && !isReservedPad(c));
      b[p][a] = [...keys, ...pads];
    }
    // 고정 버튼을 빼앗겨 패드 버튼이 없어진 동작은, 비어 있으면 기본 버튼을 돌려준다
    const used = new Set(Object.values(b[p]).flat());
    for (const a of ACTIONS) {
      if (b[p][a].some(isPad)) continue;
      const def = padDefaults(p)[a][0];
      if (!used.has(def)) { b[p][a].push(def); used.add(def); }
    }
  }
  return b;
}

function saveBindings() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings)); } catch { /* 무시 */ }
}

export const getBindings = () => bindings;

// 패드 버튼을 이 동작에 지정할 수 없는 이유 (되면 null)
export function padBlockReason(action, code) {
  if (!isPad(code)) return null;
  if (isFixedPadAction(action)) return '이동·선택·취소의 패드 버튼은 고정이에요 (십자키 · A · B)';
  if (isReservedPad(code)) return 'A · B · 십자키 · Start는 고정 버튼이라 다른 동작에 못 써요';
  return null;
}

// player의 action에 키(또는 패드 버튼) 하나를 지정. 다른 동작이 쓰던 키면 서로 맞바꾼다.
// 키를 바꾸면 패드 버튼은 그대로, 패드 버튼을 바꾸면 키는 그대로 둔다. 고정 패드 버튼이면 바꾸지 않고 false
export function setBinding(player, action, code) {
  if (padBlockReason(action, code)) return false;
  const kind = isPad(code);
  const same = (c) => isPad(c) === kind;
  const previous = bindings[player][action].filter(same);
  for (const p of [1, 2]) {
    for (const a of ACTIONS) {
      if ((p !== player || a !== action) && bindings[p][a].includes(code)) {
        bindings[p][a] = [...bindings[p][a].filter((c) => !same(c)), ...previous];
      }
    }
  }
  bindings[player][action] = [...bindings[player][action].filter((c) => !same(c)), code];
  version++;
  saveBindings();
  return true;
}

export function resetBindings() {
  bindings = clone(DEFAULT_BINDINGS);
  version++;
  saveBindings();
}

// 키 코드 → 화면에 보일 이름
const NAMED = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Minus: '-', Equal: '=', Backquote: '`', Backslash: '\\', Space: '스페이스', Enter: '엔터', Tab: 'Tab',
  ShiftLeft: '왼Shift', ShiftRight: '오른Shift', ControlLeft: '왼Ctrl', ControlRight: '오른Ctrl',
  AltLeft: '왼Alt', AltRight: '오른Alt', Backspace: '백스페이스',
  NumpadDecimal: '숫자패드.', NumpadEnter: '숫자패드엔터', NumpadAdd: '숫자패드+', NumpadSubtract: '숫자패드-',
  Mouse0: '마우스 왼쪽', Mouse1: '마우스 휠', Mouse2: '마우스 오른쪽', Mouse3: '마우스 뒤로', Mouse4: '마우스 앞으로',
};

export const mouseCode = (button) => `Mouse${button}`;
// 이 마우스 버튼이 어떤 동작에 지정돼 있는가 (지정됐으면 체스판 클릭 등에 쓰지 않는다)
export const isMouseBound = (button) => [1, 2].some((p) => Object.values(bindings[p]).some((codes) => codes.includes(mouseCode(button))));
export function keyName(code) {
  if (NAMED[code]) return NAMED[code];
  if (isPad(code)) return padName(code) ?? code;
  if (code.startsWith('key:')) return code.slice(4);
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return '숫자패드' + code.slice(6);
  return code;
}

// 한 동작의 키 이름 ('key:' 대체 항목은 같은 키라 숨긴다)
export function actionLabel(player, action) {
  const keys = bindings[player][action].filter((c) => !isPad(c));
  const codes = keys.filter((c) => !c.startsWith('key:'));
  return (codes.length ? codes : keys).map(keyName).join('·') || '없음';
}

// 한 동작의 패드 버튼 이름 (short = 자기 번호 패드(P1 = 패드1)면 '패드1 ' 없이 버튼만)
export function padLabel(player, action, short = false) {
  const names = bindings[player][action].filter(isPad).map((c) => (short ? padName(c).replace(`패드${player} `, '') : padName(c)));
  return names.join('·') || '없음';
}

// 이 플레이어에게 지정된 패드가 지금 연결돼 있는가 (그러면 도움말에 패드 버튼을 보여 준다)
export function usesPad(player) {
  return Object.values(bindings[player]).flat().filter(isPad).some((c) => padSlotConnected(Number(/^Pad(\d+)/.exec(c)[1])));
}

// 어느 플레이어든 패드를 쓰고 있는가 (메뉴 안내를 패드 버튼으로)
export const anyPad = () => usesPad(1) || usesPad(2);

// 화면 도움말용 요약
export function keyLabels(player) {
  const b = bindings[player];
  if (usesPad(player)) {
    const pad = (a) => padLabel(player, a, true);
    const dpad = ['up', 'down', 'left', 'right'].every((a, i) => b[a].some((c) => c.endsWith(`:B${12 + i}`)));
    return {
      move: dpad ? '십자키·스틱' : ['up', 'left', 'down', 'right'].map(pad).join(' '),
      confirm: pad('confirm'),
      skill: pad('skill'),
      cancel: pad('cancel'),
      turn: ['turnAttack', 'turnDefend', 'turnSkill', 'turnFocus', 'turnHeal'].map(pad),
    };
  }
  const keyOnly = (a) => b[a].filter((c) => !isPad(c));
  const arrows = ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'];
  const isArrows = ['up', 'left', 'down', 'right'].every((a, i) => keyOnly(a).length === 1 && keyOnly(a)[0] === arrows[i]);
  return {
    move: isArrows ? '방향키' : ['up', 'left', 'down', 'right'].map((a) => actionLabel(player, a)).join(' '),
    confirm: actionLabel(player, 'confirm'),
    skill: actionLabel(player, 'skill'),
    cancel: actionLabel(player, 'cancel'),
    turn: ['turnAttack', 'turnDefend', 'turnSkill', 'turnFocus', 'turnHeal'].map((a) => actionLabel(player, a)),
  };
}

// ───────── 온라인 (기획서 10장) ─────────
// 호스트 = P1, 링크로 들어온 친구 = P2. 친구 입력은 네트워크로 와서 P2 명령이 된다.
// 호스트일 때 이 컴퓨터의 키는 P1·P2 키 모두 P1 조작으로 쓴다.
export const online = { role: null, toGuest: null }; // role: null | 'host', toGuest(msg) = 친구에게 보내기 (방이 열려 있을 때)

// 이 플레이어의 패드를 진동 (kind = gamepad.js RUMBLE의 light · hit · big · ko)
//   온라인 호스트: P2는 친구 PC의 패드로 보내고, 이 PC의 패드는 모두 P1 조작이므로 P1 진동을 받는다
export function rumble(player, kind) {
  if (online.role === 'host' && player === 2) { online.toGuest?.({ t: 'rumble', kind }); return; }
  const players = online.role === 'host' ? [1, 2] : [player];
  const slots = [...new Set(players.flatMap((p) => Object.values(bindings[p]).flat().filter(isPad).map((c) => Number(/^Pad(\d+)/.exec(c)[1]))))];
  rumbleSlots(slots, kind);
}
const routers = new Set();

// 친구가 누르거나 뗀 동작을 지금 떠 있는 모든 장면에 P2 명령으로 전달
export function remoteInput({ action, down, source = 'key' }) {
  if (!ACTIONS.includes(action)) return;
  for (const r of routers) r.remote(action, down, source);
}

// 키 코드 → 동작 이름 (P1·P2 키 어느 쪽이든). 친구 화면에서 자기 키 설정으로 입력을 읽을 때 쓴다
export function actionFor(code, key = '') {
  for (const player of [1, 2]) {
    for (const [action, codes] of Object.entries(bindings[player])) {
      if (codes.includes(code) || (key && codes.includes(`key:${key}`))) return action;
    }
  }
  return null;
}

export class InputRouter {
  constructor(scene, onCommand) {
    this.held = { 1: new Map(), 2: new Map() }; // 지금 누르고 있는 동작 → 누른 순서 번호
    this.seq = 0;
    this.version = -1;
    this.scene = scene;
    this.onCommand = onCommand;
    const find = (event) => {
      if (this.version !== version) this.rebuild();
      const cmd = this.lookup.get(event.code) || this.lookup.get(`key:${event.key}`);
      // 온라인 호스트: P2는 친구 몫이므로 이 컴퓨터의 P2 키도 P1 조작이 된다
      return cmd && online.role === 'host' ? { ...cmd, player: 1 } : cmd;
    };

    // Phaser 키보드 큐 대신 브라우저 이벤트를 직접 받는다 (입력 순서·횟수가 정확함)
    // source = 'key' | 'mouse' (키 설정 화면은 마우스로 칸을 고르므로 마우스 명령을 무시한다)
    const onDown = (event, source = 'key') => {
      const cmd = find(event);
      if (!cmd) return;
      event.preventDefault(); // 방향키로 페이지가 스크롤되지 않도록
      if (!this.held[cmd.player].has(cmd.action)) this.held[cmd.player].set(cmd.action, ++this.seq);
      // 잠든(뒤에 깔린) 장면은 명령을 받지 않는다
      if (scene.sys.isActive()) onCommand({ ...cmd, repeat: Boolean(event.repeat), source });
    };
    // 마우스 버튼도 키처럼 다룬다
    const asKey = (event) => ({ code: mouseCode(event.button), key: '', repeat: false, preventDefault: () => event.preventDefault() });
    const onMouseDown = (event) => onDown(asKey(event), 'mouse');
    const onMouseUp = (event) => {
      onUp(asKey(event));
      if (event.button >= 3) event.preventDefault(); // 옆 버튼이 브라우저 뒤로가기를 하지 않도록
    };
    const onContextMenu = (event) => { if (isMouseBound(2)) event.preventDefault(); };
    const onUp = (event) => {
      const cmd = find(event);
      if (cmd) this.held[cmd.player].delete(cmd.action);
    };
    const onBlur = () => { this.held[1].clear(); if (online.role !== 'host') this.held[2].clear(); }; // 온라인이면 P2는 친구 입력
    const onKeyDown = (event) => onDown(event);
    const listeners = [
      ['keydown', onKeyDown], ['keyup', onUp], ['blur', onBlur],
      ['mousedown', onMouseDown], ['mouseup', onMouseUp], ['contextmenu', onContextMenu],
    ];
    for (const [type, fn] of listeners) window.addEventListener(type, fn);
    routers.add(this);
    scene.events.once('shutdown', () => {
      for (const [type, fn] of listeners) window.removeEventListener(type, fn);
      routers.delete(this);
    });
  }

  // 네트워크로 온 친구(P2) 입력
  remote(action, down, source) {
    const h = this.held[2];
    if (!down) { h.delete(action); return; }
    const repeat = h.has(action);
    if (!repeat) h.set(action, ++this.seq);
    if (this.scene.sys.isActive()) this.onCommand({ player: 2, action, repeat, source, remote: true });
  }

  rebuild() {
    this.lookup = new Map();
    for (const [player, actions] of Object.entries(bindings)) {
      for (const [action, codes] of Object.entries(actions)) {
        for (const code of codes) this.lookup.set(code, { player: Number(player), action });
      }
    }
    this.version = version;
  }

  isDown(player, action) {
    return this.held[player].has(action);
  }

  // 이동 4방향. 반대 방향(왼·오 / 위·아래)을 같이 누르고 있으면 나중에 누른 쪽만 인정
  directions(player) {
    const h = this.held[player];
    const pick = (a, b) => {
      if (h.has(a) && h.has(b)) return h.get(a) > h.get(b) ? a : b;
      return h.has(a) ? a : h.has(b) ? b : null;
    };
    const dirs = { up: false, down: false, left: false, right: false };
    for (const d of [pick('left', 'right'), pick('up', 'down')]) if (d) dirs[d] = true;
    return dirs;
  }
}
