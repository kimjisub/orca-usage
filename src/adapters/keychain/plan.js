import { readCredentials } from './credentials.js'

/**
 * 계정의 지금 요금제를 서버에서 읽는다. GET 하나이고 바꾸는 것은 없다.
 *
 * 프로필의 .claude.json 은 Claude Code 를 다시 열 때만 갱신돼 업그레이드를
 * 놓친다. /api/oauth/profile 은 사용량 API 와 따로 세는 엔드포인트다.
 */

const PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile'
const OAUTH_BETA = 'oauth-2025-04-20'
const HTTP_TIMEOUT_MS = 10_000

/** 응답에서 요금제만 꺼낸다. 등급이 없으면 버린다. */
export function parsePlan(data) {
  const org = data?.organization
  if (!org || typeof org.rate_limit_tier !== 'string') return null
  return {
    tier: org.rate_limit_tier,
    planName: typeof org.plan_display_name === 'string' && org.plan_display_name ? org.plan_display_name : null,
    organizationType: typeof org.organization_type === 'string' ? org.organization_type : null,
  }
}

/** @returns {Promise<{plan: object|null, error: string|null}>} */
export async function fetchPlan(token) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
  let response
  try {
    response = await fetch(PROFILE_URL, {
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': OAUTH_BETA },
      signal: controller.signal,
    })
  } catch {
    return { plan: null, error: '네트워크 실패' }
  } finally {
    clearTimeout(timer)
  }
  if (response.status === 401 || response.status === 403) return { plan: null, error: '인증 거부' }
  if (!response.ok) return { plan: null, error: `HTTP ${response.status}` }
  try {
    const plan = parsePlan(await response.json())
    return plan ? { plan, error: null } : { plan: null, error: '응답 이상' }
  } catch {
    return { plan: null, error: '응답 이상' }
  }
}

/**
 * 계정 하나의 요금제. access token 이 만료됐으면 묻지 않는다. 갱신은 Orca 와
 * 백엔드의 재인증이 맡는다(resets.js 와 같은 이유).
 */
export async function readPlan(accountId) {
  const oauth = JSON.parse(await readCredentials(accountId)).claudeAiOauth ?? {}
  if (!oauth.accessToken || (typeof oauth.expiresAt === 'number' && oauth.expiresAt <= Date.now())) {
    return { plan: null, error: 'access token 만료' }
  }
  return fetchPlan(oauth.accessToken)
}
