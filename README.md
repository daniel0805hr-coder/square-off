# Square Off: 말들의 반란

체스 + 전투 2인 도트 게임. 바로 하기: https://daniel0805hr-coder.github.io/square-off/

## 실행
이 폴더에서 아래 명령을 실행한 뒤 브라우저로 http://localhost:8000 접속.

```bash
python3 serve.py
```

## 온라인 (링크 접속)
메뉴의 **온라인 · 방 만들기** → 화면 아래 링크를 친구에게 보내면, 친구는 링크를 열기만 하면 P2(흑)로 들어온다.
- 호스트가 게임 전체를 돌리고 화면을 영상으로 보낸다. 친구는 영상을 보며 자기 키보드·마우스 입력만 보낸다 (`src/net/online.js`).
- 호스트는 게임 탭을 화면에 띄워 둬야 한다 (탭을 내리면 브라우저가 게임을 멈춰 친구 화면도 멈춤).
- `localhost` 링크는 같은 컴퓨터에서만 열린다. 멀리 있는 친구와 하려면 이 폴더를 인터넷에 올려야 한다 (GitHub Pages·itch.io 등).
- 연결 주선은 PeerJS 공개 서버를 쓴다. 일부 회사·학교 네트워크에서는 P2P 연결이 막힐 수 있다.

## 테스트 (체스 룰 자동 검사)
```bash
npm test
```

## 구조
| 파일 | 역할 |
|---|---|
| `src/logic/chess.js` | 체스 룰 (화면·입력과 분리된 순수 로직) |
| `src/logic/battle.js` | 탑다운 전투 룰 (순수 로직) |
| `src/logic/turnBattle.js` | 턴제 전투 룰 (순수 로직) |
| `src/logic/terrain.js` | 칸 지형(투기장·성채·숲)과 대칭 랜덤 맵 생성 |
| `src/logic/chase.js` | 추격전 룰·숲 미로 (순수 로직) |
| `src/logic/balance.js` | **밸런스 수치** — 스탯·기물별 기술·보상·회복량 등 조정은 여기서 |
| `src/logic/units.js` | 판 위 기물의 HP·공격력 (베테랑 포함) |
| `src/logic/ai.js` | 테스트용 컴퓨터 상대 (체스 수 + 전투 봇) |
| `src/input/controls.js` | 키 → `{ player, action }` 명령 변환, 키 배치, 온라인 친구 입력 전달 |
| `src/net/online.js` | 링크 접속 온라인 (방 만들기·친구 화면) |
| `src/scenes/BoardScene.js` | 체스판 화면 |
| `src/scenes/BattleScene.js` | 탑다운 전투 화면 (투기장) |
| `src/scenes/TurnBattleScene.js` | 턴제 전투 화면 (성채) |
| `src/scenes/ChaseScene.js` | 추격전 화면 (숲) |
| `src/scenes/KeyConfigScene.js` | 키 설정 화면 |
| `src/ui/style.js` | 공통 글꼴·색·임시 말 그림 |
| `tests/` | 룰·전투 테스트 |

## 사용한 외부 리소스
- Phaser 3.90.0 (MIT) — CDN
- Galmuri 폰트 2.40.3 (SIL OFL 1.1) — CDN
- PeerJS 1.5.4 (MIT) — CDN, 온라인 연결
