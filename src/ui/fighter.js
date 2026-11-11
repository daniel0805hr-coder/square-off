// 전투 화면의 말: 발밑 링(판정 크기 + 플레이어 색) 위에 도트 말을 세운다
//   링은 바닥에 남고 말 그림만 들썩이거나 뛰어오르므로 점프 때는 링이 그림자 역할을 한다
import { pieceTexture } from './style.js';
import { SIZE, BASE_Y } from './pieceArt.js';

const STEP_RATE = 6;  // 걸을 때 1px 들썩이는 빠르기 (초당 걸음 수)
const FLASH_MS = 80;  // 맞은 순간 하얗게 번쩍이는 시간
const LEAN = 2;       // 공격할 때 앞으로 내미는 거리(px)

export class FighterView extends Phaser.GameObjects.Container {
  // body: 판정 반지름(px), color: 링 색 (플레이어 색), ring: false면 링 대신 그림 속 바닥 그림자 (잔상용)
  constructor(scene, { x, y }, piece, { body = 10, color = 0xffffff, ring = true } = {}) {
    super(scene, x, y);
    scene.add.existing(this);
    this.piece = piece;
    this.look = { shadow: !ring };
    this.walk = 0;
    this.prevPos = { x, y };
    if (ring) {
      // 받침(폭 18px)보다 넓어야 양옆과 앞쪽으로 팀 색이 드러난다
      const w = Math.max(body * 2, 18) + 8;
      this.ring = scene.add.ellipse(0, 0, w, Math.round(w * 0.45), color, 0.28).setStrokeStyle(1, color);
      this.add(this.ring);
    }
    // 받침 바닥이 링 한가운데: 판정 원 위에 말이 서 있는 모습
    this.baseY = 2;
    this.sprite = scene.add.image(0, this.baseY, pieceTexture(scene, piece, this.look)).setOrigin(0.5, (BASE_Y + 1) / SIZE);
    this.add(this.sprite);
  }

  // 바라보는 방향. 나이트만 좌우가 다른 그림이라 뒤집는다 (그림은 왼쪽을 봄)
  face(fx) {
    if (this.piece.type === 'N' && Math.abs(fx) > 0.1) this.sprite.setFlipX(fx > 0);
    return this;
  }

  // 매 프레임 위치. lift: 점프 높이, attacking: 공격 중이면 바라보는 쪽으로 내밂, dt: 걸음 들썩임용
  place(x, y, { lift = 0, lean = 0, dt = 0 } = {}) {
    const moved = Math.hypot(x - this.prevPos.x, y - this.prevPos.y) > 0.15;
    this.prevPos = { x, y };
    this.walk = moved && !lift ? this.walk + dt : 0;
    const bob = Math.floor(this.walk * STEP_RATE * 2) % 2;
    this.setPosition(x, y);
    this.sprite.setPosition(Math.round(lean * LEAN), this.baseY - Math.round(lift) - bob);
    this.ring?.setScale(1 - Math.min(lift, 30) / 60);
    return this;
  }

  // 맞은 순간: 몸이 하얗게 번쩍
  flash() {
    this.sprite.setTexture(pieceTexture(this.scene, this.piece, { ...this.look, flash: true }));
    this.flashTimer?.remove();
    this.flashTimer = this.scene.time.delayedCall(FLASH_MS, () => this.sprite.setTexture(pieceTexture(this.scene, this.piece, this.look)));
    return this;
  }

  // KO: 체스말이 받침을 축으로 옆으로 쓰러진다. dir: 1 = 오른쪽으로, -1 = 왼쪽으로
  fall(dir = 1) {
    this.flashTimer?.remove();
    this.sprite.setTexture(pieceTexture(this.scene, this.piece, this.look));
    this.scene.tweens.add({ targets: this.sprite, angle: 90 * dir, duration: 320, ease: 'Bounce.easeOut' });
    this.scene.time.delayedCall(320, () => this.sprite.setTint(0x8a8a8a));
    if (this.ring) this.scene.tweens.add({ targets: this.ring, alpha: 0, duration: 400 });
    return this;
  }
}
