import React from 'react'
import { Box, Text } from 'ink'
import { cellWidth } from '../format.js'
import { colorForSeries } from '../chart.js'

const NAME_WIDTH = 13
const BAR_WIDTH = 20
const LABEL_WIDTH = 7
// 지표마다 색을 고정한다. 위 막대와 아래 가중치 줄이 같은 색이라 눈으로 이어진다.
const PART_COLOR = { behind: '#ff9f0a', now: 'green', reserve: 'cyan' }
const BLOCKS = { behind: '█', now: '▒', reserve: '░' }
// 설명까지 한 줄에 넣으려면 이만큼은 있어야 한다.
const WIDE = 74

const pad = (text, width) => text + ' '.repeat(Math.max(0, width - cellWidth(text)))
const padStart = (text, width) => ' '.repeat(Math.max(0, width - cellWidth(text))) + text

/** 한 계정의 점수를 지표별로 쌓은 막대. 어느 지표가 얼마나 밀었는지가 폭이다. */
function ScoreBar({ parts }) {
  const cells = []
  for (const part of parts) {
    const width = Math.round((part.value / 100) * BAR_WIDTH)
    for (let at = 0; at < width; at += 1) {
      cells.push(
        <Text key={`${part.key}-${at}`} color={PART_COLOR[part.key]}>{BLOCKS[part.key]}</Text>,
      )
    }
  }
  return (
    <>
      {cells}
      <Text color="gray">{' '.repeat(Math.max(0, BAR_WIDTH - cells.length))}</Text>
    </>
  )
}

/**
 * 왜 이 계정인지, 그리고 그 판단을 어떻게 바꾸는지.
 *
 * 점수는 세 지표를 0 부터 1 로 눕히고 가중치를 곱해 더한 값이다. 예전에는 두
 * 글자 이름과 숫자만 있어서 무엇을 재는 값인지 화면만 봐서는 알 수 없었다.
 * 지표마다 무엇을 재는지와 계정별 원값을 함께 적고, 이 화면에서 바로 가중치를
 * 옮길 수 있게 했다.
 */
export function Score({ scored, activeId, useId, decision, selected, height, columns }) {
  const ranked = [...scored].sort((a, b) => b.score.total - a.score.total)
  const parts = ranked[0]?.score.parts ?? []
  const wide = columns >= WIDE
  // 계정 목록, 빈 줄, 지표 넷과 그 머리글, 전환 한 줄.
  const listRows = Math.max(1, height - parts.length - 4)
  const shown = ranked.slice(0, listRows)

  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        <Text color="white">{'판정'}</Text>
        <Text color="gray">{'  세 지표에 가중치를 곱해 더한 점수다'}</Text>
      </Text>
      {shown.map((entry) => (
        <Text key={entry.row.id} wrap="truncate">
          <Text color="yellow" bold>{entry.row.id === activeId ? '* ' : '  '}</Text>
          <Text color={colorForSeries(entry.index - 1)} bold>{String(entry.index)}</Text>
          <Text color={entry.row.id === useId ? 'green' : 'white'}>
            {` ${pad(entry.email.split('@')[0], NAME_WIDTH - 3)}`}
          </Text>
          <Text color={entry.row.id === useId ? 'green' : 'white'} bold>
            {String(Math.round(entry.score.total)).padStart(3)}
          </Text>
          <Text color="gray">{'  '}</Text>
          <ScoreBar parts={entry.score.parts} />
          <Text color="gray">
            {`  ${entry.score.parts.map((part) => String(Math.round(part.value)).padStart(2)).join(' ')}`}
          </Text>
        </Text>
      ))}

      <Text> </Text>
      <Text color="gray" wrap="truncate">
        {`  ${pad('지표', LABEL_WIDTH)}가중치  ${shown.map((entry) => padStart(String(entry.index), 5)).join('')}${wide ? '   무엇을 재는가' : ''}`}
      </Text>
      {parts.map((part, index) => {
        const on = index === selected
        return (
          <Text key={part.key} wrap="truncate">
            <Text color="cyan" bold>{on ? '> ' : '  '}</Text>
            <Text color={PART_COLOR[part.key]}>{pad(`${BLOCKS[part.key]} ${part.label}`, LABEL_WIDTH)}</Text>
            <Text color={on ? 'white' : 'gray'} bold>{String(part.weight).padStart(5)}</Text>
            <Text color="gray">{'   '}</Text>
            {/* 계정마다 이 지표의 원값. 가중치를 곱하기 전이라 지표끼리 견줄 수 있다. */}
            {shown.map((entry) => (
              <Text key={entry.row.id} color="gray">
                {padStart(entry.score.parts[index]?.raw ?? '', 5)}
              </Text>
            ))}
            {wide ? <Text color="gray">{`   ${part.what}`}</Text> : null}
          </Text>
        )
      })}
      {wide ? null : <Text color="gray" wrap="truncate">{`  ${parts[selected]?.what ?? ''}`}</Text>}
      <Text color="gray" wrap="truncate">{`  ${parts[selected]?.how ?? ''}  (위아래로 고르고 좌우로 가중치를 바꿉니다)`}</Text>
      <Text wrap="truncate">
        <Text color="gray">{'  전환  '}</Text>
        <Text color={decision?.action === 'switch' ? 'green' : 'gray'}>
          {decision
            ? `${decision.action === 'switch' ? `옮김[${decision.why}] ` : ''}${decision.reason}`
            : '판단 전'}
        </Text>
      </Text>
    </Box>
  )
}
