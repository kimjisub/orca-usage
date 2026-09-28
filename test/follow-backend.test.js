import { describe, expect, test } from 'bun:test'
import { needsScreenRestart } from '../src/ui/follow-backend.js'

describe('화면이 백엔드 버전을 따라간다', () => {
  test('백엔드가 다른 버전으로 바뀌면 다시 뜬다', () => {
    expect(needsScreenRestart('1.1.0 (aaa)', '1.1.0 (bbb)', '1.1.0 (aaa)')).toBe(true)
  })

  test('처음 붙은 백엔드와 같으면 버전이 화면과 달라도 뜨지 않는다', () => {
    // clone 에서 백엔드를 아직 안 내린 채 새 화면을 연 경우. 뜨면 같은 코드로 끝없이 뜬다.
    expect(needsScreenRestart('1.1.0 (old)', '1.1.0 (old)', '1.1.0 (new)')).toBe(false)
  })

  test('백엔드가 화면과 같은 버전으로 바뀌면 이미 그 코드라 뜨지 않는다', () => {
    expect(needsScreenRestart('1.1.0 (old)', '1.1.0 (new)', '1.1.0 (new)')).toBe(false)
  })

  test('아직 못 붙었으면 판단하지 않는다', () => {
    expect(needsScreenRestart(null, '1.1.0 (bbb)', '1.1.0 (aaa)')).toBe(false)
  })
})
