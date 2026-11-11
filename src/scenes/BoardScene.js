import { ChessGame, WHITE, BLACK, PIECE_NAMES, PROMOTION_TYPES, isLightSquare } from '../logic/chess.js';
import { InputRouter, keyLabels, online } from '../input/controls.js';
import { hostRoom, HostPanel } from '../net/online.js';
import { chooseChessMove, BOT_LEVELS } from '../logic/ai.js';
import { BOARD } from '../logic/balance.js';
import { maxHp, currentHp, attackStat } from '../logic/units.js';
import { TERRAIN } from '../logic/terrain.js';
import { FONT_SMALL, FONT_BIG, text, C, PLAYER_OF, COLOR_OF, PLAYER_COLOR, PLAYER_HEX, SIDE_NAME, makePiece } from '../ui/style.js';

const TILE = 32;
const BOARD_X = 192;
const BOARD_Y = 60;

// 시작 메뉴. ai = P2(흑)를 컴퓨터가 맡을 때의 난이도
const MENU = [
  { label: '2인 대전', ai: null },
  { label: '컴퓨터 상대 · 쉬움', ai: 'easy' },
  { label: '컴퓨터 상대 · 보통', ai: 'normal' },
  { label: '온라인 · 방 만들기', online: true },
  { label: '키 설정', keys: true },
];
const AI_PLAYER = 2;
const TERRAIN_COLOR = {
  arena: { light: 0xe2c992, dark: 0xb48f55, mark: 0x7a5a2a },    // 투기장: 모래
  fortress: { light: 0xc3c6cf, dark: 0x858893, mark: 0x4a4d57 }, // 성채: 돌바닥
  forest: { light: 0xa7c98f, dark: 0x6b9a57, mark: 0x2f4a26 },    // 숲: 풀
};
const VETERAN_CHOICES = [
  { key: 'hp', label: 'HP +1칸', desc: '최대 HP 증가' },
  { key: 'atk', label: '공격 +1', desc: '피해량 증가' },
];

const DIRS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };

export class BoardScene extends Phaser.Scene {
  constructor() {
    super('board');
  }

  create() {
    this.chess = new ChessGame();
    this.newGame();

    this.boardGfx = this.add.graphics();
    this.pieceLayer = this.add.container(0, 0);
    this.overlay = this.add.container(0, 0).setDepth(10);
    this.drawStatic();

    new InputRouter(this, (cmd) => this.onCommand(cmd));
    // 전투 또는 키 설정 화면에서 돌아왔을 때
    this.events.on('wake', (_sys, data) => (data?.from === 'keys' ? this.render() : this.onBattleEnd(data)));
    this.input.on('pointerdown', (p) => this.onPointer(p, 'local'));
    this.render();
  }

  newGame() {
    this.chess.reset();
    this.cursor = { 1: { r: 6, c: 4 }, 2: { r: 1, c: 4 } };
    this.selected = null;
    this.mode = 'menu'; // menu | online | select | promotion | battle | veteran | over
    this.menuIndex ??= 0;
    this.ai = null;
    this.aiTimer?.remove();
    this.promo = null; // { from, to, index }
    this.flash = null;
  }

  chooseMenu(i) {
    if (MENU[i].online) {
      this.openRoom();
    } else if (MENU[i].keys) {
      this.scene.launch('keys');
      this.scene.sleep();
    } else {
      this.startGame(MENU[i].ai);
    }
  }

  startGame(ai) {
    this.ai = ai;
    this.mode = 'select';
    this.render();
    this.maybeAiTurn();
  }

