import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { HELP } from './help-text.js'
import { DAEMON_LOG, HOME, LOG_DIR, STATE_DIR } from './paths.js'
import { clockAt, shortSpan } from './core/format.js'
import { answers, call, connect } from './client/connection.js'
import { ensureBackend, waitForBackend, waitForGone } from './client/ensure.js'
import { PLIST_PATH, inspect, kickstart, register, unregister } from './daemon/launchd.js'
import { spawnDetached } from './daemon/spawn.js'
import { installMode } from './adapters/install/install.js'
import { createUpdater, repoSlug } from './adapters/install/updater.js'

const out = (text = '') => process.stdout.write(`${text}\n`)
const fail = (text, code = 1) => {
  process.stderr.write(`${text}\n`)
  process.exitCode = code
}
const tilde = (file) => (file.startsWith(HOME) ? `~${file.slice(HOME.length)}` : file)
const onOff = (value) => (value ? '켜짐' : '꺼짐')
const SOURCE_LABEL = { launchd: 'launchd 가 띄움', spawned: '따로 띄움', manual: '손으로 띄움' }

/**
 * 인자를 명령과 옵션으로 가른다. --graph 만 값을 받는다.
 *
 * --interval 과 --no-refresh-tokens 는 없앴다. 조회 주기는 설정 탭의 값이
 * 정본이고, 재인증은 백엔드의 정책이라 화면 실행 인자가 바꿀 것이 아니다.
 */
function parseArgs(argv) {
  const flags = new Set()
  const words = []
  let graphStyle = 'braille'
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--graph') {
      const style = argv[index + 1]
      if (style === 'braille' || style === 'block') {
        graphStyle = style
        index += 1
      }
    } else if (arg.startsWith('-')) {
      flags.add(arg)
    } else {
      words.push(arg)
    }
  }
  return { flags, words, graphStyle }
}

// ---- status -------------------------------------------------------------

/** 기록 중 사람이 알아야 할 것. 조회와 창 열기는 늘 돌아 여기서는 뺀다. */
const NOTABLE = new Set(['switch', 'token', 'error'])

function updateLine(update) {
  if (!update) return '아직 확인 전'
  if (update.available) return `${update.installed} -> ${update.latest} 받을 수 있음.  orca-usage update`
  if (update.error) return `확인 못 함: ${update.error}`
  if (update.ahead) return `최신 (${update.installed}, push 안 한 커밋 ${update.ahead}개)`
  return `최신 (${update.installed ?? '?'})`
}

