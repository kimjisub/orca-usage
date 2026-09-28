/**
 * 화면이 새 코드로 다시 떠야 하는가.
 *
 * 백엔드가 이 화면이 처음 본 것과 다른 버전으로 바뀌었고, 그 버전이 화면의
 * 코드와도 다를 때다. 누가 바꿨는지는 따지지 않는다. 화면의 u, orca-usage
 * update, daemon restart 어느 쪽이든 옛 화면이 남으면 옛 코드가 계속 돈다.
 *
 * 처음 본 버전과 비교하므로 다시 뜬 화면은 그때의 백엔드를 기준으로 삼아
 * 되풀이해 뜨지 않는다. 화면이 백엔드보다 새 코드로 열린 경우(clone 에서
 * 백엔드를 아직 안 내렸을 때)도 백엔드가 바뀌기 전에는 뜨지 않는다.
 *
 * @param {string|null} first 이 화면이 처음 붙었을 때 백엔드의 버전
 * @param {string|null} current 지금 붙은 백엔드의 버전
 * @param {string} screen 이 화면의 버전
 */
export function needsScreenRestart(first, current, screen) {
  if (!first || !current) return false
  return current !== first && current !== screen
}
