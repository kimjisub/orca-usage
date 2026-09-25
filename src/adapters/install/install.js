import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { PACKAGE_ROOT } from '../../paths.js'

/**
 * 이 패키지가 어떻게 깔렸나.
 *
 *   global  bun add -g. ~/.bun/install/global/node_modules 아래, 업데이트해도 경로가 같다
 *   clone   git clone. .git 이 있다
 *   bunx    bunx 캐시. 커밋마다 폴더 이름이 바뀐다
 *   other   그 밖
 */
export function installMode(root = PACKAGE_ROOT) {
  const posix = root.split(path.sep).join('/')
  if (posix.includes('/.bun/install/cache/')) return 'bunx'
  if (posix.includes('/.bun/install/global/node_modules/')) return 'global'
  if (fs.existsSync(path.join(root, '.git'))) return 'clone'
  return 'other'
}

/**
 * 설치된 커밋. clone 이면 git 에 묻고, bun 이 깐 것이면 .bun-tag 를 읽는다.
 * .bun-tag 는 kimjisub-orca-usage-<커밋> 모양이다(실측 2026-09-25). 전역
 * bun.lock 은 핀을 풀어도 옛 커밋이 남아 쓰지 않는다.
 */
export function installedCommit(root = PACKAGE_ROOT, mode = installMode(root)) {
  if (mode === 'clone') {
    try {
      return execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'],
        { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
    } catch {
      return null
    }
  }
  try {
    const tag = fs.readFileSync(path.join(root, '.bun-tag'), 'utf8').trim()
    return /-([0-9a-f]{7,40})$/.exec(tag)?.[1] ?? null
  } catch {
    return null
  }
}

export function packageVersion(root = PACKAGE_ROOT) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version ?? '?'
  } catch {
    return '?'
  }
}

/** 화면과 status 에 적는 한 줄. 1.1.0 (8047102) */
export function versionLabel(root = PACKAGE_ROOT) {
  const commit = installedCommit(root)
  return commit ? `${packageVersion(root)} (${commit})` : packageVersion(root)
}