async function statusCommand({ json = false } = {}) {
  const [hello, launchd] = await Promise.all([answers(), inspect()])
  let snapshot = null
  let log = []
  if (hello) {
    snapshot = await call('snapshot')
    log = await call('log')
  }

  if (json) {
    out(JSON.stringify({
      running: Boolean(hello),
      daemon: hello,
      launchd: { ...launchd, plist: PLIST_PATH },
      log: DAEMON_LOG,
      snapshot,
    }, null, 2))
    process.exitCode = hello ? 0 : 3
    return
  }

  if (!hello) {
    out('백엔드   꺼짐')
    if (launchd.registered) {
      const exit = launchd.lastExit != null ? ` (마지막 종료 코드 ${launchd.lastExit})` : ''
      out(`launchd  등록됨, 떠 있지 않음${exit}.  orca-usage daemon logs 로 이유를 봅니다`)
    } else {
      out('launchd  등록 안 됨.  orca-usage daemon install 로 등록합니다')
    }
    process.exitCode = 3
    return
  }

  const now = Date.now()
  const { poll, orca, policy, accounts } = snapshot
  const count = (provider) => accounts.filter((row) => row.provider === provider).length
  const hidden = accounts.filter((row) => row.hidden).length
  const lastPoll = poll.lastAt
    ? `마지막 ${clockAt(poll.lastAt)} ${poll.ok === false ? `실패 (${poll.error})` : '성공'}`
    : '아직 안 돎'
  const next = poll.running ? '지금 도는 중' : poll.nextAt ? `다음 ${clockAt(poll.nextAt)}` : ''

  out(`백엔드   실행 중  pid ${hello.pid}, ${shortSpan(now - hello.startedAt)}째, ${SOURCE_LABEL[hello.source] ?? hello.source}`)
  out(`버전     ${hello.version}`)
  out(`업데이트 ${updateLine(snapshot.update)}`)
  out(`Orca     ${orca.connected ? '연결됨' : `연결 안 됨${orca.lastError ? ` (${orca.lastError})` : ''}, Claude 는 직접 조회`}`)
  out(`조회     ${shortSpan(poll.intervalMs)} 주기, ${lastPoll}, ${next}`)
  out(`계정     Claude ${count('claude')}, Codex ${count('codex')}${hidden ? `, 숨김 ${hidden}` : ''}`)
  out(`정책     자동 전환 ${onOff(policy.autoSwitch)}, 창 미리 열기 ${onOff(policy.keepAlive)}, 알림 ${onOff(policy.notifications)}`)
  const recent = log.filter((entry) => NOTABLE.has(entry.kind)).slice(0, 3)
  recent.forEach((entry, index) => {
    const who = entry.email ? `${entry.email.split('@')[0]}  ` : ''
    out(`${index ? '        ' : '최근    '} ${clockAt(entry.at, { withDate: now - entry.at > 12 * 3_600_000 })}  ${who}${entry.text}`)
  })
  if (launchd.registered) {
    out(`launchd  등록됨  ${tilde(PLIST_PATH)}`)
  } else {
    out('launchd  등록 안 됨. 따로 띄운 백엔드라 재부팅하면 사라집니다.  orca-usage daemon install')
  }
  out(`로그     ${tilde(DAEMON_LOG)}`)
}

// ---- accounts -----------------------------------------------------------

/** 백엔드가 첫 조회를 마칠 때까지 기다린다. 막 띄운 백엔드는 캐시 값만 들고 있다. */
async function waitForFirstPoll(timeoutMs = 30_000) {
  const connection = await connect()
  try {
    const first = await connection.request('subscribe')
    if (first.poll.lastAt) return first
    return await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs)
      connection.on('state', (state) => {
        if (!state.poll.lastAt) return
        clearTimeout(timer)
        resolve(state)
      })
    })
  } finally {
    connection.close()
  }
}

async function accountsCommand({ json = false } = {}) {
  const { hello } = await ensureBackend()
  if (!hello) return fail('백엔드를 띄우지 못했습니다. orca-usage daemon logs 로 이유를 봅니다')
  const snapshot = (await waitForFirstPoll()) ?? await call('snapshot')
  if (json) {
    out(JSON.stringify(snapshot.accounts, null, 2))
    return
  }
  for (const row of snapshot.accounts) {
    const windows = (row.usage?.windows ?? [])
      .map((window) => `${window.label} ${Math.round(window.pct)}%`)
      .join('  ')
    const label = row.label ? ` [${row.label}]` : ''
    const tags = [row.hidden ? '숨김' : null, row.note].filter(Boolean).join(', ')
    out(`${row.index}${row.active ? ' *' : '  '} ${row.email}${label}  ${windows}${tags ? `  (${tags})` : ''}`)
  }
}

// ---- daemon -------------------------------------------------------------

