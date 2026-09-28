import { createHash } from 'node:crypto'

/**
 * 비밀 값의 지문. SHA-256 의 앞 8자다. 없으면 null.
 *
 * 리프레시 토큰이 바뀌었는지만 알면 되므로 원문 대신 이것을 들고 있는다.
 * 8자(32비트)로는 원문을 되돌릴 수 없고, 한 계정의 연속된 두 토큰이 우연히
 * 같은 지문을 가질 확률은 40억 분의 1 이다.
 */
export function fingerprintOf(secret) {
  if (typeof secret !== 'string' || !secret) return null
  return createHash('sha256').update(secret).digest('hex').slice(0, 8)
}
