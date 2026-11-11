// 여러 화면이 같이 쓰는 글꼴·색·말 그림
import { WHITE, BLACK } from '../logic/chess.js';
import { pieceRGBA, SIZE } from './pieceArt.js';

export const FONT = 'Galmuri11';
export const FONT_SMALL = 'Galmuri9';
export const FONT_BIG = 'Galmuri14';
export const text = (size, color, family = FONT) => ({ fontFamily: family, fontSize: `${size}px`, color });

export const C = {
  light: 0xd8c8a8, dark: 0x8a6a4a,
  lastMove: 0xe8d36a, check: 0xd84a3a, select: 0xfff2a0, dot: 0x2b2420,
  panel: 0x26242f, panelLine: 0x3a3746,
  sand: 0xc9a86a, sandDark: 0xa8864e,
  heal: 0x6fd36f, gold: 0xffd34a,
};
export const PLAYER_OF = { [WHITE]: 1, [BLACK]: 2 };
export const COLOR_OF = { 1: WHITE, 2: BLACK };
export const PLAYER_COLOR = { 1: 0x5aa0ff, 2: 0xff6a5a };
export const PLAYER_HEX = { 1: '#5aa0ff', 2: '#ff6a5a' };
export const SIDE_NAME = { [WHITE]: '백', [BLACK]: '흑' };

// 말 그림 텍스처 (그림은 ui/pieceArt.js). 처음 쓸 때 한 번 만들어 모든 화면이 같이 쓴다
//   look: { flash, shadow } — 전투용 변형 (ui/fighter.js)
export function pieceTexture(scene, { type, color, vet }, { flash = false, shadow = true } = {}) {
  const key = `piece-${color}${type}${vet ? '-vet' : ''}${flash ? '-flash' : ''}${shadow ? '' : '-noshadow'}`;
  if (!scene.textures.exists(key)) {
    const tex = scene.textures.createCanvas(key, SIZE, SIZE);
    const rgba = pieceRGBA(type, color, { vet: Boolean(vet), flash, shadow });
    tex.context.putImageData(new ImageData(rgba, SIZE, SIZE), 0, 0);
    tex.refresh();
  }
  return key;
}

// 도트 말 (32×32, 베테랑은 금 테두리). radius 12 = 원래 크기, 도트가 뭉개지지 않게 정수 배로만 키운다
export function makePiece(scene, { x, y }, piece, radius = 12) {
  const ctr = scene.add.container(x, y);
  ctr.add(scene.add.image(0, 0, pieceTexture(scene, piece)).setScale(Math.max(1, Math.round(radius / 12))));
  return ctr;
}

// 전투 끝 제목. 킹 결전이면 공격 = 체크를 건 말, 수비 = 킹
export const endTitle = (winner, duel) => (duel
  ? (winner === 'attacker' ? '킹이 쓰러졌다!' : '킹 승리!')
  : (winner === 'attacker' ? '공격 성공!' : '방어 성공!'));
