// 활성 계정이 이 위로 차면 갈아탄다. 90% 는 이미 막힌 뒤라 그 전에 옮긴다.
export const SWITCH_AT = 80
// 한 번 옮기고 이만큼은 다시 옮기지 않는다. 두 계정이 임계 언저리에 있으면
// 조회할 때마다 오가면서 세션만 계속 끊긴다.
export const COOLDOWN_MS = 10 * 60_000
// 곧 막혀서 옮길 때만 요구하는 여유 차이. 79% 에서 78% 로 가는 것은 의미가 없다.
const MARGIN = 15

const worstOf = (row) => {
  const used = row?.usage?.windows?.map((window) => window.pct) ?? []
  return used.length ? Math.max(...used) : null
}

const hold = (reason) => ({ action: 'hold', reason })

/**
 * 계정을 바꿔야 하는지 정한다. 화면이 늘 무언가 보여줄 수 있게 안 바꿀 때도
 * 이유를 함께 돌려준다.
 *
 * 어디로 갈지는 여기서 다시 고르지 않는다. 배지를 붙이는 `advise` 가 이미
 * 주간 소멸량과 리셋까지의 급함을 따져 1순위를 냈고, 그 답과 다른 답을 여기서
 * 만들면 화면의 `우선 사용` 과 실제 전환이 어긋난다.
 *
 * 옮길 이유는 셋이다. 하나라도 서면 옮기고, 하나도 없으면 그대로 둔다.
 *
 *   막힘   활성이 곧 벽에 부딪힌다
 *   소멸   다른 계정 쿼터가 리셋에 버려질 판이다
 *   자제   활성을 아껴야 한다
 *
 * @returns {{action:'switch', target, why, reason} | {action:'hold', reason}}
 */
export function decideSwitch(rows, tip, { activeId, lastSwitchAt = 0, now = Date.now() } = {}) {
  if (!tip?.use) return hold('추천할 계정 없음')

  const active = rows.find((row) => row.id === activeId)
  if (!active) return hold('활성 계정을 찾지 못함')

  const target = rows.find((row) => row.id === tip.use.row.id)
  if (!target) return hold('추천 계정을 찾지 못함')
  if (target.id === active.id) return hold('이미 추천 계정에 붙어 있음')

  const cooling = COOLDOWN_MS - (now - lastSwitchAt)
  if (cooling > 0) return hold(`쿨다운 ${Math.ceil(cooling / 60_000)}분`)

  const activeWorst = worstOf(active)
  const targetWorst = worstOf(target)
  if (activeWorst == null || targetWorst == null) return hold('사용량을 아직 못 받음')

  const activeBadge = tip.badges?.[active.id]
  const targetBadge = tip.badges?.[target.id]

  // 막힘: 활성이 곧 벽에 부딪힌다. 이때만 여유 차이를 따진다. 나머지 둘은
  // 이유 자체가 뚜렷해서 몇 %p 차이인지가 판단을 바꾸지 않는다.
  if (activeWorst >= SWITCH_AT) {
    if (activeWorst - targetWorst < MARGIN) {
      return hold(`활성 ${Math.round(activeWorst)}%, 갈 곳도 ${Math.round(targetWorst)}%`)
    }
    return {
      action: 'switch',
      target,
      why: '막힘',
      reason: `활성 ${Math.round(activeWorst)}% -> ${target.email} ${Math.round(targetWorst)}%`,
    }
  }

  // 소멸: 옮겨 갈 계정의 주간 쿼터가 리셋에 사라질 판이다. 지금 안 태우면
  // 되찾을 수 없으므로 활성이 여유로워도 옮긴다.
  if (targetBadge === 'spurt') {
    return {
      action: 'switch',
      target,
      why: '소멸',
      reason: `${target.email} 주간 쿼터가 리셋에 사라짐`,
    }
  }

  // 자제: 활성이 주간을 많이 썼다. 남은 며칠을 그 계정으로 버티기 어렵다.
  if (activeBadge === 'spare') {
    return {
      action: 'switch',
      target,
      why: '자제',
      reason: `활성 주간 ${Math.round(active.usage.windows.find((w) => w.label === '7d')?.pct ?? 0)}% -> ${target.email}`,
    }
  }

  return hold(`활성 ${Math.round(activeWorst)}%, 옮길 이유 없음`)
}
