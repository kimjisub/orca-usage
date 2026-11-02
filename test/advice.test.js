import { describe, expect, test } from 'bun:test'
import { advise, scoreAccounts } from '../src/core/advice.js'

const NOW = Date.parse('2026-11-02T00:00:00Z')
const HOUR = 3_600_000
const at = (ms) => new Date(NOW + ms).toISOString()

const row = (id, windows) => ({ id, provider: 'claude', email: `${id}@x.com`, index: 1, usage: { windows } })

describe('5h 한도가 없는 요금제', () => {
  // Ultra 는 서버가 7d 와 모델별 창만 준다. 실측 2026-11-02.
  const ultra = row('ultra', [
    { label: '7d', pct: 75, resetsAt: at(48 * HOUR) },
    { label: 'Fable', pct: 1, resetsAt: at(48 * HOUR) },
  ])

  test('단기 여력은 가득 찬 것으로 보고 막히지 않는다', () => {
    const [entry] = scoreAccounts([ultra], {}, NOW)
    expect(entry).toMatchObject({ hasShort: false, burst: 100, shortBlocked: false })
  })

  test('추천 사유에 없는 5h 를 적지 않는다', () => {
    expect(advise([ultra], {}, NOW).useReason).toBe('주간 25% 남음')
  })

  test('5h 가 있는 계정은 사유에 5h 를 함께 적는다', () => {
    const max = row('max', [
      { label: '5h', pct: 40, resetsAt: at(2 * HOUR) },
      { label: '7d', pct: 75, resetsAt: at(48 * HOUR) },
    ])
    expect(advise([max], {}, NOW).useReason).toBe('주간 25%, 5h 60% 남음')
  })
})