  // 온라인 방 만들기: 링크를 보여주고 친구를 기다린다. 친구가 들어오면 바로 2인 대전 (친구 = P2)
  openRoom() {
    if (this.room) {
      // 이미 친구와 연결된 상태면 바로 새 대전
      if (online.role === 'host') this.startGame(null);
      return;
    }
    this.mode = 'online';
    this.onlineText = '연결 서버에 접속하는 중…';
    this.panel = new HostPanel();
    this.panel.show(this.onlineText);
    this.room = hostRoom({
      game: this.game,
      onClick: (at) => this.onPointer(at, 'remote'),
      onStatus: (st) => {
        if (st.state === 'waiting') {
          this.onlineText = '친구를 기다리는 중…\n아래 링크를 친구에게 보내세요';
          this.panel.show('방 링크', st.link);
        } else if (st.state === 'joined') {
          this.panel.show('온라인 · 친구(P2) 연결됨');
          this.newGame();
          this.startGame(null);
          this.say('친구가 들어왔어요! 나는 P1(백), 친구는 P2(흑)');
        } else if (st.state === 'left') {
          this.panel.show('친구 연결이 끊겼어요 — 이제 이 컴퓨터에서 P2도 조작해요');
          this.say('친구 연결이 끊겼어요');
        } else if (st.state === 'error') {
          this.onlineText = `${st.message}\n취소 키 = 메뉴로`;
          this.panel.show(st.message);
        }
        this.render();
      },
    });
    this.render();
  }

  closeRoom() {
    this.room?.close();
    this.room = null;
    this.panel?.remove();
    this.panel = null;
  }

  // 온라인일 때 이 입력이 그 플레이어 것인가 (who: 'local' = 이 컴퓨터 = P1, 'remote' = 친구 = P2)
  //   오프라인이면 누구든 모든 플레이어를 조작한다
  ownedBy(who, player) {
    if (online.role !== 'host') return who === 'local';
    return player === (who === 'remote' ? 2 : 1);
  }

  isAi(player) {
    return this.ai !== null && player === AI_PLAYER;
  }

  // 컴퓨터 차례면 잠깐 고민하는 척하고, 고른 말을 보여준 뒤 둔다
  maybeAiTurn() {
    if (this.mode !== 'select' || !this.isAi(this.currentPlayer)) return;
    this.aiTimer = this.time.delayedCall(600, () => {
      const m = chooseChessMove(this.chess);
      if (!m) return;
      this.selected = m.from;
      this.cursor[AI_PLAYER] = { ...m.to };
      this.render();
      this.aiTimer = this.time.delayedCall(450, () => { this.commitMove(m.from, m.to, 'Q'); this.render(); });
    });
  }

  get currentPlayer() {
    return PLAYER_OF[this.chess.turn];
  }

  // ───────── 입력 처리 ─────────

  onCommand({ player, action, source, remote }) {
    if (this.mode === 'battle') return;
    // 체스판은 마우스로 직접 칸을 고른다. 마우스 버튼 지정은 전투 화면에서만 쓴다
    if (source === 'mouse') return;
    const who = remote ? 'remote' : 'local';
    if (this.mode === 'online') {
      if (action === 'cancel' && !remote) { this.closeRoom(); this.mode = 'menu'; this.render(); }
      return;
    }
    if (this.mode === 'menu' && remote) return; // 메뉴는 호스트만
    if (this.mode === 'menu') {
      if (action === 'up') this.menuIndex = (this.menuIndex + MENU.length - 1) % MENU.length;
      if (action === 'down') this.menuIndex = (this.menuIndex + 1) % MENU.length;
      if (action === 'confirm') { this.chooseMenu(this.menuIndex); return; }
      this.render();
      return;
    }
    if (this.mode === 'over') {
      if (action === 'confirm') { this.newGame(); this.render(); }
      return;
    }
    if (this.mode === 'veteran') {
      if (player !== this.vet.player || !this.ownedBy(who, player)) return;
      if (DIRS[action]) this.vet.index = 1 - this.vet.index;
      if (action === 'confirm') this.chooseVeteran(VETERAN_CHOICES[this.vet.index].key);
      this.render();
      return;
    }
    if (player !== this.currentPlayer || this.isAi(player) || !this.ownedBy(who, player)) return;

    if (this.mode === 'promotion') {
      if (action === 'left' || action === 'up') this.promo.index = (this.promo.index + 3) % 4;
      if (action === 'right' || action === 'down') this.promo.index = (this.promo.index + 1) % 4;
      if (action === 'confirm') this.commitMove(this.promo.from, this.promo.to, PROMOTION_TYPES[this.promo.index]);
      if (action === 'cancel') { this.mode = 'select'; this.promo = null; }
      this.render();
      return;
    }

    const cur = this.cursor[player];
    if (DIRS[action]) {
      const [dr, dc] = DIRS[action];
      cur.r = Phaser.Math.Clamp(cur.r + dr, 0, 7);
      cur.c = Phaser.Math.Clamp(cur.c + dc, 0, 7);
    } else if (action === 'confirm') {
      this.pick({ ...cur });
    } else if (action === 'cancel') {
      this.selected = null;
    }
    this.render();
  }

