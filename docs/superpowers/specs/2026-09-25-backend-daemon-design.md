# 백엔드와 화면 분리 설계

2026-09-25

## 목표

화면을 끄거나 화면이 죽어도 사용량 조회와 기록, 토큰 재인증, 창 미리 열기, 자동 계정 전환이 정책대로 계속 돌게 합니다. 이 일은 launchd 가 상주시키는 백엔드가 맡고, 화면은 백엔드가 하는 일을 보여 주고 사람의 명령을 전달하는 도구가 됩니다.

성공 기준은 다음과 같습니다.

- 화면을 닫은 뒤에도 히스토리와 기록이 조회 주기마다 늘어납니다.
- `orca-usage daemon install` 한 번으로 launchd 에 등록되고, 로그인할 때마다 백엔드가 뜹니다.
- `orca-usage status` 가 백엔드의 생사와 마지막 조회, 정책, 최근 동작을 보여 줍니다.
- 다른 맥에서 README 만 보고 설치, 등록, 업데이트, 제거를 할 수 있습니다.

## 원칙

**모든 상태의 정본은 백엔드입니다.** 계정 목록, 사용량, 히스토리, 기록, 정책(자동 전환, 창 미리 열기, 알림, 판단 기준, 숨긴 계정), 마지막 전환 시각은 백엔드만 쓰고 백엔드만 파일에 남깁니다.

**화면은 스스로 행동하지 않습니다.** Orca 에 묻지 않고, 키체인을 읽지 않고, 파일을 쓰지 않고, 계정을 옮기지 않습니다. 사람이 누른 키를 백엔드에 요청으로 보내고 돌아온 결과를 그릴 뿐입니다. 예외는 하나입니다. 붙을 백엔드가 없으면 백엔드를 띄웁니다(아래 "화면" 절).

**판단이 행동으로 이어지는 값은 백엔드가 계산해 보냅니다.** 추천, 점수, 전환 판단은 백엔드가 계산한 것을 화면이 그대로 그립니다. 화면이 같은 함수를 자기 시계와 자기 히스토리로 다시 돌리면 백엔드가 실제로 한 일과 화면이 말하는 이유가 어긋날 수 있습니다. 그래프와 7일 일정처럼 받은 데이터를 그림으로 바꾸는 변환만 화면이 합니다.

**화면 상태는 메모리에만 둡니다.** 지금 보는 탭, 그래프 기간, 고른 계정, 스크롤 위치, 수정모드, 숨긴 계정 펼침 여부입니다. 파일에 남기지 않으므로 화면을 다시 켜면 기본값(사용량 탭, 24h, 맨 위 합계)에서 시작합니다. 지금 `settings.json` 에 있는 `graphMode`, `rangeIndex`, `selectedId` 는 백엔드가 읽지 않고 버립니다.

## 구조

프로세스는 둘입니다.

- 백엔드 `orca-usage daemon run`: 엔진을 돌리고 Unix 소켓을 엽니다. launchd 가 띄우든 화면이 띄우든 같은 명령이고, 코드는 누가 띄웠는지에 따라 달라지지 않습니다.
- 화면 `orca-usage`: 소켓에 붙는 클라이언트입니다.

백엔드 코드는 Hexagonal 로 가릅니다(B040).

```
src/
  core/        판단만 한다. 입출력 없음
  engine/      Engine 한 개와 어댑터 계약(ports.js)
  adapters/
    orca/      Orca 소켓 RPC, 계정 목록, 사용량, 계정 전환, Codex 요금제
    keychain/  자격증명 읽기와 쓰기, OAuth 갱신, 직접 조회, 창 열기 요청
    store/     히스토리, 캐시, 기록, 정책 설정 파일
    notify/    macOS 알림
  daemon/      소켓 서버, 단일 인스턴스 보장, launchd 등록과 해제, 업데이트
  client/      소켓 클라이언트, 백엔드 없을 때 띄우기
  ui/          ink 화면과 그림 그리는 모듈
  paths.js     경로 상수
  cli.jsx      명령 분기
```

지금 파일은 성격에 따라 옮깁니다.

