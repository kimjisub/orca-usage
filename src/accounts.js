import fs from 'node:fs'
import path from 'node:path'
import { HOME, ORCA_ACCOUNTS } from './paths.js'

/** 지금 Claude Code 가 붙어 있는 계정. ~/.claude.json 만 읽는다. */
function activeAccountUuid() {
  try {
    return JSON.parse(fs.readFileSync(path.join(HOME, '.claude.json'), 'utf8'))
      ?.oauthAccount?.accountUuid ?? null
  } catch {
    return null
  }
}

export function collectAccounts() {
  if (!fs.existsSync(ORCA_ACCOUNTS)) return []
  const active = activeAccountUuid()
  const accounts = []
  for (const id of fs.readdirSync(ORCA_ACCOUNTS).sort()) {
    const metaPath = path.join(ORCA_ACCOUNTS, id, 'auth/oauth-account.json')
    if (!fs.existsSync(metaPath)) continue
    let meta
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
    } catch {
      continue
    }
    accounts.push({
      id,
      email: meta.emailAddress ?? id.slice(0, 8),
      label: labelFor(meta),
      tier: meta.organizationRateLimitTier ?? '',
      active: Boolean(active) && meta.accountUuid === active,
    })
  }
  // 이메일 순으로 고정한다. 활성 계정을 위로 올리면 Orca 에서 전환할 때마다
  // 번호와 자리가 통째로 바뀌어 눈으로 따라갈 수 없다.
  accounts.sort((a, b) => a.email.localeCompare(b.email))
  return accounts.map((account, index) => ({ ...account, index: index + 1 }))
}

/** 화면에 붙일 짧은 꼬리표. 조직명이 이메일과 겹치면 요금제를 대신 쓴다. */
function labelFor(meta) {
  const org = meta.organizationName ?? ''
  const email = meta.emailAddress ?? ''
  if (org && !org.startsWith(email)) return org
  const tier = meta.organizationRateLimitTier ?? ''
  if (tier.includes('max_20x')) return 'Max 20x'
  if (tier.includes('max')) return 'Max'
  if (tier.includes('pro')) return 'Pro'
  return meta.organizationType === 'claude_max' ? 'Max' : ''
}