  // who: 'local' = 이 화면의 마우스, 'remote' = 온라인 친구의 클릭
  onPointer(pointer, who = 'local') {
    const c = Math.floor((pointer.x - BOARD_X) / TILE);
    const r = Math.floor((pointer.y - BOARD_Y) / TILE);
    if (this.mode === 'battle' || this.mode === 'online') return;
    if (who === 'remote' && online.role !== 'host') return;
    if (this.mode === 'menu') {
      if (who === 'remote') return; // 메뉴는 호스트만
      const i = MENU.findIndex((_, j) => Math.abs(pointer.y - this.menuY(j)) <= 9 && Math.abs(pointer.x - 320) <= 90);
      if (i >= 0) { this.menuIndex = i; this.chooseMenu(i); }
      return;
    }
    if (this.mode === 'veteran') {
      if (this.isAi(this.vet.player) || (online.role === 'host' && !this.ownedBy(who, this.vet.player))) return;
      const i = VETERAN_CHOICES.findIndex((_, j) => Math.abs(pointer.x - this.vetX(j)) <= 40 && Math.abs(pointer.y - (BOARD_Y + 140)) <= 16);
      if (i >= 0) { this.chooseVeteran(VETERAN_CHOICES[i].key); this.render(); }
      return;
    }
    if (this.isAi(this.currentPlayer)) return;
    if (this.mode !== 'over' && online.role === 'host' && !this.ownedBy(who, this.currentPlayer)) return;
    if (this.mode === 'over') { this.onCommand({ player: 1, action: 'confirm' }); return; }
    if (this.mode === 'promotion') {
      const i = this.promoIndexAt(pointer.x, pointer.y);
      if (i !== null) { this.promo.index = i; this.onCommand({ player: this.currentPlayer, action: 'confirm', remote: who === 'remote' }); }
      return;
    }
    if (r < 0 || r > 7 || c < 0 || c > 7) return;
    this.cursor[this.currentPlayer] = { r, c };
    this.pick({ r, c });
    this.render();
  }

  pick(sq) {
    const g = this.chess;
    if (this.selected) {
      const move = g.findMove(this.selected, sq);
      if (move) {
        if (move.promotion) {
          this.mode = 'promotion';
          this.promo = { from: this.selected, to: sq, index: 0 };
        } else {
          this.commitMove(this.selected, sq);
        }
        return;
      }
    }
    const piece = g.pieceAt(sq);
    if (piece && piece.color === g.turn) {
      if (g.legalMovesFrom(sq).length) this.selected = sq;
      else { this.selected = null; this.say(`이 ${PIECE_NAMES[piece.type]}은(는) 움직일 수 없어요`); }
    } else {
      this.selected = null;
    }
  }

  commitMove(from, to, promotion) {
    const move = this.chess.findMove(from, to);
    this.selected = null;
    this.promo = null;
    if (move?.captured) this.startBattle(move, promotion);
    else this.finishMove(from, to, promotion);
  }

  finishMove(from, to, promotion, outcome, hp) {
    const rec = this.chess.move(from, to, promotion, outcome, hp);
    this.mode = this.chess.result ? 'over' : 'select';
    if (rec?.captured) {
      const atk = PIECE_NAMES[rec.piece.type], def = PIECE_NAMES[rec.captured.type];
      const reward = hp?.noReward ? '' : ` (HP +${BOARD.winReward / 10}칸)`;
      if (outcome === 'attacker') this.say(`공격 성공! ${atk}이(가) ${def}을(를) 잡았다${reward}`);
      else if (outcome === 'retreat') this.say(`방어 성공! ${def}이(가) 버텼다 — 둘 다 제자리`);
      else this.say(`방어 성공! ${def}이(가) ${atk}을(를) 물리쳤다`);
    }
    // 자이언트 킬 → 베테랑 승격 선택
    if (rec?.veteranPending && !this.chess.result) {
      const player = PLAYER_OF[rec.piece.color];
      this.vet = { square: rec.veteranPending, player, index: 0 };
      this.mode = 'veteran';
      if (this.isAi(player)) this.time.delayedCall(700, () => { this.chooseVeteran('atk'); this.render(); });
      return;
    }
    this.afterTurn();
  }

