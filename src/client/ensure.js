import { answers } from './connection.js'
import { inspect, wake } from '../daemon/launchd.js'

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
 * 붙을 백엔드를 찾는다. 화면과 명령은 백엔드를 스스로 띄우지 않는다.
 *
 * 답하는 백엔드가 있으면 누가 띄웠든 그것이다(개발 중에 터미널에서 daemon run
 * 으로 띄운 것도 포함). 없으면 launchd 에 등록된 것만 깨운다. 등록된 서비스를
 * 깨우는 것이라 새로 띄우는 것과 다르다. 등록돼 있지 않으면 부르는 쪽이 설치를
 * 물어야 한다.
 *
 * 여기서 백엔드를 새로 띄우지 않는 이유는, 그렇게 뜬 백엔드가 겉보기엔 돌지만
 * 재부팅하면 사라져 백엔드가 돈다고 믿는 동안 조회도 전환도 멈추기 때문이다.
 *
 * @returns {Promise<{hello: object|null, state: 'running'|'woken'|'unregistered'|'down'}>}
 */
export async function findBackend({ timeoutMs = 15_000 } = {}) {
  const hello = await answers()
  if (hello) return { hello, state: 'running' }
  const launchd = await inspect()
  if (!launchd.registered) return { hello: null, state: 'unregistered' }
  await wake().catch(() => {})
  const woken = await waitForBackend(timeoutMs)
  return { hello: woken, state: woken ? 'woken' : 'down' }
}

/** 등록된 백엔드면 깨운다. 화면이 연결을 잃었을 때 쓴다. 등록돼 있지 않으면 아무것도 안 한다. */
export async function wakeIfRegistered() {
  if ((await inspect()).registered) await wake().catch(() => {})
}
