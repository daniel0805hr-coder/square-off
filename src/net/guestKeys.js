// 온라인 친구 화면의 키 설정 창. 친구 화면은 게임(Phaser)을 돌리지 않으므로 키 설정 화면을 HTML로 따로 만든다.
// 바꾼 키는 친구 브라우저에 저장되고(controls.js와 같은 저장소), 키 1·키 2 모두 친구(P2) 조작이 된다.

import { ACTIONS, ACTION_NAMES, actionLabel, setBinding, resetBindings, mouseCode } from '../input/controls.js';

const COLORS = { bg: '#1b1a24', line: '#4a4658', text: '#f2ead8', dim: '#8d8798', on: '#ffe08a', field: '#111018' };
const font = (size) => `${size}px Galmuri11, sans-serif`;

// root에 '키 설정' 버튼을 달고, 누르면 설정 창을 연다.
//   onOpen / onClose: 창이 열린 동안 게임 입력을 멈추고 다시 켠다
export function addGuestKeys(root, { onOpen, onClose }) {
  const button = Object.assign(document.createElement('button'), { textContent: '키 설정' });
  Object.assign(button.style, {
    position: 'fixed', right: '8px', bottom: '6px', font: font(11), background: COLORS.bg, color: COLORS.text,
    border: `1px solid ${COLORS.line}`, padding: '3px 10px', cursor: 'pointer', zIndex: 20,
  });
  root.append(button);

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: 30,
    width: 'min(420px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', boxSizing: 'border-box',
    padding: '14px 16px', background: COLORS.bg, border: `1px solid ${COLORS.text}`, color: COLORS.text, font: font(12),
    display: 'none',
  });
  root.append(panel);

  let listening = null; // { player, action } — 새 키를 기다리는 칸

  const render = () => {
    panel.replaceChildren();
    const title = Object.assign(document.createElement('div'), { textContent: '내 키 설정 (P2 · 흑)' });
    Object.assign(title.style, { font: font(14), textAlign: 'center', marginBottom: '4px' });
    const sub = Object.assign(document.createElement('div'), {
      textContent: listening
        ? '새 키·마우스 버튼을 누르세요 (마우스 왼쪽은 이 칸을 클릭) · Esc = 취소'
        : '칸을 눌러 바꾸기 · 키 1·키 2 둘 다 내 조작 · 겹치면 서로 바뀜',
    });
    Object.assign(sub.style, { font: font(10), color: listening ? COLORS.on : COLORS.dim, textAlign: 'center', marginBottom: '10px' });
    panel.append(title, sub);

    const table = document.createElement('div');
    Object.assign(table.style, { display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: '3px 8px', alignItems: 'center' });
    for (const head of ['', '키 1', '키 2']) {
      table.append(Object.assign(document.createElement('div'), { textContent: head, style: `color:${COLORS.dim};font:${font(10)};text-align:center` }));
    }
    for (const action of ACTIONS) {
      table.append(Object.assign(document.createElement('div'), { textContent: ACTION_NAMES[action], style: `font:${font(11)};white-space:nowrap` }));
      for (const player of [1, 2]) {
        const on = listening?.player === player && listening?.action === action;
        const cell = Object.assign(document.createElement('button'), { textContent: on ? '키를 누르세요…' : actionLabel(player, action) });
        cell.dataset.player = player;
        cell.dataset.action = action;
        Object.assign(cell.style, {
          font: font(11), color: on ? COLORS.field : COLORS.text, background: on ? COLORS.on : COLORS.field,
          border: `1px solid ${COLORS.line}`, padding: '3px 4px', cursor: 'pointer', minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        });
        cell.addEventListener('click', () => { if (!listening) { listening = { player, action }; render(); } });
        table.append(cell);
      }
    }
    panel.append(table);

    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '12px' });
    const reset = Object.assign(document.createElement('button'), { textContent: '기본값으로' });
    const close = Object.assign(document.createElement('button'), { textContent: '닫기' });
    for (const b of [reset, close]) Object.assign(b.style, { font: font(12), border: 0, padding: '5px 14px', cursor: 'pointer' });
    Object.assign(reset.style, { background: COLORS.field, color: COLORS.text, border: `1px solid ${COLORS.line}` });
    Object.assign(close.style, { background: COLORS.text, color: COLORS.field });
    reset.addEventListener('click', () => { if (!listening) { resetBindings(); render(); } });
    close.addEventListener('click', () => { if (!listening) hide(); });
    row.append(reset, close);
    panel.append(row);
  };

  const assign = (code) => {
    setBinding(listening.player, listening.action, code);
    listening = null;
    render();
  };

  // 창이 열린 동안은 키·마우스를 먼저 가로챈다 (게임 입력으로 가지 않게)
  const onKey = (e) => {
    e.stopImmediatePropagation();
    if (e.type !== 'keydown') return;
    e.preventDefault();
    if (!listening) { if (e.code === 'Escape') hide(); return; }
    if (e.code === 'Escape') { listening = null; render(); return; }
    assign(e.code || `key:${e.key}`);
  };
  const onMouse = (e) => {
    if (!listening) return;
    const cell = e.target.closest?.('button[data-action]');
    const isListeningCell = cell && Number(cell.dataset.player) === listening.player && cell.dataset.action === listening.action;
    // 왼쪽 클릭은 기다리는 칸을 다시 누를 때만 지정 (다른 곳을 누르면 취소하고 그 클릭을 그대로 처리)
    if (e.button === 0 && !isListeningCell) { listening = null; render(); return; }
    e.preventDefault();
    e.stopImmediatePropagation();
    assign(mouseCode(e.button));
  };
  const noMenu = (e) => e.preventDefault();

  function show() {
    onOpen();
    listening = null;
    render();
    panel.style.display = 'block';
    button.style.display = 'none';
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('contextmenu', noMenu, true);
  }

  function hide() {
    listening = null;
    panel.style.display = 'none';
    button.style.display = 'block';
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('keyup', onKey, true);
    window.removeEventListener('mousedown', onMouse, true);
    window.removeEventListener('contextmenu', noMenu, true);
    onClose();
  }

  button.addEventListener('click', show);
  return { show, hide };
}
