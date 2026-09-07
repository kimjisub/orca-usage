import React from 'react'
import { render } from 'ink'
import { collectAllAccounts } from './accounts.js'
import { pollOnce, rowsFromCache } from './poller.js'
import { App } from './ui/App.jsx'

function parseArgs(argv) {
  // 사용량 엔드포인트는 계정당 5분에 5회다(실측). 120초면 5분에 2.5회라 절반만 쓴다.
  const options = { intervalMs: 120_000, allowRefresh: true, json: false, once: false, graphStyle: 'braille' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--interval') {
      const seconds = Number(argv[index + 1])
      // 뒤에 숫자가 없으면 그 자리를 건너뛰지 않는다. --interval --once 에서
      // --once 가 삼켜지고 있었다.
      if (Number.isFinite(seconds)) {
        options.intervalMs = Math.max(60, seconds) * 1000
        index += 1
      }
    } else if (arg === '--graph') {
      // 점자 글리프가 칸을 다 안 채우는 폰트에서는 블록으로 돌린다.
      const style = argv[index + 1]
      if (style === 'braille' || style === 'block') {
        options.graphStyle = style
        index += 1
      }
    } else if (arg === '--no-refresh-tokens') {
      options.allowRefresh = false
    } else if (arg === '--json') {
      options.json = true
    } else if (arg === '--once') {
      options.once = true
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    }
  }
  return options
}

