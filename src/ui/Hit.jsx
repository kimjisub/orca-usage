import React, { useEffect, useRef } from 'react'
import { Box, useBoxMetrics } from 'ink'

/**
 * 클릭 대상 한 덩어리. 자기가 화면 어디에 그려졌는지 스스로 재서 알린다.
 *
 * 행 번호를 손으로 세면 여백 한 줄만 빠져도 그 아래가 통째로 밀린다. 창을
 * 접거나 계정이 늘 때마다 다시 맞춰야 하고, 어긋난 것은 클릭해 보기 전에는
 * 모른다. ink 가 배치하고 나서 실제 좌표를 읽으면 그 계산이 없어진다.
 *
 * top 은 부모 기준이라 컨테이너의 절대 위치와 더해야 화면 행이 된다.
 */
export function Hit({ id, onMeasure, children }) {
  const ref = useRef(null)
  const metrics = useBoxMetrics(ref)
  const { top, height, hasMeasured } = metrics

  useEffect(() => {
    if (hasMeasured) onMeasure(id, top, height)
  }, [id, top, height, hasMeasured, onMeasure])

  return <Box ref={ref} flexDirection="column">{children}</Box>
}

/** 컨테이너의 절대 위치를 알린다. 자식들의 top 은 여기에 얹힌다. */
export function HitRoot({ onMeasure, children, ...boxProps }) {
  const ref = useRef(null)
  const { top, hasMeasured } = useBoxMetrics(ref)

  useEffect(() => {
    if (hasMeasured) onMeasure(top)
  }, [top, hasMeasured, onMeasure])

  return <Box ref={ref} {...boxProps}>{children}</Box>
}
