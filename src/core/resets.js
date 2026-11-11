import { clockAt } from './format.js'

/** 리셋이 비우는 창의 이름. Claude Code 가 쓰는 한도 키를 화면의 창 이름으로. */
export const CLEARS_LABEL = {
  five_hour: '5h',
  seven_day: '7d',
  seven_day_overage_included: '추가 사용',
  seven_day_opus: 'Opus 7d',
  seven_day_sonnet: 'Sonnet 7d',
}

/** 남은 Claude 리셋권. 다 쓴 권과 일시 중지된 권은 뺀다. */
export const liveGrants = (resets) => (resets?.grants?.list ?? []).filter((grant) => grant.resetsLeft > 0 && !grant.paused)

/**
 * 리셋권의 이름. 무엇을 비우는지로 정한다.
 *
 * 실측 2026-11-11: 11월 전체 리셋(full-reset-2611)은 7d 와 추가 사용 한도를 함께
 * 비우고, Fable 출시 기념 권(launch-2610-fable*)은 추가 사용 한도만 비운다.
 * 5h 가 있는 Max 계정에서는 Fable 권이 5h 도 함께 비우므로 5h 로는 가르지 않는다.
 * 가입 기간에 따라 Fable 권이 셋까지 나와 모두 "전체 초기화" 로 적으면 7d 를
 * 세 번 더 비울 수 있는 것으로 읽힌다.
 */
export function grantName(grant) {
  if (grant.clears.includes('seven_day')) return '전체 초기화'
  const model = /\b(Fable|Opus|Sonnet|Haiku)\b/.exec(grant.label ?? '')?.[1]
  return model ? `${model} 초기화` : `${grant.clears.map((key) => CLEARS_LABEL[key] ?? key).join(', ') || '사용 한도'} 초기화`
}

/**
 * 이름과 기한과 지금 쓸 수 있는지가 같은 권을 하나로 묶는다. 순서는 기한이 이른 쪽부터다.
 *
 * @returns {{key: string, name: string, count: number, endsAt: number|null, usableNow: boolean}[]}
 */
export function grantGroups(resets) {
  const groups = new Map()
  for (const grant of liveGrants(resets)) {
    const name = grantName(grant)
    const key = `${name}|${grant.endsAt ?? ''}|${grant.usableNow}`
    const group = groups.get(key) ?? { key, name, count: 0, endsAt: grant.endsAt, usableNow: grant.usableNow }
    group.count += grant.resetsLeft
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => (a.endsAt ?? Infinity) - (b.endsAt ?? Infinity))
}

/**
 * 계정 목록에 붙일 리셋 줄. 쓸 수 있는 것만 적는다. 없으면 빈 배열이라 계정
 * 블록의 높이가 늘지 않는다. 자세한 것은 상세 탭이 맡는다.
 *
 * 줄마다 key 를 함께 준다. 화면이 문구를 key 로 쓰면 같은 문구 두 줄이 key 가
 * 겹쳐, 다시 그릴 때마다 옛 줄이 남아 줄이 불어난다(실측 2026-11-11: 권 4개가 6줄).
 *
 * @returns {{key: string, text: string}[]}
 */
export function resetLines(row, now = Date.now()) {
  if (row.provider === 'codex') {
    return row.credits?.available > 0 ? [{ key: 'codex-credits', text: `리셋 크레딧 ${row.credits.available}개` }] : []
  }
  const lines = grantGroups(row.resets).map((group) => {
    const until = group.endsAt ? `, ${clockAt(group.endsAt, { withDate: true })} 까지` : ''
    return { key: group.key, text: `${group.name} ${group.count}회${until}${group.usableNow ? '' : ' (한도 도달 시)'}` }
  })
  if (row.resets?.session?.available) lines.push({ key: 'session', text: '5시간 초기화 가능' })
  return lines
}