| 지금 | 옮길 곳 |
| --- | --- |
| `advice.js`, `autoswitch.js`, `schedule.js`, `format.js`, `tuning.js` | `core/` |
| `keepalive.js` 의 판정(`needsOpening`, 재인증 기준) | `core/` |
| `keepalive.js` 의 요청(`openWindow`), `credentials.js`, `oauth.js` | `adapters/keychain/` |
| `orca-rpc.js`, `orca-limits.js`, `accounts.js`, `codex-plan.js` | `adapters/orca/` |
| `store.js`, `log.js`, `settings.js` | `adapters/store/` |
| `poller.js` | `engine/` (Orca 먼저, 실패하면 직접 조회로 가는 순서는 엔진의 일입니다) |
| `chart.js`, `braille.js`, `area.js`, `line.js`, `fullscreen.js`, `mouse.js`, `terminal.js` | `ui/` |

옮기기만 하는 커밋과 내용을 바꾸는 커밋을 나눕니다. 이동과 변경이 한 diff 에 섞이면 무엇이 바뀌었는지 읽을 수 없습니다.

### Engine

생성할 때 어댑터를 받습니다. 테스트에서는 가짜 Orca, 가짜 키체인, 가짜 알림을 넣어 실제 계정 없이 정책을 돌립니다.

```js
new Engine({ orca, keychain, store, notifier, clock, log })
```

하는 일은 지금 `App.jsx` 의 React 효과에 흩어져 있는 것들입니다.

- 조회 주기마다: 계정 목록 다시 읽기, 사용량 조회(Orca 먼저), 히스토리 기록, 재인증, 창 열기(정책이 켜져 있을 때), 자동 전환 판단과 실행(켜져 있을 때), 추천과 점수 계산.
- 5초마다: Orca 가 지금 붙어 있는 계정 확인.
- 요청 처리: 즉시 조회, 한 계정 토큰 갱신, 계정 전환, 정책과 판단 기준과 숨김 변경, 종료.
- 상태가 바뀔 때마다 구독자에게 새 상태를 알립니다.

재인증은 정책과 무관하게 늘 돕니다. 기준은 지금과 같이 "만료된 지 한 시간 넘은 Claude 토큰" 입니다. 살아 있는 토큰은 Orca 가 돌리고, 둘이 같은 refresh token 을 함께 돌리면 rotation 에 한쪽이 revoke 되기 때문입니다. 창 미리 열기(`o`)는 창을 여는 일만 맡습니다.

조회는 한 번에 하나만 돕니다. 주기 조회 중에 `r` 이 오면 진행 중인 조회가 끝난 뒤 한 번 더 돌고, 그 결과로 응답합니다.

`tuning()` 전역은 지금처럼 `core/tuning.js` 에 두고 엔진이 정책을 읽을 때 채웁니다. 화면은 받은 상태의 판단 기준으로 같은 전역을 채워 일정 그림에 씁니다.

## 소켓 프로토콜

**자리.** `~/.cache/orca-usage/daemon.sock`, 권한 0600. 디렉터리는 0700 으로 만듭니다. 같은 맥의 다른 사용자는 붙지 못합니다.

**봉투.** 한 줄에 JSON 하나입니다. Orca 의 RPC 와 같은 모양이라 클라이언트 코드를 공유합니다.

```
요청   {"id": 7, "method": "refresh", "params": {}}
응답   {"id": 7, "result": {...}}
실패   {"id": 7, "error": {"message": "..."}}
알림   {"event": "state", "data": {...}}      (구독한 연결에만, id 없음)
```

**메서드.**

