/**
 * 사람이 고를 수 있는 값.
 *
 * 상수 중에는 바꿔서는 안 되는 것이 섞여 있다. 5시간 창을 채우면 주간이 20%p
 * 오른다는 것은 측정된 사실이고, 요청 간격과 백오프는 서버에 대한 예의이며,
 * OAuth 엔드포인트는 바꾸면 그냥 안 된다. 여기 있는 것은 "언제부터 위험으로
 * 볼까" 처럼 쓰는 사람에 따라 갈리는 판단 기준뿐이다.
 *
 * step 은 한 번 누를 때 움직이는 폭이다. min 과 max 는 그 값이 뜻을 잃는
 * 자리에서 끊는다.
 */
export const TUNABLES = [
  {
    key: 'intervalMs',
    label: '조회 주기',
    unit: '초',
    min: 60_000,
    max: 600_000,
    step: 30_000,
    scale: 1000,
    hint: '사용량 API 한도는 계정당 5분에 5회',
  },
  {
    key: 'switchAt',
    label: '전환 기준',
    unit: '%',
    min: 50,
    max: 95,
    step: 5,
    hint: '사용 중 계정이 이 값을 넘으면 전환',
  },
  {
    key: 'switchMargin',
    label: '전환 여유',
    unit: '%p',
    min: 5,
    max: 40,
    step: 5,
    hint: '전환 대상에 필요한 최소 여유',
  },
  {
    key: 'switchCooldownMs',
    label: '재전환 간격',
    unit: '분',
    min: 60_000,
    max: 3_600_000,
    step: 60_000,
    scale: 60_000,
    hint: '전환 뒤 재전환까지의 최소 간격',
  },
  {
    key: 'blockedAt',
    label: '한도 임박',
    unit: '%',
    min: 70,
    max: 99,
    step: 1,
    hint: '이 값 이상은 추천에서 제외',
  },
  {
    key: 'spareAt',
    label: '사용 자제',
    unit: '%',
    min: 30,
    max: 80,
    step: 5,
    hint: '주간 사용률이 이 값 이상이면 아껴 둘 계정',
  },
  {
    key: 'wasteAlert',
    label: '뒤처짐 기준',
    unit: '%p',
    min: 5,
    max: 40,
    step: 5,
    hint: '창 경과 대비 사용 격차의 알림 기준',
  },
  {
    key: 'openCooldownMs',
    label: '창 열기 간격',
    unit: '분',
    min: 60_000,
    max: 3_600_000,
    step: 60_000,
    scale: 60_000,
    hint: '같은 계정의 창 열기 재요청 간격',
  },
  {
    key: 'weightBehind',
    label: '가중치 뒤처짐',
    unit: '',
    min: 0,
    max: 60,
    step: 5,
    hint: '주간 창 경과 대비 덜 쓴 양',
  },
  {
    key: 'weightNow',
    label: '가중치 단기',
    unit: '',
    min: 0,
    max: 60,
    step: 5,
    hint: '5h 창의 남은 양',
  },
  {
    key: 'weightReserve',
    label: '가중치 여력',
    unit: '',
    min: 0,
    max: 60,
    step: 5,
    hint: '주간 창의 남은 양',
  },
  {
    key: 'logKeep',
    label: '기록 보관',
    unit: '건',
    min: 100,
    max: 2000,
    step: 100,
    hint: '이보다 오래된 기록 삭제',
  },
]

export const TUNING_DEFAULTS = {
  intervalMs: 120_000,
  switchAt: 80,
  switchMargin: 15,
  switchCooldownMs: 10 * 60_000,
  blockedAt: 90,
  spareAt: 50,
  wasteAlert: 15,
  openCooldownMs: 10 * 60_000,
  weightBehind: 40,
  weightNow: 35,
  weightReserve: 25,
  logKeep: 500,
}

let current = { ...TUNING_DEFAULTS }

/** 지금 값. 모듈들이 상수 대신 이것을 읽는다. */
export function tuning() {
  return current
}

/** 아는 키만, 범위 안으로 넣는다. 손으로 고친 설정 파일이 화면을 깨뜨리면 안 된다. */
export function applyTuning(patch) {
  const next = { ...current }
  for (const item of TUNABLES) {
    const value = patch?.[item.key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    next[item.key] = Math.min(item.max, Math.max(item.min, value))
  }
  current = next
  return current
}

/** 화면에 적을 값. 초나 분으로 나눠 보이는 것들이 있다. */
export function formatTuning(item, value) {
  const scaled = item.scale ? value / item.scale : value
  return `${Math.round(scaled)}${item.unit}`
}
