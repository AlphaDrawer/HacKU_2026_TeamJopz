/**
 * ui/constants.ts（UI 层常量，杜绝魔法数字）
 * 与 contracts/constants.ts 区分：这里只放与界面/交互有关的常量。
 */

/** 单次测量时长（秒）：18s 可拿到更多交替步，降低 MAD 稳定度噪声；踏步不出画 */
export const MEASUREMENT_DURATION_SEC = 18;

/** 开测倒计时（秒） */
export const COUNTDOWN_SEC = 3;

/** 主循环帧间隔（ms）≈ 30fps */
export const LOOP_INTERVAL_MS = 33;

/** 路由 hash 前缀 */
export const ROUTE_PREFIX = "#/";

/** 路由名（顺序即默认导航） */
export const ROUTES = {
  HOME: "home",
  SETUP: "setup",
  MEASUREMENT: "measurement",
  REPORT: "report",
  HISTORY: "history",
} as const;

export type RouteName = (typeof ROUTES)[keyof typeof ROUTES];

/** 合法路由集合，用于校验手改 URL */
export const VALID_ROUTES: ReadonlySet<string> = new Set(Object.values(ROUTES));

/** 需要相机就绪后才允许进入的路由（悬空路由守卫用） */
export const CAMERA_GATED = new Set<string>([ROUTES.MEASUREMENT]);

/** 颜色：左踝/右踝、周期标记 */
export const COLORS = {
  LEFT: "#d9534f", // 左踝红
  RIGHT: "#3b7dd8", // 右踝蓝
  CYCLE: "#d49a36", // 周期标记琥珀
  BONE: "#286b55",
  JOINT: "#1d302b",
} as const;

/** 语音开关在 localStorage 的键 */
export const VOICE_STORAGE_KEY = "gaittrace:voice-enabled";

/** 上次输入的身高（厘米）在 localStorage 的键 */
export const HEIGHT_STORAGE_KEY = "gaittrace:height-cm";
