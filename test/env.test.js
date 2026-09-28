import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { needsProductionRestart } from '../src/react-env.js'

const root = path.resolve(import.meta.dir, '..')

/** NODE_ENV 없이 새 프로세스를 띄운다. bun test 는 자기 프로세스에 NODE_ENV=test 를 건다. */
function run(command, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv }
  if (!('NODE_ENV' in extraEnv)) delete env.NODE_ENV
  return Bun.spawnSync(command, { cwd: root, env }).stdout.toString().trim()
}

describe('needsProductionRestart', () => {
  test('NODE_ENV 가 production 이 아니면 다시 띄운다', () => {
    expect(needsProductionRestart({})).toBe(true)
    expect(needsProductionRestart({ NODE_ENV: 'development' })).toBe(true)
  })
  test('production 이면 그대로 간다', () => {
    expect(needsProductionRestart({ NODE_ENV: 'production' })).toBe(false)
  })
  test('ORCA_USAGE_REACT_DEV 가 있으면 개발 빌드로 둔다', () => {
    expect(needsProductionRestart({ ORCA_USAGE_REACT_DEV: '1' })).toBe(false)
  })
})

test('실행 스크립트는 bun 을 NODE_ENV=production 으로 띄운다', () => {
  // 가짜 bun 이 받은 환경과 인자를 찍는다.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-bun-'))
  fs.writeFileSync(path.join(dir, 'bun'), '#!/bin/sh\necho "NODE_ENV=$NODE_ENV $*"\n', { mode: 0o755 })
  const out = run(['/bin/sh', path.join(root, 'orca-usage'), 'status'], { PATH: `${dir}:${process.env.PATH}` })
  fs.rmSync(dir, { recursive: true, force: true })
  expect(out).toBe(`NODE_ENV=production run ${path.join(root, 'src/cli.jsx')} status`)
})

describe('JSX 와 React 빌드', () => {
  const fixture = path.join(root, 'test/fixtures/jsx-check.js')

  test('시작할 때 production 이면 production React 로 JSX 가 만들어진다', () => {
    expect(run([process.execPath, fixture], { NODE_ENV: 'production' })).toBe('react-jsx-runtime.production.js span')
  })

  // 실행 중에 NODE_ENV 를 바꾸면 안 되는 이유. bun 은 시작할 때 JSX 를 jsxDEV 로
  // 변환했는데 production 빌드는 jsxDEV 를 비워 둔다.
  test('실행 중에 production 으로 바꾸면 JSX 가 깨진다', () => {
    expect(run([process.execPath, fixture], { SET_AT_RUNTIME: '1' })).toStartWith('실패')
  })
})
