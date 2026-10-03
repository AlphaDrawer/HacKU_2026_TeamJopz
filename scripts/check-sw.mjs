// SW 静态逻辑验证：在 Node 里加载 public/sw.js 的纯函数（runtimeBucket / URL 解析）
// 不启动浏览器，只验证「路径 → 缓存桶」分类与子路径作用域拼接是否正确。
import { readFileSync } from 'node:fs'

const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')

// 抽出 runtimeBucket 函数体单独求值（它不依赖 SW 全局）
const bucketSrc = sw.match(/function runtimeBucket\(url\) \{[\s\S]*?\n\}/)[0]
const versionMatch = sw.match(/const VERSION = '([^']+)'/)
const V = versionMatch[1]
const prelude = `const MODEL_CACHE='gaittrace-models-${V}';const WASM_CACHE='gaittrace-wasm-${V}';`
const runtimeBucket = new Function(`${prelude}${bucketSrc}; return runtimeBucket;`)()

const cases = [
  // Pages 子路径部署
  ['https://u.github.io/HacKU_2026_TeamJopz/models/pose_landmarker_lite.task', 'MODEL'],
  ['https://u.github.io/HacKU_2026_TeamJopz/wasm/vision_wasm_internal.wasm', 'WASM'],
  ['https://u.github.io/HacKU_2026_TeamJopz/wasm/vision_wasm_nosimd.js', 'WASM'],
  // 根路径部署
  ['https://h/models/pose.task', 'MODEL'],
  ['https://h/wasm/x.data', 'WASM'],
  // 非目标资源 → null
  ['https://h/assets/index-abc.js', null],
  ['https://h/index.html', null],
  // 防误伤：名字像但路径不在模型目录
  ['https://h/other/pose.task', null],
]

let pass = 0
for (const [u, expectBucket] of cases) {
  const got = runtimeBucket(new URL(u))
  const ok =
    (expectBucket === null && got === null) ||
    (expectBucket === 'MODEL' && got && got.startsWith('gaittrace-models-')) ||
    (expectBucket === 'WASM' && got && got.startsWith('gaittrace-wasm-'))
  console.log(ok ? 'PASS' : 'FAIL', u, '->', got)
  if (ok) pass += 1
}

// 验证作用域 URL 拼接（模拟 self.registration.scope 在子路径下）
const SCOPE_BASE = new URL('https://u.github.io/HacKU_2026_TeamJopz/')
const scopeUrl = (path) => new URL(path.replace(/^\.?\//, ''), SCOPE_BASE).href
const scoped = [
  ['./', 'https://u.github.io/HacKU_2026_TeamJopz/'],
  ['index.html', 'https://u.github.io/HacKU_2026_TeamJopz/index.html'],
  ['/manifest.webmanifest', 'https://u.github.io/HacKU_2026_TeamJopz/manifest.webmanifest'],
]
for (const [p, expected] of scoped) {
  const got = scopeUrl(p)
  const ok = got === expected
  console.log(ok ? 'PASS' : 'FAIL', 'scopeUrl', p, '->', got)
  if (ok) pass += 1
}

console.log(`\n${pass}/${cases.length + scoped.length} checks passed`)
process.exit(pass === cases.length + scoped.length ? 0 : 1)
