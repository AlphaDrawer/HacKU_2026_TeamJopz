# GaitTrace 技术规范（Technical Specification）

- **文档状态**：**Released（正式版，当前唯一技术基准）**
- **版本**：v1.1
- **日期**：2026-10-03（Released 经所有人 AlphaDrawer 批准）
- **所有人**：AlphaDrawer（最终批准）
- **适用对象**：全体人类队员与协作 Agent
- **上位文档**：`docs/GaitTrace_需求文档_v1.1.md`
- **评审记录**：见 `docs/review/`（v1.0-draft 审查：有条件通过，3 阻塞项已在本版修复）
- **变更治理**：见第 9 章

> **历史文件与效力（Supersedes）**：本文件为唯一技术基准。`docs/04_*`、`docs/05_技术路线与对接_v1.md`、`docs/GaitTrace_项目说明_需求与工作流.md` 仅作历史过程材料，MUST NOT 再被引用为实现或审查依据；需求以 `docs/03_*_v2.md` 为准，技术以本文件为准。

> **规范强度关键词**：**MUST（必须）** / **MUST NOT（禁止）** / **SHOULD（应当）** / **MAY（可以）**，按 RFC 2119 语义理解。

---

## 0. 给人类与 Agent 的阅读指引

- **人类队员**：第 1 章（架构决策）、第 4 章（模块归属）、第 6 章（协作与排期）定义了你做什么、和谁对接。
- **协作 Agent**：第 1–5 章是系统的事实来源（source of truth）。任何实现建议、代码生成或审查都 MUST 以本文档的模块边界与类型契约为准；冲突时以本文档为准，或先按第 9 章提出变更，不得擅自偏离。
- **本文档与需求文档不一致**：先标记并上报所有人裁定；裁定前需求意图优先、本文档技术约束保留。
- 本文档规定必须遵守的结构与契约，不规定模块内部算法实现（内部自由，但输入输出 MUST 符合契约）。

---

## 1. 架构决策（已定）

### 1.1 决策

- **采用方案 A：无独立服务器。**
- 「后端」**MUST** 指**浏览器内的算法 / 服务层**（纯函数 TS 模块），不是远程服务器。
- 「前端」**MUST** 负责 UI、走测流程、摄像头取流、报告渲染与本地存储。
- 两组通过**提前冻结的 TypeScript 接口契约**对接（第 5 章）。

### 1.2 立身前提（不可破坏）

1. **影像不出设备**：摄像头视频帧 MUST NOT 离开用户设备、MUST NOT 上传。
2. **无服务器、无账号**：v1 MUST NOT 引入后端服务或身份体系。
3. **首载后可离线（目标）**：首次联网加载后，核心走测 SHOULD 可在断网下完成（Service Worker 真缓存）。此特性非题4强制（壁垒=成本），处理方式见 §6.1。
4. **零成本**：对用户免费；团队侧仅使用免费开源能力。

> 方案 B（真起后端跑重模型）**MUST NOT** 在本规范下实施。仅当端侧方案经 Spike 客观证明彻底不可行、且无轻量替代时，方可作为例外提案，**重新报所有人审批**，批准前不得动工。

### 1.3 架构示意

