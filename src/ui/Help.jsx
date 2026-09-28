import React from 'react'
import { Box, Text } from 'ink'
import { cellWidth } from '../core/format.js'

// 한 줄에 제목과 설명. 제목 폭을 맞춰 세로가 줄로 읽힌다. 한글은 두 칸이라
// padEnd 로는 안 맞는다.
const TOPIC_WIDTH = 13
const pad = (text, width) => text + ' '.repeat(Math.max(0, width - cellWidth(text)))

const SECTIONS = [
  {
    title: '개요',
    lines: [
      ['', 'Orca 가 관리하는 Claude 와 Codex 계정의 한도를 한 화면에 모으고, 지금 어느 계정을 쓸지 추천합니다. 조회, 토큰 갱신, 창 열기, 계정 전환은 백엔드가 하고 그 기록을 남깁니다.'],
    ],
  },
  {
    title: '백엔드와 화면',
    lines: [
      ['백엔드', 'launchd 가 띄워 두는 프로세스입니다. 화면을 닫아도 조회, 토큰 갱신, 전환을 계속합니다. 모든 상태의 정본입니다.'],
      ['화면', '백엔드가 하는 일을 보여 주고 누른 키를 전달합니다. 스스로 판단하지 않습니다. 보고 있는 탭과 기간은 메모리에만 있어 다시 켜면 처음으로 돌아갑니다.'],
      ['등록', '화면은 백엔드를 띄우지 않습니다. 등록돼 있지 않으면 화면을 열기 전에 설치 여부를 묻습니다. 머리글의 수동 실행 백엔드 는 터미널에서 daemon run 으로 띄운 것이라 그 터미널을 닫으면 멈춥니다.'],
      ['연결 끊김', '백엔드 연결 끊김 이 뜨면 2초마다 재연결하고, 세 번 실패하면 launchd 에 백엔드 기동을 요청합니다.'],
      ['알림', '자동 전환과 재로그인이 필요한 계정을 macOS 알림으로 알립니다. 설정 탭에서 끕니다.'],
      ['상태 확인', '터미널에서 orca-usage status 로 백엔드 상태를, orca-usage daemon logs 로 로그를 봅니다.'],
    ],
  },
  {
    title: '화면 구성',
    lines: [
      ['계정 목록', 'provider 마다 합계 막대가 있고 그 아래 계정별 창이 이어집니다. 별표는 지금 사용 중인 계정입니다. 넓은 화면에서는 왼쪽에, 좁은 화면에서는 계정 탭에 있습니다.'],
      ['사용량', '창별 사용률 추이.'],
      ['소비', '시간당 사용률 증가량(%p/h).'],
      ['상세', '사용량 조회 시각, access token 과 refresh token 의 만료와 상태. 합계 줄을 고르면 전 계정을 비교합니다. 길면 PgUp, PgDn 으로 넘깁니다.'],
      ['일정', '앞으로 7일 동안 쓸 수 있는 시간과 막히는 시간.'],
      ['판정', '계정 점수와 내역. 가중치를 여기서 바로 바꿉니다.'],
      ['기록', '백엔드가 한 일. 실패는 빨간색입니다. 위아래로 한 줄, PgUp, PgDn 으로 한 쪽씩 넘깁니다.'],
      ['설정', '판단 기준과 알림. 값은 백엔드가 저장합니다.'],
      ['탭 이동', '좌우 화살표 또는 탭 클릭. 탭 줄이 다 안 들어가면 가려진 쪽에 < > 가 붙습니다.'],
      ['대상 계정', '좁은 화면의 사용량, 소비, 상세 탭은 탭 줄 아래 대상 줄의 계정을 그립니다. 위아래로 바꿉니다.'],
      ['값 수정', '설정과 판정에서는 Enter 로 수정 모드에 들어가야 좌우가 값을 바꿉니다. Esc 로 나옵니다.'],
    ],
  },
  {
    title: 'r  전체 재조회',
    lines: [
      ['기능', 'Orca 에 지금 다시 조회하도록 요청하고 결과를 받습니다. 캐시가 최신이어도 건너뛰지 않습니다.'],
      ['사용 시점', '화면의 숫자가 오래됐다고 의심될 때. 이름 옆에 3h 전 값 처럼 붙은 계정이 대상입니다.'],
      ['비용', '사용량 API 한도는 계정당 5분에 5회입니다. 이 한 번도 그 한도에서 빠지고, 넘기면 그 계정만 몇 분간 조회가 보류됩니다.'],
      ['자동 조회', '누르지 않아도 조회 주기(기본 2분)마다 돕니다. 다음 조회까지 남은 시간은 머리글 오른쪽에 있습니다.'],
      ['계정 목록', '조회마다 함께 다시 읽습니다. Orca 에서 계정을 더하거나 빼도 다시 띄울 필요가 없습니다. 합류한 계정은 기록에 남습니다.'],
    ],
  },
  {
    title: 't  토큰 갱신',
    lines: [
      ['기능', '고른 Claude 계정의 access token 을 refresh token 으로 다시 발급받아 키체인에 씁니다. refresh token 도 이때 새것으로 바뀝니다.'],
      ['조건', '만료 후 1시간이 지난 계정만 됩니다. 유효한 토큰은 거절합니다.'],
      ['이유', 'Orca 와 이 도구가 같은 refresh token 을 함께 쓰면 교체 과정에서 한쪽이 폐기됩니다. 그래서 평소에는 Orca 에 맡깁니다. Orca 는 사용 중인 계정만 갱신해 안 쓰는 계정은 만료된 채 남습니다. 만료 후 1시간이 지나면 Orca 가 갱신하지 않는 것으로 봅니다.'],
      ['사용 시점', '백엔드가 조회마다 그런 토큰을 갱신합니다. 다음 조회를 기다리지 않고 지금 할 때만 누릅니다.'],
      ['Codex', '해당 없음. Codex 토큰은 Orca 와 Codex 가 관리합니다.'],
    ],
  },
  {
    title: 'a  자동 전환',
    lines: [
      ['기능', '사용 중 계정이 한도에 가까워지면 Orca 를 여유로운 계정으로 전환합니다. Claude 계정 사이에서만 동작합니다.'],
      ['조건', '사용 중 계정의 가장 높은 창(5h 또는 7d)이 전환 기준을 넘고, 대상 계정이 전환 여유만큼 더 여유로울 때. 두 값은 설정에서 바꿉니다.'],
      ['기타 사유', '대상 계정의 주간 한도가 리셋 전에 소멸할 예정일 때, 사용 중 계정을 아껴야 할 때, 점수 차가 전환 여유 이상일 때도 전환합니다. 전환 사유는 판정 탭의 전환 줄과 기록에 남습니다.'],
      ['재전환 간격', '전환 뒤 이 시간 동안은 다시 전환하지 않습니다. 수동 전환도 포함하고, 백엔드를 다시 띄워도 이어집니다.'],
      ['숨김', '숨긴 계정으로는 전환하지 않습니다.'],
      ['한계', '이미 열린 터미널은 이전 계정을 계속 씁니다. 전환된 계정은 다음에 여는 세션부터 적용됩니다.'],
      ['기본값', '꺼짐. 수동 전환은 계정을 고르고 Enter.'],
    ],
  },
  {
    title: 'o  창 미리 열기',
    lines: [
      ['기능', '5h 나 7d 창이 닫혀 있는 Claude 계정에 가장 싼 모델로 토큰 하나짜리 요청을 보내 창을 엽니다.'],
      ['이유', '두 창은 첫 요청부터 시간이 흐릅니다. 안 쓰는 계정은 창이 멈춰 있다가, 쓰기 시작한 때부터 5시간이나 7일을 온전히 기다려야 합니다. 미리 열어 두면 리셋이 주기적으로 와서 필요할 때 바로 씁니다.'],
      ['비용', '사용률 1% 미만이라 화면에는 0 으로 보입니다. 같은 계정에는 창 열기 간격 안에 다시 보내지 않습니다.'],
      ['기본값', '꺼짐. 켜면 조회마다 확인합니다. 토큰 갱신은 이 설정과 무관하게 늘 동작합니다.'],
    ],
  },
  {
    title: 'u  업데이트',
    lines: [
      ['기능', '백엔드가 최신 코드를 받고 재시작합니다. 백엔드 버전이 바뀌면 화면도 새 코드로 재시작합니다.'],
      ['사용법', '받을 업데이트가 있으면 머리글에 업데이트 있음 (u) 가 뜹니다. u 를 누르고 3초 안에 한 번 더 누릅니다. 없다고 알고 있으면 u 한 번에 다시 확인합니다.'],
      ['확인 주기', '백엔드 시작 시와 6시간마다. 터미널에서는 orca-usage update.'],
    ],
  },
  {
    title: '나머지 키',
    lines: [
      ['w', '그래프 기간 변경. 3시간부터 한 달까지 돌아갑니다.'],
      ['x  X', 'x 는 계정을 목록, 합계, 추천에서 숨깁니다. X 는 숨긴 계정을 잠시 펼칩니다. 조회와 기록은 그대로라 다시 꺼내도 그래프가 이어집니다.'],
      ['1-9', '계정 번호로 바로 선택. 0 은 맨 위 합계 줄입니다.'],
      ['Enter', '고른 계정으로 Orca 전환. 설정과 판정에서는 수정 모드를 여닫습니다.'],
      ['PgUp PgDn', '상세, 기록, 도움말을 한 쪽씩 넘깁니다.'],
      ['종료', 'q 는 바로, Ctrl+C 와 Esc 는 두 번 눌러야 종료합니다. 화면만 종료되고 백엔드는 계속 돕니다.'],
    ],
  },
  {
    title: '계정 표시',
    lines: [
      ['*', 'Orca 가 지금 사용 중인 계정. provider 마다 따로입니다.'],
      ['[Max 20x]', '이름 뒤 대괄호는 요금제입니다. Claude 와 Codex 모두 표시합니다.'],
      ['빨간 이름', '자격증명 만료나 폐기. Orca 에서 다시 로그인해야 합니다.'],
      ['재로그인 필요', 'Claude 계정의 refresh token 이 3일 안에 만료됩니다. 기한은 로그인 때 정해지고(약 30일) 토큰 갱신으로는 늘지 않습니다. Orca 를 쓰지 않는 Claude Code 도 같습니다. Orca 에서 그 계정으로 다시 로그인하면 새 기한이 잡힙니다. 3일, 1일, 6시간 전과 만료 시점에 macOS 알림도 옵니다.'],
      ['Codex 토큰', 'refresh token 기한이 없고 쓰는 동안 Codex 가 갱신해 이어 갑니다. 1회용이라 두 곳이 같은 토큰으로 갱신하면 한쪽이 끊기므로 orca-usage 는 읽기만 합니다. 쓰지 않는 계정의 access token 이 만료돼 있는 것은 정상입니다.'],
      ['리셋 크레딧', 'Codex 전용. 쓰면 짧은 창이 즉시 비워집니다.'],
      ['기본 로그인', 'Orca 가 관리하지 않는 Codex 로그인(~/.codex/auth.json). 이 계정으로의 전환은 Orca 앱에서 합니다.'],
      ['추천', '지금 쓸 계정과 아낄 계정은 계정 목록 아래 추천 줄에 있습니다.'],
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
        {rows.length > visible ? <Text color="cyan">{'  위아래: 한 줄  PgUp, PgDn: 한 쪽'}</Text> : null}
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
