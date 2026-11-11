// 체스 룰 엔진 — 화면·입력과 무관한 순수 로직. (+ 이 게임의 HP·보상 규칙)
// 좌표: r = 0(8랭크, 위) ~ 7(1랭크, 아래), c = 0(a파일) ~ 7(h파일)

import { BOARD } from './balance.js';
import { maxHp, currentHp, isGiantKill } from './units.js';
import { generateMap } from './terrain.js';

export const WHITE = 'w';
export const BLACK = 'b';
export const PIECE_NAMES = { K: '킹', Q: '퀸', R: '룩', B: '비숍', N: '나이트', P: '폰' };
export const PROMOTION_TYPES = ['Q', 'R', 'B', 'N'];

const FILES = 'abcdefgh';
const BACK_RANK = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
const KNIGHT_STEPS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING_STEPS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const SLIDE_DIRS = { R: ROOK_DIRS, B: BISHOP_DIRS, Q: [...ROOK_DIRS, ...BISHOP_DIRS] };

export const opponent = (color) => (color === WHITE ? BLACK : WHITE);
export const inBounds = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
export const squareName = ({ r, c }) => FILES[c] + (8 - r);
export const parseSquare = (name) => ({ r: 8 - Number(name[1]), c: FILES.indexOf(name[0]) });
export const isLightSquare = ({ r, c }) => (r + c) % 2 === 0;

const sameSquare = (a, b) => a && b && a.r === b.r && a.c === b.c;
const cloneBoard = (board) => board.map((row) => row.map((p) => (p ? { ...p } : null)));

// board 위에서 (r, c)가 byColor 기물에게 공격받고 있는가
export function isAttacked(board, r, c, byColor) {
  // 폰: byColor 폰은 자기 진행 방향 대각선을 공격한다
  const pawnRow = byColor === WHITE ? r + 1 : r - 1;
  for (const dc of [-1, 1]) {
    const p = inBounds(pawnRow, c + dc) && board[pawnRow][c + dc];
    if (p && p.color === byColor && p.type === 'P') return true;
  }
  for (const [dr, dc] of KNIGHT_STEPS) {
    const p = inBounds(r + dr, c + dc) && board[r + dr][c + dc];
    if (p && p.color === byColor && p.type === 'N') return true;
  }
  for (const [dr, dc] of KING_STEPS) {
    const p = inBounds(r + dr, c + dc) && board[r + dr][c + dc];
    if (p && p.color === byColor && p.type === 'K') return true;
  }
  for (const [dirs, types] of [[ROOK_DIRS, 'RQ'], [BISHOP_DIRS, 'BQ']]) {
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      while (inBounds(rr, cc)) {
        const p = board[rr][cc];
        if (p) {
          if (p.color === byColor && types.includes(p.type)) return true;
          break;
        }
        rr += dr; cc += dc;
      }
    }
  }
  return false;
}

export class ChessGame {
  constructor() {
    this.reset();
  }

  reset() {
    this.board = Array.from({ length: 8 }, () => Array(8).fill(null));
    for (let c = 0; c < 8; c++) {
      this.board[0][c] = { type: BACK_RANK[c], color: BLACK };
      this.board[1][c] = { type: 'P', color: BLACK };
      this.board[6][c] = { type: 'P', color: WHITE };
      this.board[7][c] = { type: BACK_RANK[c], color: WHITE };
    }
    this.turn = WHITE;
    this.castling = { w: { k: true, q: true }, b: { k: true, q: true } };
    this.epSquare = null; // 앙파상으로 잡을 수 있는 칸 (직전 2칸 전진한 폰이 지나간 칸)
    this.history = [];
    this.captured = { w: [], b: [] }; // 각 색이 잃은 기물
    this.result = null; // { type: 'stalemate' | 'insufficient' | 'kingslain', winner? }
    this.duel = null; // 체크메이트 → 결전 대기 { color: 몰린 킹의 색, king: 칸, checkers: [체크를 건 말의 칸] }
    this.shieldUsed = { w: false, b: false }; // 킹 실드는 게임 전체 1회
    this.terrain = generateMap(); // 칸마다 지형 (전투 방식) — 게임마다 새로 생성
  }

