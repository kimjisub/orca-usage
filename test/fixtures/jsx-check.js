// test/env.test.js 가 부른다. 화면이 도는 순서대로, 환경을 정한 뒤 JSX 모듈을 불러
// 요소 하나를 만들고 어느 React 빌드가 불렸는지 찍는다.
if (process.env.SET_AT_RUNTIME) process.env.NODE_ENV = 'production'
const { element } = await import('./jsx-element.jsx')
try {
  const made = element()
  // JSX 가 부른 런타임. 개발 빌드면 .development, production 이면 .production 이다.
  const build = Object.keys(require.cache).find((k) => /react\/cjs\/react-jsx/.test(k))?.split('/cjs/')[1]
  console.log(`${build} ${made.type}`)
} catch (error) {
  console.log(`실패 ${error.message}`)
}
