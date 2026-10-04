/*
 * GaitTrace Service Worker（B-4）
 * 目标：首载并完成一次走测后，开飞行模式仍可再次走测（离线可用）。
 *
 * 缓存分层（各自版本化，互不阻塞）：
 *  - SHELL  ：页面外壳（index.html / hashed js,css / manifest），install 时预缓存；
 *  - ASSETS ：MediaPipe 的 wasm 运行时（wasm/*），runtime 按需缓存；
 *  - MODELS ：姿态模型（models/*.task，5.5MB 大文件），runtime 按需缓存；
 * 大文件一律走 runtime caching：不放进 install 的 addAll，避免一个大文件
 * 失败拖垮整个 SW 安装；首次在线走测自然触发下载并写入缓存。
 *
 * 路径作用域：以注册作用域 self.registration.scope 为基准拼 URL，
 * GitHub Pages 子路径部署同样成立（不依赖域名根）。
 */

const VERSION = 'v2'
const SHELL_CACHE = `gaittrace-shell-${VERSION}`
const WASM_CACHE = `gaittrace-wasm-${VERSION}`
const MODEL_CACHE = `gaittrace-models-${VERSION}`
const ALL_CACHES = [SHELL_CACHE, WASM_CACHE, MODEL_CACHE]

const SCOPE_BASE = new URL(self.registration.scope)
const scopeUrl = (path) => new URL(path.replace(/^\.?\//, ''), SCOPE_BASE).href

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      // 外壳核心：导航入口 + manifest。失败不致命，后续访问会补缓存。
      await Promise.allSettled([
        cache.add(scopeUrl('./')),
        cache.add(scopeUrl('index.html')),
        cache.add(scopeUrl('manifest.webmanifest')),
      ])

      // 预缓存 index.html 里引用的带哈希的 JS/CSS（Vite 入口），
      // 使第二次受控加载即可离线启动外壳。
      try {
        const response = await fetch(scopeUrl('index.html'))
        const html = await response.text()
        const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)]
          .map((m) => new URL(m[1], SCOPE_BASE).href)
          .filter((u) => new URL(u).origin === self.location.origin)
        if (assets.length) {
          await Promise.allSettled(assets.map((u) => cache.add(u)))
        }
      } catch {
        // 入口资源预取失败不影响 SW 安装
      }
    })().then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 清理所有旧版本缓存（含被改名/弃用的缓存）
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((k) => !ALL_CACHES.includes(k)).map((k) => caches.delete(k))
      )
      await self.clients.claim()
    })()
  )
})

/** 判断该请求应归入哪个 runtime 缓存；不匹配返回 null。 */
function runtimeBucket(url) {
  const { pathname } = url
  if (pathname.includes('/models/') && pathname.endsWith('.task')) {
    return MODEL_CACHE
  }
  if (pathname.includes('/wasm/') && /\.(wasm|js|data)$/.test(pathname)) {
    return WASM_CACHE
  }
  return null
}

/** 缓存优先；未命中则走网络并把成功响应写入指定缓存（stale-while-revalidate 的离线变体）。 */
async function cacheThenNetwork(request, cacheName) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) {
    const copy = response.clone()
    void caches.open(cacheName).then((cache) => cache.put(request, copy))
  }
  return response
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)

  // 只处理同源 GET；跨域（如 CDN）与非 GET 不拦截
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  const bucket = runtimeBucket(url)
  if (bucket) {
    // 模型 / wasm：缓存优先，离线直接命中
    event.respondWith(
      cacheThenNetwork(request, bucket).catch(
        async () => (await caches.match(request)) || Response.error()
      )
    )
    return
  }

  // 外壳与其余静态资源：缓存优先 + 运行时补缓存；导航离线回退 index.html
  event.respondWith(
    caches.match(request).then(async (cached) => {
      if (cached) return cached
      try {
        const response = await fetch(request)
        if (response.ok) {
          const copy = response.clone()
          void caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      } catch {
        if (request.mode === 'navigate') {
          return (
            (await caches.match(scopeUrl('index.html'))) ||
            (await caches.match(scopeUrl('./')))
          )
        }
        return Response.error()
      }
    })
  )
})
