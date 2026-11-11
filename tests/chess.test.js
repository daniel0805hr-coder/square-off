import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChessGame, parseSquare as sq, PROMOTION_TYPES } from '../src/logic/chess.js';

// perft: 정해진 깊이까지 가능한 모든 수의 개수. 알려진 값과 같으면 룰 구현이 정확하다는 강한 증거
function snapshot(g) {
  return {
    board: g.board.map((row) => row.slice()),
    turn: g.turn, epSquare: g.epSquare, result: g.result,
    castling: { w: { ...g.castling.w }, b: { ...g.castling.b } },
    captured: { w: g.captured.w.slice(), b: g.captured.b.slice() },
    history: g.history.slice(),
  };
}
function restore(g, s) { Object.assign(g, s, { board: s.board.map((row) => row.slice()) }); }

function perft(g, depth) {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of g.allLegalMoves()) {
    for (const promo of m.promotion ? PROMOTION_TYPES : ['Q']) {
      if (depth === 1) { n++; continue; }
      const s = snapshot(g);
      g.move(m.from, m.to, promo);
      n += perft(g, depth - 1);
      restore(g, s);
    }
  }
  return n;
}

const play = (g, ...moves) => {
  for (const mv of moves) {
    const [from, to, promo] = mv.split(/[-=]/);
    assert.ok(g.move(sq(from), sq(to), promo), `불가능한 수: ${mv}`);
  }
};

test('perft 시작 국면 깊이 1~3', () => {
  const g = new ChessGame();
  assert.equal(perft(g, 1), 20);
  assert.equal(perft(g, 2), 400);
  assert.equal(perft(g, 3), 8902);
});

test('perft Kiwipete (캐슬링·앙파상·승급 혼합) 깊이 1~2', () => {
  const g = new ChessGame().loadFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -');
  assert.equal(perft(g, 1), 48);
  assert.equal(perft(g, 2), 2039);
});

test('perft 포지션 3 (앙파상 핀) 깊이 1~3', () => {
  const g = new ChessGame().loadFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -');
  assert.equal(perft(g, 1), 14);
  assert.equal(perft(g, 2), 191);
  assert.equal(perft(g, 3), 2812);
});

test('perft 포지션 4 (승급) 깊이 1~2', () => {
  const g = new ChessGame().loadFen('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq -');
  assert.equal(perft(g, 1), 6);
  assert.equal(perft(g, 2), 264);
});

test('바보의 메이트 → 바로 끝나지 않고 퀸 vs 킹 결전', () => {
  const g = new ChessGame();
  play(g, 'f2-f3', 'e7-e5', 'g2-g4', 'd8-h4');
  assert.equal(g.result, null);
  assert.deepEqual(g.duel, { color: 'w', king: sq('e1'), checkers: [sq('h4')] });
  assert.equal(g.history.at(-1).notation, 'Qd8-h4#');
  assert.equal(g.allLegalMoves().length, 0);
});

test('결전: 체크 건 말이 이기면 킹이 쓰러져 게임 끝', () => {
  const g = new ChessGame();
  play(g, 'f2-f3', 'e7-e5', 'g2-g4', 'd8-h4');
  g.resolveDuel('attacker', { attacker: 12, defender: 0 });
  assert.deepEqual(g.result, { type: 'kingslain', winner: 'b' });
  assert.equal(g.pieceAt(sq('e1')), null);
  assert.equal(g.pieceAt(sq('h4')).hp, 12);
});

test('결전: 킹이 이기면 체크 건 말 제거, 킹 HP 유지, 백 차례로 게임 계속', () => {
  const g = new ChessGame();
  play(g, 'f2-f3', 'e7-e5', 'g2-g4', 'd8-h4');
  const rec = g.resolveDuel('defender', { attacker: 0, defender: 15 });
  assert.equal(rec.notation, '결전: 퀸 패배');
  assert.equal(g.pieceAt(sq('h4')), null);
  assert.equal(g.pieceAt(sq('e1')).hp, 15);
  assert.deepEqual(g.captured.b, ['Q']);
  assert.equal(g.duel, null);
  assert.equal(g.result, null);
  assert.equal(g.turn, 'w');
  assert.ok(g.allLegalMoves().length > 0);
});