```
┌─────────────────────────── 浏览器（一台手机）──────────────────────────┐
│   ┌─────────────────────── UI 层（前端组）──────────────────────┐      │
│   │  页面路由 │ 走测引导 │ <video>/<canvas> │ 报告(绿黄红)        │      │
│   │  历史曲线 │ IndexedDB │ 语音/大字提示                        │      │
│   └───────┴───────────────────────────────────┬─────────────────┘      │
│           │ 仅传关键点/帧 + 历史记录（不传影像） ▼                        │
│   ┌──────────────── 算法 / 服务层（后端组，纯函数）─────────────┐      │
│   │ Pose 流水线 │ 事件检测 │ 切段 │ 指标计算 │ 尺度标定 │ 规则引擎 │      │
│   └───────────────────────────────────────────────────────────┘      │
│   IndexedDB（本地，仅存数字指标）                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 平台与运行约束

- 纯 Web 单页应用，移动端浏览器免安装；**MUST** 支持 iOS Safari 与 Android Chrome，竖屏优先。
- 界面语言为中文，大字 + 语音引导，零专业门槛。
- 视频帧仅在内存 / 本地实时处理，看完即焚，**MUST NOT** 落为视频文件。
- 构建工具 SHOULD 采用 Vite；部署为一组静态文件（GitHub Pages）。
- 工程 MUST 关注：iOS 的 HTTPS / WASM-SIMD / Service Worker 限制；GitHub Pages 下模型资源与 SW 缓存路径。

---

## 3. 走测与指标规范

### 3.1 走测形式

- 走测 **MUST** 采用**侧面矢状面横走**，镜头约与膝盖同高。
- 分析 **MUST** 只取**中段直线匀速数据**；起步、转身、止步段 MUST 剔除。
- 时间 **MUST** 一律使用设备时间戳（毫秒），MUST NOT 用帧数计时。
- 零门槛下 MUST NOT 要求用户精确量 5 米；用「地砖 / 步数 / 身高参照 + 自动尺度标定」补偿。

### 3.2 指标分级与极性

| 指标 | 定位 | 极性（越大/越小为好） |
|---|---|---|
| **左右对称 symmetry** | **主指标（无量纲）** | 值=对称度 0–100，**越大越好**（或内部用不对称%，越小越好，须在实现中统一并在 hint 体现） |
| **步间稳定 stability** | **主指标（无量纲）** | CV% **越小越好**（报告 hint 转换为"越稳"） |
| **步速 speed** | **需校准项** | 仅在常模范围内为绿；不作为"越快越好" |
| **步幅 strideLength** | **需校准项** | 同上 |

- **主指标非空原则**：symmetry / stability 的 `value` MUST NOT 为 `null`；若无法计算，本次走测判为**测量失败**、MUST 提示重走，不产出正式报告。
- 需校准项尺度不可信时 `value` MUST 为 `null`、`level` MUST 为 `"none"`，MUST NOT 给假精确值，报告标注「筛查级」。
- 判定 **SHOULD** 结合文献常模 + 个人历史基线的纵向变化；阈值 MUST 带文献/自测出处；低置信度结果 MUST NOT 硬下 `"seekCare"`。

### 3.3 已知关键风险（Spike 必须回答）

纯侧面视角下两腿近侧 / 远侧可能重合、远侧踝被遮挡，而主指标「左右对称」依赖可靠区分左右踝。
**降级预案（按优先级）**：① 改用 30–45° 斜侧视角；② 用躯干摆动代理左右对称；③ 以步间稳定保底。最终选择由 Spike 客观结果决定。

---

## 4. 模块清单与归属边界

### 4.1 算法 / 服务层（后端组）

| 模块 | 职责 |
|---|---|
| `posePipeline` | 封装 MediaPipe Pose 初始化与逐帧推理，输出关键点帧 |
| `eventDetector` | 从脚踝轨迹检测 heelStrike / toeOff、步态周期、左右标记 |
| `segmentSelector` | 识别并保留中段直线匀速段，剔除起步 / 转身 / 止步 |
| `metricsCalculator` | 计算 symmetry / stability（主）与 speed / strideLength（需校准） |
| `scaleCalibrator` | 地砖 / 步数 / 身高参照自动尺度标定，输出是否可信 |
| `ruleEngine` | 指标 + **个人历史基线** → 绿黄红、综合分、预警等级 |
| `exerciseAdvisor` | 输出 3 个康复动作（要点 / 禁忌），可由静态 JSON + 规则生成 |

**纪律**：以上模块 MUST 为无 DOM 依赖的纯函数，MUST NOT 直接操作摄像头、页面或数据库；MUST 能在 Node + mock 数据下独立开发与单测。

### 4.2 UI 层（前端组）

| 模块 | 职责 |
|---|---|
| `appShell / router` | 页面结构与路由（首页 / 走测 / 报告 / 历史） |
| `cameraController` | 摄像头权限、取 `MediaStream`、渲染 `<video>`、喂帧；**走测实时判停**（检测到往返完成即结束，见 §6.7） |
| `skeletonRenderer` | 在 `<canvas>` 叠加实时骨架 |
| `onboardingFlow` | 机位 / 高度 / 地砖引导、倒计时、语音 / 大字 |
| `reportView` | 综合分、指标卡、常驻「筛查非诊断」、康复动作、就医提示 |
| `historyView` | 历史列表、趋势曲线、较上次变化 |
| `storage` | IndexedDB 封装（schema 见 §5.4） |
| `voicePrompt` | 语音播报 / 大字提示（Web Speech API，降级纯文字） |

### 4.3 边界规则

- 谁碰摄像头 / 页面 / 数据库 → **前端组**。
- 谁把「帧 / 关键点」变成「事件 / 指标 / 结论」→ **后端组**。
- 后端交付一个 `core` 模块，前端只通过 §5.5 总入口调用。

### 4.4 医疗安全（强制）

- 报告 MUST 全程常驻：「本结果为筛查与自我追踪，不构成医学诊断」。
- 预警 MUST 在任一情况触发：主指标**单次严重异常**；任一指标连续 2 次红；左右不对称较基线明显加重；步速连续下滑。
- MUST 固定提示红旗症状：出现**腿麻、无力、大小便异常**应立即就诊（独立于测量）。
- 康复动作 MUST 标注适用 / 要点 / 禁忌；急性发作期、腿麻加重时 MUST 提示停练就医。

---

## 5. 接口契约（冻结后两端只 import）

> 跨组类型集中定义于 `src/contracts/types.ts`，两端 MUST NOT 私改；冻结前可评审微调，冻结后按第 9 章变更。

### 5.1 关键点与帧

```ts
interface Landmark {
  x: number;          // 归一化 0..1（相对宽）
  y: number;          // 归一化 0..1（相对高）
  z: number;          // 相对深度
  visibility: number; // 0..1
}