  // 수가 끝난 뒤: 체크메이트면 결전, 아니면 다음 차례 (컴퓨터면 둔다)
  afterTurn() {
    if (this.chess.duel) this.startDuel();
    else this.maybeAiTurn();
  }

  chooseVeteran(choice) {
    this.chess.promoteVeteran(this.vet.square, choice);
    this.say(`베테랑 승격! ${choice === 'hp' ? '최대 HP +1칸' : '공격 +1'}`);
    this.vet = null;
    this.mode = 'select';
    this.afterTurn();
  }

  // 잡는 수 → 그 칸으로 줌인한 뒤 전투 장면으로
  startBattle(move, promotion) {
    this.mode = 'battle';
    this.pendingMove = { from: move.from, to: move.to, promotion };
    this.render();
    const { x, y } = this.tileCenter(move.capturedSquare);
    const cam = this.cameras.main;
    cam.pan(x, y, 450, 'Sine.easeIn');
    cam.zoomTo(6, 450, 'Sine.easeIn');
    cam.fadeOut(450, 17, 16, 24);
    cam.once('camerafadeoutcomplete', () => {
      const bot = this.ai ? { player: AI_PLAYER, level: this.ai } : null;
      const shields = { w: !this.chess.shieldUsed.w, b: !this.chess.shieldUsed.b };
      // 전투 방식은 수비 말이 서 있는 칸의 지형으로 정해진다
      const scene = { arena: 'battle', fortress: 'turnbattle', forest: 'chase' }[this.chess.terrainAt(move.capturedSquare)];
      this.scene.launch(scene, { attacker: move.piece, defender: move.captured, shields, bot });
      this.scene.sleep();
    });
  }

  // 체크메이트 → 킹 결전 (기획서 9장): 체크를 건 말 vs 킹, 한쪽이 쓰러질 때까지
  //   킹이 선 칸의 지형으로 싸운다. 숲은 추격전으로는 끝이 안 나므로 투기장(탑다운) 결전
  startDuel() {
    const d = this.chess.duel;
    const checker = this.chess.pieceAt(d.checkers[0]);
    const king = this.chess.pieceAt(d.king);
    this.mode = 'battle';
    this.duelPending = true;
    const double = d.checkers.length > 1 ? ` (이중 체크 — ${d.checkers.length}연전)` : '';
    this.say(`체크메이트! ${PIECE_NAMES[checker.type]} vs 킹 결전${double}`);
    this.selected = d.checkers[0];
    this.render();
    const cam = this.cameras.main;
    cam.shake(500, 0.006);
    cam.flash(200, 255, 80, 60);
    this.time.delayedCall(1100, () => {
      const { x, y } = this.tileCenter(d.king);
      cam.pan(x, y, 450, 'Sine.easeIn');
      cam.zoomTo(6, 450, 'Sine.easeIn');
      cam.fadeOut(450, 17, 16, 24);
      cam.once('camerafadeoutcomplete', () => {
        this.selected = null;
        const bot = this.ai ? { player: AI_PLAYER, level: this.ai } : null;
        const shields = { w: !this.chess.shieldUsed.w, b: !this.chess.shieldUsed.b };
        const scene = this.chess.terrainAt(d.king) === 'fortress' ? 'turnbattle' : 'battle';
        this.scene.launch(scene, { attacker: checker, defender: king, shields, bot, duel: true });
        this.scene.sleep();
      });
    });
  }

