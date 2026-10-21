import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const HOME = os.homedir()
// Orca 가 계정마다 만드는 Claude Code 설정 폴더. <id>/home 이 그 계정 세션의
// CLAUDE_CONFIG_DIR 이다.
export const ORCA_PROFILES = path.join(
  HOME, 'Library/Application Support/orca/claude-profiles')
export const ORCA_CODEX_ACCOUNTS = path.join(
  HOME, 'Library/Application Support/orca/codex-accounts')
// Codex 가 시스템 기본 로그인을 두는 곳. Codex 처럼 CODEX_HOME 을 따른다.
export const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME, '.codex')
// Orca 1.4 이전의 계정별 자격증명. 지금 Orca 는 읽지도 쓰지도 않고, 프로필
// 폴더가 없는 계정만 아직 여기에 토큰이 있다.
export const KEYCHAIN_SERVICE = 'Orca Claude Code Managed Credentials'
// Claude Code 가 CLAUDE_CONFIG_DIR 마다 쓰는 항목의 접두사. 뒤에 경로 해시가 붙는다.
export const CLAUDE_CODE_SERVICE = 'Claude Code-credentials'
export const SECURITY = '/usr/bin/security'

export const STATE_DIR = path.join(HOME, '.cache/orca-usage')
export const CACHE_PATH = path.join(STATE_DIR, 'cache.json')
export const HISTORY_PATH = path.join(STATE_DIR, 'history.json')
export const BACKUP_DIR = path.join(STATE_DIR, 'keychain-backup')
export const LOCK_PATH = path.join(STATE_DIR, 'refresh.lock')

// 백엔드. 소켓과 pid 는 같은 사용자만 읽고 쓴다(디렉터리 0700, 소켓 0600).
export const DAEMON_SOCKET = path.join(STATE_DIR, 'daemon.sock')
export const DAEMON_PID = path.join(STATE_DIR, 'daemon.pid')
export const LOG_DIR = path.join(HOME, 'Library/Logs/orca-usage')
export const DAEMON_LOG = path.join(LOG_DIR, 'daemon.log')

// 이 패키지가 놓인 자리. launchd 에 적을 경로와 버전을 여기서 잰다.
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const CLI_PATH = path.join(PACKAGE_ROOT, 'src/cli.jsx')
