import { describe, expect, test } from 'bun:test'
import { actionLines, tabWindow } from '../src/ui/bars.js'

const TABS = ['계정', '사용량', '소비', '상세', '일정', '판정', '기록', '설정', '도움말']
  .map((label, index) => ({ mode: `m${index}`, label }))

describe('탭 줄', () => {
  test('다 들어가면 전부 보이고 머리가 붙는다', () => {
    const view = tabWindow(TABS, 'm0', 200)
    expect(view.items.map((item) => item.mode)).toEqual(TABS.map((tab) => tab.mode))
    expect(view.lead).toBe(' <> ')
    expect(view.left || view.right).toBe(false)
  })

  test('안 들어가면 고른 탭을 품고 폭 안에서 가려진 쪽을 표시한다', () => {
    for (const width of [20, 30, 40, 56]) {
      for (const tab of TABS) {
        const view = tabWindow(TABS, tab.mode, width)
        expect(view.items.some((item) => item.mode === tab.mode)).toBe(true)
        expect(view.items.at(-1).end + view.tail.length).toBeLessThanOrEqual(width)
        expect(view.left).toBe(view.items[0].mode !== TABS[0].mode)
        expect(view.right).toBe(view.items.at(-1).mode !== TABS.at(-1).mode)
      }
    }
  })

  test('열 범위는 이어 붙어 있어 클릭한 자리가 한 탭에만 걸린다', () => {
    const view = tabWindow(TABS, 'm4', 30)
    for (let i = 1; i < view.items.length; i += 1) {
      expect(view.items[i].start).toBe(view.items[i - 1].end)
    }
  })
})

describe('단축키 줄', () => {
  const actions = [
    { key: 'r', label: '전체 재조회' }, { key: 't', label: '토큰 갱신' }, { key: 'a', label: '자동 전환' },
    { key: 'q', label: '종료' },
  ]

  test('넓으면 한 줄', () => {
    expect(actionLines(actions, 200)).toHaveLength(1)
  })

  test('좁으면 항목을 통째로 다음 줄로 넘기고 하나도 빠뜨리지 않는다', () => {
    const lines = actionLines(actions, 30)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.flat()).toEqual(actions)
  })
})