| 메서드 | 키 | 하는 일 |
| --- | --- | --- |
| `hello` | | 프로토콜 버전, 백엔드 버전, pid, 시작 시각, 누가 띄웠는지 |
| `snapshot` | | 지금 상태 전부 |
| `subscribe` | | 이후 상태가 바뀔 때마다 `state` 알림, 기록이 늘 때마다 `log` 알림 |
| `history` | | `since` 이후의 히스토리 표본. 처음에는 0 으로 전부 받습니다 |
| `log` | | 기록 전부(최신이 앞) |
| `refresh` | `r` | 즉시 조회. 끝나면 결과 요약 |
| `refreshToken` | `t` | 한 계정 토큰 갱신. 기준에 안 맞으면 이유와 함께 거절 |
| `switch` | `Enter` | 그 계정으로 Orca 를 옮깁니다 |
| `setPolicy` | `a`, `o`, 설정 | `autoSwitch`, `keepAlive`, `notifications` 중 보낸 것만 바꿉니다 |
| `setTuning` | 설정, 판정 | 판단 기준 하나를 바꿉니다. 범위 밖이면 거절 |
| `resetTuning` | `0` | 판단 기준 하나를 기본값으로 |
| `setHidden` | `x` | 계정 하나를 숨기거나 되돌립니다 |
| `shutdown` | | 정상 종료(exit 0) |

범위 검사와 기준 검사는 전부 백엔드가 합니다. 화면이 범위를 알고 버튼을 막더라도 판정은 백엔드의 응답이 정본입니다.

**상태의 모양.**

```
daemon    버전, pid, 시작 시각, 띄운 쪽(launchd | 화면 | 손)
orca      연결 여부, 마지막 오류
poll      진행 중 여부, 마지막 시각, 마지막 결과와 오류, 다음 시각, 주기
accounts  계정 행 목록 (지금 행 모양 그대로: 사용량, 요금제, 사유, 숨김 등)
active    provider 별 지금 붙어 있는 계정 id
policy    autoSwitch, keepAlive, notifications, hiddenIds, tuning
advice    추천(지금 쓰기, 큰 작업, 아껴둘 것)
scores    판정 탭의 점수와 내역
decision  마지막 전환 판단
lastSwitchAt
historyAt 히스토리의 마지막 표본 시각. 화면은 이것이 늘면 history 를 since 로 받습니다
```

히스토리와 기록은 크기 때문에 `state` 에 싣지 않고 따로 받습니다.

## 단일 인스턴스

조회하는 쪽은 언제나 하나여야 합니다. 둘이 조회하면 계정당 5분 5회 예산을 나눠 써 활성 계정부터 429 에 걸립니다.

- 시작할 때 `~/.cache/orca-usage/daemon.pid` 를 배타적으로 만듭니다. 이미 있고 그 pid 가 살아 있으면 "이미 떠 있음" 을 남기고 exit 0 으로 끝납니다. 죽은 pid 면 덮어씁니다.
- pid 를 잡은 뒤에야 남아 있던 소켓 파일을 지우고 엽니다. 둘이 동시에 떠도 소켓을 여는 것은 pid 를 잡은 쪽뿐입니다.
- 끝날 때 소켓과 pid 파일을 지웁니다.

exit 0 으로 끝내는 이유는 launchd 설정 때문입니다(아래). 비정상 종료만 다시 띄우므로, 이미 떠 있어서 물러난 것을 launchd 가 되살리려 들지 않습니다.

## 명령어

```
orca-usage                     화면. 백엔드가 없으면 띄우고 붙습니다
orca-usage status [--json]     백엔드 상태
orca-usage accounts [--json]   계정별 사용량을 한 번 찍습니다 (지금의 --once)
orca-usage daemon run          백엔드를 포그라운드로 돌립니다 (launchd 가 부르는 것)
orca-usage daemon install      launchd 에 등록하고 시작합니다
orca-usage daemon uninstall    멈추고 등록을 지웁니다
orca-usage daemon restart      다시 띄웁니다. 업데이트 뒤에 씁니다
orca-usage daemon stop         멈춥니다. 등록은 남습니다
orca-usage daemon logs [-f]    백엔드 로그
orca-usage update              최신으로 받고 백엔드를 다시 띄웁니다
orca-usage --graph block       화면의 누적 선을 박스 문자로 (지금과 같음)
```

바뀌는 것이 셋 있습니다.

- `--once` 와 `--json` 은 직접 조회하지 않고 백엔드의 상태를 찍습니다. 직접 조회하면 백엔드와 둘이서 예산을 나눠 씁니다. `accounts` 로 옮기고, `--once` 는 같은 뜻의 별칭으로 남깁니다.
- `--interval` 은 없앱니다. 조회 주기는 설정 탭의 "조회 주기" 가 정본입니다.
- `--no-refresh-tokens` 는 없앱니다. 재인증은 백엔드의 정책이고, 화면 실행 인자가 바꿀 것이 아닙니다.

