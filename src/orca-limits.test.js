import { describe, expect, test } from 'bun:test'
import { normalizeOrcaLimits } from './orca-limits.js'
import {
  CODEX_SYSTEM_DEFAULT_ID,
  codexActiveAccountId,
  codexRpcAccountId,
} from './orca-rpc.js'

const weekly = {
  status: 'ok',
  weekly: { windowMinutes: 10080, usedPercent: 23, resetsAt: '2026-09-20T00:00:00Z' },
  rateLimitResetCredits: { availableCount: 2 },
  updatedAt: '2026-09-15T00:00:00Z',
}

describe('Codex account normalization', () => {
  test('includes an authenticated system-default account with its usage', () => {
    const result = normalizeOrcaLimits({
      codex: {
        accounts: [],
        activeAccountId: null,
        activeAccountIdsByRuntime: { host: null },
        systemDefault: { hasAuth: true, email: 'codex@example.com', workspaceLabel: 'Local' },
      },
      rateLimits: { codex: weekly, inactiveCodexAccounts: [] },
    })

    expect(result.codex.activeId).toBe(CODEX_SYSTEM_DEFAULT_ID)
    expect(result.codex.accounts).toHaveLength(1)
    expect(result.codex.accounts[0]).toMatchObject({
      id: CODEX_SYSTEM_DEFAULT_ID,
      email: 'codex@example.com',
      provider: 'codex',
      label: 'Local',
      credits: { available: 2 },
      usage: { windows: [{ label: '7d', pct: 23 }] },
    })
  })

  test('prefers the current host account over the legacy active id', () => {
    expect(codexActiveAccountId({
      activeAccountId: 'legacy',
      activeAccountIdsByRuntime: { host: 'host-account' },
      systemDefault: { hasAuth: true },
    })).toBe('host-account')
  })

  test('uses system default when the current host explicitly has no managed account', () => {
    expect(codexActiveAccountId({
      activeAccountId: 'legacy',
      activeAccountIdsByRuntime: { host: null },
      systemDefault: { hasAuth: true },
    })).toBe(CODEX_SYSTEM_DEFAULT_ID)
  })

  test('does not invent a system-default account without authentication', () => {
    const result = normalizeOrcaLimits({
      codex: { accounts: [], activeAccountId: null, systemDefault: { hasAuth: false } },
      rateLimits: {},
    })

    expect(result.codex.activeId).toBeNull()
    expect(result.codex.accounts).toEqual([])
  })

  test('translates the system-default id back to null for Orca RPC', () => {
    expect(codexRpcAccountId(CODEX_SYSTEM_DEFAULT_ID)).toBeNull()
    expect(codexRpcAccountId('managed-account')).toBe('managed-account')
  })
})
