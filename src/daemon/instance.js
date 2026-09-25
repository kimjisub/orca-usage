import fs from 'node:fs'
import path from 'node:path'

/** 그 pid 의 프로세스가 살아 있나. 다른 사용자의 것이면 EPERM 이 오지만 살아는 있다. */
export function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/**
 * 백엔드는 하나만 돈다. pid 파일을 배타적으로 만들어 그 자리를 잡는다.
 *
 * 조회하는 쪽이 둘이면 계정당 5분 5회 예산을 나눠 써 활성 계정부터 429 에
 * 걸린다. 소켓 파일로 판정하지 않는 것은, 둘이 동시에 떠서 서로 남은 소켓을
 * 지우고 다시 열면 둘 다 성공하기 때문이다.
 *
 * @returns {{ok: true} | {ok: false, pid: number}}
 */
export function acquirePid(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      fs.writeFileSync(file, String(process.pid), { flag: 'wx', mode: 0o600 })
      return { ok: true }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    const other = Number(fs.readFileSync(file, 'utf8').trim())
    if (Number.isInteger(other) && other > 0 && other !== process.pid && isAlive(other)) {
      return { ok: false, pid: other }
    }
    // 죽은 프로세스가 남긴 파일이다.
    fs.rmSync(file, { force: true })
  }
  return { ok: false, pid: 0 }
}

/** 내가 잡은 것만 놓는다. 다른 백엔드가 이미 새로 잡았으면 건드리지 않는다. */
export function releasePid(file) {
  try {
    if (Number(fs.readFileSync(file, 'utf8').trim()) === process.pid) fs.rmSync(file, { force: true })
  } catch { /* 이미 없다 */ }
}
