import fs from 'node:fs'
import path from 'node:path'
import { ORCA_CODEX_ACCOUNTS } from './paths.js'

/**
 * Codex 계정의 요금제.
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

/**
 * 계정 하나의 요금제 이름. 못 알아내면 빈 문자열이다.
 *
 * @param {string} accountId Orca 의 계정 id
 * @param {string|null} workspaceLabel Orca 가 목록에 실어 준 값
 */
export function codexPlanLabel(accountId, workspaceLabel = null) {
  try {
    const file = path.join(ORCA_CODEX_ACCOUNTS, accountId, 'home/auth.json')
    const auth = JSON.parse(fs.readFileSync(file, 'utf8'))
    const claims = payloadOf(auth?.tokens?.id_token)
    const label = labelFor(claims?.['https://api.openai.com/auth']?.chatgpt_plan_type)
    if (label) return label
  } catch { /* 파일이 없거나 모양이 바뀌었다. 아래로 내려간다 */ }
  return fromWorkspace(workspaceLabel)
}
