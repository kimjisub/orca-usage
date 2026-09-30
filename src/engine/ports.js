/**
 * 엔진이 바깥 세계와 말하는 자리. 엔진은 이 모양만 알고, 무엇이 뒤에 붙는지는
 * 모른다. 실제 어댑터는 daemon/ports.js 가 묶고, 테스트는 가짜를 넣는다.
 *
 * 이 파일은 계약만 적는다. 코드는 없다.
 *
 * @typedef {object} Account
 * @property {string} id
 * @property {'claude'|'codex'} provider
 * @property {string} email
 * @property {string} label   요금제 꼬리표
 * @property {number} index   화면에 적는 번호
 *
 * @typedef {object} OrcaPort
 * @property {() => Promise<{accounts: Account[], codexKnown: boolean}>} listAccounts
 *   Orca 가 아는 계정 전부. Claude 뒤에 Codex, 번호는 이어 매긴다. Orca 가 꺼져
 *   있으면 Codex 를 못 받고 codexKnown 이 false 다
 * @property {() => Promise<{claude: string|null, codex: string|null}>} activeIds
 * @property {(provider: string, accountId: string) => Promise<void>} select
 * @property {(options: {refreshUsage: boolean}) => Promise<object>} fetchLimits
 *   Orca 가 들고 있는 계정별 한도 (adapters/orca/orca-limits.js 의 모양)
 * @property {(accountId: string) => Promise<{outcome: string, reason?: string, restored: boolean}>} [consumeCodexResetCredit]
 *   Codex 리셋 크레딧 하나를 Orca 로 쓴다. 다른 계정이면 옮겨 쓰고 되돌린다
 * @property {(accounts: Account[]) => Map<string, {expiresAt: number|null, refreshedAt: number|null, refresh: string|null}>} [codexTokens]
 *   Codex 계정들의 토큰 만료와 마지막 갱신. 읽기만 한다
 *
 * @typedef {object} KeychainPort
 * @property {(accountId: string, options: object) => Promise<object>} ensureToken
 * @property {(token: string) => Promise<{data: object|null, error: string|null, retryAfter: number|null}>} fetchUsage
 * @property {(data: object) => {windows: object[]}} normalize
 * @property {(accountId: string) => Promise<{expiresAt: number|null, refresh: string|null, refreshExpiresAt: number|null}>} peekToken
 *   액세스 토큰의 만료, 리프레시 토큰의 지문(core/fingerprint.js)과 만료. 갱신하지 않는다
 * @property {(accountId: string) => Promise<{refreshed: boolean, expiresAt: number|null, note: string|null, authFailed: boolean, revoked: boolean}>} refresh
 * @property {(accountId: string) => Promise<{ok: boolean, reason?: string, refreshed?: boolean}>} openWindow
 * @property {(accountId: string) => Promise<{status: object|null, error: string|null}>} [resetStatus]
 *   Claude 리셋권과 세션 리셋의 상태. 읽기만 한다
 *
 * @typedef {object} StorePort
 * @property {() => object} loadCache
 * @property {(cache: object) => void} saveCache
 * @property {(accountId: string, patch: object) => void} updateCache
 * @property {() => object} loadHistory
 * @property {(history: object) => void} saveHistory
 * @property {(history: object, accountId: string, windows: object[], at?: number) => object} appendHistory
 * @property {() => object} loadPolicy
 * @property {(policy: object) => void} savePolicy
 * @property {(kind: string, text: string, detail?: object) => object} log  남긴 한 줄을 돌려준다
 * @property {() => object[]} loadLog  최신이 앞
 *
 * @typedef {object} NotifierPort
 * @property {(title: string, body: string) => void} notify  실패해도 던지지 않는다
 *
 * @typedef {object} UpdaterPort
 * @property {() => {version: string, commit: string|null, mode: string}} installed
 * @property {() => Promise<{installed: string|null, latest: string|null, available: boolean, error: string|null}>} check
 * @property {() => Promise<{from: string|null, to: string|null, changed: boolean}>} apply
 *
 * @typedef {object} Ports
 * @property {OrcaPort} orca
 * @property {KeychainPort} keychain
 * @property {StorePort} store
 * @property {NotifierPort} notifier
 * @property {UpdaterPort} [updater]
 */

export {}