test('이중 체크메이트 → 두 말과 연속 결전, 킹 HP 이어짐', () => {
  // 나이트 h6→f7: 나이트 체크 + 열린 h파일로 룩 h1 체크 (흑 킹 h8은 룩 g8·폰 g7에 막힘)
  const g = new ChessGame().loadFen('6rk/6p1/7N/8/8/8/8/K6R w - -');
  assert.ok(g.move(sq('h6'), sq('f7')));
  assert.equal(g.duel.checkers.length, 2);
  g.resolveDuel('defender', { attacker: 0, defender: 20 });
  assert.equal(g.duel.checkers.length, 1);
  assert.equal(g.pieceAt(sq('h8')).hp, 20);
  g.resolveDuel('defender', { attacker: 0, defender: 8 });
  assert.equal(g.pieceAt(sq('h8')).hp, 8);
  assert.equal(g.result, null);
});

test('스테일메이트', () => {
  const g = new ChessGame().loadFen('7k/8/5Q2/8/8/8/8/K7 w - -');
  play(g, 'f6-g6');
  assert.deepEqual(g.result, { type: 'stalemate' });
});

test('앙파상: 옆 칸 폰이 잡히고 기록됨', () => {
  const g = new ChessGame();
  play(g, 'e2-e4', 'a7-a6', 'e4-e5', 'd7-d5');
  const rec = g.move(sq('e5'), sq('d6'));
  assert.ok(rec.enPassant);
  assert.equal(g.pieceAt(sq('d5')), null);
  assert.deepEqual(g.captured.b, ['P']);
});

test('앙파상은 바로 다음 수에만 가능', () => {
  const g = new ChessGame();
  play(g, 'e2-e4', 'a7-a6', 'e4-e5', 'd7-d5', 'h2-h3', 'h7-h6');
  assert.equal(g.findMove(sq('e5'), sq('d6')), null);
});

test('캐슬링 양쪽 + 룩 이동', () => {
  const g = new ChessGame().loadFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq -');
  play(g, 'e1-g1');
  assert.equal(g.pieceAt(sq('f1')).type, 'R');
  play(g, 'e8-c8');
  assert.equal(g.pieceAt(sq('d8')).type, 'R');
  assert.equal(g.history.at(-1).notation, 'O-O-O');
});

test('캐슬링 불가: 체크 중 / 지나가는 칸 공격 / 룩 움직인 뒤', () => {
  const inCheck = new ChessGame().loadFen('4r1k1/8/8/8/8/8/8/R3K2R w KQ -');
  assert.equal(inCheck.findMove(sq('e1'), sq('g1')), null);
  const attacked = new ChessGame().loadFen('5rk1/8/8/8/8/8/8/R3K2R w KQ -');
  assert.equal(attacked.findMove(sq('e1'), sq('g1')), null);
  assert.ok(attacked.findMove(sq('e1'), sq('c1')));
  const moved = new ChessGame().loadFen('4k3/8/8/8/8/8/8/R3K2R w KQ -');
  play(moved, 'h1-h2', 'e8-d8', 'h2-h1', 'd8-e8');
  assert.equal(moved.findMove(sq('e1'), sq('g1')), null);
});

test('승급: 원하는 기물로 바뀜', () => {
  const g = new ChessGame().loadFen('8/P6k/8/8/8/8/8/K7 w - -');
  const m = g.findMove(sq('a7'), sq('a8'));
  assert.ok(m.promotion);
  play(g, 'a7-a8=N');
  assert.equal(g.pieceAt(sq('a8')).type, 'N');
});

test('핀된 기물은 못 움직임', () => {
  const g = new ChessGame().loadFen('4r1k1/8/8/8/8/8/4N3/4K3 w - -');
  assert.equal(g.legalMovesFrom(sq('e2')).length, 0);
});

test('기물 부족 무승부', () => {
  const g = new ChessGame().loadFen('4k3/8/8/8/8/8/3q4/4K3 w - -');
  play(g, 'e1-d2');
  assert.deepEqual(g.result, { type: 'insufficient' });
  const bishops = new ChessGame().loadFen('4k3/8/8/8/2b5/8/8/4KB2 w - -');
  assert.equal(bishops.isInsufficientMaterial(), true); // f1, c4 둘 다 밝은 칸
});
