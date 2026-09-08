import React from 'react'
import { Box, Text } from 'ink'
import { cellWidth } from '../format.js'

// 한 줄에 제목과 설명. 제목 폭을 맞춰 세로가 줄로 읽힌다. 한글은 두 칸이라
// padEnd 로는 안 맞는다.
const TOPIC_WIDTH = 13
const pad = (text, width) => text + ' '.repeat(Math.max(0, width - cellWidth(text)))

const SECTIONS = [
  {
    title: '이 도구가 하는 일',
    lines: [
      ['', 'Orca 가 관리하는 Claude 와 Codex 계정의 한도를 한 화면에 놓고, 언제 어느 계정을 쓸지 답한다. 조회와 토큰 갱신, 창 열기, 계정 전환까지 스스로 하고 그 기록을 남긴다.'],
    ],
  },
  {
    title: '화면',
    lines: [
      ['왼쪽', '계정마다 창별 사용률. 별표가 지금 붙어 있는 계정이다.'],
      ['사용량', '창별 사용률의 추이.'],
      ['소비', '시간당 몇 %p 를 태우고 있나.'],
      ['일정', '앞으로 7일 중 언제 일할 수 있고 언제 막히나.'],
      ['판정', '계정 점수와 그 내역. 여기서 가중치를 바로 옮긴다.'],
      ['기록', '이 도구가 스스로 한 일. 실패는 빨간 글씨다.'],
      ['설정', '판단 기준을 고친다.'],
    ],
  },
  {
    title: '스스로 하는 일',
    lines: [
      ['조회', 'Orca 가 이미 조회해 둔 값을 받는다. Orca 가 없으면 직접 친다.'],
      ['토큰 갱신', '만료된 지 한 시간 넘은 것만. 나머지는 Orca 몫이다.'],
      ['사이클', '닫힌 5h 나 7d 창을 요청 하나로 연다. o 로 켠다.'],
      ['전환', '활성이 임계를 넘으면 여유로운 계정으로 옮긴다. a 로 켠다.'],
    ],
  },
  {
    title: '배지',
    lines: [
      ['우선 사용', '지금 붙기 가장 좋은 계정.'],
      ['소진 권장', '창이 흐른 것보다 뒤처져 있다. 지금 태워야 한다.'],
      ['사용 자제', '창이 흐른 것보다 앞서 썼다. 이대로면 바닥이 난다.'],
      ['한도 임박', '5h 나 7d 가 임계를 넘어 지금은 못 쓴다.'],
      ['이름 빨강', '자격증명이 끊겼다. Orca 에서 다시 로그인해야 한다.'],
    ],
  },
]

/** 폭에 맞춰 낱말 경계에서 끊는다. 자르면 문장이 통째로 뜻을 잃는다. */
function wrap(text, width) {
  const lines = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (cellWidth(next) > width && line) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

/** 제품 설명. --help 와 같은 내용을 화면 안에서 본다. */
export function Help({ height, columns }) {
  const body = Math.max(10, columns - TOPIC_WIDTH)
  const rows = []
  for (const section of SECTIONS) {
    rows.push({ title: section.title })
    for (const [topic, text] of section.lines) {
      // 제목이 없는 항목은 본문이 왼쪽부터 흐른다. 제목 자리를 비워 두면 좁은
      // 화면에서 글이 들어갈 폭이 그만큼 줄어든다.
      const width = topic ? body : Math.max(10, columns - 2)
      wrap(text, width).forEach((line, index) => rows.push({
        topic: index ? '' : topic, text: line, flush: !topic,
      }))
    }
    rows.push({ blank: true })
  }
  return (
    <Box flexDirection="column">
      {rows.slice(0, Math.max(1, height)).map((row, index) => {
        if (row.blank) return <Text key={index}> </Text>
        if (row.title) return <Text key={index} color="white" bold wrap="truncate">{row.title}</Text>
        return (
          <Text key={index} wrap="truncate">
            <Text color="cyan">{row.flush ? '  ' : `  ${pad(row.topic, TOPIC_WIDTH - 2)}`}</Text>
            <Text color="gray">{row.text}</Text>
          </Text>
        )
      })}
    </Box>
  )
}
