import React from 'react'
import { Box, Text } from 'ink'
import { cellWidth } from '../core/format.js'

const pad = (text, width) => text + ' '.repeat(Math.max(0, width - cellWidth(text)))

/**
 * Codex 리셋 크레딧 확인 창. 세 단계를 거쳐야 쓴다.
 *
 *   1 요약        무엇이 비워지고 무엇이 남는지, 계정을 옮기는지. [취소] [다음]
 *   2 이름 입력   계정 이름(@ 앞)을 그대로 쳐야 넘어간다
 *   3 마지막 확인 [취소] [사용]
 *
 * 버튼은 늘 취소에서 시작한다. Enter 를 연달아 눌러 지나가지 못하게 하려는 것이다.
 * 입력과 단계 이동은 App 이 한다. 여기는 그리기만 한다.
 */

/** 확인 입력으로 받을 글자. 이메일의 @ 앞이다. */
export const confirmWordOf = (row) => row.email.split('@')[0]

function Buttons({ labels, choice }) {
  return (
    <Text>
      {labels.map((label, index) => (
        <Text key={label}>
          {index ? '   ' : ''}
          <Text color={index === choice ? 'black' : 'white'} backgroundColor={index === choice ? (index === 0 ? 'white' : 'magenta') : undefined} bold={index === choice}>
            {` ${label} `}
          </Text>
        </Text>
      ))}
    </Text>
  )
}

function Line({ topic, children, color = 'white' }) {
  return (
    <Text wrap="truncate">
      <Text color="gray">{pad(topic, 12)}</Text>
      <Text color={color}>{children}</Text>
    </Text>
  )
}

/**
 * @param {{
 *   row: object, activeCodexEmail: string|null, step: 1|2|3, choice: number, typed: string,
 *   width: number,
 * }} props
 */
export function ResetModal({ row, activeCodexEmail, step, choice, typed, width }) {
  const count = row.credits?.available ?? 0
  const word = confirmWordOf(row)
  const windows = (row.usage?.windows ?? []).map((window) => `${window.label} ${Math.round(window.pct)}%`).join(', ')
  const switching = activeCodexEmail && activeCodexEmail !== row.email
  return (
    <Box flexDirection="column" borderStyle="double" borderColor="magenta" paddingX={2} paddingY={1} width={width}>
      <Text color="magenta" bold>{`리셋 크레딧 사용  ${step}/3`}</Text>
      <Text> </Text>
      {step === 1 ? (
        <>
          <Line topic="계정">{`${row.email}${row.label ? `  [${row.label}]` : ''}`}</Line>
          <Line topic="크레딧">{`${count}개 -> 사용 후 ${Math.max(0, count - 1)}개`}</Line>
          <Line topic="비우는 창">{`해당하는 사용 창 전부${windows ? ` (지금 ${windows})` : ''}`}</Line>
          <Line topic="계정 전환" color={switching ? 'yellow' : 'white'}>
            {switching ? `필요, 잠시 옮겼다 ${activeCodexEmail} 로 되돌림` : '없음'}
          </Line>
          <Text> </Text>
          <Text color="red" bold>{'되돌릴 수 없습니다.'}</Text>
          <Text> </Text>
          <Buttons labels={['취소', '다음']} choice={choice} />
        </>
      ) : null}
      {step === 2 ? (
        <>
          <Text>{'확인을 위해 계정 이름을 그대로 입력하세요.'}</Text>
          <Text>
            <Text color="gray">{'입력할 이름  '}</Text>
            <Text color="magenta" bold>{word}</Text>
          </Text>
          <Text> </Text>
          <Text>
            <Text color="gray">{'> '}</Text>
            <Text color={typed === word ? 'green' : 'white'}>{typed}</Text>
            <Text color="gray">{'_'}</Text>
          </Text>
          <Text> </Text>
          <Text color="gray">{'Enter: 다음  Backspace: 지우기'}</Text>
        </>
      ) : null}
      {step === 3 ? (
        <>
          <Text>{`지금 ${row.email} 의 리셋 크레딧 1개를 씁니다.`}</Text>
          <Text color="red" bold>{'마지막 확인입니다. 되돌릴 수 없습니다.'}</Text>
          <Text> </Text>
          <Buttons labels={['취소', '사용']} choice={choice} />
        </>
      ) : null}
      <Text> </Text>
      <Text color="gray">{step === 2 ? 'Esc: 닫기' : '좌우: 고르기  Enter: 확정  Esc: 닫기'}</Text>
    </Box>
  )
}
