import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readCodexAuth } from '../src/adapters/orca/codex-auth.js'
import { fingerprintOf } from '../src/core/fingerprint.js'
import { codexActiveId, systemCodexAccount } from '../src/adapters/orca/system-codex.js'

// agent 맥의 Orca 가 준 모양(2026-09-25). 관리 계정 0개, Codex 는 시스템 기본으로 돈다.
const agentPayload = () => ({
  codex: {
    accounts: [],
    activeAccountId: null,
    systemDefault: {
      hasAuth: true, authKind: 'oauth', email: 'jisub.kim@clozer.kr',
      providerAccountId: '835e5253-fbcd-4873-8cbf-feedbb3c15b6', workspaceLabel: null,
    },
  },
})

describe('시스템 기본 Codex 로그인', () => {
  test('관리 계정이 없으면 시스템 기본을 한 줄로 세우고 활성으로 본다', () => {
    const payload = agentPayload()
    const account = systemCodexAccount(payload)
    expect(account).toEqual({
      id: 'codex-system:835e5253-fbcd-4873-8cbf-feedbb3c15b6', email: 'jisub.kim@clozer.kr', system: true,
    })
    expect(codexActiveId(payload)).toBe(account.id)
  })

  test('같은 사람이 관리 계정으로도 있으면 한 줄을 더 세우지 않고 그 관리 계정을 활성으로 본다', () => {
    const payload = agentPayload()
    payload.codex.accounts = [{ id: 'managed-1', providerAccountId: '835e5253-fbcd-4873-8cbf-feedbb3c15b6' }]
    expect(systemCodexAccount(payload)).toBeNull()
    expect(codexActiveId(payload)).toBe('managed-1')
  })

  test('관리 계정을 골라 쓰고 있으면 그것이 활성이다', () => {
    const payload = agentPayload()
    payload.codex.accounts = [{ id: 'managed-2', providerAccountId: 'other' }]
    payload.codex.activeAccountId = 'managed-2'
    expect(codexActiveId(payload)).toBe('managed-2')
    expect(systemCodexAccount(payload)?.system).toBe(true)
  })

  test('시스템 기본 로그인이 없으면 아무것도 세우지 않는다', () => {
    const payload = agentPayload()
    payload.codex.systemDefault = { hasAuth: false }
    expect(systemCodexAccount(payload)).toBeNull()
    expect(codexActiveId(payload)).toBeNull()
  })
})

describe('readCodexAuth', () => {
  let dir
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-auth-')) })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`

  test('요금제는 id_token, 만료는 access_token 의 exp, 갱신은 last_refresh 에서, 리프레시 토큰은 지문만 읽는다', () => {
    const file = path.join(dir, 'auth.json')
    fs.writeFileSync(file, JSON.stringify({
      last_refresh: '2026-09-25T02:21:26.249880Z',
      tokens: {
        id_token: jwt({ exp: 1, 'https://api.openai.com/auth': { chatgpt_plan_type: 'pro' } }),
        access_token: jwt({ exp: 1790000000 }),
        refresh_token: 'rt_secret',
      },
    }))
    const read = readCodexAuth(file)
    expect(read).toEqual({
      planType: 'pro',
      expiresAt: 1790000000 * 1000,
      refreshedAt: Date.parse('2026-09-25T02:21:26.249880Z'),
      refresh: fingerprintOf('rt_secret'),
    })
    expect(read.refresh).toMatch(/^[0-9a-f]{8}$/)
    expect(JSON.stringify(read)).not.toContain('rt_secret')
  })

  test('파일이 없으면 null', () => {
    expect(readCodexAuth(path.join(dir, 'none.json'))).toBeNull()
  })
})
