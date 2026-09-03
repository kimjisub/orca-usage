import React from 'react'
import { render } from 'ink'
import { collectAccounts } from './accounts.js'
import { pollOnce, rowsFromCache } from './poller.js'
import { App } from './ui/App.jsx'

function parseArgs(argv) {
  // 사용량 엔드포인트는 계정당 5분에 5회다(실측). 120초면 5분에 2.5회라 절반만 쓴다.
  const options = { intervalMs: 120_000, allowRefresh: true, json: false, once: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--interval') {
      const seconds = Number(argv[index + 1])
      if (Number.isFinite(seconds)) options.intervalMs = Math.max(60, seconds) * 1000
      index += 1
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

const HELP = `orca-usage - Orca 가 관리하는 Claude 계정들의 사용량을 봅니다.

  orca-usage                     대화형 화면 (기본 120초 주기)
  orca-usage --interval 600      조회 주기를 초로 지정 (최소 60)
  orca-usage --once              한 번 조회하고 끝냅니다
  orca-usage --json              JSON 으로 출력합니다 (--once 를 함께 쓰세요)
  orca-usage --no-refresh-tokens 만료된 토큰을 갱신하지 않습니다

화면 안에서:
  r  전체 재조회         t  선택한 계정의 토큰 재생성
  d  사용량/소비 전환    f  Fable 창 표시/숨김
  w  기간 (3h~1M)        a  자동 계정 전환 켜기/끄기
  g  그래프 접기/펼치기  q  종료
  위아래 또는 j k 로 선택하고, 숫자키로 바로 고릅니다. 클릭도 됩니다.
  Enter 를 누르면 고른 계정으로 Orca 를 옮깁니다.

자동 계정 전환:
  a 로 켭니다. 기본은 꺼져 있습니다.
  활성 계정의 가장 빡빡한 창이 80% 를 넘고, 갈 곳이 15%p 넘게 여유로우면
  Orca 런타임에 직접 요청해 계정을 바꿉니다. 한 번 옮기면 10분은 다시 옮기지
  않습니다. 이미 떠 있는 터미널은 옛 계정으로 계속 돌고, 바뀐 계정은 그다음에
  여는 세션부터 적용됩니다.

계정 표시:
  *         이름 앞의 별표는 Orca 가 지금 붙어 있는 계정입니다
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

  const accounts = collectAccounts()
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
    <App intervalMs={options.intervalMs} allowRefresh={options.allowRefresh} />,
    { exitOnCtrlC: true },
  )
  await app.waitUntilExit()
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`)
  process.exitCode = 1
})