### status

살아 있으면 이렇게 찍고 exit 0 입니다.

```
백엔드   실행 중  pid 51234, 3시간 12분째, launchd 가 띄움
버전     1.1.0 (8047102)
Orca     연결됨
조회     2분 주기, 마지막 14:02 성공, 다음 14:04
계정     Claude 3, Codex 3, 숨김 2
정책     자동 전환 꺼짐, 창 미리 열기 켜짐, 알림 켜짐
재인증   최근 09-24 22:10 0226daniel
최근     14:01 전환  claude2 -> claude  (점수)
         13:40 실패  codex  Orca 에서 재로그인
launchd  등록됨  ~/Library/LaunchAgents/com.kimjisub.orca-usage.plist
로그     ~/Library/Logs/orca-usage/daemon.log
```

꺼져 있으면 launchd 상태와 다음 할 일을 찍고 exit 3 입니다. 스크립트가 종료 코드로 생사를 가를 수 있습니다.

```
백엔드   꺼짐
launchd  등록 안 됨.  orca-usage daemon install 로 등록합니다
```

## launchd

**에이전트 파일.** `~/Library/LaunchAgents/com.kimjisub.orca-usage.plist`

| 키 | 값 | 이유 |
| --- | --- | --- |
| `ProgramArguments` | bun 의 절대 경로, `src/cli.jsx` 의 절대 경로, `daemon`, `run` | launchd 의 PATH 에는 bun 이 없습니다. 둘 다 등록할 때 실제 경로로 풀어 적습니다 |
| `RunAtLoad` | true | 로그인하면 뜹니다 |
| `KeepAlive` | `{SuccessfulExit: false}` | 비정상 종료만 다시 띄웁니다. `daemon stop` 과 "이미 떠 있음" 은 exit 0 이라 되살리지 않습니다 |
| `ThrottleInterval` | 10 | 계속 죽는 경우 10초 간격으로만 다시 띄웁니다 |
| `StandardOutPath`, `StandardErrorPath` | `~/Library/Logs/orca-usage/daemon.log` | `daemon logs` 가 읽는 곳 |
| `EnvironmentVariables` | `ORCA_USAGE_LAUNCHD=1` | 상태의 "띄운 쪽" 에 씁니다 |

**경로 확인.** 등록할 때 `src/cli.jsx` 의 실제 경로가 bunx 캐시(`~/.bun/install/cache/`) 안이면 등록을 거절하고 설치 방법을 안내합니다. 그 경로는 커밋마다 바뀌어 다음 업데이트에서 사라집니다. `bun add -g` 로 깐 경로(`~/.bun/install/global/node_modules/orca-usage`)나 git clone 경로는 업데이트해도 그대로라 받습니다.

**명령과 launchctl.**

| 명령 | 하는 일 |
| --- | --- |
| `install` | 화면이 띄운 백엔드가 떠 있으면 `shutdown` 으로 먼저 내립니다. plist 를 쓰고 `launchctl bootstrap gui/<uid>` 합니다. 소켓이 응답할 때까지 최대 10초 기다린 뒤 `status` 를 찍습니다. 이미 등록돼 있으면 plist 를 다시 쓰고 다시 띄웁니다 |
| `uninstall` | `launchctl bootout gui/<uid>/<label>`, plist 를 지웁니다. 로그와 상태 파일은 남깁니다 |
| `restart` | 등록돼 있으면 `launchctl kickstart -k`, 아니면 `shutdown` 뒤 화면이 하듯 띄웁니다 |
| `stop` | `shutdown` 을 보냅니다. 등록은 남아 다음 로그인에 뜹니다 |

## 화면

**붙기.** 켜면 소켓에 `hello` 를 보냅니다. 응답이 오면 `snapshot`, `history`, `log` 를 받고 `subscribe` 합니다.