async function installDaemon() {
  if (installMode() === 'bunx') {
    // bunx 캐시는 커밋마다 폴더 이름이 바뀌어 launchd 에 물리면 다음 업데이트에서
    // 사라진다. 경로가 그대로인 자리에 먼저 깔고 그쪽에서 다시 부른다.
    const slug = repoSlug() ?? 'kimjisub/orca-usage'
    out('bunx 캐시에서 불렸습니다. 업데이트해도 경로가 그대로인 자리에 먼저 설치합니다.')
    out(`  bun add -g github:${slug}`)
    const added = spawnSync(process.execPath, ['add', '-g', `github:${slug}`], { stdio: 'inherit' })
    if (added.status !== 0) return fail('설치하지 못했습니다')
    const bunHome = process.env.BUN_INSTALL ?? path.join(os.homedir(), '.bun')
    const globalCli = path.join(bunHome, 'install/global/node_modules/orca-usage/src/cli.jsx')
    const next = spawnSync(process.execPath, [globalCli, 'daemon', 'install'], { stdio: 'inherit' })
    process.exitCode = next.status ?? 1
    return
  }

  // 화면이나 손으로 띄운 백엔드가 pid 를 쥐고 있으면 launchd 가 띄운 쪽이
  // "이미 떠 있음" 으로 물러난다. 먼저 내린다.
  const hello = await answers()
  if (hello && hello.source !== 'launchd') {
    out(`따로 떠 있던 백엔드(pid ${hello.pid})를 내립니다`)
    await call('shutdown')
    await waitForGone()
  }
  await register()
  out(`launchd 에 등록했습니다: ${tilde(PLIST_PATH)}`)
  const up = await waitForBackend(20_000, { unless: (next) => next.source !== 'launchd' })
  if (!up) return fail('등록은 했지만 백엔드가 답하지 않습니다. orca-usage daemon logs 로 이유를 봅니다')
  out()
  await statusCommand()
}

async function uninstallDaemon() {
  const launchd = await inspect()
  if (launchd.registered) {
    await unregister()
    out('launchd 에서 내리고 등록을 지웠습니다')
  } else {
    out('launchd 에 등록돼 있지 않습니다')
  }
  const hello = await answers()
  if (hello) {
    await call('shutdown')
    await waitForGone()
    out(`따로 떠 있던 백엔드(pid ${hello.pid})도 내렸습니다`)
  }
  out(`상태와 기록은 남겨 둡니다: ${tilde(STATE_DIR)}, ${tilde(LOG_DIR)}`)
}

async function restartDaemon() {
  const [launchd, before] = await Promise.all([inspect(), answers()])
  if (launchd.registered) {
    await kickstart()
  } else {
    if (before) {
      await call('shutdown')
      await waitForGone()
    }
    spawnDetached()
  }
  const after = await waitForBackend(20_000, { unless: (next) => Boolean(before) && next.pid === before.pid })
  if (!after) return fail('다시 뜨지 않았습니다. orca-usage daemon logs 로 이유를 봅니다')
  out(`다시 떴습니다: pid ${after.pid}, ${after.version}, ${SOURCE_LABEL[after.source] ?? after.source}`)
}

async function stopDaemon() {
  const hello = await answers()
  if (!hello) return out('백엔드가 떠 있지 않습니다')
  await call('shutdown')
  await waitForGone()
  out(`내렸습니다 (pid ${hello.pid})`)
  if ((await inspect()).registered) {
    out('launchd 등록은 남아 있어 다음 로그인 때 다시 뜹니다. 완전히 멈추려면 orca-usage daemon uninstall')
  }
}

function showLogs(follow) {
  if (!fs.existsSync(DAEMON_LOG)) return out(`아직 로그가 없습니다: ${tilde(DAEMON_LOG)}`)
  const tail = spawn('tail', ['-n', '80', ...(follow ? ['-f'] : []), DAEMON_LOG], { stdio: 'inherit' })
  return new Promise((resolve) => tail.on('exit', resolve))
}

async function daemonCommand(sub, flags) {
  if (sub === 'run') {
    const { runDaemon } = await import('./daemon/run.js')
    return runDaemon()
  }
  if (sub === 'install') return installDaemon()
  if (sub === 'uninstall') return uninstallDaemon()
  if (sub === 'restart') return restartDaemon()
  if (sub === 'stop') return stopDaemon()
  if (sub === 'logs') return showLogs(flags.has('-f') || flags.has('--follow'))
  return fail('orca-usage daemon install | uninstall | restart | stop | logs [-f] | run', 2)
}

