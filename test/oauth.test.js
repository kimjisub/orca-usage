import { afterEach, describe, expect, test } from 'bun:test'
import { refreshCredentials } from '../src/adapters/keychain/oauth.js'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

const payload = (extra = {}) => JSON.stringify({
  claudeAiOauth: { accessToken: 'a0', refreshToken: 'r0', expiresAt: 1, refreshTokenExpiresAt: 2, ...extra },
})
const answer = (body) => { globalThis.fetch = async () => new Response(JSON.stringify(body), { status: 200 }) }

describe('토큰 갱신 응답', () => {
  test('refresh_token_expires_in 으로 새 refresh token 의 만료를 적는다', async () => {
    answer({ access_token: 'a1', expires_in: 28800, refresh_token: 'r1', refresh_token_expires_in: 86400 })
    const before = Date.now()
    const oauth = JSON.parse((await refreshCredentials(payload())).payload).claudeAiOauth
    expect(oauth.refreshToken).toBe('r1')
    expect(oauth.refreshTokenExpiresAt).toBeGreaterThanOrEqual(before + 86_400_000)
    expect(oauth.refreshTokenExpiresAt).toBeLessThan(before + 86_400_000 + 5_000)
  })

  test('새 refresh token 인데 만료가 없으면 옛 만료를 지운다', async () => {
    answer({ access_token: 'a1', expires_in: 28800, refresh_token: 'r1' })
    const oauth = JSON.parse((await refreshCredentials(payload())).payload).claudeAiOauth
    expect(oauth.refreshToken).toBe('r1')
    expect('refreshTokenExpiresAt' in oauth).toBe(false)
  })

  test('refresh token 이 그대로면 만료도 그대로 둔다', async () => {
    answer({ access_token: 'a1', expires_in: 28800 })
    const oauth = JSON.parse((await refreshCredentials(payload())).payload).claudeAiOauth
    expect(oauth.refreshToken).toBe('r0')
    expect(oauth.refreshTokenExpiresAt).toBe(2)
  })
})
