import { describe, expect, test } from 'bun:test'
import { installMode } from '../src/adapters/install/install.js'
import { buildPlist } from '../src/daemon/launchd.js'

describe('installMode', () => {
  test('bunx 캐시', () => {
    expect(installMode('/Users/a/.bun/install/cache/@GH@kimjisub-orca-usage-f59de91@@@1')).toBe('bunx')
  })
  test('bun add -g', () => {
    expect(installMode('/Users/a/.bun/install/global/node_modules/orca-usage')).toBe('global')
  })
  test('그 밖', () => {
    expect(installMode('/tmp/nowhere-orca-usage')).toBe('other')
  })
})

describe('buildPlist', () => {
  const plist = buildPlist({ bunPath: '/opt/bun & co/bin/bun', cliPath: '/x/src/cli.jsx' })
  test('0 이 아닌 종료만 다시 띄운다', () => {
    expect(plist).toContain('<key>SuccessfulExit</key>\n    <false/>')
  })
  test('경로의 특수 문자를 XML 로 바꾼다', () => {
    expect(plist).toContain('<string>/opt/bun &amp; co/bin/bun</string>')
    expect(plist).not.toContain('bun & co')
  })
  test('daemon run 을 부르고 launchd 가 띄웠다는 것을 알린다', () => {
    expect(plist).toContain('<string>daemon</string>\n    <string>run</string>')
    expect(plist).toContain('<key>ORCA_USAGE_LAUNCHD</key>')
  })
})