**백엔드가 없을 때.** launchd 에 등록돼 있으면 `launchctl kickstart` 로 깨웁니다. 등록돼 있지 않으면 `daemon run` 을 분리된 프로세스로 띄웁니다(출력은 같은 로그 파일로, 화면이 끝나도 남도록). 둘 다 소켓이 응답할 때까지 최대 5초 기다립니다. 등록된 것을 두고 따로 띄우지 않는 이유는, 따로 띄운 것이 pid 를 잡고 있으면 launchd 쪽이 계속 "이미 떠 있음" 으로 물러나 등록이 이름뿐이 되기 때문입니다. 머리글에는 백엔드를 누가 띄웠는지 적습니다. 화면이 띄운 것이면 "화면이 띄운 백엔드, launchd 미등록" 을 적어 다음 할 일을 알립니다.

**연결이 끊겼을 때.** 머리글에 "백엔드 연결 끊김, 다시 붙는 중" 을 띄우고 2초마다 다시 붙습니다. 세 번 실패하면 위의 "없을 때" 규칙을 한 번 적용합니다. 그동안 화면은 마지막으로 받은 상태를 회색으로 둡니다.

**키.** 지금 키는 그대로이고, 각 키는 표의 메서드를 보냅니다. 응답이 올 때까지 머리글에 무엇을 기다리는지 적고, 거절되면 백엔드가 준 이유를 그대로 띄웁니다.

**카운트다운.** "다음 조회" 는 백엔드가 준 다음 시각에서 화면 시계로 뺍니다. 시각을 세는 것은 그리기이므로 화면이 합니다.

## 알림

백엔드가 macOS 알림을 띄우는 것은 둘입니다.

- 자동 전환을 했을 때. 바뀐 계정은 새 세션부터 적용되므로 알아야 합니다.
- 재로그인이 필요한 계정을 새로 발견했을 때. 기다려도 풀리지 않습니다. 같은 계정은 회복될 때까지 한 번만 띄웁니다.

손으로 누른 전환은 화면에서 이미 보고 있으므로 띄우지 않습니다. 설정 탭에 "알림" 켜기와 끄기를 둡니다(기본 켜짐). `osascript` 의 `display notification` 을 씁니다.

## 버전과 업데이트

**버전.** `package.json` 의 version 과, 알 수 있으면 커밋을 붙입니다. clone 이면 `git rev-parse`, `bun add -g` 설치면 설치본 폴더의 `.bun-tag`(`kimjisub-orca-usage-<커밋>`)를 읽습니다. 전역 `bun.lock` 은 쓰지 않습니다. 핀을 걸었다가 풀고 다시 받으면 옛 커밋 항목이 함께 남아 어느 것이 설치본인지 가를 수 없습니다(실측 2026-09-25). 화면과 백엔드의 버전이 다르면 화면 머리글에 "백엔드 버전이 다릅니다, daemon restart" 를 띄웁니다. 업데이트하고 백엔드를 다시 띄우지 않은 상태를 알리기 위해서입니다.

**`orca-usage update`.** 어떻게 깔렸는지 보고 그에 맞게 받습니다.

- `bun add -g` 설치: `bun add -g github:kimjisub/orca-usage` 로 최신 커밋을 받습니다.
- git clone: `git pull --ff-only` 뒤 `bun install`.
- 그 밖(bunx 등): 받는 방법을 안내하고 끝냅니다.

받은 뒤 백엔드가 떠 있으면 `daemon restart` 를 합니다. `bun add -g github:kimjisub/orca-usage` 는 이미 깔려 있어도 기본 브랜치의 최신 커밋으로 다시 받습니다(실측 2026-09-25: `fb9e1d0` 에서 `f59de91` 로 올라감). 받기 전후의 `.bun-tag` 를 비교해 "f59de91 -> 8047102" 처럼 무엇이 바뀌었는지 찍고, 같으면 "이미 최신" 이라고 찍고 백엔드는 건드리지 않습니다.

## 오류 처리

