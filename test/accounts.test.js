import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { io, listAccounts } from '../src/adapters/orca/accounts.js'

let saved
let root

beforeEach(() => {
  saved = { ...io }
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-usage-accounts-'))
  io.profiles = path.join(root, 'profiles')
  io.home = path.join(root, 'home')
  fs.mkdirSync(io.home, { recursive: true })
})

afterEach(() => {
  Object.assign(io, saved)
  fs.rmSync(root, { recursive: true, force: true })
})

/** Orca 1.4 가 만드는 프로필 폴더 하나. oauthAccount 는 그 세션의 Claude Code 가 쓴다. */
function profile(id, oauthAccount) {
  const home = path.join(io.profiles, id, 'home')
  fs.mkdirSync(home, { recursive: true })
  fs.writeFileSync(path.join(io.profiles, id, 'profile.json'), JSON.stringify({ version: 1, accountId: id, runtime: 'host' }))
  if (oauthAccount) fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount }))
}

const orcaWith = (claude, codex = []) => {
  io.fetch = async () => ({ claude, codex: { activeId: null, accounts: codex } })
}

describe('Orca 가 켜져 있을 때', () => {
  test('Orca 의 계정 목록을 그대로 쓴다. 이메일 순으로 번호를 매기고 Codex 를 뒤에 잇는다', async () => {
    profile('b-new', { emailAddress: 'new@x.com', organizationRateLimitTier: 'default_claude_max_5x' })
    profile('a-old', { emailAddress: 'old@x.com', organizationRateLimitTier: 'default_claude_max_20x' })
    orcaWith({
      activeId: 'a-old',
      accounts: [
        { id: 'b-new', email: 'new@x.com', organizationName: "new@x.com's Organization" },
        { id: 'a-old', email: 'old@x.com', organizationName: "old@x.com's Organization" },
      ],
    }, [{ id: 'cx', email: 'cx@x.com', provider: 'codex', label: 'Pro' }])

    const { accounts, codexKnown } = await listAccounts()

    expect(codexKnown).toBe(true)
    expect(accounts.map((account) => [account.index, account.id, account.email, account.label, account.active ?? null]))
      .toEqual([
        [1, 'b-new', 'new@x.com', 'Max', false],
        [2, 'a-old', 'old@x.com', 'Max 20x', true],
        [3, 'cx', 'cx@x.com', 'Pro', null],
      ])
  })

  test('프로필의 이메일이 옛것이어도 Orca 의 이메일을 쓴다', async () => {
    profile('slot', { emailAddress: 'before@x.com' })
    orcaWith({ activeId: null, accounts: [{ id: 'slot', email: 'after@x.com', organizationName: 'Team' }] })

    const [account] = (await listAccounts()).accounts

    expect(account).toMatchObject({ email: 'after@x.com', label: 'Team', tier: '' })
  })

  test('Orca 목록에 없는 프로필 폴더는 넣지 않는다', async () => {
    profile('kept', { emailAddress: 'kept@x.com' })
    profile('left', { emailAddress: 'left@x.com' })
    orcaWith({ activeId: null, accounts: [{ id: 'kept', email: 'kept@x.com' }] })

    expect((await listAccounts()).accounts.map((account) => account.id)).toEqual(['kept'])
  })
})

describe('Orca 가 꺼져 있을 때', () => {
  beforeEach(() => {
    io.fetch = async () => { throw new Error('소켓 없음') }
  })

  test('프로필 폴더에서 읽고, 활성 계정은 ~/.claude.json 으로 정한다', async () => {
    profile('p1', { emailAddress: 'z@x.com', accountUuid: 'u1', organizationRateLimitTier: 'default_claude_pro' })
    profile('p2', { emailAddress: 'a@x.com', accountUuid: 'u2', organizationName: "a@x.com's Organization", organizationType: 'claude_max' })
    fs.writeFileSync(path.join(io.home, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: 'u1' } }))

    const { accounts, codexKnown } = await listAccounts()

    expect(codexKnown).toBe(false)
    expect(accounts.map((account) => [account.index, account.id, account.email, account.label, account.active]))
      .toEqual([
        [1, 'p2', 'a@x.com', 'Max', false],
        [2, 'p1', 'z@x.com', 'Pro', true],
      ])
  })

  test('profile.json 이 없는 폴더는 계정이 아니다', async () => {
    profile('real', { emailAddress: 'real@x.com' })
    fs.mkdirSync(path.join(io.profiles, 'stray'), { recursive: true })
    fs.writeFileSync(path.join(io.profiles, 'selected-host'), 'host')

    expect((await listAccounts()).accounts.map((account) => account.id)).toEqual(['real'])
  })

  test('로그인 전이라 .claude.json 이 없으면 id 앞자리로 부른다', async () => {
    profile('abcdef0123', null)

    expect((await listAccounts()).accounts[0]).toMatchObject({ email: 'abcdef01', label: '', active: false })
  })

  test('프로필 폴더가 아예 없으면 빈 목록이다', async () => {
    expect((await listAccounts()).accounts).toEqual([])
  })
})
