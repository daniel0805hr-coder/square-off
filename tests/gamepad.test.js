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
  assert.ok(setBinding(1, 'skill', 'Pad1:B3')); // 스킬을 Y로 → 턴제 공격은 원래 스킬 버튼(X)을 받음
  assert.deepEqual(getBindings()[1].skill, ['KeyG', 'Pad1:B3']);
  assert.deepEqual(getBindings()[1].turnAttack, ['Digit1', 'Pad1:B2']);
  assert.equal(keyLabels(1).skill, 'Y'); // 패드가 연결돼 있으면 도움말은 패드 버튼으로
  resetBindings();
});

test('패드 고정 버튼: A·B·십자키·Start는 바꿀 수 없음', () => {
  resetBindings();
  assert.equal(setBinding(1, 'skill', 'Pad1:B0'), false); // A를 스킬로 못 씀
  assert.equal(setBinding(1, 'turnHeal', 'Pad1:B9'), false); // Start도 고정
  assert.equal(setBinding(1, 'confirm', 'Pad1:B2'), false); // 선택의 패드 버튼은 A 고정
  assert.equal(setBinding(2, 'up', 'Pad2:B3'), false);
  assert.deepEqual(getBindings()[1].confirm, ['KeyF', 'Pad1:B0']);
  assert.deepEqual(getBindings()[1].skill, ['KeyG', 'Pad1:B2']);
  assert.ok(setBinding(1, 'confirm', 'Enter')); // 키는 그대로 바꿀 수 있음
  resetBindings();
});

test('진동: 자기 패드만 울림, 온라인 친구 몫은 친구에게 보냄', async () => {
  const { rumble, online } = await import('../src/input/controls.js');
  const { setRumble } = await import('../src/input/gamepad.js');
  resetBindings();
  const played = [];
  pads.forEach((g, i) => { g.vibrationActuator = { type: 'dual-rumble', playEffect: (_t, o) => { played.push([i + 1, o.duration]); return Promise.resolve(); } }; });
  step();
  rumble(2, 'hit');
  assert.deepEqual(played, [[2, 120]]); // P2 → 패드2만
  played.length = 0;
  setRumble(false);
  rumble(1, 'ko');
  assert.deepEqual(played, []); // 꺼 두면 안 울림
  setRumble(true);
  played.length = 0;
  const sent = [];
  Object.assign(online, { role: 'host', toGuest: (m) => sent.push(m) });
  rumble(2, 'ko');
  rumble(1, 'light');
  assert.deepEqual(sent, [{ t: 'rumble', kind: 'ko' }]); // P2는 친구 PC로
  assert.deepEqual(played.map((p) => p[0]).sort(), [1, 2]); // 호스트 PC 패드는 모두 P1
  Object.assign(online, { role: null, toGuest: null });
});
