import fs from 'node:fs'
import path from 'node:path'
import { fingerprintOf } from '../../core/fingerprint.js'
import { CODEX_HOME, ORCA_CODEX_ACCOUNTS } from '../../paths.js'

/**
 * Codex 계정의 auth.json 에서 읽는 것: 요금제와 토큰의 만료, 마지막 갱신.
 *
 * Orca 가 관리하는 계정은 Orca 가 계정마다 두는 home 아래에, 시스템 기본
 * 로그인은 Codex 자신의 home(~/.codex) 아래에 있다. 토큰 값은 읽고 버리며
 * 어디에도 남기지 않는다.
 *
 * 요금제에 대해.
 *
 * Orca 가 계정 목록에 실어 주는 것은 `workspaceLabel` 뿐이고 그마저 비어 올
 * 때가 있다. 실측 2026-09-21: 두 계정 중 하나만 "Personal (Pro)" 였고 다른
 * 하나는 null 이었다. 값은 로그인할 때 받아 저장되는 듯하고, 오래전에 붙인
 * 계정에는 없다.
 *
 * 요금제 자체는 OAuth id_token 의 클레임에 늘 들어 있다. Orca 가 계정마다
 * 따로 두는 home 아래 auth.json 이 그 토큰을 들고 있다. Claude 쪽에서 이미
 * 같은 디렉터리의 계정 메타를 읽고 있으므로 읽는 자리가 하나 느는 것은 아니다.
 */

// 아는 요금제의 표기. 화면에 들어갈 짧은 이름이다.
const KNOWN = {
  free: 'Free',
  plus: 'Plus',
  pro: 'Pro',
  team: 'Team',
  business: 'Business',
  enterprise: 'Enterprise',
  edu: 'Edu',
}

/**
 * JWT 의 payload 만 꺼낸다. 서명은 확인하지 않는다.
 *
 * 이 값으로 무엇을 허용하지 않고 화면에 이름만 적는다. 토큰을 발급한 쪽을
 * 믿는 것이 아니라, 우리가 우리 디스크에서 읽은 것을 그대로 읽는 것이다.
 */
function payloadOf(token) {
  const part = String(token ?? '').split('.')[1]
  if (!part) return null
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

/**
 * `self_serve_business_prolite` 처럼 아는 이름에 수식이 붙어 온다. 모르는
 * 요금제를 빈칸으로 두면 계정마다 라벨이 있다 없다 해서 무엇이 다른지 알 수
 * 없으므로, 접두만 떼고 남은 낱말을 그대로 적는다.
 */
function labelFor(planType) {
  const key = String(planType ?? '').toLowerCase()
  if (!key) return ''
  if (KNOWN[key]) return KNOWN[key]
  return key.replace(/^self_serve_/, '').split('_').filter(Boolean)
    .map((word) => KNOWN[word] ?? word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/** Orca 가 준 `Personal (Pro)` 에서 괄호 안만 뽑는다. auth.json 을 못 읽을 때 쓴다. */
function fromWorkspace(workspaceLabel) {
  const found = /\(([^)]+)\)\s*$/.exec(String(workspaceLabel ?? ''))
  return found ? found[1].trim() : ''
}

/** Orca 가 관리하는 계정이면 그 계정의 home, id 가 없으면 시스템 기본 로그인. */
const authFileFor = (accountId) => (accountId
  ? path.join(ORCA_CODEX_ACCOUNTS, accountId, 'home/auth.json')
  : path.join(CODEX_HOME, 'auth.json'))

/**
 * auth.json 하나를 읽는다. 못 읽으면 null.
 *
 * 만료는 access_token 의 exp 다. id_token 은 갱신한 뒤 한 시간이면 만료돼
 * 토큰이 살아 있는지와 상관이 없다(실측 2026-09-25: access_token 은 238시간
 * 남았는데 id_token 은 이미 만료). last_refresh 는 Codex 나 Orca 가 마지막으로
 * 토큰을 갱신한 시각이다. 리프레시 토큰은 지문만 꺼낸다(core/fingerprint.js).
 * id_token 의 auth_time 은 브라우저로 로그인한 시각이다. 갱신해도 바뀌지 않는다
 * (실측 2026-09-28: 9/16 로그인 계정의 9/25 갱신 토큰이 auth_time 9/16 을 유지).
 *
 * refresh token 의 기한은 없다. 토큰에도 auth.json 에도 없고 OpenAI 문서도
 * 기한을 밝히지 않는다. 문서가 말하는 것은 쓰는 동안 Codex 가 갱신해 이어진다는
 * 것과, refresh token 이 1회용이라 두 곳이 같은 것으로 갱신하면 한쪽이 끊긴다는
 * 것이다. 그래서 이 도구는 Codex 토큰을 갱신하지 않고 읽기만 한다.
 *
 * @returns {{planType: string|null, expiresAt: number|null, refreshedAt: number|null, refresh: string|null, loginAt: number|null}|null}
 */
export function readCodexAuth(file) {
  let auth
  try {
    auth = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
  const identity = payloadOf(auth?.tokens?.id_token)
  const access = payloadOf(auth?.tokens?.access_token)
  const refreshedAt = Date.parse(auth?.last_refresh ?? '')
  return {
    planType: identity?.['https://api.openai.com/auth']?.chatgpt_plan_type ?? null,
    expiresAt: typeof access?.exp === 'number' ? access.exp * 1000 : null,
    refreshedAt: Number.isFinite(refreshedAt) ? refreshedAt : null,
    refresh: fingerprintOf(auth?.tokens?.refresh_token),
    loginAt: typeof identity?.auth_time === 'number' ? identity.auth_time * 1000 : null,
  }
}

/**
 * 계정 하나의 요금제 이름. 못 알아내면 빈 문자열이다.
 *
 * @param {string|null} accountId Orca 의 계정 id. null 이면 시스템 기본 로그인
 * @param {string|null} workspaceLabel Orca 가 목록에 실어 준 값
 */
export function codexPlanLabel(accountId, workspaceLabel = null) {
  const label = labelFor(readCodexAuth(authFileFor(accountId))?.planType)
  return label || fromWorkspace(workspaceLabel)
}

/**
 * 계정 하나의 토큰 만료, 마지막 갱신, 리프레시 토큰 지문. 못 읽으면 null.
 *
 * @param {string|null} accountId Orca 의 계정 id. null 이면 시스템 기본 로그인
 */
export function codexTokenInfo(accountId) {
  const auth = readCodexAuth(authFileFor(accountId))
  return auth
    ? { expiresAt: auth.expiresAt, refreshedAt: auth.refreshedAt, refresh: auth.refresh, loginAt: auth.loginAt }
    : null
}
