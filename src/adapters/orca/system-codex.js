/**
 * Orca 가 관리하지 않는 Codex 로그인.
 *
 * Orca 에 Codex 관리 계정을 고르지 않으면 Codex 는 시스템 기본 로그인
 * (~/.codex/auth.json)으로 돈다. 그 계정은 Orca 의 계정 목록(codex.accounts)에
 * 없지만, Orca 는 이메일을 codex.systemDefault 에, 사용량을 rateLimits.codex 에
 * 실어 준다. 실측 2026-09-25: agent 맥은 관리 계정이 0개이고 Codex 는 시스템
 * 기본으로 돌아, 목록만 읽던 화면에 Codex 계정이 하나도 없었다.
 *
 * 같은 사람이 관리 계정으로도 등록돼 있으면(ChatGPT 계정 id 가 같으면) 한 줄을
 * 더 세우지 않는다. 그때 시스템 기본을 쓰고 있으면 그 관리 계정이 활성이다.
 */

/** 시스템 기본 로그인을 계정 행으로 세운다. 세울 것이 없으면 null. */
export function systemCodexAccount(payload) {
  const system = payload?.codex?.systemDefault
  if (!system?.hasAuth) return null
  const managed = payload?.codex?.accounts ?? []
  if (system.providerAccountId && managed.some((account) => account.providerAccountId === system.providerAccountId)) {
    return null
  }
  return {
    // ChatGPT 계정 id 로 고정한다. 시스템 기본 로그인이 다른 계정으로 바뀌어도
    // 히스토리가 한 줄에 섞이지 않는다.
    id: `codex-system:${system.providerAccountId ?? 'default'}`,
    email: system.email ?? 'Codex 기본 계정',
    system: true,
  }
}

/** 지금 Codex 가 쓰는 계정의 행 id. 관리 계정을 골랐으면 그것, 아니면 시스템 기본. */
export function codexActiveId(payload) {
  const chosen = payload?.codex?.activeAccountId
  if (chosen) return chosen
  const system = payload?.codex?.systemDefault
  if (!system?.hasAuth) return null
  const twin = (payload?.codex?.accounts ?? [])
    .find((account) => system.providerAccountId && account.providerAccountId === system.providerAccountId)
  return twin?.id ?? systemCodexAccount(payload)?.id ?? null
}