const HELP = `orca-usage - Orca 가 관리하는 Claude 와 Codex 계정들의 사용량을 봅니다.

  orca-usage                     대화형 화면 (기본 120초 주기)
  orca-usage --interval 600      조회 주기를 초로 지정 (최소 60)
  orca-usage --once              한 번 조회하고 끝냅니다
  orca-usage --json              JSON 으로 출력합니다 (--once 를 함께 쓰세요)
  orca-usage --no-refresh-tokens 만료된 토큰을 갱신하지 않습니다
  orca-usage --graph block       누적 선을 점자 대신 박스 문자로 그립니다

그래프:
  누적 선은 점자 문자로 그립니다. 한 칸이 세로 넷 가로 둘, 점 여덟 개라 박스
  문자보다 세로 네 배, 가로 두 배로 잘게 그려집니다. btop 과 bottom 이 쓰는
  방식입니다. 폰트가 점자 글리프를 칸에 다 못 채워 오른쪽에 틈이 보이면
  --graph block 으로 돌립니다. 축은 관측 최댓값에 맞춰 20, 50, 100 중 하나이고,
  5h 창이 세로의 절반을 씁니다. 맨 아랫줄이 바닥선입니다.

사용량 출처:
  Orca 가 계정별로 이미 조회해 둔 값을 받습니다. 우리가 따로 치면 같은 예산을
  나눠 써 활성 계정이 429 에 걸립니다. Orca 가 꺼져 있으면 키체인의 자격증명으로
  직접 조회하고, 머리글에 "Orca 연결 안 됨, 직접 조회" 가 뜹니다.

화면 안에서:
  r  전체 재조회         t  선택한 계정의 토큰 재생성
  d  오른쪽 패널 전환      f  Fable 창 표시/숨김
  w  기간 (3h~1M)        a  자동 계정 전환 켜기/끄기
  o  사이클 자동트리거 켜기/끄기
  s  설정                ?  도움말
  g  그래프 접기/펼치기  q  종료
  위아래 또는 j k 로 선택하고, 숫자키로 바로 고릅니다. 클릭도 됩니다.
  Enter 를 누르면 고른 계정으로 Orca 를 옮깁니다.

오른쪽 패널 (d 로 순환):
  맨 위 탭 줄에 사용량, 소비, 일정, 판정, 기록, 설정, 도움말 일곱이 있고 지금
  보는 것에 괄호가 칩니다. 탭을 눌러도 바뀌고, s 와 ? 는 바로 그 탭으로 갑니다.

판정:
  계정마다 점수와 그 내역을 보입니다. 점수는 네 지표를 0 부터 1 로 눕히고
  가중치를 곱해 더한 값이라 늘 0 부터 100 입니다.

    소멸  리셋에 버려질 양. 최대 속도로 태워도 남을 몫이라 되찾을 수 없습니다
    급함  리셋 전에 다 쓰려면 최대 속도의 몇 할로 달려야 하나
    당장  지금 붙어 다섯 시간 동안 태울 수 있는 양
    여력  주간에 남은 양. 며칠을 버티는 자원입니다

  막대는 지표별 기여를 이어 붙인 것이고 오른쪽 숫자가 그 값입니다. 가중치는
  설정에서 바꾸며, 바꾸면 순위와 전환 판단이 함께 달라집니다.

설정 (s):
  판단 기준을 고칩니다. 위아래로 항목을 고르고 좌우로 값을 옮기며, 0 을 누르면
  그 항목만 기본값으로 돌아갑니다. 기본값에서 바뀐 값은 노란색입니다. 바꾼 값은
  저장돼 다음에 켤 때도 남습니다.

  측정된 사실과 서버에 대한 예의는 여기 없습니다. 5시간 창을 채우면 주간이
  20%p 오른다는 것, 요청 사이 간격, 백오프, OAuth 주소는 사람이 정할 값이
  아닙니다.
  탭을 눌러도 바뀝니다.

왼쪽 아래:
  추천 두세 줄 다음에 자동 상태 한 줄, 그리고 지금 화면에 붙어 있는 배지의
  뜻이 옵니다. 자동 줄은 마지막 조회와 사이클, 전환의 켜짐 여부를 보이고 최근
  한 시간에 실패가 있었으면 건수를 붙입니다. 무슨 일이 있었는지는 기록 탭입니다.

기록:
  이 도구가 스스로 한 일이 최신순으로 쌓입니다. 조회는 결과가 달라졌을 때만,
  토큰 갱신과 사이클 트리거와 계정 전환은 일어날 때마다 남습니다. 실패는 빨간
  글씨입니다. 알림은 8초 뒤 사라지므로 "아까 왜 계정이 바뀌었지" 는 여기서
  봅니다. 최근 500건을 파일에 남기고 앱을 다시 띄워도 이어집니다. 사이클
  트리거의 10분 쿨다운도 이 기록으로 판단합니다.

일정 그래프:
  앞으로 7일을 한 시간 한 칸으로 그립니다. 칸은 계정을 합친 주간 여력이라 어느
  계정이든 열려 있으면 초록입니다. 리셋 시각은 확정이고, 그 사이는 히스토리에서
  관측한 소비 속도로 이어 봅니다. 속도를 모르면 리셋만 반영합니다. 미래의 5h 는
  예측하지 않습니다. 쓰기 시작해야 창이 열리는 구조라 지금 막힌 것이 언제 풀리는
  지만 확정입니다. 오늘 행은 계정마다 따로 그려 누가 막혔고 언제 풀리는지를
  보입니다. ! 는 리셋 전에 못 다 쓸 양이 15% 넘는 시간대입니다.

사이클 자동트리거 (o):
  기본은 꺼져 있습니다. 켜 두면 폴링마다 5h 창이 안 열렸거나 닫힌 Claude 계정을
  찾아 가장 싼 모델에 토큰 하나짜리 요청을 보내 창을 엽니다. 5h 와 7d 창은 첫
  요청에서 시작하므로, 안 쓰는 계정은 리셋 시계가 서 있다가 나중에 쓰기 시작한
  때부터 온전히 기다려야 합니다. 미리 열어 두면 시계가 돌아 리셋이 주기적으로
  옵니다. 비용은 사용률 정수 단위 아래라 화면에 0 으로 보입니다. 같은 계정에는
  10분 안에 다시 보내지 않습니다. 토큰이 만료된 지 한 시간 넘었으면 갱신합니다.
  Orca 는 쓰는 계정만 갱신해서 안 쓰는 계정은 그대로 만료돼 있습니다.

자동 블록:
  왼쪽 아래에 이 도구가 스스로 하는 일 네 가지가 보입니다. 조회(2분마다, Orca
  또는 직접), 토큰 갱신(마지막에 갱신한 계정), 사이클(o, 마지막에 연 창), 전환
  (a, 마지막 판단). 화면이 낮으면 한 줄로 접힙니다.

자동 계정 전환:
  a 로 켭니다. 기본은 꺼져 있습니다. Claude 계정 사이에서만 돕니다.
  옮기는 이유는 넷입니다. 활성이 전환 임계를 넘었거나(막힘), 갈 곳의 주간
  쿼터가 리셋에 사라질 판이거나(소멸), 활성을 아껴야 하거나(자제), 갈 곳의
  점수가 전환 여유차만큼 높거나(점수)입니다.
  활성 계정의 가장 빡빡한 창이 80% 를 넘고, 갈 곳이 15%p 넘게 여유로우면
  Orca 런타임에 직접 요청해 계정을 바꿉니다. 한 번 옮기면 10분은 다시 옮기지
  않습니다. 이미 떠 있는 터미널은 옛 계정으로 계속 돌고, 바뀐 계정은 그다음에
  여는 세션부터 적용됩니다.

계정 표시:
  *         이름 앞의 별표는 Orca 가 지금 붙어 있는 계정입니다. provider 마다 따로입니다
  리셋 크레딧  Codex 에만 있습니다. 쓰면 짧은 창이 즉시 비워집니다
  한도 임박  5h 또는 7d 가 90% 이상이라 지금은 못 씁니다
  이름 빨강  자격증명이 끊겨 다시 로그인해야 합니다. 사유는 이름 옆에 붙습니다
  우선 사용  지금 붙기 가장 좋은 계정입니다
  소진 권장  주간 쿼터가 리셋에 사라질 몫이 커서 지금 태워야 합니다
  사용 자제  주간을 절반 넘게 써서 아껴둘 계정입니다
`

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(HELP)
    return
  }

  const accounts = await collectAllAccounts()
  if (accounts.length === 0) {
    process.stderr.write('Orca 계정을 찾지 못했습니다.\n')
    process.exitCode = 1
    return
  }

  if (options.once || options.json) {
    const rows = await pollOnce(accounts, {
      allowRefresh: options.allowRefresh,
      force: true,
      freshForMs: 0,
    })
    if (options.json) {
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`)
    } else {
      for (const row of rows) {
        const windows = (row.usage?.windows ?? [])
          .map((window) => `${window.label} ${Math.round(window.pct)}%`)
          .join('  ')
        const tag = row.active ? ' *' : '  '
        process.stdout.write(`${row.index}${tag} ${row.email}  ${windows}${row.note ? `  (${row.note})` : ''}\n`)
      }
    }
    return
  }

  if (!process.stdin.isTTY) {
    // 파이프로 돌리면 대화형 화면이 의미가 없다. 캐시된 값만 한 번 찍는다.
    for (const row of rowsFromCache(accounts)) {
      const windows = (row.usage?.windows ?? [])
        .map((window) => `${window.label} ${Math.round(window.pct)}%`)
        .join('  ')
      process.stdout.write(`${row.index} ${row.email}  ${windows}\n`)
    }
    return
  }

  const app = render(
    <App intervalMs={options.intervalMs} allowRefresh={options.allowRefresh} graphStyle={options.graphStyle} />,
    { exitOnCtrlC: true },
  )
  await app.waitUntilExit()
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`)
  process.exitCode = 1
})
