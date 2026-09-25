import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { PACKAGE_ROOT } from '../../paths.js'
import { installMode, installedCommit, versionLabel } from './install.js'

const run = promisify(execFile)
const HTTP_TIMEOUT_MS = 15_000

/** package.json 의 저장소 주소에서 owner/name 을 뽑는다. 주소가 한 곳에만 적히게 한다. */
export function repoSlug(root = PACKAGE_ROOT) {
  try {
    const url = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).repository?.url ?? ''
    return /github\.com[/:]([^/]+\/[^/.]+)/.exec(url)?.[1] ?? null
  } catch {
    return null
  }
}

/** 기본 브랜치의 최신 커밋. GitHub API 는 이 Accept 로 sha 한 줄만 준다. */
async function latestOnGitHub(slug) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
  try {
    const response = await fetch(`https://api.github.com/repos/${slug}/commits/HEAD`, {
      headers: { Accept: 'application/vnd.github.sha', 'User-Agent': 'orca-usage' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`)
    return (await response.text()).trim()
  } finally {
    clearTimeout(timer)
  }
}

const git = (root, args, timeout = 30_000) => run('git', ['-C', root, ...args], { timeout })

/**
 * 설치 방식에 맞게 업데이트를 확인하고 받는다.
 *
 *   global  GitHub 의 최신 커밋과 .bun-tag 를 비교하고, bun add -g 로 다시 받는다
 *   clone   git fetch 뒤 HEAD 가 원격 브랜치의 조상이고 서로 다를 때만 받을 것이
 *           있다고 본다. push 안 한 커밋이 있는 개발 중인 clone 을 업데이트
 *           대상으로 읽지 않기 위해서다. git pull --ff-only 와 bun install 로 받는다
 *   bunx    받지 않는다. 캐시 폴더는 커밋마다 새로 생겨 받은 것을 이 프로세스가
 *           다시 쓸 길이 없다. daemon install 로 고정 경로에 깔도록 안내한다
 *
 * @returns {import('../../engine/ports.js').UpdaterPort}
 */
export function createUpdater({ root = PACKAGE_ROOT, bunPath = process.execPath } = {}) {
  const mode = installMode(root)
  const slug = repoSlug(root)

  const installed = () => ({ version: versionLabel(root), commit: installedCommit(root, mode), mode })

  async function check() {
    const commit = installedCommit(root, mode)
    try {
      if (mode === 'clone') {
        await git(root, ['fetch', '--quiet'])
        const upstream = (await git(root, ['rev-parse', '--short', '@{u}'])).stdout.trim()
        const behind = Number((await git(root, ['rev-list', '--count', 'HEAD..@{u}'])).stdout.trim())
        const ahead = Number((await git(root, ['rev-list', '--count', '@{u}..HEAD'])).stdout.trim())
        return {
          mode, installed: commit, latest: upstream, ahead,
          available: behind > 0 && ahead === 0,
          error: behind > 0 && ahead > 0 ? '로컬 커밋과 원격이 갈라져 있어 자동으로 받지 않습니다' : null,
        }
      }
      if (!slug) return { mode, installed: commit, latest: null, available: false, error: '저장소 주소를 모릅니다' }
      const latest = await latestOnGitHub(slug)
      return {
        mode, installed: commit, latest: latest.slice(0, 7),
        available: mode === 'global' && Boolean(commit) && !latest.startsWith(commit),
        error: mode === 'global' ? null : `${mode} 설치는 여기서 받지 않습니다`,
      }
    } catch (error) {
      return { mode, installed: commit, latest: null, available: false, error: error?.message ?? String(error) }
    }
  }

  async function apply() {
    const from = installedCommit(root, mode)
    if (mode === 'global') {
      await run(bunPath, ['add', '-g', `github:${slug}`], { timeout: 180_000 })
    } else if (mode === 'clone') {
      await git(root, ['pull', '--ff-only', '--quiet'], 60_000)
      await run(bunPath, ['install'], { cwd: root, timeout: 180_000 })
    } else if (mode === 'bunx') {
      throw new Error('bunx 로 띄운 것은 업데이트하지 않습니다. bunx github:kimjisub/orca-usage daemon install 로 설치하세요')
    } else {
      throw new Error('설치 방식을 알 수 없어 받지 않습니다')
    }
    const to = installedCommit(root, mode)
    return { from, to, changed: from !== to }
  }

  return { installed, check, apply }
}
