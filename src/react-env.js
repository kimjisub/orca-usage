/**
 * 화면은 React production 빌드로 돌아야 한다.
 *
 * NODE_ENV 가 없으면 React 는 개발 빌드를 고른다. 개발 빌드는 요소를 만들
 * 때마다 디버그용 Error 스택을 붙이는데, bun(JSC)에서는 그 스택 정보가 JS 힙
 * 밖의 네이티브 메모리에 남아 GC 로 돌아오지 않는다. 화면은 1초에 세 번쯤 다시
 * 그리므로 빨리 쌓인다. 실측 2026-09-28: 사흘 띄운 화면이 상주 6.6GB, 스왑
 * 11.6GB 였고 JS 힙은 55MB 로 평평했다. 초당 20번 그리게 한 실험에서 개발
 * 빌드는 4분에 126MB 가 늘었고 production 빌드는 1MB 도 늘지 않았다.
 *
 * NODE_ENV 는 프로세스가 시작할 때부터 production 이어야 한다. bun 은 JSX 를
 * 시작 시점의 NODE_ENV 로 변환해, 개발 모드로 시작하면 jsxDEV 호출을 만든다.
 * 실행 중에 production 으로 바꾸면 React 의 production 빌드가 jsxDEV 를 비워
 * 두어(void 0) 화면이 그려지지 않는다. 그래서 실행 스크립트(orca-usage)가
 * 걸어 두고, 그것을 거치지 않고 열린 화면은 production 으로 다시 띄운다.
 *
 * React 경고를 보며 고칠 때만 ORCA_USAGE_REACT_DEV=1 로 개발 빌드를 쓴다.
 */
export function needsProductionRestart(env = process.env) {
  return env.NODE_ENV !== 'production' && !env.ORCA_USAGE_REACT_DEV
}
