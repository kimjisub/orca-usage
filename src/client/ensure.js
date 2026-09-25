import { answers } from './connection.js'
import { inspect, wake } from '../daemon/launchd.js'
import { spawnDetached } from '../daemon/spawn.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 백엔드가 답할 때까지 기다린다. 끝내 답이 없으면 null. */
export async function waitForBackend(timeoutMs = 5_000, { unless } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const hello = await answers()
    if (hello && (!unless || !unless(hello))) return hello
    await sleep(200)
  }
  return null
}

/** 백엔드가 내려갈 때까지 기다린다. */
export async function waitForGone(timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await answers())) return true
    await sleep(200)
  }
  return false
}

/**
 * 붙을 백엔드를 마련한다. 이미 있으면 그대로, 없으면 띄운다.
 *
 * launchd 에 등록돼 있으면 launchd 에게 깨우라고 한다. 따로 띄운 것이 pid 를
 * 쥐고 있으면 launchd 쪽이 계속 "이미 떠 있음" 으로 물러나 등록이 이름뿐이 된다.
 * 등록돼 있지 않으면 이 프로세스와 떨어진 백엔드를 띄운다. 화면을 꺼도 남는다.
 *
 * @returns {Promise<{hello: object|null, started: 'none'|'launchd'|'spawned'}>}
 */
export async function ensureBackend({ timeoutMs = 5_000 } = {}) {
  const hello = await answers()
  if (hello) return { hello, started: 'none' }
  const launchd = await inspect()
  if (launchd.registered) {
    await wake().catch(() => {})
    return { hello: await waitForBackend(timeoutMs + 10_000), started: 'launchd' }
  }
  spawnDetached()
  return { hello: await waitForBackend(timeoutMs), started: 'spawned' }
}
