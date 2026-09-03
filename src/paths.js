import os from 'node:os'
import path from 'node:path'

export const HOME = os.homedir()
export const ORCA_ACCOUNTS = path.join(
  HOME, 'Library/Application Support/orca/claude-accounts')
export const KEYCHAIN_SERVICE = 'Orca Claude Code Managed Credentials'
export const SECURITY = '/usr/bin/security'

export const STATE_DIR = path.join(HOME, '.cache/orca-usage')
export const CACHE_PATH = path.join(STATE_DIR, 'cache.json')
export const HISTORY_PATH = path.join(STATE_DIR, 'history.json')
export const BACKUP_DIR = path.join(STATE_DIR, 'keychain-backup')
export const LOCK_PATH = path.join(STATE_DIR, 'refresh.lock')
