import { InputRouter, ACTIONS, ACTION_NAMES, actionLabel, padLabel, setBinding, resetBindings, mouseCode, isPad, isFixedPadAction, isStartButton, padBlockReason, PAD_FIXED } from '../input/controls.js';
import { rumbleEnabled, setRumble, rumbleSlots, rumbleSupport } from '../input/gamepad.js';
import { FONT_SMALL, FONT_BIG, text, C, PLAYER_COLOR, PLAYER_HEX } from '../ui/style.js';
import { UI, UI_HEX, drawPanel } from '../ui/frame.js';

const COL_X = { 1: 75, 2: 335 }; // 각 플레이어 칸의 왼쪽 끝
const COL_W = 230;
const PAD_W = 56; // 칸 오른쪽의 패드 버튼 자리
const ROW_Y = 66;
const ROW_H = 18;
const BUTTONS = ['기본값으로', '돌아가기']; // 단추 줄 (왼쪽 / 오른쪽)
const BUTTON_ROW = ACTIONS.length;
const RUMBLE_ROW = BUTTON_ROW + 1; // 마지막 줄: 패드 진동 켜기·끄기 / 진동 시험
const LAST_ROW = RUMBLE_ROW;

// 키 설정 화면. 칸을 고르고 선택 키를 누른 뒤, 새로 쓸 키(또는 마우스·패드 버튼)를 누르면 바뀐다.
// 키를 누르면 키가, 패드 버튼을 누르면 패드 버튼이 바뀐다 (한 동작에 키 하나 + 패드 버튼 하나)
export class KeyConfigScene extends Phaser.Scene {
  constructor() {
    super('keys');
  }

