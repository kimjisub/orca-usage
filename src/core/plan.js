/**
 * Claude 계정 이름 옆의 짧은 꼬리표. 조직명이 이메일과 겹치면 요금제를 대신 쓴다.
 *
 * 요금제 이름은 Claude 가 부르는 대로 쓴다. 서버의 plan_display_name 이 있으면
 * 그 값이고, 없으면 등급 값에서 고른다. 실측 2026-11-02: max_20x 계정은
 * plan_display_name 이 "Ultra" 로 왔고, max_5x 는 그 값이 없어 Claude Code 도
 * "Claude Max" 로 띄운다.
 */
export function claudeLabel({ email, organizationName, tier = '', organizationType, planName }) {
  const org = organizationName ?? ''
  if (org && !org.startsWith(email ?? '')) return org
  if (planName) return planName
  if (tier.includes('max_20x')) return 'Ultra'
  if (tier.includes('max')) return 'Max'
  if (tier.includes('pro')) return 'Pro'
  return organizationType === 'claude_max' ? 'Max' : ''
}

/**
 * 서버에서 받은 요금제를 계정에 얹는다. 받은 것이 없으면 그대로 둔다.
 *
 * 계정 목록의 요금제는 프로필의 .claude.json 에서 오는데, 그 파일은 그 계정으로
 * Claude Code 를 다시 열어야 갱신된다. 실측 2026-11-11: claude2 는 서버가 Ultra
 * 인데 9일 전 파일이 max_5x 라 Max 로 보였다.
 */
export function withPlan(account, plan) {
  if (account.provider !== 'claude' || !plan) return account
  const tier = plan.tier || account.tier
  return {
    ...account,
    tier,
    label: claudeLabel({
      email: account.email,
      organizationName: account.organizationName,
      organizationType: plan.organizationType ?? account.organizationType,
      tier,
      planName: plan.planName,
    }),
  }
}