interface PoseFrame {
  frameId: number;
  timestampMs: number;      // 设备时间戳
  landmarks: Landmark[];    // MediaPipe 33 点，按官方索引
}
```

左右踝 MUST NOT 写魔法数字；由后端导出 `LEFT_ANKLE` / `RIGHT_ANKLE`（值以 MediaPipe 官方索引为准）。

### 5.2 事件、周期、切段

```ts
type Side = "left" | "right";
type GaitEventType = "heelStrike" | "toeOff";

interface GaitEvent {
  type: GaitEventType;
  side: Side;
  timestampMs: number;
  confidence: number;
}

interface GaitCycle {
  side: Side;
  startMs: number;
  endMs: number;
  durationMs: number;
}

interface ValidSegment {
  startMs: number;
  endMs: number;
  direction: "out" | "back";
  events: GaitEvent[];
  cycles: GaitCycle[];
}
```

### 5.3 指标与结论

```ts
interface ScaleInfo {
  calibrated: boolean;
  pixelsPerMeter?: number;
  method?: "tile" | "step" | "height" | "manual" | "none";
  confidence?: number;
}

type MetricLevel = "green" | "yellow" | "red" | "none";

interface Metric {
  key: "symmetry" | "stability" | "speed" | "strideLength";
  label: string;
  value: number | null;            // 主指标非空（见§3.2）；校准项不可信为 null
  unit: "%" | "m/s" | "m" | "cv";
  level: MetricLevel;              // value=null 时 MUST 为 "none"
  calibrated: boolean;
  confidence: number;
  hint: string;
}

interface GaitMetrics {
  sessionId: string;
  timestampMs: number;
  scale: ScaleInfo;
  metrics: {
    symmetry: Metric;
    stability: Metric;
    speed: Metric;
    strideLength: Metric;
  };
}

type AlertLevel = "normal" | "caution" | "seekCare";

interface Exercise {
  id: string;
  name: string;
  applicable: string;
  steps: string[];
  cautions: string[];
  imageUrl?: string;
}

interface GaitConclusion {
  overallScore: number;   // 0..100
  alertLevel: AlertLevel;
  summaryLine: string;
  alerts: string[];
  disclaimer: string;
  exercises: Exercise[];
}