// ---- update -------------------------------------------------------------

async function updateCommand() {
  const hello = await answers()
  if (!hello) {
    // 받을 백엔드가 없다. 이 프로세스가 직접 받는다.
    const updater = createUpdater()
    const info = await updater.check()
    if (!info.available) {
      return info.error ? fail(`업데이트를 확인하지 못했습니다: ${info.error}`) : out(`이미 최신입니다 (${info.installed})`)
    }
    out(`받는 중: ${info.installed} -> ${info.latest}`)
    const result = await updater.apply()
    return out(`${result.from} -> ${result.to}`)
  }

  // 받는 것도 다시 뜨는 것도 백엔드가 한다. 여기서는 요청하고 기다린다.
  out('업데이트를 확인하는 중...')
  const info = await call('checkUpdate', {}, { timeoutMs: 60_000 })
  if (!info?.available) {
    return info?.error ? fail(`업데이트를 확인하지 못했습니다: ${info.error}`) : out(`이미 최신입니다 (${info?.installed ?? hello.version})`)
  }
  out(`받는 중: ${info.installed} -> ${info.latest}`)
  const result = await call('update', {}, { timeoutMs: 300_000 })
  if (!result.changed) return out('받을 것이 없었습니다')
  const after = await waitForBackend(60_000, { unless: (next) => next.pid === hello.pid })
  if (!after) return fail('받았지만 새 백엔드가 답하지 않습니다. orca-usage daemon logs 로 이유를 봅니다')
  out(`${result.from} -> ${result.to}. 백엔드가 새 코드로 떴습니다 (pid ${after.pid})`)
}

// ---- 화면 ---------------------------------------------------------------

async function screen(graphStyle) {
  const React = (await import('react')).default
  const { render } = await import('ink')
  const { App } = await import('./ui/App.jsx')
  let restart = false
  const app = render(
    <App graphStyle={graphStyle} onRestart={() => { restart = true }} />,
    // Ctrl+C 는 우리가 받는다. ink 에 맡기면 한 번에 끝나 실수로 누른 것과
    // 끄려는 것이 구분되지 않는다.
    { exitOnCtrlC: false },
  )
  await app.waitUntilExit()
  if (!restart) return
  // 업데이트로 백엔드가 새 코드로 떴다. 화면도 같은 명령을 다시 띄워 새 코드로
  // 돌린다. 이 프로세스는 옛 코드를 메모리에 들고 있어 제자리에서 바뀌지 않는다.
  const next = spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit' })
  process.exitCode = next.status ?? 0
}

async function main() {
  // status | head 처럼 읽는 쪽이 먼저 닫으면 쓰기가 EPIPE 로 죽는다. 읽을 사람이
  // 없으니 조용히 끝낸다.
  process.stdout.on('error', (error) => {
    if (error.code === 'EPIPE') process.exit(0)
  })
  const { flags, words, graphStyle } = parseArgs(process.argv.slice(2))
  const [command, sub] = words
  if (flags.has('--help') || flags.has('-h') || command === 'help') return out(HELP)
  if (command === 'daemon') return daemonCommand(sub, flags)
  if (command === 'status') return statusCommand({ json: flags.has('--json') })
  if (command === 'update') return updateCommand()
  if (command === 'accounts' || flags.has('--once') || flags.has('--json')) {
    return accountsCommand({ json: flags.has('--json') })
  }
  if (command) return fail(`모르는 명령입니다: ${command}. orca-usage --help`, 2)
  // 파이프로 돌리면 대화형 화면이 의미가 없다. 한 번 찍고 끝낸다.
  if (!process.stdin.isTTY) return accountsCommand()
  return screen(graphStyle)
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`)
  process.exitCode = 1
})
