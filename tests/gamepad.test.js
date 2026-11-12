import { test } from 'node:test';
import assert from 'node:assert/strict';

// 브라우저 대신 가짜 window·패드로 패드 → 키 이벤트 변환을 확인
const events = [];
let frame = null;
globalThis.window = { addEventListener() {} };
globalThis.document = { body: { dispatchEvent: (e) => events.push(`${e.type} ${e.code}`) } };
globalThis.KeyboardEvent = class { constructor(type, { code }) { this.type = type; this.code = code; } };
globalThis.requestAnimationFrame = (fn) => { frame = fn; };
const mk = (index) => ({ index, connected: true, axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false })) });
const pads = [mk(3), mk(7)];
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => pads }, configurable: true });

const { startGamepads, padSlotConnected } = await import('../src/input/gamepad.js');
const { setBinding, getBindings, resetBindings, actionFor, keyLabels } = await import('../src/input/controls.js');
const step = () => { events.length = 0; frame(); return events.slice(); };
startGamepads();

test('패드: 버튼·스틱을 연결 순서 번호의 키 이벤트로 바꿈', () => {
  assert.deepEqual(step(), []);
  assert.ok(padSlotConnected(1) && padSlotConnected(2));
  pads[0].buttons[0].pressed = true;
  assert.deepEqual(step(), ['keydown Pad1:B0']);
  assert.deepEqual(step(), []); // 누르고 있는 동안은 한 번만
  pads[0].buttons[0].pressed = false;
  assert.deepEqual(step(), ['keyup Pad1:B0']);
  // 두 번째 패드의 왼쪽 스틱 → 십자키 왼쪽, 살짝 돌아와도 유지(0.35 이상), 놓으면 뗌
  pads[1].axes = [-0.8, 0];
  assert.deepEqual(step(), ['keydown Pad2:B14']);
  pads[1].axes = [-0.4, 0];
  assert.deepEqual(step(), []);
  pads[1].axes = [0, 0];
  assert.deepEqual(step(), ['keyup Pad2:B14']);
  // 누른 채 패드가 빠지면 뗀 것으로
  pads[1].buttons[1].pressed = true;
  step();
  pads[1].connected = false;
  assert.deepEqual(step(), ['keyup Pad2:B1']);
  assert.ok(!padSlotConnected(2));
  pads[1].connected = true;
  pads[1].buttons[1].pressed = false;
  step();
});

test('패드 배치: 기본값, 키와 따로 바뀜, 겹치면 맞바꿈', () => {
  resetBindings();
  assert.equal(actionFor('Pad1:B0'), 'confirm');
  assert.equal(actionFor('Pad2:B3'), 'turnAttack');
  setBinding(1, 'confirm', 'Space'); // 키만 바뀌고 패드 A는 그대로
  assert.deepEqual(getBindings()[1].confirm, ['Pad1:B0', 'Space']);
  setBinding(1, 'skill', 'Pad1:B0'); // 패드 A를 스킬로 → 선택은 원래 스킬 버튼(X)을 받음
  assert.deepEqual(getBindings()[1].skill, ['KeyG', 'Pad1:B0']);
  assert.deepEqual(getBindings()[1].confirm, ['Space', 'Pad1:B2']);
  assert.equal(keyLabels(1).skill, 'A'); // 패드가 연결돼 있으면 도움말은 패드 버튼으로
  resetBindings();
});
