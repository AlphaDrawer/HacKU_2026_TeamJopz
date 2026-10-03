import { unavailableRecord, type ReportRecord } from './domain/report'
import { CameraController, CameraError } from './services/cameraController'
import { clearReports, getReports, saveReport } from './services/storage'
import { VoicePrompt } from './services/voicePrompt'

type Route = 'home' | 'setup' | 'measurement' | 'report' | 'history'
type MeasurementPhase = 'countdown' | 'walking'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('App root is missing')

const camera = new CameraController()
const voice = new VoicePrompt()
let currentRoute: Route = routeFromHash()
let cameraError = ''
let speechEnabled = readVoicePreference()
let activeRecord: ReportRecord | null = null
let saveMessage = ''
let sessionTimer = 0
let tickHandle = 0
let countdownHandle = 0

camera.onEnded = () => {
  cameraError = '相機連線已中斷。請重新允許相機後再試；本次無法產生有效測量。'
  if (currentRoute === 'measurement') navigate('setup')
}

function readVoicePreference(): boolean {
  try {
    return localStorage.getItem('gaittrace-voice') === 'true'
  } catch {
    return false
  }
}

function writeVoicePreference(enabled: boolean): void {
  try {
    localStorage.setItem('gaittrace-voice', String(enabled))
  } catch {
    // Voice is optional; a restricted storage mode must not block the app.
  }
}

