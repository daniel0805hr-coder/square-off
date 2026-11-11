import { ChessGame, WHITE, BLACK, PIECE_NAMES, PROMOTION_TYPES, isLightSquare } from '../logic/chess.js';
import { InputRouter, keyLabels, online } from '../input/controls.js';
import { hostRoom, HostPanel } from '../net/online.js';
import { chooseChessMove, BOT_LEVELS } from '../logic/ai.js';
import { BOARD } from '../logic/balance.js';
import { maxHp, currentHp, attackStat } from '../logic/units.js';
import { TERRAIN, KINDS, FIXED_MAPS, makeMap } from '../logic/terrain.js';
import { FONT_SMALL, FONT_BIG, text, C, PLAYER_OF, COLOR_OF, PLAYER_COLOR, PLAYER_HEX, SIDE_NAME, makePiece } from '../ui/style.js';
import { FxLayer, FX, RAMP, NO_BODY } from '../ui/pixelfx.js';
import { UI, UI_HEX, drawPanel, corners, windowAt, drawSelectBar } from '../ui/frame.js';

const TILE = 32;
const BOARD_X = 192;
const BOARD_Y = 60;

// 규칙 설정 (기획서 8·10장 옵션). 메뉴 위쪽 줄에서 왼쪽/오른쪽(또는 선택 키)으로 바꾸고, 브라우저에 저장한다
const MAP_CHOICES = [{ id: 'random', name: '대칭 랜덤', desc: '게임마다 새로 만드는 대칭 맵' }, ...FIXED_MAPS];
const DRAFT_PICKS = 3; // 드래프트: 시작 전에 각자 바꾸는 칸 수
const OPTIONS = {
  map: { label: '맵', values: MAP_CHOICES.map((m) => m.id), show: (v) => MAP_CHOICES.find((m) => m.id === v).name },
  draft: { label: '드래프트', values: [false, true], show: (v) => (v ? `각자 ${DRAFT_PICKS}칸 바꾸기` : '끔') },
  timer: { label: '제한시간', values: [0, 30, 60], show: (v) => (v ? `한 수 ${v}초` : '없음') },
};
const RULES_KEY = 'squareoff.rules.v1';

function loadRules() {
  const rules = { map: 'random', draft: false, timer: 0 };
  try {
    const saved = JSON.parse(localStorage.getItem(RULES_KEY));
    for (const key of Object.keys(rules)) if (OPTIONS[key].values.includes(saved?.[key])) rules[key] = saved[key];
  } catch { /* 저장소를 못 쓰면 기본값 */ }
  return rules;
}

