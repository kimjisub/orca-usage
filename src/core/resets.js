import { clockAt } from './format.js'

/** 리셋이 비우는 창의 이름. Claude Code 가 쓰는 한도 키를 화면의 창 이름으로. */
export const CLEARS_LABEL = {
  five_hour: '5h',
  seven_day: '7d',
  seven_day_overage_included: '추가 사용',
  seven_day_opus: 'Opus 7d',
  seven_day_sonnet: 'Sonnet 7d',
}

/** 남은 Claude 전체 초기화 권. 다 쓴 권과 일시 중지된 권은 뺀다. */
export const liveGrants = (resets) => (resets?.grants?.list ?? []).filter((grant) => grant.resetsLeft > 0 && !grant.paused)

/**
 * 계정 목록에 붙일 리셋 줄. 쓸 수 있는 것만 적는다. 없으면 빈 배열이라 계정
 * 블록의 높이가 늘지 않는다. 자세한 것은 상세 탭이 맡는다.
 *
 * @returns {string[]}
 */
export function resetLines(row, now = Date.now()) {
  if (row.provider === 'codex') {
    return row.credits?.available > 0 ? [`리셋 크레딧 ${row.credits.available}개`] : []
  }
  const lines = []
  for (const grant of liveGrants(row.resets)) {
    const until = grant.endsAt ? `, ${clockAt(grant.endsAt, { withDate: true })} 까지` : ''
    lines.push(`전체 초기화 ${grant.resetsLeft}회${until}${grant.usableNow ? '' : ' (한도 도달 시)'}`)
  }
  if (row.resets?.session?.available) lines.push('5시간 초기화 가능')
  return lines
}
