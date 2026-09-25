import readline from 'node:readline'

/**
 * 예/아니오 답을 읽는다. 엔터만 치면 기본값이다.
 *
 * 한글 자판인 채로 누르면 y 가 ㅛ, n 이 ㅜ 로 들어온다. 자판을 바꾸라고 되묻는
 * 대신 같은 키로 받는다.
 *
 * @returns {boolean|null} 알아들을 수 없으면 null
 */
export function parseYes(answer, fallback = true) {
  const text = String(answer ?? '').trim().toLowerCase()
  if (!text) return fallback
  if (['y', 'yes', 'ㅛ', '예', '네', 'ㅇ', 'ㅇㅇ'].includes(text)) return true
  if (['n', 'no', 'ㅜ', '아니오', '아니요', 'ㄴ', 'ㄴㄴ'].includes(text)) return false
  return null
}

/** 한 줄을 묻는다. 알아들을 수 없는 답이면 다시 묻는다. */
export async function confirm(question, fallback = true) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    for (;;) {
      const answer = await new Promise((resolve) => rl.question(question, resolve))
      const yes = parseYes(answer, fallback)
      if (yes !== null) return yes
      process.stdout.write('y 나 n 으로 답해 주세요\n')
    }
  } finally {
    rl.close()
  }
}