// 시작 메뉴. option = 규칙 설정 줄, ai = P2(흑)를 컴퓨터가 맡을 때의 난이도
const MENU = [
  { option: 'map' },
  { option: 'draft' },
  { option: 'timer' },
  { label: '2인 대전', ai: null },
  { label: '컴퓨터 상대 · 쉬움', ai: 'easy' },
  { label: '컴퓨터 상대 · 보통', ai: 'normal' },
  { label: '온라인 · 인터넷 방', online: 'peer' },
  { label: '온라인 · 같은 네트워크(VPN) 방', online: 'lan' },
  { label: '키 설정', keys: true },
];
const OPTION_ROWS = MENU.filter((m) => m.option).length;
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
    this.rules = loadRules();
    this.chess = new ChessGame();
    this.newGame();

    this.boardGfx = this.add.graphics();
    this.pieceLayer = this.add.container(0, 0);
    this.overlay = this.add.container(0, 0).setDepth(10);
    this.fx = new FxLayer(this, { depth: 5 }); // 말 위, 메뉴·안내 창 아래
    this.halos = new Map(); // 베테랑 헤일로: 칸 → 이펙트
    this.drawStatic();

    new InputRouter(this, (cmd) => this.onCommand(cmd));
    // 전투 또는 키 설정 화면에서 돌아왔을 때
    this.events.on('wake', (_sys, data) => (data?.from === 'keys' ? this.render() : this.onBattleEnd(data)));
    this.input.on('pointerdown', (p) => this.onPointer(p, 'local'));
    this.render();
  }

  newGame() {
    this.chess.reset();
    this.chess.terrain = makeMap(this.rules.map);
    this.cursor = { 1: { r: 6, c: 4 }, 2: { r: 1, c: 4 } };
    this.selected = null;
    this.mode = 'menu'; // menu | online | draft | select | promotion | battle | veteran | over
    this.menuIndex ??= OPTION_ROWS; // 처음엔 '2인 대전'
    this.draft = null;
    this.clock = null; // 이번 수에 남은 시간(ms). 제한시간 없으면 null
    this.ai = null;
    this.aiTimer?.remove();
    this.promo = null; // { from, to, index }
    this.flash = null;
  }

  chooseMenu(i) {
    if (MENU[i].option) {
      this.changeOption(MENU[i].option, 1);
    } else if (MENU[i].online) {
      this.openRoom(MENU[i].online);
    } else if (MENU[i].keys) {
      this.scene.launch('keys');
      this.scene.sleep();
    } else {
      this.startGame(MENU[i].ai);
    }
  }

  // 규칙 하나를 다음(dir = 1) / 이전(-1) 값으로. 맵을 바꾸면 메뉴 뒤 판에 바로 보인다
  changeOption(key, dir) {
    const { values } = OPTIONS[key];
    const i = values.indexOf(this.rules[key]);
    this.rules[key] = values[(i + dir + values.length) % values.length];
    try { localStorage.setItem(RULES_KEY, JSON.stringify(this.rules)); } catch { /* 무시 */ }
    if (key === 'map') this.chess.terrain = makeMap(this.rules.map);
    this.render();
  }

  startGame(ai) {
    this.ai = ai;
    if (this.rules.draft) this.startDraft();
    else this.beginPlay();
  }

  beginPlay() {
    this.mode = 'select';
    this.startClock();
    this.render();
    this.maybeAiTurn();
  }

  // ───────── 드래프트 (기획서 8장): 시작 전에 P1부터 번갈아 한 칸씩, 각자 3칸의 지형을 바꾼다 ─────────
  //   킹 시작 칸(e1·e8)은 성채 고정이라 못 바꾼다. 취소 키 = 남은 칸을 안 바꾸고 넘김

  startDraft() {
    this.mode = 'draft';
    this.draft = { player: 1, left: { 1: DRAFT_PICKS, 2: DRAFT_PICKS }, pick: null, changed: [] };
    this.render();
    this.maybeAiDraft();
  }

  canDraft({ r, c }) {
    return c !== 4 || (r !== 0 && r !== 7);
  }

  // 칸을 고르면 바꿀 지형(지금 것 말고 두 가지) 선택 창을 연다
  openDraftPick(sq) {
    if (!this.canDraft(sq)) { this.say('킹 시작 칸은 성채로 고정이에요'); return; }
    const now = this.chess.terrainAt(sq);
    this.draft.pick = { sq, kinds: KINDS.filter((k) => k !== now), index: 0 };
  }

  applyDraft(kind) {
    const d = this.draft;
    const { sq } = d.pick;
    this.chess.terrain[sq.r][sq.c] = kind;
    d.changed.push(sq);
    d.left[d.player]--;
    d.pick = null;
    this.fxAt(FX.collectBurst, sq, { palette: RAMP.gold }, 33);
    this.nextDraft();
  }

  // 다음 사람 차례 (상대가 다 썼으면 계속 나, 둘 다 다 썼으면 대전 시작)
  nextDraft() {
    const d = this.draft;
    const other = 3 - d.player;
    if (d.left[other] > 0) d.player = other;
    else if (d.left[d.player] <= 0) {
      this.say('드래프트 끝! 백(P1)부터 시작');
      this.beginPlay();
      return;
    }
    this.render();
    this.maybeAiDraft();
  }

  onDraftCommand(action) {
    const d = this.draft;
    const cur = this.cursor[d.player];
    if (d.pick) {
      if (DIRS[action]) d.pick.index = 1 - d.pick.index;
      if (action === 'confirm') this.applyDraft(d.pick.kinds[d.pick.index]);
      if (action === 'cancel') d.pick = null;
      return;
    }
    if (DIRS[action]) {
      const [dr, dc] = DIRS[action];
      cur.r = Phaser.Math.Clamp(cur.r + dr, 0, 7);
      cur.c = Phaser.Math.Clamp(cur.c + dc, 0, 7);
    } else if (action === 'confirm') {
      this.openDraftPick({ ...cur });
    } else if (action === 'cancel') {
      d.left[d.player] = 0;
      this.say(`P${d.player} 남은 칸은 그대로 두기`);
      this.nextDraft();
    }
  }

  // 컴퓨터: 내 진영(5~8랭크) 아무 칸이나 하나 골라 바꾼다
  maybeAiDraft() {
    if (this.mode !== 'draft' || !this.isAi(this.draft.player)) return;
    this.aiTimer = this.time.delayedCall(500, () => {
      const squares = [];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) if (this.canDraft({ r, c })) squares.push({ r, c });
      const sq = Phaser.Utils.Array.GetRandom(squares);
      this.cursor[AI_PLAYER] = sq;
      this.openDraftPick(sq);
      this.render();
      this.aiTimer = this.time.delayedCall(400, () => this.applyDraft(Phaser.Utils.Array.GetRandom(this.draft.pick.kinds)));
    });
  }

  draftKindX(i) {
    return 320 - 42 + i * 84;
  }

  draftPopupY() {
    return this.draft.pick.sq.r >= 4 ? BOARD_Y + 64 : BOARD_Y + 192; // 고른 칸을 가리지 않게
  }

  // ───────── 체스 턴 제한시간 (기획서 10장 옵션) ─────────
  //   사람 차례마다 새로 잰다. 다 되면 컴퓨터가 대신 한 수 둔다 (전투·승격 고르기 중에는 멈춤)

  startClock() {
    this.clock = this.rules.timer && !this.isAi(this.currentPlayer) ? this.rules.timer * 1000 : null;
  }

  update(_time, delta) {
    if (this.clock === null || !['select', 'promotion'].includes(this.mode)) return;
    const shown = Math.ceil(this.clock / 1000);
    this.clock -= delta;
    if (this.clock <= 0) {
      this.clock = null;
      this.timeUp();
      this.render();
    } else if (Math.ceil(this.clock / 1000) !== shown) {
      this.renderPanels();
    }
  }

  timeUp() {
    this.say(`시간 초과! ${SIDE_NAME[this.chess.turn]} 수는 컴퓨터가 대신 둠`);
    if (this.mode === 'promotion') {
      this.commitMove(this.promo.from, this.promo.to, PROMOTION_TYPES[this.promo.index]);
      return;
    }
    const m = chooseChessMove(this.chess);
    if (m) this.commitMove(m.from, m.to, 'Q');
  }

  // 온라인 방 만들기: 링크를 보여주고 친구를 기다린다. 친구가 들어오면 바로 2인 대전 (친구 = P2)
  //   kind: 'peer' = 인터넷 링크 방, 'lan' = 같은 와이파이·VPN 방 (src/net/online.js)
  openRoom(kind) {
    if (this.room) {
      // 이미 친구와 연결된 상태면 바로 새 대전
      if (online.role === 'host') this.startGame(null);
      return;
    }
    this.mode = 'online';
    const lan = kind === 'lan';
    this.onlineText = lan ? '이 PC의 주소를 확인하는 중…' : '연결 서버에 접속하는 중…';
    this.panel = new HostPanel();
    this.panel.show(this.onlineText);
    this.room = hostRoom({
      lan,
      game: this.game,
      onClick: (at) => this.onPointer(at, 'remote'),
      onStatus: (st) => {
        if (st.state === 'waiting') {
          this.onlineText = lan
            ? '친구를 기다리는 중…\n아래 주소 중 친구와 같은 네트워크(VPN) 주소를 보내세요'
            : '친구를 기다리는 중…\n아래 링크를 친구에게 보내세요';
          this.panel.show(lan ? '친구 PC에서 열 주소' : '방 링크', st.links);
        } else if (st.state === 'joined') {
          this.panel.show('온라인 · 친구(P2) 연결됨');
          this.newGame();
          this.startGame(null);
          this.say('친구가 들어왔어요! 나는 P1(백), 친구는 P2(흑)');
        } else if (st.state === 'left') {
          this.panel.show('친구 연결이 끊겼어요 — 이제 이 컴퓨터에서 P2도 조작해요');
          this.say('친구 연결이 끊겼어요');
        } else if (st.state === 'error') {
          this.onlineText = `${st.message}\n\n2인 대전(한 컴퓨터)은 인터넷 없이도 돼요`;
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
      const option = MENU[this.menuIndex].option;
      if (action === 'up') this.menuIndex = (this.menuIndex + MENU.length - 1) % MENU.length;
      if (action === 'down') this.menuIndex = (this.menuIndex + 1) % MENU.length;
      if (option && (action === 'left' || action === 'right')) { this.changeOption(option, action === 'left' ? -1 : 1); return; }
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
    if (this.mode === 'draft') {
      if (player !== this.draft.player || this.isAi(player) || !this.ownedBy(who, player)) return;
      this.onDraftCommand(action);
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
      const i = MENU.findIndex((_, j) => Math.abs(pointer.y - this.menuY(j)) <= 9 && Math.abs(pointer.x - 320) <= 115);
      if (i >= 0) { this.menuIndex = i; this.chooseMenu(i); }
      return;
    }
    if (this.mode === 'veteran') {
      if (this.isAi(this.vet.player) || (online.role === 'host' && !this.ownedBy(who, this.vet.player))) return;
      const i = VETERAN_CHOICES.findIndex((_, j) => Math.abs(pointer.x - this.vetX(j)) <= 40 && Math.abs(pointer.y - (BOARD_Y + 140)) <= 16);
      if (i >= 0) { this.chooseVeteran(VETERAN_CHOICES[i].key); this.render(); }
      return;
    }
    if (this.mode === 'draft') {
      const d = this.draft;
      if (this.isAi(d.player) || (online.role === 'host' && !this.ownedBy(who, d.player))) return;
      const i = d.pick && Math.abs(pointer.y - this.draftPopupY() - 6) <= 26
        ? d.pick.kinds.findIndex((_, j) => Math.abs(pointer.x - this.draftKindX(j)) <= 36) : -1;
      if (i >= 0) this.applyDraft(d.pick.kinds[i]);
      else if (r >= 0 && r <= 7 && c >= 0 && c <= 7) {
        this.cursor[d.player] = { r, c };
        d.pick = null;
        this.openDraftPick({ r, c });
      } else d.pick = null;
      this.render();
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
    if (rec?.promotion) this.fxAt(FX.holyPillar, rec.to, { shafts: 5 });
    for (const sq of rec?.healed || []) this.fxAt(FX.collectBurst, sq, { palette: RAMP.heal }, 33);
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
    const won = this.chess.result?.winner;
    if (won) this.fx.play(FX.confetti, { x: 320, y: BOARD_Y + 200 });
    if (this.chess.duel) this.startDuel();
    else {
      this.startClock();
      this.maybeAiTurn();
    }
  }

  chooseVeteran(choice) {
    this.chess.promoteVeteran(this.vet.square, choice);
    this.fxAt(FX.collectBurst, this.vet.square, { palette: RAMP.gold }, 33);
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
    // 두 말이 칸 위에서 맞붙는 불꽃 → 그 칸 속으로 줌인
    this.fx.play(FX.parry, { x, y: y + 6, height: 6 });
    cam.shake(120, 0.004);
    this.time.delayedCall(280, () => {
      cam.pan(x, y, 450, 'Sine.easeIn');
      cam.zoomTo(6, 450, 'Sine.easeIn');
      cam.fadeOut(450, 17, 16, 24);
    });
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
    const k = this.tileCenter(d.king);
    this.fx.play(FX.critHit, { x: k.x, y: k.y + 8, height: 8, palette: RAMP.duel });
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
    this.fx.clearOneShots(); // 줌인하며 멈춰 있던 충돌 불꽃이 돌아와서 다시 재생되지 않게
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
    // 공격자 승리(KO·턴제 판정승) = 잡기 성공 → 보상·베테랑 적용, 방어자 KO = 공격한 말 제거, 시간 종료 방어 = 둘 다 제자리
    const outcome = winner === 'attacker' ? 'attacker' : reason === 'time' ? 'retreat' : 'defender';
    // 쓰러진 말이 있던 칸에 연기
    if (outcome !== 'retreat') this.fxAt(FX.poof, outcome === 'attacker' ? to : from);
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
    const g = this.add.graphics().setDepth(-1); // 패널·판 틀은 칸·말 아래
    for (const x of [12, 468]) {
      drawPanel(g, x, BOARD_Y, 160, 256);
      // 머리 띠 + 구역 구분선
      g.fillStyle(UI.panelHi).fillRect(x + 2, BOARD_Y + 2, 156, 21);
      g.fillStyle(UI.rule);
      for (const y of [23, 134, 186]) g.fillRect(x + 8, BOARD_Y + y, 144, 1);
    }
    this.drawBoardFrame(g);
    // 제목: 금빛 글자 + 양옆 장식 선
    this.add.text(320, 12, 'SQUARE OFF', text(15, UI_HEX.title, FONT_BIG)).setOrigin(0.5, 0)
      .setStroke('#0b0a10', 3).setLetterSpacing(2);
    g.fillStyle(UI.gold);
    for (const sx of [-1, 1]) {
      g.fillRect(320 + sx * 70 - (sx < 0 ? 26 : 0), 21, 26, 1);
      g.fillRect(320 + sx * 98 - 1, 20, 3, 3); // 끝 마름모 점
    }
    this.add.text(320, 32, '말들의 반란', text(10, UI_HEX.muted, FONT_SMALL)).setOrigin(0.5, 0);

    this.panelTexts = {};
    this.capturedLayer = this.add.container(0, 0);
    for (const player of [1, 2]) {
      const x = player === 1 ? 22 : 478;
      const color = COLOR_OF[player];
      this.add.text(x, BOARD_Y + 6, `P${player} · ${SIDE_NAME[color]}`, text(12, PLAYER_HEX[player]));
      this.panelTexts[player] = {
        turn: this.add.text(x + 140, BOARD_Y + 6, '', text(12, PLAYER_HEX[player])).setOrigin(1, 0),
        captured: this.add.text(x, BOARD_Y + 46, '', text(10, UI_HEX.muted, FONT_SMALL)),
        log: this.add.text(x, BOARD_Y + 94, '', { ...text(10, UI_HEX.body, FONT_SMALL), lineSpacing: 2 }),
        info: this.add.text(x, BOARD_Y + 140, '', { ...text(10, UI_HEX.body, FONT_SMALL), lineSpacing: 2 }),
      };
      this.add.text(x, BOARD_Y + 28, '잡은 말', text(10, UI_HEX.label, FONT_SMALL));
      this.add.text(x, BOARD_Y + 80, '최근 수', text(10, UI_HEX.label, FONT_SMALL));
      this.panelTexts[player].keys = this.add.text(x, BOARD_Y + 192, '',
        { ...text(10, UI_HEX.muted, FONT_SMALL), lineSpacing: 1, wordWrap: { width: 140 } });
    }
    this.statusText = this.add.text(320, 336, '', text(12, UI_HEX.text)).setOrigin(0.5, 0).setStroke('#0b0a10', 3);
    this.panelFrame = this.add.graphics();
  }

  // 판 테두리: 흑단 틀 + 안쪽 금 띠 + 모서리 금 장식, 좌표는 틀 위에
  drawBoardFrame(g) {
    const B = 12, x = BOARD_X - B, y = BOARD_Y - B, s = TILE * 8 + B * 2;
    g.fillStyle(UI.ink).fillRect(x - 1, y - 1, s + 2, s + 2);
    g.fillStyle(UI.wood).fillRect(x, y, s, s);
    g.fillStyle(UI.woodHi).fillRect(x, y, s, 1).fillRect(x, y, 1, s);
    g.fillStyle(UI.gold).fillRect(BOARD_X - 3, BOARD_Y - 3, TILE * 8 + 6, 1).fillRect(BOARD_X - 3, BOARD_Y + TILE * 8 + 2, TILE * 8 + 6, 1)
      .fillRect(BOARD_X - 3, BOARD_Y - 3, 1, TILE * 8 + 6).fillRect(BOARD_X + TILE * 8 + 2, BOARD_Y - 3, 1, TILE * 8 + 6);
    g.fillStyle(UI.ink).fillRect(BOARD_X - 1, BOARD_Y - 1, TILE * 8 + 2, 1).fillRect(BOARD_X - 1, BOARD_Y + TILE * 8, TILE * 8 + 2, 1)
      .fillRect(BOARD_X - 1, BOARD_Y - 1, 1, TILE * 8 + 2).fillRect(BOARD_X + TILE * 8, BOARD_Y - 1, 1, TILE * 8 + 2);
    corners(g, x + 2, y + 2, s - 4, s - 4, UI.goldHi);
    for (let i = 0; i < 8; i++) {
      this.add.text(BOARD_X - 6, BOARD_Y + i * TILE + 16, String(8 - i), text(10, UI_HEX.gold, FONT_SMALL)).setOrigin(0.5);
      this.add.text(BOARD_X + i * TILE + 16, BOARD_Y + TILE * 8 + 6, 'abcdefgh'[i], text(10, UI_HEX.gold, FONT_SMALL)).setOrigin(0.5);
    }
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
    //   칸 표시는 옅은 색 + 안쪽 테두리: 지형 질감이 비쳐 보이게
    if (last) {
      for (const sq of [last.from, last.to]) this.markTile(gfx, sq, C.lastMove, 0.3);
    }
    // 직전 수에서 킹 옆이라 회복된 말
    for (const sq of last?.healed || []) this.markTile(gfx, sq, C.heal, 0.35);
    // 체크된 킹
    if (g.inCheck(g.turn)) this.markTile(gfx, g.findKing(g.turn), C.check, 0.55, 2);
    // 선택한 말
    if (this.selected) this.markTile(gfx, this.selected, C.select, 0.45, 2);
    // 갈 수 있는 칸: 빈 칸은 점, 잡을 수 있는 칸은 테두리
    for (const m of moves) {
      const { x, y } = this.tileCenter(m.to);
      if (m.captured) gfx.lineStyle(3, C.dot, 0.55).strokeCircle(x, y, 14);
      else gfx.fillStyle(C.dot, 0.45).fillCircle(x, y, 4);
    }
    // 드래프트로 바뀐 칸
    for (const sq of this.draft?.changed || []) this.markTile(gfx, sq, C.gold, 0.25);
    // 커서 (차례인 플레이어만)
    if (this.mode === 'select' || this.mode === 'draft') {
      const p = this.mode === 'draft' ? this.draft.player : player;
      const cur = this.cursor[p];
      gfx.lineStyle(2, PLAYER_COLOR[p]).strokeRect(BOARD_X + cur.c * TILE + 1, BOARD_Y + cur.r * TILE + 1, TILE - 2, TILE - 2);
    }

    // 말
    this.pieceLayer.removeAll(true);
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = g.board[r][c];
        if (p) this.pieceLayer.add(this.makeBoardPiece({ r, c }, p));
      }
    }
    this.syncHalos();

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
    this.drawTileTexture(gfx, kind, x, y, sq, light ? col.dark : col.mark);
    gfx.fillStyle(col.mark, 0.85);
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

  // 지형 질감 (칸마다 정해진 무늬라 다시 그려도 그대로): 모래 알갱이 · 돌판 줄눈 · 풀 포기
  drawTileTexture(gfx, kind, x, y, { r, c }, ink) {
    const h = (i) => ((r * 8 + c) * 73 + i * 151) % 997; // 칸·번호별 고정 난수 0~996
    if (kind === 'arena') {
      gfx.fillStyle(ink, 0.35);
      for (let i = 0; i < 6; i++) gfx.fillRect(x + 2 + (h(i) % 28), y + 12 + (h(i + 9) % 18), (i % 2) + 1, 1);
    } else if (kind === 'fortress') {
      // 돌판 두 장씩 엇갈려 쌓은 줄눈
      gfx.fillStyle(ink, 0.3).fillRect(x, y + 15, TILE, 1).fillRect(x + 20, y, 1, 15).fillRect(x + 9, y + 16, 1, 16)
        .fillRect(x + 25, y + 16, 1, 16);
      gfx.fillStyle(0xffffff, 0.12).fillRect(x, y + 16, TILE, 1);
    } else if (kind === 'forest') {
      gfx.fillStyle(ink, 0.45);
      for (let i = 0; i < 3; i++) {
        const tx = x + 4 + (h(i) % 24), ty = y + 14 + (h(i + 5) % 14);
        gfx.fillRect(tx, ty, 1, 2).fillRect(tx + 2, ty, 1, 2).fillRect(tx + 1, ty - 1, 1, 3);
      }
    }
  }

  // 판 위 말: 도트 말 + 다쳤으면 HP 눈금, 베테랑이면 별 (금 테두리는 말 그림에 있음)
  makeBoardPiece(sq, p) {
    const ctr = makePiece(this, this.tileCenter(sq), p);
    if (p.vet) {
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

  // 칸 가운데에 이펙트 (이펙트 원점 = 바닥이라 말 아래쪽에 둔다)
  //   dy: 이펙트마다 그림 중심이 원점에서 떨어진 정도가 달라 칸 가운데에 맞추는 값
  fxAt(mod, sq, o = {}, dy = 12) {
    const { x, y } = this.tileCenter(sq);
    return this.fx.play(mod, { x, y: y + dy, height: 12, ...o });
  }

  // 베테랑 말 머리 위 금빛 헤일로. 칸마다 하나, 말이 떠나면 서서히 꺼진다
  syncHalos() {
    const keep = new Set();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (!this.chess.board[r][c]?.vet) continue;
        const key = `${r},${c}`;
        keep.add(key);
        if (this.halos.has(key)) continue;
        const { x, y } = this.tileCenter({ r, c });
        // 헤일로는 원점보다 46px 위에 뜬다 → 말 동그라미 바로 위(-16)에 오게
        this.halos.set(key, this.fx.play(FX.halo, { x, y: y + 30, actor: NO_BODY, seed: r * 8 + c }));
      }
    }
    for (const [key, fx] of this.halos) {
      if (!keep.has(key)) { fx.stop(); this.halos.delete(key); }
    }
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

  // 잡은 말: 실제 말 그림을 겹쳐 세운 줄 (많아지면 더 촘촘하게)
  drawCaptured(x, types, color) {
    const step = types.length > 1 ? Math.min(14, 118 / (types.length - 1)) : 0;
    types.forEach((type, i) => this.capturedLayer.add(makePiece(this, { x: x + 12 + Math.round(i * step), y: BOARD_Y + 54 }, { type, color })));
  }

  renderPanels() {
    const g = this.chess;
    const frame = this.panelFrame.clear();
    this.capturedLayer.removeAll(true);
    for (const player of [1, 2]) {
      const color = COLOR_OF[player];
      const t = this.panelTexts[player];
      const active = this.mode === 'draft' ? this.draft.player === player : this.mode !== 'over' && g.turn === color;
      const clock = active && this.clock !== null && this.mode !== 'draft' ? ` ${Math.ceil(this.clock / 1000)}초` : '';
      t.turn.setText(active && this.mode !== 'menu' ? `차례${clock}` : '').setColor(clock && this.clock <= 5000 ? '#ff6a5a' : PLAYER_HEX[player]);
      const keys = keyLabels(player);
      t.keys.setText(online.role === 'host' && player === 2 ? '온라인 친구가 조종\n(친구 자기 키 설정 사용)'
        : this.isAi(player) ? `컴퓨터가 조종\n난이도: ${BOT_LEVELS[this.ai].name}`
        : `이동  ${keys.move}\n선택·공격  ${keys.confirm}\n스킬  ${keys.skill}\n취소  ${keys.cancel}`);
      const foe = color === WHITE ? BLACK : WHITE;
      const took = g.captured[foe];
      t.captured.setText(took.length ? '' : '아직 없음');
      this.drawCaptured(player === 1 ? 22 : 478, took, foe);
      const mine = g.history.filter((m) => m.piece.color === color).slice(-3);
      t.log.setText(mine.map((m) => m.notation).join('\n'));
      const shield = `킹 실드: ${g.shieldUsed[color] ? '사용함' : '1회 남음'}`;
      const look = active && (this.mode === 'select' || this.mode === 'draft') ? this.pieceInfo(this.cursor[player]) : '';
      t.info.setText(look ? `${look}\n${shield}` : shield);
      if (active && this.mode !== 'menu') {
        const x = player === 1 ? 12 : 468;
        frame.lineStyle(2, PLAYER_COLOR[player]).strokeRect(x + 1, BOARD_Y + 1, 158, 254);
        corners(frame, x - 1, BOARD_Y - 1, 162, 258, UI.goldHi);
      }
    }

    let status;
    if (this.flash) status = this.flash;
    else if (this.mode === 'menu') {
      const option = MENU[this.menuIndex].option;
      status = option === 'map' ? MAP_CHOICES.find((m) => m.id === this.rules.map).desc
        : option === 'draft' ? '시작 전에 각자 칸 3개의 지형을 바꿔요 (킹 칸 제외)'
        : option === 'timer' ? '시간이 다 되면 컴퓨터가 대신 한 수 둬요'
        : '모드를 고르세요 (위/아래 + 선택 키 · 규칙은 왼쪽/오른쪽)';
    }
    else if (this.mode === 'draft') {
      const d = this.draft;
      status = d.pick ? '바꿀 지형을 고르세요 (취소 = 다른 칸)'
        : `P${d.player} 드래프트: 바꿀 칸을 고르세요 · 남은 ${d.left[d.player]}칸 · 취소 = 그만 바꾸기`;
    }
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
      const top = this.menuY(0) - 18, bottom = this.menuY(MENU.length - 1) + 18;
      this.overlay.add(windowAt(this, 320, (top + bottom) / 2, 236, bottom - top));
      this.overlay.add(this.add.rectangle(320, this.menuY(OPTION_ROWS) - 14, 200, 1, UI.rule));
      this.overlay.add(drawSelectBar(this.add.graphics(), 320, this.menuY(this.menuIndex), 216));
      MENU.forEach((item, i) => {
        const on = i === this.menuIndex;
        if (item.option) {
          // 규칙 줄: 왼쪽 이름 + 오른쪽 값 (고른 줄은 < 값 >)
          const o = OPTIONS[item.option], value = o.show(this.rules[item.option]);
          this.overlay.add(this.add.text(220, this.menuY(i), o.label, text(10, on ? UI_HEX.title : UI_HEX.muted, FONT_SMALL)).setOrigin(0, 0.5));
          this.overlay.add(this.add.text(420, this.menuY(i), on ? `< ${value} >` : value, text(12, on ? UI_HEX.title : UI_HEX.label)).setOrigin(1, 0.5));
          return;
        }
        this.overlay.add(this.add.text(320, this.menuY(i), item.label, text(12, on ? UI_HEX.title : UI_HEX.label)).setOrigin(0.5));
      });
    }
    if (this.mode === 'draft' && this.draft.pick) {
      const p = this.draft.player, y = this.draftPopupY();
      this.overlay.add(windowAt(this, 320, y + 6, 180, 66, { accent: PLAYER_COLOR[p] }));
      this.draft.pick.kinds.forEach((kind, i) => {
        const x = this.draftKindX(i), on = i === this.draft.pick.index;
        this.overlay.add(this.add.rectangle(x, y - 10, 20, 20, TERRAIN_COLOR[kind].light).setStrokeStyle(on ? 2 : 1, on ? PLAYER_COLOR[p] : TERRAIN_COLOR[kind].mark));
        this.overlay.add(this.add.text(x, y + 4, TERRAIN[kind].name, text(12, on ? '#f2ead8' : '#8d8798')).setOrigin(0.5, 0));
        this.overlay.add(this.add.text(x, y + 19, TERRAIN[kind].battle, text(10, on ? '#d8d2c4' : '#6d6878', FONT_SMALL)).setOrigin(0.5, 0));
      });
    }
    if (this.mode === 'online') {
      this.overlay.add(windowAt(this, 320, BOARD_Y + 128, 232, 128));
      this.overlay.add(this.add.text(320, BOARD_Y + 74, '온라인 · 방 만들기', text(12, '#f2ead8')).setOrigin(0.5, 0));
      this.overlay.add(this.add.text(320, BOARD_Y + 96, this.onlineText,
        { ...text(10, '#d8d2c4', FONT_SMALL), align: 'center', lineSpacing: 3, wordWrap: { width: 208, useAdvancedWrap: true } }).setOrigin(0.5, 0));
      this.overlay.add(this.add.text(320, BOARD_Y + 168, `취소(${keyLabels(1).cancel}) = 메뉴로`, text(10, '#8d8798', FONT_SMALL)).setOrigin(0.5, 0));
    }
    if (this.mode === 'veteran') {
      const col = PLAYER_COLOR[this.vet.player];
      this.overlay.add(windowAt(this, 320, BOARD_Y + 128, 204, 80, { accent: C.gold }));
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
      this.overlay.add(windowAt(this, 320, BOARD_Y + 128, 180, 68, { accent: PLAYER_COLOR[this.currentPlayer] }));
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
      this.overlay.add(windowAt(this, 320, BOARD_Y + 128, 244, 76));
      this.overlay.add(this.add.text(320, BOARD_Y + 106, title, text(12, '#f2ead8')).setOrigin(0.5, 0));
      this.overlay.add(this.add.text(320, BOARD_Y + 132, `선택 키(${keyLabels(1).confirm} / ${keyLabels(2).confirm}) → 메뉴`, text(10, '#8d8798', FONT_SMALL)).setOrigin(0.5, 0));
    }
  }

  vetX(i) {
    return 320 - 45 + i * 90;
  }

  // 메뉴 줄 높이. 규칙 줄과 모드 줄 사이는 조금 띄운다
  menuY(i) {
    return BOARD_Y + 44 + i * 20 + (i >= OPTION_ROWS ? 8 : 0);
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

  // 칸 표시: 옅은 색 + 안쪽 테두리 (width px)
  markTile(gfx, sq, color, alpha, width = 1) {
    this.fillTile(gfx, sq, color, alpha);
    const x = BOARD_X + sq.c * TILE, y = BOARD_Y + sq.r * TILE;
    gfx.fillStyle(color).fillRect(x, y, TILE, width).fillRect(x, y + TILE - width, TILE, width)
      .fillRect(x, y, width, TILE).fillRect(x + TILE - width, y, width, TILE);
  }
}
