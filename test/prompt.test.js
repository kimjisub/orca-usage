import { describe, expect, test } from 'bun:test'
import { parseYes } from '../src/client/prompt.js'

describe('parseYes', () => {
  test('엔터만 치면 기본값', () => {
    expect(parseYes('')).toBe(true)
    expect(parseYes('  ', false)).toBe(false)
  })
  test('예로 읽는 것', () => {
    for (const answer of ['y', 'Y', 'yes', 'ㅛ', '네']) expect(parseYes(answer)).toBe(true)
  })
  test('아니오로 읽는 것', () => {
    for (const answer of ['n', 'N', 'no', 'ㅜ', '아니요']) expect(parseYes(answer)).toBe(false)
  })
  test('알아들을 수 없으면 null', () => {
    expect(parseYes('maybe')).toBeNull()
  })
})