  // FEN 문자열로 국면 설정 (테스트·고정 맵용)
  loadFen(fen) {
    const [placement, turn, castling, ep] = fen.trim().split(/\s+/);
    this.reset();
    this.board = placement.split('/').map((row) => {
      const cells = [];
      for (const ch of row) {
        if (/\d/.test(ch)) cells.push(...Array(Number(ch)).fill(null));
        else cells.push({ type: ch.toUpperCase(), color: ch === ch.toUpperCase() ? WHITE : BLACK });
      }
      return cells;
    });
    this.turn = turn === 'b' ? BLACK : WHITE;
    const cs = castling || '-';
    this.castling = { w: { k: cs.includes('K'), q: cs.includes('Q') }, b: { k: cs.includes('k'), q: cs.includes('q') } };
    this.epSquare = ep && ep !== '-' ? parseSquare(ep) : null;
    return this;
  }

  // 그 칸의 지형. 전투는 수비 말이 서 있는 칸(앙파상이면 잡히는 폰의 칸)에서 벌어진다
  terrainAt({ r, c }) {
    return this.terrain[r][c];
  }

  pieceAt({ r, c }) {
    return inBounds(r, c) ? this.board[r][c] : null;
  }

  findKing(color, board = this.board) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (p && p.type === 'K' && p.color === color) return { r, c };
      }
    }
    return null;
  }

  inCheck(color = this.turn, board = this.board) {
    const k = this.findKing(color, board);
    return k ? isAttacked(board, k.r, k.c, opponent(color)) : false;
  }

  // 자기 킹 안전을 따지지 않은 이동 후보
  pseudoMoves(from) {
    const piece = this.pieceAt(from);
    if (!piece) return [];
    const { r, c } = from;
    const moves = [];
    const add = (tr, tc, extra = {}) => {
      const target = this.board[tr][tc];
      moves.push({
        from, to: { r: tr, c: tc }, piece,
        captured: target, capturedSquare: target ? { r: tr, c: tc } : null,
        ...extra,
      });
    };
    const enemyAt = (tr, tc) => inBounds(tr, tc) && this.board[tr][tc] && this.board[tr][tc].color !== piece.color;
    const emptyAt = (tr, tc) => inBounds(tr, tc) && !this.board[tr][tc];

    if (piece.type === 'P') {
      const dir = piece.color === WHITE ? -1 : 1;
      const startRow = piece.color === WHITE ? 6 : 1;
      const lastRow = piece.color === WHITE ? 0 : 7;
      const promo = (tr) => (tr === lastRow ? { promotion: true } : {});
      if (emptyAt(r + dir, c)) {
        add(r + dir, c, promo(r + dir));
        if (r === startRow && emptyAt(r + 2 * dir, c)) add(r + 2 * dir, c, { double: true });
      }
      for (const dc of [-1, 1]) {
        if (enemyAt(r + dir, c + dc)) add(r + dir, c + dc, promo(r + dir));
        if (sameSquare(this.epSquare, { r: r + dir, c: c + dc })) {
          // 앙파상: 잡히는 폰은 도착 칸이 아니라 바로 옆 칸에 있다
          moves.push({
            from, to: { r: r + dir, c: c + dc }, piece,
            captured: this.board[r][c + dc], capturedSquare: { r, c: c + dc },
            enPassant: true,
          });
        }
      }
    } else if (piece.type === 'N' || piece.type === 'K') {
      for (const [dr, dc] of piece.type === 'N' ? KNIGHT_STEPS : KING_STEPS) {
        if (emptyAt(r + dr, c + dc) || enemyAt(r + dr, c + dc)) add(r + dr, c + dc);
      }
      if (piece.type === 'K') this.addCastling(from, piece, moves);
    } else {
      for (const [dr, dc] of SLIDE_DIRS[piece.type]) {
        let tr = r + dr, tc = c + dc;
        while (emptyAt(tr, tc)) { add(tr, tc); tr += dr; tc += dc; }
        if (enemyAt(tr, tc)) add(tr, tc);
      }
    }
    return moves;
  }

  addCastling(from, king, moves) {
    const row = king.color === WHITE ? 7 : 0;
    if (from.r !== row || from.c !== 4) return;
    const enemy = opponent(king.color);
    if (isAttacked(this.board, row, 4, enemy)) return;
    const rights = this.castling[king.color];
    const sides = [
      { side: 'k', rookCol: 7, empty: [5, 6], safe: [5, 6], kingTo: 6, rookTo: 5 },
      { side: 'q', rookCol: 0, empty: [1, 2, 3], safe: [3, 2], kingTo: 2, rookTo: 3 },
    ];
    for (const s of sides) {
      const rook = this.board[row][s.rookCol];
      if (!rights[s.side] || !rook || rook.type !== 'R' || rook.color !== king.color) continue;
      if (s.empty.some((cc) => this.board[row][cc])) continue;
      if (s.safe.some((cc) => isAttacked(this.board, row, cc, enemy))) continue;
      moves.push({
        from, to: { r: row, c: s.kingTo }, piece: king, captured: null, capturedSquare: null,
        castle: { side: s.side, rookFrom: { r: row, c: s.rookCol }, rookTo: { r: row, c: s.rookTo } },
      });
    }
  }

  // 이동을 적용한 새 보드 (원본은 그대로)
  boardAfter(move, promotionType = 'Q') {
    const b = cloneBoard(this.board);
    const piece = b[move.from.r][move.from.c];
    if (move.capturedSquare) b[move.capturedSquare.r][move.capturedSquare.c] = null;
    b[move.from.r][move.from.c] = null;
    b[move.to.r][move.to.c] = move.promotion ? { ...piece, type: promotionType } : piece;
    if (move.castle) {
      const { rookFrom, rookTo } = move.castle;
      b[rookTo.r][rookTo.c] = b[rookFrom.r][rookFrom.c];
      b[rookFrom.r][rookFrom.c] = null;
    }
    return b;
  }

  legalMovesFrom(from) {
    const piece = this.pieceAt(from);
    if (!piece || piece.color !== this.turn || this.result) return [];
    return this.pseudoMoves(from).filter((m) => !this.inCheck(piece.color, this.boardAfter(m)));
  }

  allLegalMoves(color = this.turn) {
    const moves = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.board[r][c];
        if (p && p.color === color) {
          moves.push(...this.pseudoMoves({ r, c }).filter((m) => !this.inCheck(color, this.boardAfter(m))));
        }
      }
    }
    return moves;
  }

  findMove(from, to) {
    return this.legalMovesFrom(from).find((m) => sameSquare(m.to, to)) || null;
  }

  // 수를 둔다. 성공하면 기록 객체, 불가능한 수면 null
  // outcome: 잡는 수일 때 전투 결과
  //   'attacker' = 공격자 승리 (일반 체스처럼 잡음)
  //   'defender' = 수비자 승리 (공격한 말이 제거됨)
  //   'retreat'  = 시간 종료로 방어 성공 (아무도 안 죽고 공격자는 원래 칸으로 후퇴)
  // hp: 전투가 끝났을 때 남은 HP { attacker, defender } — 살아남은 말은 이 HP로 판에 남는다
  move(from, to, promotionType = 'Q', outcome = 'attacker', hp = null) {
    const m = this.findMove(from, to);
    if (!m) return null;
    if (m.promotion && !PROMOTION_TYPES.includes(promotionType)) return null;
    const color = m.piece.color;
    const failed = Boolean(m.captured) && outcome !== 'attacker';

    if (!failed) {
      this.board = this.boardAfter(m, promotionType);
      if (m.captured) this.captured[m.captured.color].push(m.captured.type);
      this.updateCastlingRights(m);
    } else if (outcome === 'defender') {
      this.board = cloneBoard(this.board);
      this.board[from.r][from.c] = null;
      this.captured[color].push(m.piece.type);
      this.updateCastlingRights({ piece: m.piece, from, capturedSquare: null });
    }
    this.epSquare = !failed && m.double ? { r: (m.from.r + m.to.r) / 2, c: m.from.c } : null;
    const extra = this.applyHp(m, outcome, failed, hp);
    this.turn = opponent(color);

    const check = this.updateResult();

    const record = {
      ...m,
      promotion: m.promotion && !failed ? promotionType : null,
      outcome: m.captured ? outcome : null,
      check, mate: Boolean(this.duel),
      ...extra,
    };
    record.notation = notate(record);
    this.history.push(record);
    return record;
  }

  // 수를 둔 뒤 게임 상태 갱신. 돌려주는 값 = 지금 둘 차례인 쪽이 체크인가
  //   체크메이트는 바로 끝나지 않고 결전이 된다 (기획서 9장): 체크를 건 말 vs 킹
  updateResult() {
    this.duel = null;
    const lostKing = [WHITE, BLACK].find((c) => !this.findKing(c));
    if (lostKing) {
      // 전투에서 킹이 쓰러짐 → 게임 종료
      this.result = { type: 'kingslain', winner: opponent(lostKing) };
      return false;
    }
    const check = this.inCheck(this.turn);
    const hasMoves = this.allLegalMoves(this.turn).length > 0;
    if (!hasMoves && check) {
      const king = this.findKing(this.turn);
      this.duel = { color: this.turn, king, checkers: this.attackersOf(king, opponent(this.turn)) };
    } else if (!hasMoves) this.result = { type: 'stalemate' };
    else if (this.isInsufficientMaterial()) this.result = { type: 'insufficient' };
    return check;
  }

  // sq를 공격하고 있는 byColor 말들의 칸
  attackersOf(sq, byColor) {
    const out = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.board[r][c];
        if (!p || p.color !== byColor) continue;
        if (this.pseudoMoves({ r, c }).some((m) => sameSquare(m.to, sq))) out.push({ r, c });
      }
    }
    return out;
  }

  // 결전 하나의 결과 적용 (체크를 건 말 중 첫 번째와 싸운 결과)
  //   winner 'attacker' = 체크 건 말 승리 → 킹 제거, 게임 끝
  //   winner 'defender' = 킹 승리 → 체크 건 말 제거. 이중 체크면 다음 말과 바로 이어서 결전 (HP 유지)
  //   hp.defender = 킹의 남은 HP
  resolveDuel(winner, hp = null) {
    const d = this.duel;
    if (!d) return null;
    const [from, ...rest] = d.checkers;
    const checker = this.pieceAt(from);
    const king = this.pieceAt(d.king);
    const record = { duel: true, piece: { ...checker }, from, to: { ...d.king }, winner };
    if (winner === 'attacker') {
      this.board[d.king.r][d.king.c] = null;
      this.captured[d.color].push('K');
      if (hp) checker.hp = hp.attacker;
    } else {
      this.board[from.r][from.c] = null;
      this.captured[checker.color].push(checker.type);
      this.updateCastlingRights({ piece: checker, from, capturedSquare: null });
      if (hp) king.hp = hp.defender;
    }
    record.notation = `결전: ${PIECE_NAMES[checker.type]} ${winner === 'attacker' ? '승리' : '패배'}`; // 체크 건 쪽 기록
    this.history.push(record);
    if (winner === 'defender' && rest.length) {
      this.duel = { ...d, checkers: rest };
      return record;
    }
    this.updateResult(); // 체크 건 말이 사라져 다른 말의 길이 열리면 다시 결전이 될 수도 있다
    return record;
  }

  // HP 유지·승급 회복·공격 보상·킹 주변 회복 (기획서 7장). 기록에 붙일 정보를 돌려준다.
  applyHp(m, outcome, failed, hp) {
    const at = (sq) => this.board[sq.r][sq.c];
    const extra = {};
    if (m.captured && hp) {
      if (!failed) {
        const winner = at(m.to);
        if (m.promotion) delete winner.hp; // 승급 → 새 기물로 풀 HP
        else winner.hp = Math.min(maxHp(winner), hp.attacker + (hp.noReward ? 0 : BOARD.winReward)); // 추격전은 보상 없음
        if (isGiantKill(m.piece, m.captured) && !winner.vet) extra.veteranPending = { ...m.to };
      } else {
        at(m.capturedSquare).hp = hp.defender;
        if (outcome === 'retreat') at(m.from).hp = hp.attacker;
      }
    } else if (m.promotion && !failed) {
      delete at(m.to).hp;
    }
    // 수를 둔 쪽 킹 주변 8칸의 아군 회복 (킹 자신은 제외)
    const king = this.findKing(m.piece.color);
    extra.healed = [];
    if (king) {
      for (let r = king.r - 1; r <= king.r + 1; r++) {
        for (let c = king.c - 1; c <= king.c + 1; c++) {
          const p = inBounds(r, c) && this.board[r][c];
          if (!p || p.color !== m.piece.color || p.type === 'K' || currentHp(p) >= maxHp(p)) continue;
          p.hp = Math.min(maxHp(p), currentHp(p) + BOARD.healPerTurn);
          extra.healed.push({ r, c });
        }
      }
    }
    return extra;
  }

  // 베테랑 승격 선택 적용: 'hp' = 최대 HP 증가(그만큼 회복), 'atk' = 공격 +1
  promoteVeteran(sq, choice) {
    const p = this.pieceAt(sq);
    if (!p || p.vet) return;
    const before = currentHp(p);
    p.vet = choice;
    if (choice === 'hp') p.hp = before + BOARD.veteranHp;
  }

  updateCastlingRights(m) {
    if (m.piece.type === 'K') this.castling[m.piece.color] = { k: false, q: false };
    // 코너 칸에서 움직이거나 코너 칸이 잡히면 그쪽 룩의 캐슬링 권리가 사라진다
    for (const sq of [m.from, m.capturedSquare]) {
      if (!sq || (sq.r !== 0 && sq.r !== 7)) continue;
      const color = sq.r === 7 ? WHITE : BLACK;
      if (sq.c === 0) this.castling[color].q = false;
      if (sq.c === 7) this.castling[color].k = false;
    }
  }

  // 킹 vs 킹 / 킹+비숍 or 나이트 vs 킹 / 같은 색 칸 비숍끼리
  isInsufficientMaterial() {
    const others = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.board[r][c];
        if (p && p.type !== 'K') others.push({ ...p, r, c });
      }
    }
    if (others.length === 0) return true;
    if (others.length === 1) return others[0].type === 'B' || others[0].type === 'N';
    if (others.every((p) => p.type === 'B')) {
      const shade = isLightSquare(others[0]);
      return others.every((p) => isLightSquare(p) === shade);
    }
    return false;
  }
}

function notate(m) {
  if (m.castle) return (m.castle.side === 'k' ? 'O-O' : 'O-O-O') + (m.mate ? '#' : m.check ? '+' : '');
  const letter = m.piece.type === 'P' ? '' : m.piece.type;
  const sep = m.captured ? 'x' : '-';
  return letter + squareName(m.from) + sep + squareName(m.to)
    + (m.promotion ? '=' + m.promotion : '')
    + (m.mate ? '#' : m.check ? '+' : '')
    + (m.outcome === 'defender' ? ' 실패' : m.outcome === 'retreat' ? ' 후퇴' : '');
}
