import fs from 'node:fs'
import path from 'node:path'
import { HOME } from '../../paths.js'
import { readCredentials } from './credentials.js'

/**
 * Claude 사용 한도 리셋의 상태를 읽는다. 쓰지는 않는다.
 *
 * 리셋은 두 가지다(Claude Code 2.1.285 에서 확인, 2026-09-30).
 *
 *   cedar_ember   리셋권. 권마다 남은 횟수와 기한이 있고 비우는 창(clears)이 적혀
 *                 있다. 출시 기념 권은 5h, 7d, 추가 사용 한도를 함께 비운다
 *   juniper_tide  세션 리셋. 주 1회, 5h 한도에 닿았을 때만(not_at_wall) 쓸 수 있다
 *
 * 둘 다 /api/oauth/usage 에 쿼리를 붙여야 실려 온다. 서버는 부른 쪽이 Claude
 * Code 인지 User-Agent 로 가르고, 아니면 ineligible_reason "surface" 로 권을 비워
 * 보낸다. 그래서 이 조회만 Claude Code 의 User-Agent 를 쓴다. 사용(POST
 * reset_rate_limits)은 이 도구가 하지 않는다. 그 계정의 Claude Code 에서
 * /usage-credits 로 한다.
 */

const STATUS_URL = 'https://api.anthropic.com/api/oauth/usage?at_wall=1&skip_spend=1'
const OAUTH_BETA = 'oauth-2025-04-20'
const HTTP_TIMEOUT_MS = 10_000
const CLAUDE_VERSIONS = path.join(HOME, '.local/share/claude/versions')
// 설치본을 못 찾을 때 쓰는 버전. 서버는 너무 낡은 버전을 cli_version 으로 거절한다.
const FALLBACK_VERSION = '2.1.285'

/** 이 맥에 깔린 가장 새 Claude Code 버전. */
function claudeCodeVersion() {
  try {
    const versions = fs.readdirSync(CLAUDE_VERSIONS).filter((name) => /^\d+\.\d+\.\d+$/.test(name))
    const newer = (a, b) => {
      const [x, y] = [a, b].map((v) => v.split('.').map(Number))
      for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i]
      return 0
    }
    return versions.sort(newer).at(-1) ?? FALLBACK_VERSION
  } catch {
    return FALLBACK_VERSION
  }
}

const isoTime = (value) => {
  const at = Date.parse(value ?? '')
  return Number.isFinite(at) ? at : null
}

/** 리셋권 하나. 모양이 다르면 버린다. */
function grantOf(raw) {
  if (!raw || typeof raw.id !== 'string' || typeof raw.resets_left !== 'number') return null
  return {
    id: raw.id,
    label: typeof raw.label === 'string' ? raw.label : '',
    resetsLeft: raw.resets_left,
    resetsTotal: typeof raw.resets_total === 'number' ? raw.resets_total : raw.resets_left,
    startsAt: isoTime(raw.starts_at),
    endsAt: isoTime(raw.ends_at),
    clears: Array.isArray(raw.clears) ? raw.clears.filter((entry) => typeof entry === 'string') : [],
    paused: raw.paused === true,
    usableNow: raw.usable_now === true,
    useRequiresLimit: raw.use_requires_limit !== false,
  }
}

/**
 * 응답에서 두 리셋의 상태를 꺼낸다. 블록이 없으면 그 리셋은 null 이다.
 *
 * @returns {{grants: object[]|null, session: object|null}}
 */
export function parseResetStatus(data) {
  const cedar = data?.cedar_ember
  const juniper = data?.juniper_tide
  return {
    grants: cedar && typeof cedar === 'object'
      ? {
        eligible: cedar.eligible === true,
        reason: cedar.ineligible_reason ?? null,
        atLimit: cedar.at_limit === true,
        list: (cedar.grants ?? []).map(grantOf).filter(Boolean),
      }
      : null,
    session: juniper && typeof juniper === 'object'
      ? {
        eligible: juniper.eligible === true,
        reason: juniper.ineligible_reason ?? null,
        available: juniper.available === true,
        nextAvailableAt: isoTime(juniper.next_available_at),
        perWeek: typeof juniper.resets_per_week === 'number' ? juniper.resets_per_week : null,
      }
      : null,
  }
}

/** @returns {Promise<{status: object|null, error: string|null}>} */
export async function fetchResetStatus(token) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
  let response
  try {
    response = await fetch(STATUS_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': OAUTH_BETA,
        'Content-Type': 'application/json',
        'User-Agent': `claude-cli/${claudeCodeVersion()} (external, cli)`,
      },
      signal: controller.signal,
    })
  } catch {
    return { status: null, error: '네트워크 실패' }
  } finally {
    clearTimeout(timer)
  }
  if (response.status === 429) return { status: null, error: '호출 예산 소진' }
  if (response.status === 401 || response.status === 403) return { status: null, error: '인증 거부' }
  if (!response.ok) return { status: null, error: `HTTP ${response.status}` }
  try {
    return { status: parseResetStatus(await response.json()), error: null }
  } catch {
    return { status: null, error: '응답 이상' }
  }
}

/**
 * 계정 하나의 리셋 상태. access token 이 만료됐으면 묻지 않는다. 갱신은 Orca 와
 * 백엔드의 재인증이 맡고, 여기서 갱신하면 refresh token 을 한 번 더 돌리게 된다.
 */
export async function readResetStatus(accountId) {
  const oauth = JSON.parse(await readCredentials(accountId)).claudeAiOauth ?? {}
  if (!oauth.accessToken || (typeof oauth.expiresAt === 'number' && oauth.expiresAt <= Date.now())) {
    return { status: null, error: 'access token 만료' }
  }
  return fetchResetStatus(oauth.accessToken)
}
