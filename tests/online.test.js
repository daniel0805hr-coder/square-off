import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionFor } from '../src/input/controls.js';

test('온라인 친구 입력: P1·P2 키 어느 쪽이든 같은 동작으로 읽음', () => {
  assert.equal(actionFor('KeyW'), 'up');
  assert.equal(actionFor('ArrowUp'), 'up');
  assert.equal(actionFor('KeyF'), 'confirm');
  assert.equal(actionFor('Digit2'), 'turnDefend');
  assert.equal(actionFor('KeyZ'), null);
});
