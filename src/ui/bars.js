import { cellWidth } from '../core/format.js'

// 탭 줄의 머리. 좌우 화살표로 옮긴다는 표시다.
export const TAB_LEAD = ' <> '
// 가려진 탭이 있다는 표시. 탭 줄 끝에 붙는다.
const MORE = { left: '< ', right: ' >' }

/** 탭 하나가 차지하는 폭. 고른 탭은 대괄호, 나머지는 공백이라 폭이 같다. */
const tabWidth = (tab) => cellWidth(tab.label) + 3

/**
 * 폭 안에 들어가는 탭들과 그 열 범위. 그리기와 클릭 판정이 같은 값을 쓴다.
 *
 * 다 안 들어가면 고른 탭을 중심으로 좌우를 번갈아 넓히고, 가려진 쪽 끝에
 * `<` `>` 를 붙인다. 고른 탭 하나만 남기면 무엇이 더 있는지 안 보인다.
 *
 * @param {{mode: string, label: string}[]} tabs
 * @param {string} mode 고른 탭
 * @param {number} width 탭 줄에 쓸 수 있는 칸
 * @returns {{items: {mode: string, label: string, start: number, end: number}[], left: boolean, right: boolean, lead: string, tail: string}}
 */
export function tabWindow(tabs, mode, width) {
  const at = Math.max(0, tabs.findIndex((tab) => tab.mode === mode))
  const total = tabs.reduce((sum, tab) => sum + tabWidth(tab), cellWidth(TAB_LEAD))
  let from = 0
  let to = tabs.length
  if (total > width) {
    // 머리 대신 `<` 와 `>` 가 들어갈 자리를 남긴다.
    const room = width - cellWidth(MORE.left) - cellWidth(MORE.right)
    from = at
    to = at + 1
    let used = tabWidth(tabs[at])
    const fitsRight = () => to < tabs.length && used + tabWidth(tabs[to]) <= room
    const fitsLeft = () => from > 0 && used + tabWidth(tabs[from - 1]) <= room
    for (let turn = 0; fitsRight() || fitsLeft(); turn += 1) {
      if ((turn % 2 === 0 && fitsRight()) || !fitsLeft()) {
        used += tabWidth(tabs[to])
        to += 1
      } else {
        used += tabWidth(tabs[from - 1])
        from -= 1
      }
    }
  }
  const left = from > 0
  const right = to < tabs.length
  // 잘렸으면 머리 자리에 `<` 나 같은 폭의 공백이 온다. 탭의 열 범위가 바뀌지 않는다.
  const lead = left ? MORE.left : right ? ' '.repeat(cellWidth(MORE.left)) : TAB_LEAD
  let x = cellWidth(lead)
  const items = tabs.slice(from, to).map((tab) => {
    const item = { mode: tab.mode, label: tab.label, start: x, end: x + tabWidth(tab) }
    x = item.end
    return item
  })
  return { items, left, right, lead, tail: right ? MORE.right : '' }
}

/**
 * 단축키들을 폭에 맞춰 줄로 나눈다. 한 항목이 두 줄에 걸치지 않게 통째로
 * 넘긴다. 한 줄로 잘라 두면 뒤쪽 키가 있는지조차 모른다.
 *
 * @param {{key: string, label: string}[]} actions
 * @param {number} width
 * @returns {{key: string, label: string}[][]}
 */
export function actionLines(actions, width) {
  const lines = [[]]
  let used = 2
  for (const action of actions) {
    const size = cellWidth(`[${action.key}] ${action.label}  `)
    if (used + size > width && lines.at(-1).length) {
      lines.push([])
      used = 2
    }
    lines.at(-1).push(action)
    used += size
  }
  return lines
}