  // 전투 장면이 끝나고 돌아왔을 때
  onBattleEnd({ winner, reason, hp, shieldUsed }) {
    const cam = this.cameras.main;
    cam.setZoom(1).centerOn(320, 180);
    cam.fadeIn(300, 17, 16, 24);
    for (const color of Object.keys(shieldUsed || {})) this.chess.shieldUsed[color] = true;
    if (this.duelPending) {
      this.duelPending = false;
      const rec = this.chess.resolveDuel(winner, hp);
      this.mode = this.chess.result ? 'over' : 'select';
      if (!this.chess.result) this.say(`킹 승리! ${PIECE_NAMES[rec.piece.type]}이(가) 쓰러졌다 — 게임 계속`);
      this.afterTurn();
      this.render();
      return;
    }
    const { from, to, promotion } = this.pendingMove;
    this.pendingMove = null;
    // KO = 진 쪽 제거, 시간 종료 = 방어 성공이지만 둘 다 제자리
    const outcome = winner === 'attacker' ? 'attacker' : reason === 'time' ? 'retreat' : 'defender';
    this.finishMove(from, to, promotion, outcome, hp);
    this.render();
  }

  say(msg) {
    this.flash = msg;
    this.flashTimer?.remove();
    this.flashTimer = this.time.delayedCall(1800, () => { this.flash = null; this.render(); });
  }

  // ───────── 그리기 ─────────

  // 바뀌지 않는 것: 패널 테두리, 좌표 글자, 제목
  drawStatic() {
    const g = this.add.graphics();
    for (const x of [12, 468]) {
      g.fillStyle(C.panel).fillRect(x, BOARD_Y, 160, 256);
      g.lineStyle(1, C.panelLine).strokeRect(x + 0.5, BOARD_Y + 0.5, 159, 255);
    }
    for (let i = 0; i < 8; i++) {
      this.add.text(BOARD_X - 10, BOARD_Y + i * TILE + 10, String(8 - i), text(10, '#8d8798', FONT_SMALL));
      this.add.text(BOARD_X + i * TILE + 13, BOARD_Y + 260, 'abcdefgh'[i], text(10, '#8d8798', FONT_SMALL));
    }
    this.add.text(320, 14, 'SQUARE OFF', text(15, '#f2ead8', FONT_BIG)).setOrigin(0.5, 0);
    this.add.text(320, 34, '말들의 반란 · 7단계: 링크 온라인', text(10, '#8d8798', FONT_SMALL)).setOrigin(0.5, 0);

    this.panelTexts = {};
    for (const player of [1, 2]) {
      const x = player === 1 ? 22 : 478;
      const color = COLOR_OF[player];
      this.add.text(x, BOARD_Y + 10, `P${player} · ${SIDE_NAME[color]}`, text(12, PLAYER_HEX[player]));
      this.panelTexts[player] = {
        turn: this.add.text(x + 140, BOARD_Y + 10, '', text(12, '#f2ead8')).setOrigin(1, 0),
        captured: this.add.text(x, BOARD_Y + 40, '', { ...text(10, '#d8d2c4', FONT_SMALL), wordWrap: { width: 140 } }),
        log: this.add.text(x, BOARD_Y + 84, '', { ...text(10, '#b3adbd', FONT_SMALL), lineSpacing: 2 }),
        info: this.add.text(x, BOARD_Y + 132, '', { ...text(10, '#d8d2c4', FONT_SMALL), lineSpacing: 2 }),
      };
      this.add.text(x, BOARD_Y + 28, '잡은 말', text(10, '#8d8798', FONT_SMALL));
      this.add.text(x, BOARD_Y + 72, '최근 수', text(10, '#8d8798', FONT_SMALL));
      this.panelTexts[player].keys = this.add.text(x, BOARD_Y + 186, '',
        { ...text(10, '#8d8798', FONT_SMALL), lineSpacing: 1, wordWrap: { width: 140 } });
    }
    this.statusText = this.add.text(320, 334, '', text(12, '#f2ead8')).setOrigin(0.5, 0);
    this.panelFrame = this.add.graphics();
  }

