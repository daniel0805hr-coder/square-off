// 판 위 기물의 HP·공격력 계산 (베테랑 보너스 포함).
// 기물 객체: { type, color, hp?, vet? }  — hp가 없으면 최대 HP, vet = null | 'hp' | 'atk'

import { STATS, VALUE, BOARD, TOPDOWN as T } from './balance.js';

export const maxHp = (piece) => STATS[piece.type].hp * T.hpScale + (piece.vet === 'hp' ? BOARD.veteranHp : 0);
export const currentHp = (piece) => piece.hp ?? maxHp(piece);
export const attackStat = (piece) => STATS[piece.type].atk + (piece.vet === 'atk' ? BOARD.veteranAtk : 0);

// 하위 기물이 상위 기물을 잡았는가 (기획서 7장)
export const isGiantKill = (attacker, defender) => VALUE[attacker.type] < VALUE[defender.type];
