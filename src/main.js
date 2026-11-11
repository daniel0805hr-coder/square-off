import { BoardScene } from './scenes/BoardScene.js';
import { BattleScene } from './scenes/BattleScene.js';
import { KeyConfigScene } from './scenes/KeyConfigScene.js';
import { TurnBattleScene } from './scenes/TurnBattleScene.js';
import { ChaseScene, prepareChase } from './scenes/ChaseScene.js';
import { startGamepads } from './input/gamepad.js';
import { FX, prepareFx } from './ui/pixelfx.js';

// 폰트가 로드된 뒤에 게임을 시작해야 글자가 기본 폰트로 그려지지 않는다
await Promise.all([
  document.fonts.load('12px Galmuri11'),
  document.fonts.load('10px Galmuri9'),
  document.fonts.load('15px Galmuri14'), // 제목·전투 안내 글자
]).catch(() => {});

// 링크로 들어온 친구는 게임을 돌리지 않고 호스트 화면을 받아 본다 (src/net/online.js)
//   ?room=코드 = 인터넷 링크 방, ?lan=1 = 같은 네트워크(LAN·VPN) 방
const params = new URLSearchParams(location.search);
startGamepads(); // 패드 버튼 → 키 입력 (호스트·친구 화면 모두)
if (params.has('room')) {
  const { joinRoom } = await import('./net/online.js');
  joinRoom(params.get('room'), document.getElementById('game'));
} else if (params.has('lan')) {
  const { joinLan } = await import('./net/online.js');
  joinLan(document.getElementById('game'));
} else {
  startGame();
}

function startGame() {
  prepareChase(); // 추격전 숲의 나뭇잎 그림을 백그라운드에서 미리 그려 둔다
  prepareFx(FX.poof); // 말이 쓰러질 때마다 나는 연기
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
