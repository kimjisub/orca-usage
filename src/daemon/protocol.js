/**
 * 백엔드와 화면 사이의 약속. 한 줄에 JSON 하나다.
 *
 *   요청   {"id": 7, "method": "refresh", "params": {}}
 *   응답   {"id": 7, "result": ...}  또는  {"id": 7, "error": {"message": "..."}}
 *   알림   {"event": "state" | "log", "data": ...}   subscribe 한 연결에만
 *
 * 모양을 바꾸면 PROTOCOL 을 올린다. 화면은 hello 에서 이것을 보고 다르면 알린다.
 */
export const PROTOCOL = 1

/**
 * 조각나 들어오는 바이트를 줄 단위 JSON 으로 끊는다. 한 줄이 JSON 이 아니면
 * onBad 를 부르고 다음 줄로 넘어간다. 한 줄이 깨졌다고 연결을 버리지 않는다.
 */
export function lineReader(onMessage, onBad = () => {}) {
  let buffer = ''
  return (chunk) => {
    buffer += chunk
    let cut
    while ((cut = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 1)
      if (!line.trim()) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        onBad(line)
        continue
      }
      onMessage(message)
    }
  }
}

export const frame = (payload) => `${JSON.stringify(payload)}\n`
