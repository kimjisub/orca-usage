import fs from 'node:fs'
import path from 'node:path'
import { fetchOrcaLimits } from './orca-limits.js'
import { HOME, ORCA_PROFILES } from '../../paths.js'
import { claudeLabel } from '../../core/plan.js'

/** 바꿔 끼울 수 있는 바깥. 테스트가 Orca 와 폴더를 가짜로 바꾼다. */
export const io = { fetch: fetchOrcaLimits, profiles: ORCA_PROFILES, home: HOME }

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * 프로필의 Claude Code 가 받아 둔 계정 정보. 요금제는 여기에만 있다. Orca 의
 * 계정 목록에는 이메일과 조직까지만 온다.
 */
function profileAccount(id) {
  return readJson(path.join(io.profiles, id, 'home/.claude.json'))?.oauthAccount ?? null
}

/** 지금 Claude Code 가 붙어 있는 계정. Orca 가 꺼져 있을 때만 쓴다. */
function activeAccountUuid() {
  return readJson(path.join(io.home, '.claude.json'))?.oauthAccount?.accountUuid ?? null
}

function claudeAccount({ id, email, organizationName }, active) {
  const profile = profileAccount(id)
  const tier = profile?.organizationRateLimitTier ?? ''
  const address = email ?? profile?.emailAddress ?? id.slice(0, 8)
  const org = organizationName ?? profile?.organizationName
  return {
    id,
    provider: 'claude',
    email: address,
    label: claudeLabel({
      email: address,
      organizationName: org,
      tier,
      organizationType: profile?.organizationType,
      planName: profile?.planDisplayName,
    }),
    tier,
    // 서버에서 요금제를 다시 받았을 때 꼬리표를 같은 규칙으로 다시 세우려고 들고 간다.
    organizationName: org ?? null,
    organizationType: profile?.organizationType ?? null,
    active,
  }
}

/**
 * Orca 가 꺼져 있을 때의 Claude 계정. Orca 1.4 는 계정마다 프로필 폴더를 둔다.
 * 옛 claude-accounts 폴더는 Orca 가 더 갱신하지 않는다. 실측 2026-10-21: 새 계정은 거기 없었고, 다른 이메일로 다시 로그인한
 * 자리는 옛 이메일로 남아 있었고, Orca 에서 지운 계정도 남아 있었다.
 */
function profileAccounts() {
  if (!fs.existsSync(io.profiles)) return []
  const active = activeAccountUuid()
  const accounts = []
  for (const id of fs.readdirSync(io.profiles)) {
    if (!readJson(path.join(io.profiles, id, 'profile.json'))) continue
    const uuid = profileAccount(id)?.accountUuid
    accounts.push(claudeAccount({ id }, Boolean(active) && uuid === active))
  }
  return accounts
}

// 이메일 순으로 고정한다. 활성 계정을 위로 올리면 Orca 에서 전환할 때마다
// 번호와 자리가 통째로 바뀌어 눈으로 따라갈 수 없다.
const byEmail = (a, b) => a.email.localeCompare(b.email)

/**
 * 계정 전부와, Codex 목록을 실제로 받았는지. Claude 뒤에 Codex 를 붙이고 번호를
 * 이어 매긴다.
 *
 * 둘 다 Orca 의 계정 목록에서 받는다. Orca 가 꺼져 있으면 Claude 는 프로필
 * 폴더에서 읽고, Codex 는 빈 목록으로 온다. 그것을 "Codex 계정이 없다" 로 읽으면
 * 목록을 다시 읽을 때마다 계정이 빠졌다 합류했다를 오간다. 부르는 쪽이 들고
 * 있던 Codex 목록을 유지할 수 있게 알려 준다.
 *
 * @returns {Promise<{accounts: object[], codexKnown: boolean}>}
 */
export async function listAccounts() {
  let orca = null
  try {
    orca = await io.fetch({ refreshUsage: false })
  } catch {
    // Orca 가 꺼져 있다. 아래에서 프로필 폴더로 대신한다.
  }
  const claude = orca
    ? orca.claude.accounts.map((account) => claudeAccount(account, account.id === orca.claude.activeId))
    : profileAccounts()
  const codex = orca?.codex.accounts ?? []
  return {
    accounts: [...claude.sort(byEmail), ...codex].map((account, index) => ({ ...account, index: index + 1 })),
    codexKnown: Boolean(orca),
  }
}