interface ReportRecord {
  sessionId: string;      // 由前端生成并作为唯一标识来源（建议 crypto.randomUUID）
  createdAtMs: number;
  durationSec: number;
  metrics: GaitMetrics;
  conclusion: GaitConclusion;
}
```

> `GaitMetrics.sessionId` 与 `ReportRecord.sessionId` MUST 为同一值；后端不自行生成 ID，由前端传入，保证唯一性来源。

### 5.4 IndexedDB schema

- 数据库名：`gaitrace-db`；版本：`1`；Object Store：`reports`。
- `keyPath`：`sessionId`。
- 索引：`by_createdAt`（`createdAtMs`）、`by_alertLevel`（`conclusion.alertLevel`）。

```ts
interface ReportStore {
  save(record: ReportRecord): Promise<void>;
  getAll(): Promise<ReportRecord[]>;                 // 按 createdAt 升序
  getByRange(fromMs: number, toMs: number): Promise<ReportRecord[]>;
  delete(sessionId: string): Promise<void>;          // v1 可不暴露删除 UI
}
```

### 5.5 算法层总入口（前端只认这几个函数）

```ts
interface GaitCore {
  initPose(modelAssetUrl: string): Promise<void>;

  // 返回 null = 本帧未得到有效姿态（前端据此跳过/计数，不当作错误崩溃）
  inferFrame(video: HTMLVideoElement, timestampMs: number): Promise<PoseFrame | null>;

  // sessionId：由前端生成并传入（与最终 ReportRecord 同一值）；history 为既往记录（getAll）
  analyzeSession(
    sessionId: string,
    frames: PoseFrame[],
    history: ReportRecord[],
    scaleHint?: ScaleHint
  ): Promise<{ metrics: GaitMetrics; conclusion: GaitConclusion }>;
}

interface ScaleHint {
  method: ScaleInfo["method"];
  referenceLengthM?: number;
}
```

- 首次测量 `history` 传空数组，ruleEngine 仅按常模判定、并标注"尚无个人基线"。
- `inferFrame` 入参形式（`<video>` vs `ImageBitmap`）由 Spike 最终确定，变更 MUST 同步契约与调用方。
- `frames` 只在内存、用后释放，MUST NOT 落地为视频。

---

## 6. 协作、并行开发与排期

### 6.1 开工首步：Spike（共同）

**测量协议（先固定，再读数）：**
- **帧率**：走测稳定后连续 30 秒滑动窗口内，MediaPipe 成功推理次数 / 窗口时长，得平均 fps。
- **有效帧**：`visibility ≥ 0.5`（踝/髋等关键关节）的帧占比；阈值在冻结时常量化。
- **左右踝可分且一致**：侧面（或斜侧预案）下左右踝关键点可被分别标记；同一人走两次，主指标 symmetry 差值在容差 **±10 个百分点**内视为一致。
- **周期数**：按同侧 heelStrike 计数，中段合计 ≥ 6 个步态周期。
- **断网走测**：SW 缓存后开飞行模式完成一次走测。

**通过判定：**
- 第 1–4 项为**硬标准**，MUST 全部满足才进入全面并行。
- 第 5 项（离线）为非题4强制目标：**若仅离线一项未达标，允许带风险放行**（记录为已知风险、pitch 中诚实说明"首载需联网"），MUST NOT 因这一项卡死整个项目；但 SW 缓存仍 SHOULD 尽力实现并复测。

不达标即按 §3.3 预案降级并快速复测；硬标准仍不达标则上报所有人，MUST NOT 硬扛。Spike 录制数据沉淀为第一份 mock。

### 6.2 Walking Skeleton

两组 MUST 先用 stub / mock 竖切打通端到端假链路（假帧→假事件→假指标→假报告→存 IndexedDB→历史可见），尽早暴露接缝；之后逐个替换 stub，系统始终可运行。

### 6.3 Mock 与 Stub

- 后端开工即提供 `mockPoseFrames.json`（正常走 + 不对称走）与 `mockReport.json`。
- 未实现模块 MUST 提供同签名、类型正确的 stub；替换 stub 时 MUST NOT 改调用方。

### 6.4 Merge 节奏

- 共用主分支、小步提交；真实模块替换 stub 后即合，避免最后大合并。
- 每天固定 2 次、每次约 15 分钟同步：改了什么 / 要合什么 / 卡在哪。
- 提交前 MUST 通过 Prettier 与 `tsc --noEmit`。

### 6.5 工程结构

```
/ (项目根)
  index.html
  src/
    ui/          # 前端组
    core/        # 后端组
    contracts/   # 共享类型（共同维护、改动需双方同意）
    data/        # 静态 JSON、mock
  package.json
  tsconfig.json