| 상황 | 백엔드 | 화면과 status |
| --- | --- | --- |
| Orca 꺼짐 | Claude 는 키체인으로 직접 조회, Codex 는 지난 값 유지. 1분마다 Orca 다시 확인 | "Orca 연결 안 됨" |
| 조회 실패 | 기록에 남기고 다음 주기에 다시 | 마지막 결과와 오류 |
| 자동 전환 실패 | 기록, 알림, 쿨다운은 걸지 않음 | 판정 탭의 전환 줄 |
| 키체인 접근 거부 | 해당 계정에 사유를 달고 계속 | 이름 옆 사유 |
| 백엔드 예외 | 잡히지 않은 예외는 로그에 남기고 exit 1. launchd 가 10초 뒤 다시 띄움 | 연결 끊김 뒤 재접속 |
| 소켓 요청이 잘못됨 | 그 요청에만 오류 응답, 연결은 유지 | 거절 사유 |

## 테스트

`bun test` 를 씁니다. bun 에 내장돼 있어 의존성이 늘지 않습니다.

- **core**: 재인증 기준(만료 30분, 1시간, 2시간, 만료 시각 없음), 창 열기 판정, 전환 판단(지금 있는 판단의 입력과 출력).
- **Engine**: 가짜 어댑터로 한 주기를 돌려 확인합니다. 만료 2시간 토큰은 `keepAlive` 가 꺼져 있어도 갱신한다. `autoSwitch` 가 켜져 있고 활성이 임계를 넘으면 전환하고 알린다. 숨긴 계정은 전환 대상이 아니다. 범위 밖 판단 기준은 거절한다. 조회 중에 온 `refresh` 는 두 조회를 겹치지 않는다.
- **소켓**: 임시 경로에 가짜 엔진으로 서버를 열고, 요청과 응답, 구독 알림, 잘못된 요청에 대한 오류를 확인합니다.
- **단일 인스턴스**: 살아 있는 pid 가 있으면 두 번째가 exit 0 으로 물러나고, 죽은 pid 는 덮어쓴다.
- **이 맥에서 끝까지**: `daemon install` 뒤 `launchctl print` 로 실행 중인지, `status` 가 맞게 찍히는지, 화면을 끈 뒤에도 기록이 느는지, 백엔드 pid 를 죽이면 launchd 가 다시 띄우는지, `uninstall` 이 깨끗이 지우는지. 이 확인은 지섭님 맥에 launchd 에이전트를 실제로 등록합니다. 자동 전환은 꺼 둔 상태로 합니다.

## 문서

README 를 다시 씁니다. 설치 절은 다른 맥을 기준으로 합니다.

- 준비물: macOS, Orca(로그인된 계정 하나 이상), Bun.
- 설치: `bun add -g github:kimjisub/orca-usage`, `orca-usage daemon install`, `orca-usage status` 로 확인.
- 업데이트: `orca-usage update`.
- 제거: `orca-usage daemon uninstall`, `bun remove -g orca-usage`. 남는 파일(`~/.cache/orca-usage`, `~/Library/Logs/orca-usage`)과 지우는 법.
- 소스에서 돌리기: clone, `bun install`, `bun run src/cli.jsx daemon install` (clone 경로로 등록됩니다).
- 문제 해결: 백엔드가 안 뜰 때 `daemon logs`, Orca 가 꺼져 있을 때, 키체인 창이 뜰 때, 화면과 백엔드 버전이 다를 때.
- 구조: 백엔드와 화면의 관계, 상태가 어디 남는지.

bunx 로 바로 돌리는 방법은 "설치 없이 한 번 보기" 로 남기되, 그 경우 백엔드는 화면이 띄운 것이라 화면을 끄면 함께 내리지는 않지만 재부팅하면 사라진다는 것을 적습니다.

## 이번에 하지 않는 것

- 여러 맥의 백엔드끼리 조율하기. 각 맥의 Orca 는 따로 로그인하므로 refresh token 이 갈리고, 같은 토큰을 두 맥이 돌리는 일은 없습니다.
- 웹 화면. 소켓 프로토콜이 있으니 나중에 붙일 수 있습니다.
- 로그 회전. 백엔드 로그에는 시작과 오류만 남아 작습니다. 제어 기록은 지금처럼 500건으로 자릅니다.
