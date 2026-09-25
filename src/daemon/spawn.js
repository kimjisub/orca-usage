import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { CLI_PATH, DAEMON_LOG, LOG_DIR } from '../paths.js'

/**
 * 백엔드를 이 프로세스와 떨어진 채로 띄운다. 띄운 쪽이 끝나도 남는다.
 * 출력은 launchd 가 쓰는 것과 같은 로그 파일로 보낸다.
 */
export function spawnDetached() {
  fs.mkdirSync(LOG_DIR, { recursive: true })
  const out = fs.openSync(DAEMON_LOG, 'a')
  const env = { ...process.env, ORCA_USAGE_SPAWNED: '1' }
  delete env.ORCA_USAGE_LAUNCHD
  const child = spawn(process.execPath, [CLI_PATH, 'daemon', 'run'], {
    detached: true,
    stdio: ['ignore', out, out],
    env,
  })
  child.unref()
  fs.closeSync(out)
  return child.pid
}
