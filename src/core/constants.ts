/**
 * GaitCore 常量集中管理（规范 §6.1 / §5），禁止在算法中散落魔法数字。
 */

// ---- MediaPipe Pose 33 点官方索引 ----
// https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker
export const NOSE = 0;
export const LEFT_SHOULDER = 11;
export const RIGHT_SHOULDER = 12;
export const LEFT_HIP = 23;
export const RIGHT_HIP = 24;
export const LEFT_KNEE = 25;
export const RIGHT_KNEE = 26;
export const LEFT_ANKLE = 27;
export const RIGHT_ANKLE = 28;

// §5.5 对接点：算法实际使用并对外导出的踝索引（前端渲染/接线用）
export const ANKLE_INDICES = { left: LEFT_ANKLE, right: RIGHT_ANKLE } as const;

// ---- 有效帧 / 测量硬标准（§6.1）----
export const VISIBILITY_THRESHOLD = 0.5;
export const CRITICAL_JOINTS = [LEFT_HIP, RIGHT_HIP, LEFT_ANKLE, RIGHT_ANKLE] as const;
export const FPS_TARGET = 20;
export const VALID_FRAME_TARGET = 0.8;
export const SYMMETRY_TOLERANCE_PP = 10;
export const MIN_GAIT_CYCLES = 6;

// ---- 会话内虚拟几何 ----
// analyzeSession 只拿到归一化 landmarks（无视频元素），core 内部统一在一个
// 1000×1000 的虚拟画面上计算，保证 x/y 等尺度（物理上更一致）；
// 所有阈值均按该虚拟尺度标定。这是内部假设，不影响契约。
export const VIRTUAL_WIDTH_PX = 1000;
export const VIRTUAL_HEIGHT_PX = 1000;

// ---- heelStrike 检测 ----
export const MIN_STRIKE_GAP_MS = 450;
export const MIN_PROMINENCE_RATIO = 0.06; // 谷-峰落差 / 平均小腿长
export const PROMINENCE_WINDOW = 12;
export const STRIKE_SPEED_REF_PX_S = 400;
export const DEFAULT_SHANK_RATIO = 0.15; // 无小腿尺度时兜底：画面高 15%

// ---- 切段 ----
export const SEG_SPEED_ENTER_PX_S = 60;
export const SEG_SPEED_EXIT_PX_S = 30;
export const MIN_SEGMENT_MS = 800;
export const STEADY_BAND = 0.4;
export const MAX_INVALID_GAP_MS = 250;

// ---- 原地踏步模式（空间不足：无走行位移，靠垂直节奏识别；真机修正 v1.3）----
// v1.2 曾用「全段髋中心 x 极差 ≤120px」单特征判 march，实测人离镜头较近、
// 踏步时身体左右稍晃，极差就轻易超 12% 画面宽 → 误判 locomotion → 踏步小幅
// 水平速度达不到走行入段阈值 → 无段 → 门控2。v1.3 改为基于「持续同向
// 位移段(run)」判别（见 segmentSelector.detectMode）。
// 旧常量仅留作诊断参照与兼容，不再参与判定/切段。
export const MARCH_HIP_RANGE_PX = 120;

// ---- 模式判定（v1.3：run 结构判别，替代全段极差）----
// 把髋水平速度按符号切成「同向位移段(run)」（|v| 低于噪声带时断开）。
// 走路（含小范围来回走）存在又长又远的 run；踏步/站立的 run 都短。
// 任一 run 同时达到时长与净位移下限 → 判 locomotion，否则 march。
export const RUN_NOISE_BAND_PX_S = 30; // |髋水平速度| 低于此值视为无方向、run 断开
export const RUN_MIN_MS = 1500; // run 最短持续时长（踏步左右晃半周期通常 <1.5s）
export const RUN_MIN_NET_PX = 180; // run 内最少净位移（虚拟px，即画面宽 18%）

// ---- 踏步入段（v1.3：能量分位数自适应取景，替代固定 120 阈值）----
// 固定绝对阈值对取景距离/抬膝高低不自适应（远机位/抬膝低时踝垂直速度
// 峰值到不了 120px/s 就永远不进段）。改为取整段平滑能量的高比例分位数
// 作为入段基准（节奏越清晰，高能量帧与噪声帧差距越大，分位数本身自适应）；
// 另设绝对噪声地板，防止纯站姿噪声/检测抖动被分位数相对放大而误触发。
// 安全兜底：即便小幅站姿晃动入段，也会因每侧 heelStrike<3 被门控2拒绝。
export const MARCH_ENTER_QUANTILE = 0.6; // 入段阈值 = 能量序列此分位数
export const MARCH_ENTER_FLOOR_PX_S = 40; // 入段绝对噪声地板（px/s）
export const MARCH_EXIT_RATIO = 0.5; // 出段阈值 = 入段阈值 ×此比例（滞回防抖）
// 旧固定阈值仅留作诊断参照，不再参与切段。
export const MARCH_VERT_SPEED_ENTER_PX_S = 120;
export const MARCH_VERT_SPEED_EXIT_PX_S = 60;
// 垂直活动能量的居中平滑窗口（帧）；压掉着地/摆动顶点处的瞬时 vy=0
export const MARCH_SMOOTH_WINDOW = 5;

