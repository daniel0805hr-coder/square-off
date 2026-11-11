import { BoardScene } from './scenes/BoardScene.js';
import { BattleScene } from './scenes/BattleScene.js';
import { KeyConfigScene } from './scenes/KeyConfigScene.js';
import { TurnBattleScene } from './scenes/TurnBattleScene.js';
import { ChaseScene } from './scenes/ChaseScene.js';

// 폰트가 로드된 뒤에 게임을 시작해야 글자가 기본 폰트로 그려지지 않는다
await Promise.all([
  document.fonts.load('12px Galmuri11'),
  document.fonts.load('10px Galmuri9'),
]).catch(() => {});

// ?room=코드 링크로 들어온 친구는 게임을 돌리지 않고 호스트 화면을 받아 본다 (src/net/online.js)
const room = new URLSearchParams(location.search).get('room');
if (room) {
  const { joinRoom } = await import('./net/online.js');
  joinRoom(room, document.getElementById('game'));
} else {
  startGame();
}

function startGame() {
  // 디버그용: 브라우저 콘솔에서 window.squareOff로 접근
  window.squareOff = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: 640,
    height: 360,
    backgroundColor: '#1b1a24',
    pixelArt: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [BoardScene, BattleScene, TurnBattleScene, ChaseScene, KeyConfigScene],
  });
}
