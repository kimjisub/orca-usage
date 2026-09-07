import React from 'react'
import { Box, Text } from 'ink'
import { cellWidth } from '../format.js'
import { colorForSeries } from '../chart.js'
import { tuning } from '../tuning.js'

const NAME_WIDTH = 13
const BAR_WIDTH = 22
// 지표마다 색을 고정한다. 막대와 아래 가중치 줄이 같은 색이라 눈으로 이어진다.
const PART_COLOR = { waste: 'red', urgency: '#ff9f0a', now: 'green', reserve: 'cyan' }
const BLOCKS = ['█', '▓', '▒', '░']

const pad = (text, width) => text + ' '.repeat(Math.max(0, width - cellWidth(text)))

/** 한 계정의 점수를 지표별로 쌓은 막대. 어느 지표가 얼마나 밀었는지가 폭이다. */
function ScoreBar({ parts }) {
  const cells = []
  parts.forEach((part, index) => {
    const width = Math.round((part.value / 100) * BAR_WIDTH)
    for (let at = 0; at < width; at += 1) {
      cells.push(<Text key={`${part.key}-${at}`} color={PART_COLOR[part.key]}>{BLOCKS[index]}</Text>)
    }
  })
  const rest = BAR_WIDTH - cells.length
  return (
    <>
      {cells}
      <Text color="gray">{' '.repeat(Math.max(0, rest))}</Text>
    </>
  )
}

/**
 * 왜 이 계정인지.
 *
 * 예전에는 소멸, 급함, 당장, 여력을 순서대로 보고 앞이 갈리면 뒤를 안 봤다.
 * 그래서 순위는 나왔지만 근거가 화면에 없었고, 1%p 소멸 하나로 여력 없는
 * 계정이 뽑히는 일도 있었다. 지금은 넷에 가중치를 곱해 더하고, 그 내역을
 * 그대로 보여 준다. 가중치는 설정에서 바꾼다.
 */
export function Score({ scored, activeId, useId, decision, height }) {
  const ranked = [...scored].sort((a, b) => b.score.total - a.score.total)
  const shown = ranked.slice(0, Math.max(1, height - 4))
  const weights = tuning()
  const labels = shown[0]?.score.parts ?? []

  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        <Text color="white">{'판정'}</Text>
        <Text color="gray">{'  네 지표에 가중치를 곱해 더한 점수다'}</Text>
      </Text>
      {shown.map((entry) => {
        const active = entry.row.id === activeId
        const best = entry.row.id === useId
        return (
          <Text key={entry.row.id} wrap="truncate">
            <Text color="yellow" bold>{active ? '* ' : '  '}</Text>
            <Text color={colorForSeries(entry.index - 1)} bold>{String(entry.index)}</Text>
            <Text color={best ? 'green' : 'white'}>{` ${pad(entry.email.split('@')[0], NAME_WIDTH - 3)}`}</Text>
            <Text color={best ? 'green' : 'white'} bold>{String(Math.round(entry.score.total)).padStart(3)}</Text>
            <Text color="gray">{'  '}</Text>
            <ScoreBar parts={entry.score.parts} />
            <Text color="gray">
              {`  ${entry.score.parts.map((part) => Math.round(part.value)).join(' ')}`}
            </Text>
          </Text>
        )
      })}
      <Text> </Text>
      <Text wrap="truncate">
        <Text color="gray">{'가중치  '}</Text>
        {labels.map((part) => (
          <Text key={part.key} color={PART_COLOR[part.key]}>
            {`${part.label} ${weights[`weight${part.key[0].toUpperCase()}${part.key.slice(1)}`] ?? part.weight}  `}
          </Text>
        ))}
      </Text>
      <Text wrap="truncate">
        <Text color="gray">{'전환    '}</Text>
        <Text color={decision?.action === 'switch' ? 'green' : 'gray'}>
          {decision ? `${decision.action === 'switch' ? `옮김[${decision.why}] ` : ''}${decision.reason}` : '판단 전'}
        </Text>
      </Text>
    </Box>
  )
}
