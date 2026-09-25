import fs from 'node:fs'
import { DAEMON_PID, DAEMON_SOCKET, STATE_DIR } from '../paths.js'
import { Engine } from '../engine/engine.js'
import { versionLabel } from '../adapters/install/install.js'
import { createUpdater } from '../adapters/install/updater.js'
import { answers } from '../client/connection.js'
import { acquirePid, releasePid } from './instance.js'
import { createPorts } from './ports.js'
import { PROTOCOL } from './protocol.js'
import { createServer } from './server.js'

// 업데이트 뒤 launchd 에게 새 코드로 다시 띄워 달라는 종료 코드. KeepAlive 가
// 0 이 아닌 종료만 다시 띄우므로 0 이 아니면 되고, 크래시(1)와 가를 수 있게 따로 둔다.
export const EXIT_RESTART = 75

const say = (text) => process.stdout.write(`${new Date().toISOString()} ${text}\n`)

/**
 * 누가 띄웠나. launchd 는 plist 의 환경 변수로 알린다. 그 밖은 터미널에서 직접
 * daemon run 을 부른 것이다. 화면과 명령은 백엔드를 띄우지 않는다.
 */
function launchedBy() {
  return process.env.ORCA_USAGE_LAUNCHD ? 'launchd' : 'manual'
}

/**
 * 백엔드를 돌린다. 끝나지 않는다(종료는 process.exit 로 한다).
 *
 * @param {{updater?: object}} [options] 업데이트 어댑터. 테스트가 바꿔 넣는다
 */
export async function runDaemon({ updater = createUpdater() } = {}) {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  // 자격증명 백업이 들어 있는 곳이다. 같은 사용자 말고는 못 들어오게 한다.
  fs.chmodSync(STATE_DIR, 0o700)

  let lock = acquirePid(DAEMON_PID)
  if (!lock.ok) {
    if (await answers(DAEMON_SOCKET)) {
      say(`이미 떠 있습니다 (pid ${lock.pid}). 물러납니다`)
      process.exit(0)
    }
    // pid 는 살아 있는데 소켓이 답하지 않는다. 죽은 백엔드의 pid 를 다른
    // 프로세스가 물려받은 경우다. 그 파일을 치우고 다시 잡는다.
    fs.rmSync(DAEMON_PID, { force: true })
    lock = acquirePid(DAEMON_PID)
    if (!lock.ok) {
      say(`다른 백엔드가 자리를 잡았습니다 (pid ${lock.pid}). 물러납니다`)
      process.exit(0)
    }
  }
  // pid 를 잡은 뒤에야 남은 소켓을 치운다. 소켓을 여는 것은 pid 를 쥔 쪽뿐이다.
  fs.rmSync(DAEMON_SOCKET, { force: true })

  const source = launchedBy()
  const engine = new Engine(createPorts({ updater }), {
    meta: { version: versionLabel(), source, pid: process.pid, startedAt: Date.now() },
  })

  let stopping = false
  const stop = (code) => {
    if (stopping) return
    stopping = true
    engine.stop()
    server.close()
    fs.rmSync(DAEMON_SOCKET, { force: true })
    releasePid(DAEMON_PID)
    say(`백엔드 종료 (코드 ${code})`)
    process.exit(code)
  }

  const server = createServer(engine, {
    hello: () => ({ protocol: PROTOCOL, ...engine.meta }),
    onShutdown: () => stop(0),
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(DAEMON_SOCKET, resolve)
  })
  fs.chmodSync(DAEMON_SOCKET, 0o600)

  // 새 코드로 다시 뜬다. launchd 가 띄운 것은 종료 코드로 launchd 에 맡긴다.
  // 직접 띄운 것은 끝나기만 한다. 다시 띄우는 것은 그 터미널의 몫이다.
  engine.on('restart', () => setTimeout(() => {
    if (source === 'launchd') {
      stop(EXIT_RESTART)
      return
    }
    say('업데이트했습니다. 직접 띄운 백엔드라 스스로 다시 뜨지 않습니다. daemon run 으로 다시 띄웁니다')
    stop(0)
  }, 300))

  process.on('SIGTERM', () => stop(0))
  process.on('SIGINT', () => stop(0))
  process.on('uncaughtException', (error) => {
    say(`잡히지 않은 예외: ${error?.stack ?? error}`)
    stop(1)
  })
  process.on('unhandledRejection', (error) => {
    say(`처리되지 않은 거부: ${error?.stack ?? error}`)
    stop(1)
  })

  say(`백엔드 시작 pid ${process.pid}, ${engine.meta.version}, ${source}`)
  await engine.start()
}