```

### 6.6 跨组必对清单

- 模型文件位置与加载方式（离线目标下需可本地加载）；
- 左右踝索引常量由后端导出；
- 统一毫秒时间戳；归一化坐标与 canvas 像素换算放前端；
- 康复动作图文放 `data/` 共用；
- iOS 摄像头权限与兼容真机验证。

### 6.7 走测实时判停

- `cameraController` MUST 提供实时判停出口：根据帧中人物位置 / 已检出往返，自动结束走测；同时保留手动「结束 / 重走」按钮兜底。
- 自动判停只用于结束流程，MUST NOT 在未满足有效数据最低要求时产出正式报告（不足则提示重走）。

---

## 7. 交付物（提交硬要求，逐项定 owner）

全部公开可看：

| 交付物 | 要求 | Owner（待组内定人） |
|---|---|---|
| 公开仓库 | GitHub/GitLab 链接，**含开源库署名（硬要求）** | 前端组指定 1 人 |
| 在线 demo / 视频 | GitHub Pages 在线 demo；并录 3 分钟演示视频作 Plan B | 前端组 + 需求/内容线 |
| Pitch deck | 可加海报；主动点题「能力下沉 + 组合创新」 | 需求分析师协助、所有人主讲 |

**提交前清零（各项 MUST 指定 owner）：**
- [ ] Spike 硬标准 1–4 通过（离线按 §6.1 处理）
- [ ] 30 秒耗时秒表实测、HK$380 价目来源回填需求文档
- [ ] 自动尺度标定落地
- [ ] iOS：HTTPS / WASM-SIMD / SW 实测；Pages 模型路径与 SW 缓存；断网实测
- [ ] 开源库署名
- [ ] 官方提交表单认领并按时提交三样
- [ ] 赛道展 10/4 14:40–15:40 至少一人到场（否则 DQ）
- [ ] 预录视频作 Plan B

---

## 8. 隐私、误差与成本

- 视频本地处理、不保存、不上传；无后端、无账号、不采集身份信息；本地仅存数字指标。
- 首次加载需联网获取模型；除此之外**无个人信息、无影像离开设备**。（需求 v2 §13 的措辞 MUST 与本句统一）
- MUST 诚实列出误差来源（单目角度、两腿遮挡、衣物遮挡、转身误判、帧率差异、定距误差），demo 主动公开与秒表 / 实测步距的对比，不夸大精度。
- 用户免费；团队侧无硬件 / API / 服务器费用。

---

## 9. 文档治理与变更流程

1. 本文档经审查复核确认 3 阻塞项已闭环、所有人批准后状态转为 **Released**，作为唯一技术基准。
2. **契约变更（第 5 章类型 / schema / 总入口）MUST NOT 单方面进行**：
   1. 提出方说明：改哪个字段、为什么、影响谁；
   2. 前后端两组确认；
   3. 更新 `contracts/types.ts` 及受影响 stub / mock，通知所有人。
3. **版本号（语义化）**：非破坏性澄清升 patch（v1.0.x）；向后兼容的新增升 minor（v1.x）；**破坏性变更升 major（v2.0）**，且 MUST 报所有人审批。
4. 涉及架构原则（第 1 章）的变更 MUST 报所有人审批。
5. 每次变更 MUST 更新文档头部版本与日期，并在 `docs/review/` 留痕。

---

## 附录 A：一页速览

- 架构：方案 A，无服务器；后端 = 浏览器内纯函数算法层；前端 = UI / 流程 / 存储。
- 数据流：`PoseFrame → GaitEvent/GaitCycle/ValidSegment → GaitMetrics → GaitConclusion → ReportRecord`；IndexedDB `gaitrace-db / reports`。
- 纵向基线：`analyzeSession(sessionId, frames, history, scaleHint?)` 传入 sessionId 与既往记录，支撑核心卖点。
- 并行：Walking skeleton + mock/stub + 接口先冻结 + 小步勤 merge + 契约变更双方同意。
- 首步：四人共同 Spike（硬标准 1–4：帧率/有效帧/左右踝一致/周期数；离线为带风险放行项）。
- 红线：影像不出设备、无服务器、零成本；方案 B 须重新报批。