// ---- 踏步稳态裁边（v1.3）----
// 平滑能量 ≥ 中位值 ×(1-此带) 视为稳定中段；裁后若短于 MIN_SEGMENT_MS
// 则回退到段内真实帧边界（裁边只用于削起步/止步弱拍，绝不允许把段裁没）。
export const MARCH_STEADY_BAND = 0.5;

// ---- 指标 ----
export const MAX_STEP_GAP_MS = 2000;
/**
 * 交替步间隔下界保护（ms）：单侧异侧相邻 strike 间隔小于此值时
 * 生理上不可能（正常步频约 1.5–2.5 步/秒，半拍 ≥200ms），视为误检剔除。
 */
export const MIN_ALTERNATING_STEP_GAP_MS = 200;
export const ANKLE_SEPARABLE_RATIO = 0.2; // 踝水平距 / 小腿长
export const SEPARABLE_PASS_RATIO = 0.7; // 可分帧达标比例（§3.3 视角门控）

// ---- 指标分级阈值（demo 筛查口径，非临床诊断；见 disclaimer）----
// symmetry：0–100 越大越好
export const SYM_GREEN = 85;
export const SYM_YELLOW = 70;
// stability：内部稳健变异系数 rCV% 越小越好（对外为 0–100 稳定度得分）
export const CV_GREEN = 8;
export const CV_YELLOW = 15;
// speed（m/s）：筛查口径，过慢提示跌倒/功能风险
export const SPEED_GREEN_MIN = 0.8;
export const SPEED_GREEN_MAX = 1.8;
export const SPEED_YELLOW_MIN = 0.6;
// strideLength（m）：成年人自然步幅参考区间
export const STRIDE_GREEN_MIN = 0.9;
export const STRIDE_GREEN_MAX = 1.8;
export const STRIDE_YELLOW_MIN = 0.7;

// 单次会话「严重异常」候选 seekCare（低置信度时不得硬下）
export const SYM_SEVERE = 60;
export const CV_SEVERE = 25;
export const SPEED_SEVERE = 0.5;

// ---- 历史纵向规则（ruleEngine）----
export const HISTORY_MIN_BASELINE = 2; // 至少 2 次历史才做纵向比较
export const WORSEN_SYM_DROP_PP = 10; // symmetry 较基线降幅
export const SPEED_DECLINE_REL = 0.15; // 步速累计下滑比例
export const LOW_CONFIDENCE_GATE = 0.55; // 低于此值禁止硬下 seekCare

// ---- analyzeSession 失败门控（B-1：算不出 = 测量失败，非疾病结论）----
export const MIN_SESSION_FRAMES = 30; // 低于此帧数无法代表一次走测（约 1.5s@20fps）
export const MIN_HEEL_STRIKES_PER_SIDE = 3; // 每侧至少 3 次跟着地才算测得该侧
export const SESSION_MIN_CONFIDENCE = 0.5; // 整体事件置信度均值低于此值 = 低置信失败

// ---- 综合评分权重 ----
export const SCORE_WEIGHTS = {
  symmetry: 0.35,
  stability: 0.3,
  speed: 0.2,
  strideLength: 0.15,
} as const;
export const CV_SCORE_SCALE = 4; // stability 分 = 100 - cv*4

// ---- 评分映射（metricScore 分段线性）----
export const SCORE_FULL = 100; // 满分 / 截断上限
export const SCORE_FLOOR = 40; // speed/stride 分段映射的起评分
export const SCORE_NEUTRAL = 60; // 未测量（value=null）时给的中性分
export const SPEED_SCORE_REF_MPS = 0.6; // 速度评分起算点：0.6 m/s → 40 分
export const SPEED_SCORE_FULL_MPS = 1.2; // 1.2 m/s → 100 分
export const STRIDE_SCORE_REF_M = 0.7; // 步幅评分起算点：0.7 m → 40 分
export const STRIDE_SCORE_FULL_M = 1.2; // 1.2 m → 100 分

// ---- 尺度校准 ----
export const BODY_NOSE_TO_ANKLE_RATIO = 0.875; // 鼻-踝距 / 真实身高

// ---- 固定文案（医疗安全：常驻）----
export const DISCLAIMER =
  '本结果仅供日常健康与康复参考，不能取代医生或物理治疗师的诊断。如出现疼痛、跌倒或其他疑虑，请咨询专业人士。';
