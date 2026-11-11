// 여러 화면이 같이 쓰는 글꼴·색·임시 말 그림
import { WHITE, BLACK, PIECE_NAMES } from '../logic/chess.js';

export const FONT = 'Galmuri11';
export const FONT_SMALL = 'Galmuri9';
export const FONT_BIG = 'Galmuri14';
export const text = (size, color, family = FONT) => ({ fontFamily: family, fontSize: `${size}px`, color });

export const C = {
  light: 0xd8c8a8, dark: 0x8a6a4a,
  lastMove: 0xe8d36a, check: 0xd84a3a, select: 0xfff2a0, dot: 0x2b2420,
  whiteFill: 0xf2ead8, whiteLine: 0x3a2f25, blackFill: 0x2a2230, blackLine: 0xc8b89a,
  panel: 0x26242f, panelLine: 0x3a3746,
  sand: 0xc9a86a, sandDark: 0xa8864e,
  heal: 0x6fd36f, gold: 0xffd34a,
};
export const PLAYER_OF = { [WHITE]: 1, [BLACK]: 2 };
export const COLOR_OF = { 1: WHITE, 2: BLACK };
export const PLAYER_COLOR = { 1: 0x5aa0ff, 2: 0xff6a5a };
export const PLAYER_HEX = { 1: '#5aa0ff', 2: '#ff6a5a' };
export const SIDE_NAME = { [WHITE]: '백', [BLACK]: '흑' };

// 임시 말: 동그라미 + 한 글자 (에셋 정하기 전까지)
export function makePiece(scene, { x, y }, piece, radius = 12) {
  const white = piece.color === WHITE;
  const ctr = scene.add.container(x, y);
  ctr.add(scene.add.circle(0, 0, radius, white ? C.whiteFill : C.blackFill).setStrokeStyle(2, white ? C.whiteLine : C.blackLine));
  ctr.add(scene.add.text(0, 0, PIECE_NAMES[piece.type][0], text(12, white ? '#3a2f25' : '#efe4cc')).setOrigin(0.5));
  return ctr;
}

// 전투 끝 제목. 킹 결전이면 공격 = 체크를 건 말, 수비 = 킹
export const endTitle = (winner, duel) => (duel
  ? (winner === 'attacker' ? '킹이 쓰러졌다!' : '킹 승리!')
  : (winner === 'attacker' ? '공격 성공!' : '방어 성공!'));
