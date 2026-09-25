import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { CLI_PATH, DAEMON_LOG, HOME, LOG_DIR } from '../paths.js'

const run = promisify(execFile)

export const LABEL = 'com.kimjisub.orca-usage'
export const PLIST_PATH = path.join(HOME, 'Library/LaunchAgents', `${LABEL}.plist`)
const LAUNCHCTL = '/bin/launchctl'

const domain = () => `gui/${process.getuid()}`
const service = () => `${domain()}/${LABEL}`

const xml = (text) => String(text)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * 에이전트 파일. 값마다 이유가 있다.
 *
 *   ProgramArguments  launchd 의 PATH 에는 bun 이 없다. 둘 다 실제 경로로 적는다
 *   KeepAlive         0 이 아닌 종료만 다시 띄운다. daemon stop 과 "이미 떠 있음" 은
 *                     exit 0 이라 되살리지 않고, 업데이트 뒤 exit 75 는 새 코드로 띄운다
 *   ThrottleInterval  계속 죽으면 10초 간격으로만 다시 띄운다
 *   PATH              업데이트가 git 과 bun 을 부른다
 */
export function buildPlist({ bunPath = process.execPath, cliPath = CLI_PATH } = {}) {
  const searchPath = [path.dirname(bunPath), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(bunPath)}</string>
    <string>${xml(cliPath)}</string>
    <string>daemon</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xml(DAEMON_LOG)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(DAEMON_LOG)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ORCA_USAGE_LAUNCHD</key>
    <string>1</string>
    <key>PATH</key>
    <string>${xml(searchPath.join(':'))}</string>
  </dict>
</dict>
</plist>
`
}

/**
 * launchd 가 이 에이전트를 아는가, 알면 지금 상태는 무엇인가.
 *
 * @returns {Promise<{registered: boolean, running: boolean, pid: number|null, lastExit: number|null, program: string|null}>}
 */
export async function inspect() {
  try {
    const { stdout } = await run(LAUNCHCTL, ['print', service()], { timeout: 5_000 })
    const pick = (pattern) => pattern.exec(stdout)?.[1] ?? null
    const pid = pick(/^\s*pid = (\d+)/m)
    const lastExit = pick(/^\s*last exit code = (-?\d+)/m)
    return {
      registered: true,
      running: pick(/^\s*state = (\w+)/m) === 'running',
      pid: pid ? Number(pid) : null,
      lastExit: lastExit != null ? Number(lastExit) : null,
      program: pick(/^\s*arguments = \{\s*\n\s*(\S+)/m),
    }
  } catch {
    return { registered: false, running: false, pid: null, lastExit: null, program: null }
  }
}

/** plist 를 쓰고 launchd 에 올린다. 이미 올라가 있으면 내리고 다시 올린다. */
export async function register(options) {
  fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true })
  fs.mkdirSync(LOG_DIR, { recursive: true })
  if ((await inspect()).registered) await unregister({ keepFile: true })
  fs.writeFileSync(PLIST_PATH, buildPlist(options))
  await run(LAUNCHCTL, ['bootstrap', domain(), PLIST_PATH], { timeout: 10_000 })
}

/** launchd 에서 내린다. 돌고 있던 백엔드도 함께 내려간다. */
export async function unregister({ keepFile = false } = {}) {
  try {
    await run(LAUNCHCTL, ['bootout', service()], { timeout: 15_000 })
  } catch { /* 이미 내려가 있다 */ }
  if (!keepFile) fs.rmSync(PLIST_PATH, { force: true })
}

/** 등록된 백엔드를 죽이고 다시 띄운다. 새 코드를 읽게 하는 방법이다. */
export async function kickstart() {
  await run(LAUNCHCTL, ['kickstart', '-k', service()], { timeout: 15_000 })
}

/** 등록된 채로 내려가 있는 것을 깨운다. 이미 돌고 있으면 아무것도 안 한다. */
export async function wake() {
  await run(LAUNCHCTL, ['kickstart', service()], { timeout: 15_000 })
}