  create() {
    this.sel = { row: 0, col: 0 }; // col 0 = P1, 1 = P2
    this.listening = false;

    const bg = this.add.graphics().fillStyle(0x111018).fillRect(0, 0, 640, 360);
    // 플레이어마다 패널 하나 (머리 띠에 P1/P2)
    const bottom = ROW_Y + (LAST_ROW + 1) * ROW_H + 10;
    for (const p of [1, 2]) {
      drawPanel(bg, COL_X[p] - 10, 38, COL_W + 20, bottom - 38);
      bg.fillStyle(UI.panelHi).fillRect(COL_X[p] - 8, 40, COL_W + 16, 18);
    }
    this.add.text(320, 10, '키 설정', text(15, UI_HEX.title, FONT_BIG)).setOrigin(0.5, 0).setStroke('#0b0a10', 3);
    bg.fillStyle(UI.gold).fillRect(262, 19, 22, 1).fillRect(356, 19, 22, 1);
    for (const p of [1, 2]) {
      this.add.text(COL_X[p] + COL_W / 2, 42, `P${p}`, text(12, PLAYER_HEX[p])).setOrigin(0.5, 0);
      this.add.text(COL_X[p] + COL_W - 8, 44, '패드', text(10, UI_HEX.muted, FONT_SMALL)).setOrigin(1, 0);
      this.add.text(COL_X[p] + COL_W - PAD_W - 8, 44, '키', text(10, UI_HEX.muted, FONT_SMALL)).setOrigin(1, 0);
    }
    this.help = this.add.text(320, 340, '', text(10, UI_HEX.muted, FONT_SMALL)).setOrigin(0.5, 0);
    this.gfx = this.add.graphics();
    this.cells = [];

    new InputRouter(this, (cmd) => this.onCommand(cmd));
    // 키를 기다리는 중이면 이 키를 가장 먼저 가로채서, 체스판·메뉴 조작으로 쓰이지 않게 한다
    this.onRawKey = (event) => {
      if (!this.listening || !this.sys.isActive()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      this.listening = false;
      const code = event.code || `key:${event.key}`;
      // Esc · 패드 B · 패드 Start = 바꾸지 않고 그만두기
      const quit = code === 'Escape' || isStartButton(code) || (isPad(code) && code.endsWith(`:B${PAD_FIXED.cancel}`));
      if (!quit) {
        const action = ACTIONS[this.sel.row];
        this.note = padBlockReason(action, code);
        if (!this.note) setBinding(this.sel.col + 1, action, code);
      }
      this.render();
    };
    this.onEscape = (event) => {
      if ((event.code === 'Escape' || isStartButton(event.code)) && !this.listening && this.sys.isActive()) this.back();
    };
    // 마우스 버튼도 지정할 수 있다
    this.onRawMouse = (event) => {
      if (!this.listening || !this.sys.isActive()) return;
      // 왼쪽 클릭은 '기다리는 칸'을 다시 눌렀을 때만 지정한다.
      // 다른 곳을 왼쪽 클릭하면 지정을 취소하고 평소처럼 그 칸을 고른다 (실수로 왼쪽 클릭이 묶이지 않게)
      if (event.button === 0 && !this.isSelectedCell(event)) {
        this.listening = false;
        this.render();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      this.listening = false;
      this.justAssigned = true; // 같은 클릭이 칸 클릭으로 처리되지 않게
      this.time.delayedCall(50, () => { this.justAssigned = false; });
      setBinding(this.sel.col + 1, ACTIONS[this.sel.row], mouseCode(event.button));
      this.render();
    };
    window.addEventListener('keydown', this.onRawKey, true);
    window.addEventListener('keydown', this.onEscape);
    window.addEventListener('mousedown', this.onRawMouse, true);
    this.events.once('shutdown', () => {
      window.removeEventListener('keydown', this.onRawKey, true);
      window.removeEventListener('keydown', this.onEscape);
      window.removeEventListener('mousedown', this.onRawMouse, true);
    });
    this.input.on('pointerdown', (p) => this.onPointer(p));
    this.render();
  }

  onCommand({ action, source, remote }) {
    // 이 화면에서 마우스는 칸 고르기에만 쓴다. 온라인 친구는 호스트의 키 설정을 건드리지 않는다
    if (this.listening || source === 'mouse' || remote) return;
    this.note = null;
    const rows = LAST_ROW + 1;
    if (action === 'up') this.sel.row = (this.sel.row + rows - 1) % rows;
    if (action === 'down') this.sel.row = (this.sel.row + 1) % rows;
    if (action === 'left' || action === 'right') this.sel.col = 1 - this.sel.col;
    if (action === 'confirm') this.activate();
    if (action === 'cancel') this.back();
    this.render();
  }

  onPointer({ x, y }) {
    if (this.listening || this.justAssigned) return;
    const row = Math.floor((y - ROW_Y + 4) / ROW_H);
    if (row < 0 || row > LAST_ROW) return;
    const col = x < 320 ? 0 : 1;
    this.sel = { row, col };
    this.note = null;
    this.activate();
    this.render();
  }

  // 마우스 이벤트가 지금 고른 칸 위인가 (화면 좌표 → 게임 좌표)
  isSelectedCell(event) {
    const rect = this.game.canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (640 / rect.width);
    const y = (event.clientY - rect.top) * (360 / rect.height);
    const left = COL_X[this.sel.col + 1];
    const top = ROW_Y + this.sel.row * ROW_H - 4;
    return x >= left && x <= left + COL_W && y >= top && y <= top + ROW_H;
  }

  activate() {
    if (this.sel.row === RUMBLE_ROW) {
      if (this.sel.col === 0) setRumble(!rumbleEnabled());
      else rumbleSlots(null, 'big');
      // 안 울리는 이유를 알려 준다
      const why = { nopad: '연결된 패드가 없어요 (패드 버튼을 한 번 눌러 주세요)', browser: '이 브라우저는 패드 진동을 지원하지 않아요 — 크롬·엣지에서 열어 주세요' }[rumbleSupport()];
      this.note = !rumbleEnabled() ? null : why ?? (this.sel.col === 1 ? '진동을 보냈어요 (안 울리면 패드가 진동을 지원하지 않는 것)' : null);
      return;
    }
    if (this.sel.row === BUTTON_ROW) {
      if (this.sel.col === 0) resetBindings();
      else this.back();
      return;
    }
    this.listening = true;
  }

  back() {
    this.scene.stop();
    this.scene.wake('board', { from: 'keys' });
  }

  render() {
    const g = this.gfx.clear();
    for (const c of this.cells) c.destroy();
    this.cells = [];
    const add = (...args) => { const t = this.add.text(...args); this.cells.push(t); return t; };

    ACTIONS.forEach((action, row) => {
      for (const p of [1, 2]) {
        const x = COL_X[p], y = ROW_Y + row * ROW_H;
        const on = this.sel.row === row && this.sel.col === p - 1;
        g.fillStyle(on ? 0x3a3746 : C.panel).fillRect(x, y - 4, COL_W, ROW_H - 4);
        if (on) g.lineStyle(2, PLAYER_COLOR[p]).strokeRect(x + 1, y - 3, COL_W - 2, ROW_H - 6);
        add(x + 8, y, ACTION_NAMES[action], text(10, '#8d8798', FONT_SMALL));
        if (on && this.listening) {
          add(x + COL_W - 8, y - 1, '키나 패드 버튼을 누르세요…', text(12, '#ffe08a')).setOrigin(1, 0);
        } else {
          add(x + COL_W - PAD_W - 8, y - 1, actionLabel(p, action), text(12, '#f2ead8')).setOrigin(1, 0);
          // 고정 패드 버튼은 어둡게 (바꿀 수 없음)
          const fixed = isFixedPadAction(action);
          add(x + COL_W - 8, y + 1, padLabel(p, action, true), text(10, fixed ? '#5f5a6c' : '#b8b0c8', FONT_SMALL)).setOrigin(1, 0);
        }
      }
    });
    const buttonRow = (row, labels) => labels.forEach((label, col) => {
      const x = COL_X[col + 1], y = ROW_Y + row * ROW_H + 8;
      const on = this.sel.row === row && this.sel.col === col;
      g.fillStyle(on ? 0x3a3746 : C.panel).fillRect(x, y - 4, COL_W, ROW_H - 4);
      if (on) g.lineStyle(2, 0xf2ead8).strokeRect(x + 1, y - 3, COL_W - 2, ROW_H - 6);
      add(x + COL_W / 2, y - 1, label, text(12, on ? '#f2ead8' : '#8d8798')).setOrigin(0.5, 0);
    });
    buttonRow(BUTTON_ROW, BUTTONS);
    buttonRow(RUMBLE_ROW, [`패드 진동: ${rumbleEnabled() ? '켜짐' : '꺼짐'}`, '진동 시험']);

    const fixedRow = this.sel.row < BUTTON_ROW && isFixedPadAction(ACTIONS[this.sel.row]);
    this.help.setColor(this.note ? '#ff9a7a' : UI_HEX.muted);
    this.help.setText(this.note
      ? this.note
      : this.listening
        ? (fixedRow ? '새 키·마우스 버튼을 누르세요 (이 줄의 패드 버튼은 고정) · Esc / 패드 B = 취소'
          : '새 키·마우스·패드 버튼을 누르세요 (마우스 왼쪽은 이 칸 클릭) · Esc / 패드 B = 취소 · 겹치면 서로 바뀜')
        : '패드 고정: 십자키 이동 · A 선택 · B 취소 · Start 나가기 (어두운 칸) · 패드는 P1 = 패드1, P2 = 패드2');
  }
}