function routeFromHash(): Route {
  const page = location.hash.replace(/^#\/?/, '')
  return ['setup', 'measurement', 'report', 'history'].includes(page) ? page as Route : 'home'
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

function navigate(route: Route): void {
  if (route !== currentRoute) {
    clearInterval(tickHandle)
    clearInterval(countdownHandle)
    voice.stop()
    if (route !== 'measurement') camera.stop()
    currentRoute = route
    if (location.hash !== `#/${route}`) history.pushState({}, '', `#/${route}`)
  }
  render()
}

function button(label: string, route: Route, primary = false): string {
  return `<button class="button ${primary ? 'button-primary' : 'button-secondary'}" data-route="${route}">${label}</button>`
}

function header(): string {
  return `<header class="topbar">
    <a class="brand" href="#/home" aria-label="GaitTrace 首頁" data-route="home"><span class="brand-mark">G</span><span>GaitTrace<small>步態日記</small></span></a>
    <nav aria-label="主要導覽">${button('歷史', 'history')}</nav>
  </header>`
}

function disclaimer(): string {
  return `<aside class="disclaimer"><span aria-hidden="true">ⓘ</span><p><strong>篩查，非診斷。</strong>本工具不能取代醫生或物理治療師的評估。</p></aside>`
}

function homeView(): string {
  return `<main class="page">
    <section class="hero">
      <div class="hero-copy"><p class="eyebrow">在家自我觀察 · 不需安裝</p>
        <h1>多留意一步，<br><em>了解步態變化。</em></h1>
        <p class="lead">架好手機，側身來回走一趟。當分析服務可用時，這裡會協助你追蹤步態變化。</p>
        ${button('開始準備', 'setup', true)}
        <label class="voice-toggle"><input id="voice-toggle" type="checkbox" ${speechEnabled ? 'checked' : ''}/> 開啟語音提示 <span>${voice.available ? '（亦會顯示文字提示）' : '（此瀏覽器不支援語音，將顯示文字提示）'}</span></label>
      </div>
      <div class="hero-art" aria-label="步行者插圖" role="img"><span class="orbit orbit-one"></span><span class="orbit orbit-two"></span><span class="figure-head"></span><span class="figure-body"></span><span class="figure-arm"></span><span class="figure-leg"></span><span class="art-label">LOCAL FIRST<br/>本機處理</span></div>
    </section>
    ${disclaimer()}
    <section class="trust-grid" aria-label="使用方式與私隱">
      <article class="info-card"><span class="card-icon">⌂</span><h2>在家完成</h2><p>手機瀏覽器即可使用，無需下載、註冊或建立帳號。</p></article>
      <article class="info-card"><span class="card-icon">◉</span><h2>影像不離開裝置</h2><p>相機畫面只在本機預覽；不錄影、不上傳、不保存影像。</p></article>
      <article class="info-card"><span class="card-icon">↗</span><h2>誠實呈現限制</h2><p>步態分析模型尚未接入。現階段不會提供分數或假造測量結果。</p></article>
    </section>
    <section class="walkthrough"><div><p class="eyebrow">簡單三步</p><h2>讓環境先準備好</h2></div><ol><li><b>01</b><span>把手機穩固放好，鏡頭約在膝蓋高度。</span></li><li><b>02</b><span>留出一段直線空間，讓全身都在畫面內。</span></li><li><b>03</b><span>側面走去再走回；不舒服就立即停止。</span></li></ol></section>
    <footer class="footer-note">你的步態數據僅存於這部裝置。你可以隨時清除本機歷史。</footer>
  </main>`
}

function setupView(): string {
  return `<main class="page narrow">
    <a class="back-link" href="#/home" data-route="home">← 返回首頁</a>
    <p class="eyebrow">測量前準備</p><h1 class="page-title">先把手機架穩，<br/>再開始走。</h1>
    <div class="setup-card">
      <ol class="setup-list">
        <li><span>1</span><div><strong>手機橫放並固定</strong><p>靠牆或放在穩固支架上，避免手持拍攝。</p></div></li>
        <li><span>2</span><div><strong>鏡頭約在膝蓋高度</strong><p>鏡頭對準身體側面，避免逆光；全身需完整入鏡。</p></div></li>
        <li><span>3</span><div><strong>預留直線來回空間</strong><p>從畫面一側走到另一側再返回，轉身時放慢速度。</p></div></li>
      </ol>
      <div class="privacy-callout"><span>⌑</span><div><strong>相機畫面只在此裝置預覽</strong><p>不錄影、不上傳；離開測量頁會停止相機。</p></div></div>
    </div>
    ${cameraError ? `<p class="error-box" role="alert">${escapeHtml(cameraError)}</p>` : ''}
    <div class="button-stack"><button class="button button-primary" id="enable-camera">允許相機並開始倒數</button>
      <button class="button button-secondary" id="skip-camera">不開相機，查看未測報告</button></div>
    <p class="small-note">此版本尚未接入姿態分析服務。相機預覽和計時不會產生有效步態數據或評分。</p>
  </main>`
}

function measurementView(phase: MeasurementPhase, remaining: number): string {
  const countdown = phase === 'countdown'
  const progress = countdown ? 0 : Math.min(100, ((30 - remaining) / 30) * 100)
  return `<main class="page measurement-page">
    <div class="measure-heading"><p class="eyebrow">${countdown ? '準備開始' : '走測計時'}</p><h1>${countdown ? '準備好了嗎？' : '依自己的舒適速度走。'}</h1></div>
    <div class="camera-stage ${camera.active ? '' : 'camera-stage-empty'}" data-phase="${phase}">
      ${camera.active ? '<video id="camera-preview" autoplay muted playsinline aria-label="本機相機即時預覽"></video><canvas id="skeleton-canvas" aria-hidden="true"></canvas>' : '<div class="camera-empty"><span>◉</span><strong>相機未開啟</strong><p>你可以繼續查看流程，但不會進行測量。</p></div>'}
      ${camera.active ? '<span class="local-badge">● 本機預覽</span><div class="guide-line" aria-hidden="true"></div>' : ''}
    </div>
    <div class="prompt-panel" aria-live="polite">
      <div class="timer" aria-live="off">${countdown ? (remaining > 0 ? remaining : '走') : `${String(remaining).padStart(2, '0')}<small>秒</small>`}</div>
      <div><strong>${countdown ? (remaining > 0 ? '站在起點，保持全身入鏡' : '側面走到另一端，再走回來') : '側面來回走，感到不適請停止'}</strong>
        <p>${countdown ? '倒數完畢後，按自己的速度自然步行。' : '進度只代表計時；目前沒有步態偵測或骨架分析。'}</p></div>
    </div>
    <div class="progress-track" role="progressbar" aria-label="走測計時進度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"><span style="width:${progress}%"></span></div>
    <div class="measure-actions"><button class="button button-primary" id="${countdown ? 'start-walk' : 'finish-walk'}" ${countdown && remaining > 0 ? 'disabled' : ''}>${countdown ? '開始走' : '結束並查看結果'}</button><button class="button button-secondary" id="retake">重新準備</button></div>
    <p class="small-note center">⚠ 正在預覽而非分析。影片及影格不會被儲存或傳送。</p>
  </main>`
}

function metricRow(title: string, value: number | null, unit: string): string {
  return `<div class="metric-row"><div><strong>${title}</strong><small>${value === null ? '尚無有效測量' : '篩查級參考'}</small></div><b>${value === null ? '—' : `${value.toFixed(1)} ${unit}`}</b></div>`
}

function reportView(): string {
  const record = activeRecord ?? unavailableRecord()
  const unavailable = record.status !== 'measured'
  const date = new Intl.DateTimeFormat('zh-HK', { dateStyle: 'medium', timeStyle: 'short' }).format(record.measuredAt)
  return `<main class="page narrow report-page">
    <a class="back-link" href="#/home" data-route="home">← 返回首頁</a>
    <p class="eyebrow">你的步態記錄 · ${date}</p>
    <section class="report-result ${unavailable ? 'result-unavailable' : ''}">
      <div class="result-icon">${unavailable ? '…' : '✓'}</div><div><span class="status-label">${unavailable ? '本次未能測量' : '篩查結果'}</span><h1>${unavailable ? '測量功能尚未就緒' : '本次步態摘要'}</h1></div>
      <p>${escapeHtml(record.summary)}</p>
      ${unavailable ? '<p class="result-hint">相機預覽和計時不等同步態分析。沒有足夠資料，不會提供分數、顏色判斷或健康結論。</p>' : `<div class="score"><b>${record.compositeScore ?? '—'}</b><span>/ 100<br/>篩查分數</span></div>`}
    </section>
    <div class="saved-note" role="status">${escapeHtml(saveMessage || '只將數值報告資料保存在本機，沒有儲存影像或個人資料。')}</div>
    <section class="content-card"><div class="section-heading"><div><p class="eyebrow">本次數據</p><h2>步態指標</h2></div><span class="tag">不作診斷</span></div>
      ${metricRow('左右對稱', record.metrics.symmetryPct, '%')}
      ${metricRow('步間穩定', record.metrics.stabilityCvPct, '%')}
      ${metricRow('步速', record.metrics.speedMps, 'm/s')}
      ${metricRow('步幅', record.metrics.strideLengthM, 'm')}
      <p class="small-note">判讀閾值與分析演算法尚未接入，故不顯示綠／黃／紅燈號。</p>
    </section>
    <section class="care-card"><span class="care-symbol">＋</span><div><h2>何時應尋求協助</h2><p>如有腿部麻痺或無力加重、大小便控制異常，請立即求醫。若症狀持續或令你擔心，請聯絡醫護人員作正式評估。</p></div></section>
    <section class="content-card exercise-card"><p class="eyebrow">一般活動參考 · 非個人化處方</p><h2>選擇舒適、可隨時停止的活動</h2><ul>
      <li><strong>平地慢步：</strong>在安全、平坦的地方按舒適程度走動；不必追求速度或距離。</li>
      <li><strong>坐姿腳踝活動：</strong>坐穩後，在無痛的舒適範圍內輕柔活動腳踝，不要強行拉伸。</li>
      <li><strong>放鬆呼吸：</strong>找舒適坐姿自然呼吸；若感到不適或暈眩便停止。</li>
      <li>若正處急性發作、腿麻或無力加重，請停止活動並求醫；術後或不確定是否適合時先問醫護人員。</li>
    </ul></section>
    ${disclaimer()}
    <div class="button-stack">${button('查看本機歷史', 'history', true)}${button('重新準備', 'setup')}</div>
    <p class="small-note">局限：單鏡頭 2D 影像易受角度、遮擋及設備影響；本版本未通過裝置實測及演算法驗證。</p>
  </main>`
}

function trendGraphic(records: ReportRecord[]): string {
  const points = records.filter((item) => item.metrics.symmetryPct !== null)
  if (points.length < 2) return `<div class="empty-chart"><span>⌁</span><strong>尚未有可繪製的趨勢</strong><p>目前沒有已驗證的數值測量。未測記錄不會被當成零分或趨勢點。</p></div>`
  const values = points.slice(0, 8).reverse()
  const nums = values.map((item) => item.metrics.symmetryPct!)
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const range = max - min || 1
  const coords = nums.map((n, i) => `${32 + (i * 336) / Math.max(1, nums.length - 1)},${145 - ((n - min) / range) * 105}`).join(' ')
  return `<svg class="trend-svg" viewBox="0 0 400 180" role="img" aria-label="左右對稱數值趨勢圖"><polyline points="${coords}" fill="none" stroke="#38846d" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>${nums.map((n, i) => `<circle cx="${32 + (i * 336) / Math.max(1, nums.length - 1)}" cy="${145 - ((n - min) / range) * 105}" r="5" fill="#38846d"><title>${n.toFixed(1)}%</title></circle>`).join('')}</svg>`
}

function historyView(): string {
  return `<main class="page narrow history-page"><a class="back-link" href="#/home" data-route="home">← 返回首頁</a>
    <p class="eyebrow">只在這部裝置</p><h1 class="page-title">步態日記</h1>
    <p class="lead">記錄留在你的瀏覽器中。沒有帳號或雲端同步。</p>
    <div id="history-content" class="history-loading" aria-live="polite">正在讀取本機記錄…</div>
    <section class="care-card compact"><span class="care-symbol">⌁</span><div><h2>變化不等於診斷</h2><p>本機趨勢只供自我觀察；如有疑慮，請由醫護人員評估。</p></div></section>
    <button class="button button-secondary danger-button" id="clear-history">清除本機歷史</button>
    <div class="button-stack">${button('開始新一次準備', 'setup', true)}</div>${disclaimer()}
  </main>`
}

function render(): void {
  const views: Record<Route, () => string> = {
    home: homeView, setup: setupView, measurement: () => measurementView('countdown', 0),
    report: reportView, history: historyView,
  }
  app!.innerHTML = `${header()}${views[currentRoute]()}`
  app!.querySelectorAll<HTMLElement>('[data-route]').forEach((element) => {
    element.addEventListener('click', (event) => {
      event.preventDefault()
      navigate(element.dataset.route as Route)
    })
  })
  if (currentRoute === 'home') {
    app!.querySelector<HTMLInputElement>('#voice-toggle')?.addEventListener('change', (event) => {
      speechEnabled = (event.currentTarget as HTMLInputElement).checked
      writeVoicePreference(speechEnabled)
      if (speechEnabled) voice.speak('語音提示已開啟，重要指示亦會顯示在畫面上。', true)
    })
  }
  if (currentRoute === 'setup') bindSetup()
  if (currentRoute === 'measurement') {
    if (camera.active) camera.attach(app!.querySelector<HTMLVideoElement>('#camera-preview')!)
    bindMeasurement()
  }
  if (currentRoute === 'report') persistCurrentReport()
  if (currentRoute === 'history') {
    app!.querySelector('#clear-history')?.addEventListener('click', () => void clearHistory())
    void loadHistory()
  }
}

function bindSetup(): void {
  app!.querySelector('#enable-camera')?.addEventListener('click', async () => {
    cameraError = ''
    const buttonEl = app!.querySelector<HTMLButtonElement>('#enable-camera')!
    buttonEl.disabled = true
    buttonEl.textContent = '正在開啟相機…'
    try {
      await camera.start()
      sessionTimer = 0
      navigate('measurement')
      beginCountdown()
    } catch (error) {
      cameraError = error instanceof CameraError ? error.message : '無法開啟相機，請再試一次。'
      render()
    }
  })
  app!.querySelector('#skip-camera')?.addEventListener('click', () => {
    camera.stop()
    activeRecord = unavailableRecord()
    saveMessage = ''
    navigate('report')
  })
}

function renderMeasurement(phase: MeasurementPhase, remaining: number): void {
  if (currentRoute !== 'measurement') return
  const stage = app!.querySelector<HTMLElement>('.camera-stage')
  if (stage && stage.dataset.phase === phase) {
    const timer = app!.querySelector<HTMLElement>('.timer')
    if (timer) timer.innerHTML = phase === 'countdown'
      ? (remaining > 0 ? String(remaining) : '走')
      : `${String(remaining).padStart(2, '0')}<small>秒</small>`
    const mainPrompt = app!.querySelector<HTMLElement>('.prompt-panel strong')
    const subPrompt = app!.querySelector<HTMLElement>('.prompt-panel p')
    if (mainPrompt && phase === 'countdown') mainPrompt.textContent = remaining > 0 ? '站在起點，保持全身入鏡' : '側面走到另一端，再走回來'
    if (subPrompt && phase === 'countdown') subPrompt.textContent = '倒數完畢後，按自己的速度自然步行。'
    const startButton = app!.querySelector<HTMLButtonElement>('#start-walk')
    if (startButton && phase === 'countdown') startButton.disabled = remaining > 0
    const progress = phase === 'countdown' ? 0 : Math.min(100, ((30 - remaining) / 30) * 100)
    const track = app!.querySelector<HTMLElement>('.progress-track')
    const fill = app!.querySelector<HTMLElement>('.progress-track span')
    if (track) track.setAttribute('aria-valuenow', String(Math.round(progress)))
    if (fill) fill.style.width = `${progress}%`
    return
  }
  app!.innerHTML = `${header()}${measurementView(phase, remaining)}`
  app!.querySelectorAll<HTMLElement>('[data-route]').forEach((element) => {
    element.addEventListener('click', (event) => {
      event.preventDefault()
      navigate(element.dataset.route as Route)
    })
  })
  if (camera.active) camera.attach(app!.querySelector<HTMLVideoElement>('#camera-preview')!)
  bindMeasurement()
}

function bindMeasurement(): void {
  app!.querySelector('#start-walk')?.addEventListener('click', () => beginWalk())
  app!.querySelector('#finish-walk')?.addEventListener('click', () => finishMeasurement())
  app!.querySelector('#retake')?.addEventListener('click', () => {
    sessionTimer = 0
    clearInterval(tickHandle)
    clearInterval(countdownHandle)
    navigate('setup')
  })
}

function beginCountdown(): void {
  let count = 3
  renderMeasurement('countdown', count)
  voice.speak('三，二，一，準備開始。', speechEnabled)
  countdownHandle = window.setInterval(() => {
    count -= 1
    if (count <= 0) {
      clearInterval(countdownHandle)
      renderMeasurement('countdown', 0)
    } else renderMeasurement('countdown', count)
  }, 1000)
}

function beginWalk(): void {
  sessionTimer = 30
  renderMeasurement('walking', sessionTimer)
  voice.speak('側面走到另一端，再走回來。感到不適請停止。', speechEnabled)
  tickHandle = window.setInterval(() => {
    sessionTimer -= 1
    if (sessionTimer <= 0) {
      clearInterval(tickHandle)
      finishMeasurement()
    } else renderMeasurement('walking', sessionTimer)
  }, 1000)
}

function finishMeasurement(): void {
  clearInterval(tickHandle)
  clearInterval(countdownHandle)
  voice.stop()
  activeRecord = unavailableRecord()
  saveMessage = ''
  navigate('report')
}

async function persistCurrentReport(): Promise<void> {
  if (!activeRecord) return
  try {
    await saveReport(activeRecord)
    saveMessage = '未測記錄已保存在本機；沒有保存任何影片、影格或關鍵點。'
    const note = app!.querySelector<HTMLElement>('.saved-note')
    if (note) note.textContent = saveMessage
  } catch {
    saveMessage = '本機儲存目前不可用；本次記錄只在此頁暫存，離開後可能消失。'
    const note = app!.querySelector<HTMLElement>('.saved-note')
    if (note) note.textContent = saveMessage
  }
}

async function loadHistory(): Promise<void> {
  const container = app!.querySelector<HTMLElement>('#history-content')
  if (!container) return
  try {
    const records = await getReports()
    if (currentRoute !== 'history') return
    container.className = ''
    container.innerHTML = `<section class="content-card trend-card"><div class="section-heading"><div><p class="eyebrow">縱向觀察</p><h2>數值趨勢</h2></div></div>${trendGraphic(records)}    <p class="chart-caption">只繪製已接入並驗證的左右對稱數值；不以未測資料補值。數值差異不代表改善或惡化。</p></section>
      <section class="content-card record-card"><div class="section-heading"><div><p class="eyebrow">本機記錄</p><h2>過往記錄 <span class="count">${records.length}</span></h2></div></div>
      ${records.length ? `      <ul class="record-list">${records.map((record, index) => {
        const previous = records[index + 1]
        const currentSymmetry = record.metrics.symmetryPct
        const previousSymmetry = previous?.metrics.symmetryPct
        const delta = record.status === 'measured' && previous?.status === 'measured'
          && currentSymmetry !== null && previousSymmetry !== null
          ? currentSymmetry - previousSymmetry : null
        const comparison = delta === null ? '' : `<small class="comparison">較前次 ${delta > 0 ? '+' : ''}${delta.toFixed(1)} 個百分點</small>`
        return `<li><div class="record-date"><strong>${new Intl.DateTimeFormat('zh-HK', { dateStyle: 'medium' }).format(record.measuredAt)}</strong><small>${new Intl.DateTimeFormat('zh-HK', { timeStyle: 'short' }).format(record.measuredAt)}</small></div><span class="record-status">${record.status === 'measured' ? '已測量' : '未能測量'}</span><div class="record-value">${record.status === 'measured' && currentSymmetry !== null ? `左右對稱 ${currentSymmetry.toFixed(1)}%` : '沒有有效步態數據'}</div>${comparison}</li>`
      }).join('')}</ul>` : '<div class="empty-chart"><strong>尚未有本機記錄</strong><p>完成一次走測流程後，記錄會顯示在這裡。</p></div>'}</section>`
  } catch {
    container.className = 'error-box'
    container.textContent = '無法讀取本機歷史。請確認瀏覽器允許網站儲存資料；走測流程仍可使用。'
  }
}

async function clearHistory(): Promise<void> {
  if (!confirm('確定要清除這部裝置上的所有 GaitTrace 歷史嗎？此操作無法復原。')) return
  try {
    await clearReports()
    await loadHistory()
  } catch {
    alert('未能清除本機歷史，請稍後再試。')
  }
}

window.addEventListener('hashchange', () => {
  currentRoute = routeFromHash()
  if (currentRoute !== 'measurement') {
    clearInterval(tickHandle)
    clearInterval(countdownHandle)
    camera.stop()
    voice.stop()
  }
  render()

  window.addEventListener('pagehide', () => {
    clearInterval(tickHandle)
    clearInterval(countdownHandle)
    camera.stop()
    voice.stop()
  })
})

render()
