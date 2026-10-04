【已归档 2026-10-03】本文件描述的是早期状态，已被需求 v1.1 + 技术规范 v1.1 取代，请勿作为依据。

# GaitTrace 前端快速開始

## 本機開發

需要 Node.js 22.12+ 和 npm：

```sh
npm install
npm run dev
```

相機只可在 HTTPS 或 `localhost` 使用。請在手機瀏覽器打開本機網絡地址時使用 HTTPS；純 HTTP 網絡地址通常不會開放相機權限。

## 驗證與建置

```sh
npm test
npm run build
npm run preview
```

GitHub Pages 的 repository path 為 `/HacKU_2026_TeamJopz/`，用以下命令建置：

```sh
GITHUB_PAGES=true npm run build
```

Windows PowerShell：

```powershell
$env:GITHUB_PAGES = "true"
npm run build
```

輸出在 `dist/`。Service Worker 使用相對 scope，快取已建置的 app shell 與靜態資源；相機資料及 IndexedDB 報告不會進入 Cache Storage。離線使用仍須部署環境允許 Service Worker，並在初次載入完成後實機測試。

## 分析服務介面與目前限制

`src/domain/report.ts` 定義最小的 `PosePipeline`、`GaitAnalysisAdapter`、keypoint 與報告型別。真正的 Pose 推理、步態事件、校準、臨床規則和評分尚未存在，因此目前流程僅提供本機相機預覽、倒數／計時和明確標示的「未能測量」報告。計時不是步態偵測；畫面不繪製虛構骨架、不提供分數或燈號。

新增演算法時應以 adapter 實作取代邊界，不可將影片、影格或 keypoint 寫入 storage 或送出裝置。IndexedDB 的 `ReportRecord` 只存時間、測量數字及報告欄位，不收集姓名或其他身份資料。尚無有效指標時，歷史趨勢會顯示空狀態而不補零。

語音使用瀏覽器 Web Speech API；不支援或未啟用時仍以畫面文字提示。建議在 iOS Safari、Android Chrome 上實測相機權限、旋轉／背景切換、語音、PWA 快取與斷網行為。本版本尚未完成 MediaPipe 模型載入或項目文件所列 Spike 通過標準。