  render() {
    const g = this.chess;
    const gfx = this.boardGfx.clear();
    const player = this.currentPlayer;
    const last = g.history.at(-1);
    const moves = this.selected ? g.legalMovesFrom(this.selected) : [];

    // 칸
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        this.drawTerrainTile(gfx, { r, c });
      }
    }
    // 직전 수
    if (last) {
      for (const sq of [last.from, last.to]) this.fillTile(gfx, sq, C.lastMove, 0.45);
    }
    // 직전 수에서 킹 옆이라 회복된 말
    for (const sq of last?.healed || []) this.fillTile(gfx, sq, C.heal, 0.45);
    // 체크된 킹
    if (g.inCheck(g.turn)) this.fillTile(gfx, g.findKing(g.turn), C.check, 0.7);
    // 선택한 말
    if (this.selected) this.fillTile(gfx, this.selected, C.select, 0.6);
    // 갈 수 있는 칸: 빈 칸은 점, 잡을 수 있는 칸은 테두리
    for (const m of moves) {
      const { x, y } = this.tileCenter(m.to);
      if (m.captured) gfx.lineStyle(3, C.dot, 0.55).strokeCircle(x, y, 14);
      else gfx.fillStyle(C.dot, 0.45).fillCircle(x, y, 4);
    }
    // 커서 (차례인 플레이어만)
    if (this.mode === 'select') {
      const cur = this.cursor[player];
      gfx.lineStyle(2, PLAYER_COLOR[player]).strokeRect(BOARD_X + cur.c * TILE + 1, BOARD_Y + cur.r * TILE + 1, TILE - 2, TILE - 2);
    }

    // 말
    this.pieceLayer.removeAll(true);
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = g.board[r][c];
        if (p) this.pieceLayer.add(this.makeBoardPiece({ r, c }, p));
      }
    }

    this.renderPanels();
    this.renderOverlay();
  }

  // 지형 칸: 지형 색(밝은/어두운 칸 구분 유지) + 왼쪽 위 작은 문양 (검 = 투기장, 방패 = 성채)
  drawTerrainTile(gfx, sq) {
    const kind = this.chess.terrainAt(sq);
    const light = isLightSquare(sq);
    const x = BOARD_X + sq.c * TILE, y = BOARD_Y + sq.r * TILE;
    const col = TERRAIN_COLOR[kind];
    gfx.fillStyle(light ? col.light : col.dark).fillRect(x, y, TILE, TILE);
    gfx.fillStyle(col.mark, 0.7);
    if (kind === 'arena') {
      // 검: 대각선 칼날 + 가드
      for (let i = 0; i < 6; i++) gfx.fillRect(x + 3 + i, y + 9 - i, 1, 1);
      gfx.fillRect(x + 3, y + 7, 3, 1);
      gfx.fillRect(x + 5, y + 7, 1, 3);
    } else if (kind === 'forest') {
      // 나무: 삼각형 잎 + 줄기
      for (let i = 0; i < 4; i++) gfx.fillRect(x + 6 - i, y + 3 + i, 1 + i * 2, 1);
      gfx.fillRect(x + 6, y + 7, 1, 3);
    } else if (kind === 'fortress') {
      // 방패
      gfx.fillRect(x + 3, y + 3, 6, 4);
      gfx.fillRect(x + 4, y + 7, 4, 2);
      gfx.fillRect(x + 5, y + 9, 2, 1);
    }
  }

  // 판 위 말: 동그라미 + 다쳤으면 HP 눈금, 베테랑이면 별
  makeBoardPiece(sq, p) {
    const ctr = makePiece(this, this.tileCenter(sq), p);
    if (p.vet) {
      ctr.addAt(this.add.circle(0, 0, 14).setStrokeStyle(2, C.gold), 0);
      ctr.add(this.add.text(9, -15, '★', text(10, '#ffd34a', FONT_SMALL)).setStroke('#111018', 2));
    }
    const hp = currentHp(p), max = maxHp(p);
    if (hp < max) {
      // 눈금 1칸 = HP 10
      const ticks = max / 10, w = 24, seg = w / ticks;
      const bar = this.add.graphics();
      bar.fillStyle(0x111018, 0.85).fillRect(-w / 2 - 1, 11, w + 2, 5);
      for (let i = 0; i < ticks; i++) {
        const fill = Phaser.Math.Clamp(hp / 10 - i, 0, 1);
        bar.fillStyle(0x3a3746).fillRect(-w / 2 + i * seg, 12, seg - 1, 3);
        if (fill > 0) bar.fillStyle(hp / max > 0.35 ? 0x6fd36f : 0xff6a5a).fillRect(-w / 2 + i * seg, 12, (seg - 1) * fill, 3);
      }
      ctr.add(bar);
    }
    return ctr;
  }

  // 커서가 가리키는 칸 정보: 지형 + 말
  pieceInfo(sq) {
    if (!sq) return '';
    const t = TERRAIN[this.chess.terrainAt(sq)];
    const p = this.chess.pieceAt(sq);
    if (!p) return `${t.name} 칸 (${t.battle})`;
    const vet = p.vet ? ` ★${p.vet === 'hp' ? 'HP' : '공격'}` : '';
    return `${SIDE_NAME[p.color]} ${PIECE_NAMES[p.type]}${vet} · ${t.name}\nHP ${currentHp(p)}/${maxHp(p)} · 공격 ${attackStat(p)}`;
  }

  renderPanels() {
    const g = this.chess;
    const frame = this.panelFrame.clear();
    for (const player of [1, 2]) {
      const color = COLOR_OF[player];
      const t = this.panelTexts[player];
      const active = this.mode !== 'over' && g.turn === color;
      t.turn.setText(active && this.mode !== 'menu' ? '차례 ◀' : '');
      const keys = keyLabels(player);
      t.keys.setText(online.role === 'host' && player === 2 ? '온라인 친구가 조종\n(친구 자기 키 설정 사용)'
        : this.isAi(player) ? `컴퓨터가 조종\n난이도: ${BOT_LEVELS[this.ai].name}`
        : `이동  ${keys.move}\n선택·공격  ${keys.confirm}\n스킬  ${keys.skill}\n취소  ${keys.cancel}`);
      const took = g.captured[color === WHITE ? BLACK : WHITE];
      t.captured.setText(took.length ? took.map((k) => PIECE_NAMES[k]).join(' ') : '-');
      const mine = g.history.filter((m) => m.piece.color === color).slice(-3);
      t.log.setText(mine.map((m) => m.notation).join('\n'));
      const shield = `킹 실드: ${g.shieldUsed[color] ? '사용함' : '1회 남음'}`;
      const look = active && this.mode === 'select' ? this.pieceInfo(this.cursor[player]) : '';
      t.info.setText(look ? `${look}\n${shield}` : shield);
      if (active) {
        const x = player === 1 ? 12 : 468;
        frame.lineStyle(2, PLAYER_COLOR[player]).strokeRect(x + 1, BOARD_Y + 1, 158, 254);
      }
    }

    let status;
    if (this.flash) status = this.flash;
    else if (this.mode === 'menu') status = '모드를 고르세요 (위/아래 + 선택 키)';
    else if (this.mode === 'online') status = '친구가 링크로 들어오면 바로 시작해요';
    else if (this.mode === 'promotion') status = '승급할 말을 고르세요';
    else if (this.mode === 'veteran') status = `P${this.vet.player} 베테랑 승격! 보너스를 고르세요`;
    else if (!g.result) status = `${SIDE_NAME[g.turn]} 차례${g.inCheck(g.turn) ? ' — 체크!' : ''}`;
    else status = '';
    this.statusText.setText(status);
  }

  renderOverlay() {
    this.overlay.removeAll(true);
    const g = this.chess;
    if (this.mode === 'menu') {
      this.overlay.add(this.add.rectangle(320, BOARD_Y + 139, 200, 130, 0x111018, 0.94).setStrokeStyle(1, 0xf2ead8));
      MENU.forEach((item, i) => {
        const on = i === this.menuIndex;
        this.overlay.add(this.add.text(320, this.menuY(i), (on ? '▶ ' : '') + item.label,
          text(12, on ? '#f2ead8' : '#8d8798')).setOrigin(0.5));
      });
    }
    if (this.mode === 'online') {
      this.overlay.add(this.add.rectangle(320, BOARD_Y + 128, 220, 80, 0x111018, 0.94).setStrokeStyle(1, 0xf2ead8));
      this.overlay.add(this.add.text(320, BOARD_Y + 100, '온라인 · 방 만들기', text(12, '#f2ead8')).setOrigin(0.5, 0));
      this.overlay.add(this.add.text(320, BOARD_Y + 120, this.onlineText, { ...text(10, '#d8d2c4', FONT_SMALL), align: 'center', lineSpacing: 3 }).setOrigin(0.5, 0));
      this.overlay.add(this.add.text(320, BOARD_Y + 152, `취소(${keyLabels(1).cancel}) = 메뉴로`, text(10, '#8d8798', FONT_SMALL)).setOrigin(0.5, 0));
    }
    if (this.mode === 'veteran') {
      const col = PLAYER_COLOR[this.vet.player];
      this.overlay.add(this.add.rectangle(320, BOARD_Y + 128, 200, 76, 0x111018, 0.94).setStrokeStyle(1, C.gold));
      this.overlay.add(this.add.text(320, BOARD_Y + 98, '★ 베테랑 승격 ★', text(12, '#ffd34a')).setOrigin(0.5, 0));
      VETERAN_CHOICES.forEach((choice, i) => {
        const x = this.vetX(i), on = i === this.vet.index;
        if (on) this.overlay.add(this.add.rectangle(x, BOARD_Y + 140, 84, 32).setStrokeStyle(2, col));
        this.overlay.add(this.add.text(x, BOARD_Y + 128, choice.label, text(12, on ? '#f2ead8' : '#8d8798')).setOrigin(0.5, 0));
        this.overlay.add(this.add.text(x, BOARD_Y + 143, choice.desc, text(10, '#8d8798', FONT_SMALL)).setOrigin(0.5, 0));
      });
    }
    if (this.mode === 'promotion') {
      const color = g.turn;
      this.overlay.add(this.add.rectangle(320, BOARD_Y + 128, 176, 64, 0x111018, 0.92).setStrokeStyle(1, PLAYER_COLOR[this.currentPlayer]));
      PROMOTION_TYPES.forEach((type, i) => {
        const x = this.promoX(i);
        if (i === this.promo.index) this.overlay.add(this.add.rectangle(x, BOARD_Y + 122, 32, 32).setStrokeStyle(2, PLAYER_COLOR[this.currentPlayer]));
        this.overlay.add(makePiece(this, { x, y: BOARD_Y + 122 }, { type, color }));
        this.overlay.add(this.add.text(x, BOARD_Y + 141, PIECE_NAMES[type], text(10, '#d8d2c4', FONT_SMALL)).setOrigin(0.5, 0));
      });
    }
    if (this.mode === 'over') {
      const r = g.result;
      const title = r.type === 'kingslain' ? `킹이 쓰러졌다! ${SIDE_NAME[r.winner]}(P${PLAYER_OF[r.winner]}) 승리`
        : r.type === 'stalemate' ? '스테일메이트 — 무승부' : '기물 부족 — 무승부';
      this.overlay.add(this.add.rectangle(320, BOARD_Y + 128, 240, 72, 0x111018, 0.92).setStrokeStyle(1, 0xf2ead8));
      this.overlay.add(this.add.text(320, BOARD_Y + 106, title, text(12, '#f2ead8')).setOrigin(0.5, 0));
      this.overlay.add(this.add.text(320, BOARD_Y + 132, `선택 키(${keyLabels(1).confirm} / ${keyLabels(2).confirm}) → 메뉴`, text(10, '#8d8798', FONT_SMALL)).setOrigin(0.5, 0));
    }
  }

  vetX(i) {
    return 320 - 45 + i * 90;
  }

  menuY(i) {
    return BOARD_Y + 95 + i * 22;
  }

  promoX(i) {
    return 320 - 60 + i * 40;
  }

  promoIndexAt(x, y) {
    if (Math.abs(y - (BOARD_Y + 122)) > 16) return null;
    const i = PROMOTION_TYPES.findIndex((_, j) => Math.abs(x - this.promoX(j)) <= 16);
    return i >= 0 ? i : null;
  }

  tileCenter({ r, c }) {
    return { x: BOARD_X + c * TILE + TILE / 2, y: BOARD_Y + r * TILE + TILE / 2 };
  }

  fillTile(gfx, { r, c }, color, alpha) {
    gfx.fillStyle(color, alpha).fillRect(BOARD_X + c * TILE, BOARD_Y + r * TILE, TILE, TILE);
  }
}
