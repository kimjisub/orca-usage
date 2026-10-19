import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  CredentialError, io, locateCredentials, profileService,
} from '../src/adapters/keychain/credentials.js'
import { ensureToken } from '../src/adapters/keychain/oauth.js'
import { peekToken } from '../src/adapters/keychain/tokens.js'
import { KEYCHAIN_SERVICE } from '../src/paths.js'

const ID = 'acct-1'
const HOUR = 3_600_000
const USER = process.env.USER

/**
 * security 를 흉내 낸다. 항목은 "서비스|계정" 으로 메모리에 둔다. locked 면 모든
 * 명령이 36(잠김)으로 실패한다.
 */
function fakeSecurity() {
  const items = new Map()
  const fail = (code) => Object.assign(new Error(`security ${code}`), { code })
  const key = (args) => `${args[args.indexOf('-s') + 1]}|${args[args.indexOf('-a') + 1]}`
  const state = { items, locked: false, writes: [] }
  const save = (service, account, hex) => {
    state.writes.push(`${service}|${account}`)
    items.set(`${service}|${account}`, Buffer.from(hex, 'hex').toString('utf8'))
  }
  state.run = (cmd, args) => {
    if (args[0] === '-i') {
      const done = new Promise((resolve) => {
        state.pending = (line) => {
          const [, account, service, hex] = /-a '([^']+)' -s '([^']+)' -X ([0-9a-f]+)/.exec(line)
          save(service, account, hex)
          resolve({ stdout: '', stderr: '' })
        }
      })
      done.child = { stdin: { end: (line) => state.pending(line) } }
      return done
    }
    if (state.locked) return Promise.reject(fail(36))
    if (args[0] === 'find-generic-password') {
      const value = items.get(key(args))
      if (value === undefined) return Promise.reject(fail(44))
      return Promise.resolve({ stdout: args.includes('-w') ? `${value}\n` : 'attributes', stderr: '' })
    }
    if (args[0] === 'add-generic-password') {
      save(args[args.indexOf('-s') + 1], args[args.indexOf('-a') + 1], args[args.indexOf('-X') + 1])
      return Promise.resolve({ stdout: '', stderr: '' })
    }
    return Promise.reject(fail(1))
  }
  return state
}

const creds = (oauth) => JSON.stringify({
  claudeAiOauth: { accessToken: 'a0', refreshToken: 'r0', ...oauth },
  mcpOAuth: { other: 'keep' },
})

let saved
let root
let security
let profileHome

beforeEach(() => {
  saved = { ...io }
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-usage-cred-'))
  security = fakeSecurity()
  io.run = security.run
  io.profiles = path.join(root, 'profiles')
  io.backups = path.join(root, 'backup')
  io.stateDir = root
  io.lock = path.join(root, 'refresh.lock')
  profileHome = path.join(io.profiles, ID, 'home')
})

afterEach(() => {
  Object.assign(io, saved)
  fs.rmSync(root, { recursive: true, force: true })
  globalThis.fetch = realFetch
})

const realFetch = globalThis.fetch
const putManaged = (oauth) => security.items.set(`${KEYCHAIN_SERVICE}|${ID}`, creds(oauth))
const putProfile = (oauth) => {
  fs.mkdirSync(profileHome, { recursive: true })
  security.items.set(`${profileService(profileHome)}|${USER}`, creds(oauth))
}
const grant = () => {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body))
    return new Response(JSON.stringify({
      access_token: 'a1', expires_in: 28800, refresh_token: 'r1', refresh_token_expires_in: 86400,
    }), { status: 200 })
  }
  return calls
}

