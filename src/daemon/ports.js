import { listAccounts } from '../adapters/orca/accounts.js'
import { fetchOrcaLimits, selectCodexAccount } from '../adapters/orca/orca-limits.js'
import { codexTokenInfo } from '../adapters/orca/codex-auth.js'
import { activeAccountIds, selectClaudeAccount } from '../adapters/orca/orca-rpc.js'
import { ensureToken, fetchUsage, normalize } from '../adapters/keychain/oauth.js'
import { openWindow } from '../adapters/keychain/keepalive.js'
import { peekToken, refreshNow } from '../adapters/keychain/tokens.js'
import {
  appendHistory, loadCache, loadHistory, saveCache, saveHistory, updateCache,
} from '../adapters/store/store.js'
import { loadPolicy, savePolicy } from '../adapters/store/policy.js'
import { loadLog, log } from '../adapters/store/log.js'
import { notify } from '../adapters/notify/macos.js'

/**
 * 실제 어댑터를 엔진이 기대하는 모양(engine/ports.js)으로 묶는다.
 * 무엇이 무엇에 붙는지는 이 파일에만 적힌다.
 *
 * @param {{updater?: import('../engine/ports.js').UpdaterPort}} [extra]
 * @returns {import('../engine/ports.js').Ports}
 */
export function createPorts({ updater } = {}) {
  return {
    orca: {
      listAccounts,
      activeIds: activeAccountIds,
      select: (provider, accountId) => (provider === 'codex'
        ? selectCodexAccount(accountId)
        : selectClaudeAccount(accountId)),
      fetchLimits: fetchOrcaLimits,
      // 시스템 기본 로그인은 Orca 의 계정 폴더가 아니라 Codex 자신의 home 에 있다.
      codexTokens: (accounts) => new Map(accounts.map((account) => [
        account.id, codexTokenInfo(account.system ? null : account.id),
      ]).filter(([, info]) => info)),
    },
    keychain: {
      ensureToken, fetchUsage, normalize, peekToken, refresh: refreshNow, openWindow,
    },
    store: {
      loadCache, saveCache, updateCache, loadHistory, saveHistory, appendHistory,
      loadPolicy: () => loadPolicy(),
      savePolicy: (policy) => savePolicy(policy),
      log, loadLog,
    },
    notifier: { notify },
    updater,
  }
}
