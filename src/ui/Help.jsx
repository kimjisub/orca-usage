import React from 'react'
import { Box, Text } from 'ink'
import { cellWidth } from '../core/format.js'

// 한 줄에 제목과 설명. 제목 폭을 맞춰 세로가 줄로 읽힌다. 한글은 두 칸이라
// padEnd 로는 안 맞는다.
const TOPIC_WIDTH = 13
const pad = (text, width) => text + ' '.repeat(Math.max(0, width - cellWidth(text)))

const SECTIONS = [
  {
    title: '이 도구가 하는 일',
    lines: [
      ['', 'Orca 가 관리하는 Claude 와 Codex 계정의 한도를 한 화면에 놓고, 언제 어느 계정을 쓸지 답한다. 조회와 토큰 갱신, 창 열기, 계정 전환은 백엔드가 하고 그 기록을 남긴다.'],
    ],
  },
  {
    title: '백엔드와 이 화면',
    lines: [
      ['백엔드', 'launchd 가 띄워 두는 프로세스. 화면을 닫아도 조회와 재인증, 전환을 계속한다. 모든 상태의 정본이다.'],
      ['이 화면', '백엔드가 하는 일을 보여 주고 누른 키를 전한다. 스스로 판단하지 않는다. 보고 있는 탭과 기간은 메모리에만 두어 다시 켜면 처음으로 돌아간다.'],
      ['등록', '머리글에 launchd 미등록 이 뜨면 이 화면이 띄운 백엔드라 재부팅하면 사라진다. orca-usage daemon install 로 등록한다.'],
      ['끊김', '백엔드 연결 끊김 이 뜨면 2초마다 다시 붙고, 세 번 못 붙으면 백엔드를 다시 띄운다.'],
      ['알림', '자동으로 계정을 옮겼을 때와 다시 로그인해야 하는 계정을 찾았을 때 macOS 알림을 띄운다. 설정 탭에서 끈다.'],
      ['상태', '터미널에서 orca-usage status 로 백엔드의 상태를, orca-usage daemon logs 로 로그를 본다.'],
    ],
  },
  {
    title: '화면',
    lines: [
      ['왼쪽', 'provider 마다 합계 막대가 서고 그 아래 계정별 창이 온다. 별표가 지금 붙어 있는 계정이다.'],
      ['사용량', '창별 사용률의 추이.'],
      ['소비', '시간당 몇 %p 를 태우고 있나.'],
      ['일정', '앞으로 7일 중 언제 일할 수 있고 언제 막히나.'],
      ['판정', '계정 점수와 그 내역. 여기서 가중치를 바로 옮긴다.'],
      ['기록', '이 도구가 스스로 한 일. 실패는 빨간 글씨다. 위아래로 굴리고 PgUp PgDn 으로 한 쪽씩 넘긴다.'],
      ['설정', '판단 기준과 알림을 고친다. 값은 백엔드가 저장한다.'],
      ['패널 이동', '좌우 화살표로 옮기거나 탭을 누른다.'],
      ['값 고치기', '설정과 판정에서는 Enter 로 수정모드에 들어가야 좌우가 값을 바꾼다. Esc 로 닫는다.'],
    ],
  },
  {
    title: 'r  전체 재조회',
    lines: [
      ['하는 일', 'Orca 에 지금 다시 조회하라고 시키고 그 결과를 받아 온다. 캐시가 신선해도 건너뛰지 않는다.'],
      ['언제', '화면의 숫자가 낡았다고 의심될 때. 이름 옆에 "3시간 전 값" 이 붙어 있으면 그 계정이다.'],
      ['비용', '사용량 엔드포인트는 계정당 5분에 5회다. 이 한 번이 그 예산에서 나가고, 넘기면 그 계정만 백오프에 걸려 몇 분간 값이 안 바뀐다.'],
      ['평소', '누르지 않아도 조회 주기(기본 2분)마다 스스로 돈다. 다음 조회까지 남은 시간은 머리글 오른쪽에 있다.'],
      ['계정 목록', '조회마다 함께 다시 읽는다. Orca 에서 계정을 더하거나 빼도 아무것도 다시 띄울 필요가 없다. 합류한 계정은 기록에 남는다.'],
    ],
  },
  {
    title: 't  토큰 갱신',
    lines: [
      ['하는 일', '고른 Claude 계정의 access token 을 refresh token 으로 다시 발급해 키체인에 써넣는다.'],
      ['조건', '만료된 지 한 시간 넘은 계정만 된다. 살아 있는 토큰은 거절한다.'],
      ['왜', 'Orca 와 우리가 같은 refresh token 을 함께 돌리면 rotation 에 한쪽이 revoke 된다. 그래서 평소에는 Orca 에 맡긴다. 다만 Orca 는 지금 쓰는 계정만 돌려서 안 쓰는 계정은 만료된 채 남는다. 한 시간이 지났으면 Orca 가 손을 놓은 것으로 본다.'],
      ['언제', '백엔드가 조회마다 그런 토큰을 갱신하므로, 다음 조회를 기다리지 않고 지금 할 때만 누른다.'],
      ['Codex', '해당 없다. Codex 토큰은 Orca 만 다룬다.'],
    ],
  },
  {
    title: 'a  자동 계정 전환',
    lines: [
      ['하는 일', '붙어 있는 계정이 한계에 가까워지면 Orca 를 여유로운 계정으로 옮긴다. Claude 계정 사이에서만 돈다.'],
      ['조건', '활성 계정의 가장 빡빡한 창(5h 나 7d)이 전환 임계를 넘고, 갈 곳이 전환 여유차만큼 더 여유로울 때. 두 값 다 설정에서 고친다.'],
      ['그밖에', '갈 곳의 주간 쿼터가 리셋에 그냥 사라질 판이거나, 활성을 아껴야 하거나, 점수가 여유차만큼 높아도 옮긴다. 왜 옮겼는지는 판정 탭의 전환 줄과 기록에 남는다.'],
      ['쿨다운', '한 번 옮기면 그만큼은 다시 옮기지 않는다. 손으로 옮긴 것도 세고, 백엔드를 다시 띄워도 이어진다.'],
      ['숨김', '숨긴 계정으로는 옮기지 않는다.'],
      ['한계', '이미 떠 있는 터미널은 옛 계정으로 계속 돈다. 바뀐 계정은 그다음에 여는 세션부터다.'],
      ['기본', '꺼져 있다. 손으로 옮길 때는 계정을 고르고 Enter 다.'],
    ],
  },
  {
    title: 'o  창 미리 열기',
    lines: [
      ['하는 일', '5h 나 7d 창이 닫혀 있는 Claude 계정에 가장 싼 모델로 토큰 하나짜리 요청을 보내 창을 연다.'],
      ['왜', '두 창은 첫 요청에서야 시계가 돈다. 안 쓰는 계정은 시계가 서 있다가, 나중에 쓰기 시작한 때부터 다섯 시간이나 이레를 온전히 기다려야 한다. 미리 열어 두면 리셋이 주기적으로 와서 필요할 때 바로 쓴다.'],
      ['비용', '사용률 정수 단위 아래라 화면에는 0 으로 보인다. 같은 계정에는 쿨다운 안에 다시 보내지 않는다.'],
      ['기본', '꺼져 있다. 켜면 조회마다 확인한다. 토큰 재인증은 이것과 무관하게 늘 돈다.'],
    ],
  },
  {
    title: 'u  업데이트',
    lines: [
      ['하는 일', '백엔드가 최신 코드를 받고 다시 뜬다. 새 백엔드에 다시 붙으면 이 화면도 새 코드로 다시 뜬다.'],
      ['누르기', '받을 것이 있으면 머리글에 업데이트 있음 (u) 가 뜬다. u 를 누르고 3초 안에 한 번 더 누른다. 받을 것이 없다고 알고 있으면 u 한 번에 지금 다시 확인한다.'],
      ['확인', '백엔드가 켤 때와 6시간마다 확인한다. 터미널에서는 orca-usage update.'],
    ],
  },
  {
    title: '나머지 키',
    lines: [
      ['w', '그래프 기간을 3시간부터 한 달까지 돌린다.'],
      ['x  X', 'x 로 안 쓰는 계정을 목록과 합계와 판단에서 뺀다. X 로 숨긴 것을 잠깐 펼쳐 본다. 조회와 기록은 그대로라 다시 꺼내도 그래프가 이어진다.'],
      ['1-9', '계정 번호로 바로 고른다. 0 은 맨 위 합계 줄이다.'],
      ['Enter', '고른 계정으로 Orca 를 옮긴다. 설정과 판정 화면에서는 수정모드를 여닫는다.'],
      ['끄기', 'q 는 바로, Ctrl+C 와 Esc 는 두 번 눌러야 끝난다. 이 화면만 끝나고 백엔드는 계속 돈다.'],
    ],
  },
  {
    title: '계정 표시',
    lines: [
      ['*', 'Orca 가 지금 붙어 있는 계정. provider 마다 따로다.'],
      ['[Max 20x]', '이름 뒤 대괄호는 요금제다. Claude 와 Codex 둘 다 붙는다.'],
      ['이름 빨강', '자격증명이 끊겼다. Orca 에서 다시 로그인해야 한다.'],
      ['크레딧', 'Codex 에만 있다. 쓰면 짧은 창이 즉시 비워진다.'],
      ['어느 계정', '지금 쓸 계정과 아껴둘 계정은 왼쪽 아래 추천 줄이 말한다.'],
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

/** 제목 한 줄을 뺀 본문 줄 수. 스크롤 한계를 재는 쪽과 같은 값을 쓴다. */
export const helpVisibleRows = (height) => Math.max(1, height - 1)

/**
 * 제품 설명. --help 와 같은 내용을 화면 안에서 본다.
 *
 * 한 화면에 안 들어가므로 위아래로 굴린다. offset 은 맨 위에 놓을 줄이다.
 */
/** 이 폭에서 도움말이 몇 줄이 되는지. 스크롤 한계를 재는 쪽이 같은 값을 쓴다. */
export function helpRows(columns) {
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
  return rows
}

export function Help({ offset = 0, height, columns }) {
  const rows = helpRows(columns)
  const visible = helpVisibleRows(height)
  const start = Math.min(Math.max(0, offset), Math.max(0, rows.length - visible))
  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        <Text color="white">{'도움말'}</Text>
        <Text color="gray">{`  ${rows.length}줄 중 ${start + 1}-${Math.min(rows.length, start + visible)}`}</Text>
        {rows.length > visible ? <Text color="cyan">{'  (위아래로, PgUp PgDn 으로 한 쪽씩)'}</Text> : null}
      </Text>
      {rows.slice(start, start + visible).map((row, index) => {
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