describe('자격증명 위치', () => {
  test('프로필 항목 이름은 Claude Code 처럼 폴더 경로 SHA-256 앞 8자를 붙인다', () => {
    // Orca 의 0226daniel 프로필에서 실제 키체인 항목 이름과 대조한 값이다.
    const home = '/Users/kimjisub/Library/Application Support/orca/claude-profiles/eda28222-1101-4c12-a738-81e3602266b7/home'
    expect(profileService(home)).toBe('Claude Code-credentials-0df7b6f7')
  })

  test('프로필 항목이 있으면 그것을 읽는다', async () => {
    putManaged({ expiresAt: 1 })
    putProfile({ expiresAt: Date.now() + HOUR })
    expect(await locateCredentials(ID)).toEqual({ kind: 'profile', service: profileService(profileHome), account: USER })
    expect((await peekToken(ID)).source).toBe('profile')
  })

  test('프로필 폴더만 있고 항목이 없으면 옛 Orca 항목을 읽는다', async () => {
    putManaged({ expiresAt: 1 })
    fs.mkdirSync(profileHome, { recursive: true })
    expect((await locateCredentials(ID)).kind).toBe('managed')
  })

  test('키체인이 잠겼으면 옛 항목으로 넘어가지 않고 실패한다', async () => {
    putProfile({ expiresAt: Date.now() + HOUR })
    security.locked = true
    const error = await locateCredentials(ID).catch((caught) => caught)
    expect(error).toBeInstanceOf(CredentialError)
    expect(error.fatal).toBe(false)
  })
})

describe('프로필 항목 갱신', () => {
  test('만료 30분 전이어도 갱신하지 않는다. 세션이 갱신할 몫이다', async () => {
    const calls = grant()
    putProfile({ expiresAt: Date.now() + 10 * 60_000 })
    const result = await ensureToken(ID, { allowRefresh: true })
    expect(result).toMatchObject({ token: 'a0', refreshed: false })
    expect(calls).toHaveLength(0)
  })

  test('만료된 지 한 시간이 안 됐으면 갱신하지 않는다', async () => {
    const calls = grant()
    putProfile({ expiresAt: Date.now() - 10 * 60_000 })
    const result = await ensureToken(ID, { allowRefresh: true })
    expect(result.refreshed).toBe(false)
    expect(result.note).toContain('세션')
    expect(calls).toHaveLength(0)
  })

  test('만료된 지 한 시간이 넘으면 갱신해 프로필 항목에만 쓰고 원본을 백업한다', async () => {
    const calls = grant()
    putManaged({ expiresAt: 1, refreshToken: 'old' })
    const before = creds({ expiresAt: Date.now() - 2 * HOUR })
    putProfile({ expiresAt: Date.now() - 2 * HOUR })
    const result = await ensureToken(ID, { allowRefresh: true })
    expect(result).toMatchObject({ refreshed: true, token: 'a1' })
    expect(calls[0].refresh_token).toBe('r0')
    expect(security.writes).toEqual([`${profileService(profileHome)}|${USER}`])
    const written = JSON.parse(security.items.get(`${profileService(profileHome)}|${USER}`))
    expect(written.claudeAiOauth.refreshToken).toBe('r1')
    expect(written.mcpOAuth).toEqual({ other: 'keep' })
    expect(JSON.parse(security.items.get(`${KEYCHAIN_SERVICE}|${ID}`)).claudeAiOauth.refreshToken).toBe('old')
    const backups = fs.readdirSync(path.join(io.backups, ID))
    expect(backups).toHaveLength(1)
    expect(backups[0]).toMatch(/^profile-\d+\.json$/)
    const backup = JSON.parse(fs.readFileSync(path.join(io.backups, ID, backups[0]), 'utf8'))
    expect(backup.claudeAiOauth.refreshToken).toBe(JSON.parse(before).claudeAiOauth.refreshToken)
  })
})

describe('옛 Orca 항목 갱신', () => {
  test('프로필이 없는 계정은 지금처럼 만료 30분 전에 갱신해 옛 항목에 쓴다', async () => {
    grant()
    putManaged({ expiresAt: Date.now() + 10 * 60_000 })
    const result = await ensureToken(ID, { allowRefresh: true })
    expect(result.refreshed).toBe(true)
    expect(security.writes).toEqual([`${KEYCHAIN_SERVICE}|${ID}`])
    expect(fs.readdirSync(path.join(io.backups, ID))[0]).toMatch(/^managed-\d+\.json$/)
  })
})
