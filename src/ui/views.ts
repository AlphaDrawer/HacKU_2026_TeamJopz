/**
 * ui/views.ts（各页面视图渲染）
 * ------------------------------------------------------------------
 * 每个视图都是一个 render 函数：输入依赖容器 + 导航器，输出一个可挂载
 * 的 HTMLElement，并在内部绑定本页事件。视图：
 *   - homeView    ：产品说明 + 开始入口 + 隐私要点
 *   - setupView   ：拍摄指引（斜角 30–45°/光线/平地）+ 身高输入 + 语音开关
 *   - reportView  ：运动类型徽章 + 指标卡 + 严重预警 + 康复运动 + 免责
 *   - historyView ：历史列表 + 趋势图 + 删除
 * 测量页因为含相机+实时骨架+计时，单独放在 measurementView.ts。
 *
 * 所有历史/用户文本经 escapeHtml 插入，避免 XSS。
 */
import type { Metric, ReportRecord, Exercise } from "../contracts/types";
import { metricList } from "../domain/report";
import { buildAlertBanner } from "./alertBanner";
import { delegate, escapeHtml, h } from "./dom";
import { formatMetric, formatPercent } from "./format";
import { ROUTES, HEIGHT_STORAGE_KEY, MEASUREMENT_DURATION_SEC } from "./constants";
import { buildTrendChart } from "./trendChart";
import type { AppContext } from "./appContext";

type Navigate = (route: string) => void;

/** 身高合法范围（厘米），超出范围的输入不用于校准并给出内联提示 */
const HEIGHT_MIN_CM = 100;
const HEIGHT_MAX_CM = 220;

const LEVEL_LABEL: Record<Metric["level"], string> = {
  green: "良好",
  yellow: "留意",
  red: "需关注",
  none: "未测量",
};

/** 指标卡（显示值统一按指标类型格式化，存储值不动） */
function metricCard(metric: Metric): HTMLElement {
  const value = formatMetric(metric);
  const card = h("div", { className: `metric-card level-${metric.level}` });
  card.append(
    h("div", { className: "metric-label", text: metric.label }),
    h("div", { className: "metric-value", text: value }),
    h("div", { className: "metric-level", text: LEVEL_LABEL[metric.level] }),
    h("div", { className: "metric-hint", text: metric.hint }),
  );
  if (!metric.calibrated) card.append(h("div", { className: "metric-uncali", text: "未标定" }));
  return card;
}

/** 读取 localStorage 中上次输入的身高；无记录或不可读时返回空串 */
function readStoredHeight(): string {
  try {
    return localStorage.getItem(HEIGHT_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * 校验身高输入。返回 { value, error }：
 * - 空串视为选填未填：value=null，无错误；
 * - 合法数字且在 100–220cm：value 为该数字；
 * - 否则 error 为内联提示文案。
 */
function parseHeight(raw: string): { value: number | null; error: string | null } {
  const t = raw.trim();
  if (t === "") return { value: null, error: null };
  const n = Number(t);
  if (!Number.isFinite(n)) {
    return { value: null, error: "请输入数字，或留空不填。" };
  }
  if (n < HEIGHT_MIN_CM || n > HEIGHT_MAX_CM) {
    return { value: null, error: `身高需在 ${HEIGHT_MIN_CM}–${HEIGHT_MAX_CM} 厘米之间；本次将按未校准处理。` };
  }
  return { value: n, error: null };
}

/** 首页 */
export function homeView(_ctx: AppContext, navigate: Navigate): HTMLElement {
  const hero = h("section", { className: "hero card" });
  hero.append(
    h("h1", { text: "用手机镜头，记录你的步态" }),
    h("p", {
      text: "GaitTrace 在手机本地通过斜角拍摄，评估原地踏步或短距离来回走时的左右对称度与步间稳定度，帮助你长期自我追踪。视频不会离开设备。",
    }),
  );
  const cta = h("button", { className: "button primary", text: "开始准备" });
  cta.addEventListener("click", () => navigate(ROUTES.SETUP));
  hero.appendChild(cta);

  const privacy = h("section", { className: "privacy-points card" });
  privacy.append(
    h("h2", { text: "隐私与安全" }),
    h("ul", {}, [
      h("li", { text: "视频仅用于实时姿态估算，不上传、不保存视频。" }),
      h("li", { text: "报告仅保存在本机浏览器，可随时删除。" }),
      h("li", { text: "结果用于筛查，如有不适请及时就医。" }),
    ]),
  );

  return h("div", { className: "stack" }, [hero, privacy]);
}

/** 准备页（拍摄指引 + 身高输入 + 语音开关） */
export function setupView(ctx: AppContext, navigate: Navigate): HTMLElement {
  const card = h("section", { className: "card setup-card" });
  card.append(
    h("h1", { text: "拍摄前准备" }),
    h("ol", { className: "guide-list" }, [
      h("li", { text: "找一块平坦、光线充足、大约一块地垫大小的位置，把手机放稳。" }),
      h("li", { text: "手机放在身体斜侧约 30–45°（不要正对身体的正侧面），让双脚在画面中左右错开，全身尤其是双脚都要入镜。" }),
      h("li", {}, [
        h("p", { text: `测量动作（二选一）：节奏保持稳定，全程约 ${MEASUREMENT_DURATION_SEC} 秒。` }),
        h("p", { text: "方式一（推荐）：原地高抬腿踏步。最省空间，也最不容易走出画面。" }),
        h("p", {
          text: "方式二：在这块小范围内斜角 30–45°「来回走」——走到边缘就缓慢转身往回走，不要走出画面；系统会自动忽略转身，只统计稳定行走的部分。",
        }),
      ]),
    ]),
  );

  // 身高（选填，用于步行模式校准速度与步幅；踏步模式不用）
  const heightField = h("div", { className: "height-field" });
  const heightInput = document.createElement("input");
  heightInput.type = "number";
  heightInput.inputMode = "numeric";
  heightInput.min = String(HEIGHT_MIN_CM);
  heightInput.max = String(HEIGHT_MAX_CM);
  heightInput.step = "1";
  heightInput.placeholder = "例如 170";
  heightInput.value = readStoredHeight();
  heightInput.setAttribute("aria-describedby", "height-hint");
  heightField.append(
    h("label", {
      className: "height-label",
      attrs: { for: "height-input" },
      text: "身高（厘米，选填，用于步行时校准速度和步幅）",
    }),
    heightInput,
    h("small", { className: "field-hint", text: "踏步时无需校准；留空则速度与步幅不计算。" }),
    h("div", { className: "inline-error", attrs: { role: "alert" } }),
  );
  heightInput.id = "height-input";
  card.appendChild(heightField);

  const label = h("label", { className: "switch-row" });
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = ctx.isVoiceEnabled();
  checkbox.addEventListener("change", () => ctx.setVoiceEnabled(checkbox.checked));
  label.append(checkbox, h("span", { text: "开启语音提示" }));
  card.appendChild(label);

  const tip = h("p", {
    className: "setup-tip",
    text: "测量视频只在本机实时分析，不会上传，也不会保存视频。",
  });
  const start = h("button", { className: "button primary", text: "进入测量" });
  start.addEventListener("click", () => {
    const parsed = parseHeight(heightInput.value);
    const errorEl = heightField.querySelector(".inline-error");
    if (parsed.error !== null) {
      // 非法身高：内联提示，不记住、不进入
      if (errorEl) errorEl.textContent = parsed.error;
      heightInput.classList.add("input-invalid");
      heightInput.focus();
      return;
    }
    if (errorEl) errorEl.textContent = "";
    heightInput.classList.remove("input-invalid");
    // 合法（含选填留空）：记住，供测量页读取
    try {
      if (parsed.value === null) localStorage.removeItem(HEIGHT_STORAGE_KEY);
      else localStorage.setItem(HEIGHT_STORAGE_KEY, String(parsed.value));
    } catch {
      // 隐私模式下不可持久化，本次测量仍可继续
    }
    navigate(ROUTES.MEASUREMENT);
  });
  // 输入时即时清除上一次的错误提示
  heightInput.addEventListener("input", () => {
    heightInput.classList.remove("input-invalid");
    const errorEl = heightField.querySelector(".inline-error");
    if (errorEl) errorEl.textContent = "";
  });
  card.append(tip, start);

  return h("div", { className: "stack" }, [card]);
}

/** 运动类型徽章：原地踏步 / 短距离来回走 */
function activityBadge(mode: ReportRecord["activityMode"]): HTMLElement {
  if (mode === "march") {
    return h("span", { className: "activity-badge activity-march", text: "原地踏步" });
  }
  return h("span", { className: "activity-badge activity-walk", text: "短距离来回走" });
}

/** 单个康复运动卡片：名称 + 步骤 + 注意事项 */
function exerciseCard(exercise: Exercise, openByDefault: boolean): HTMLElement {
  const details = h("details", { className: "exercise-card" });
  if (openByDefault) details.open = true;
  const summary = h("summary", { text: exercise.name });
  details.appendChild(summary);

  const body = h("div", { className: "exercise-body" });
  if (exercise.steps.length > 0) {
    const stepsList = h("ol", { className: "exercise-steps" });
    exercise.steps.forEach((step) => {
      stepsList.appendChild(h("li", { text: step }));
    });
    body.appendChild(h("div", { className: "exercise-subtitle", text: "动作步骤" }));
    body.appendChild(stepsList);
  }
  if (exercise.cautions.length > 0) {
    const cautionList = h("ul", { className: "rec-cautions" });
    exercise.cautions.forEach((caution) => {
      cautionList.appendChild(h("li", { text: caution }));
    });
    body.appendChild(h("div", { className: "exercise-subtitle caution", text: "注意事项" }));
    body.appendChild(cautionList);
  }
  details.appendChild(body);
  return details;
}

/** 康复运动推荐区块（可展开/折叠，默认展开第一个） */
function exercisesSection(exercises: Exercise[]): HTMLElement | null {
  if (exercises.length === 0) return null;
  const section = h("section", { className: "exercises-section" });
  section.appendChild(h("h2", { text: "康复运动推荐" }));
  exercises.forEach((exercise, index) => {
    section.appendChild(exerciseCard(exercise, index === 0));
  });
  return section;
}

/** 报告页：展示最近一次报告 */
export function reportView(ctx: AppContext, navigate: Navigate): HTMLElement {
  const record = ctx.lastRecord;
  if (!record) {
    const empty = h("section", { className: "card empty-state" });
    const btn = h("button", { className: "button primary", text: "去测量" });
    btn.addEventListener("click", () => navigate(ROUTES.MEASUREMENT));
    empty.append(h("h1", { text: "暂无报告" }), h("p", { text: "完成一次测量后，这里会显示结果。" }), btn);
    return h("div", { className: "stack" }, [empty]);
  }

  const card = h("section", { className: "card report-card" });
  const header = h("div", { className: "report-header" });
  header.append(
    h("h1", { text: "本次报告" }),
    activityBadge(record.activityMode),
  );
  card.append(
    header,
    h("div", {
      className: "report-date",
      text: new Date(record.createdAtMs).toLocaleString("zh-CN"),
    }),
  );

  const alert = buildAlertBanner(record);
  if (alert) card.appendChild(alert);

  const grid = h("div", { className: "metric-grid" });
  metricList(record.metrics).forEach((metric) => grid.appendChild(metricCard(metric)));
  card.appendChild(grid);

  const exercises = exercisesSection(record.conclusion.exercises);
  if (exercises) card.appendChild(exercises);

  card.append(
    h("p", { className: "disclaimer", text: record.conclusion.disclaimer }),
  );

  const actions = h("div", { className: "row-actions" });
  const again = h("button", { className: "button primary", text: "再测一次" });
  again.addEventListener("click", () => navigate(ROUTES.MEASUREMENT));
  const history = h("button", { className: "button ghost", text: "查看历史" });
  history.addEventListener("click", () => navigate(ROUTES.HISTORY));
  actions.append(again, history);
  card.appendChild(actions);

  return h("div", { className: "stack" }, [card]);
}

/** 单行历史记录 */
function historyRow(record: ReportRecord): HTMLElement {
  const symmetry = record.metrics.metrics.symmetry.value;
  const row = h("div", { className: `history-row level-${record.conclusion.alertLevel}` });
  row.dataset.sessionId = record.sessionId;
  // 类型小标记 + 日期，便于区分同一时间段的踏步/步行记录
  const modeText = record.activityMode === "march" ? "踏步" : "步行";
  row.append(
    h("div", { className: "history-mode", text: modeText }),
    h("div", {
      className: "history-date",
      text: new Date(record.createdAtMs).toLocaleString("zh-CN"),
    }),
    h("div", {
      className: "history-sym",
      text: symmetry === null ? "未测量" : `对称 ${formatPercent(symmetry)}%`,
    }),
  );
  const del = h("button", { className: "button tiny ghost", text: "删除" });
  del.dataset.action = "delete";
  del.dataset.sessionId = record.sessionId;
  row.appendChild(del);
  return row;
}

/** 历史页：列表 + 趋势图 + 删除 */
export async function historyView(ctx: AppContext, navigate: Navigate): Promise<HTMLElement> {
  const wrap = h("div", { className: "stack" });
  const card = h("section", { className: "card" });
  card.append(h("h1", { text: "历史记录" }));

  let records: ReportRecord[] = [];
  try {
    records = await ctx.store.getAll();
  } catch (error) {
    card.appendChild(h("p", { className: "error-text", text: "无法读取本机历史。" }));
    void error;
  }

  if (records.length === 0) {
    const btn = h("button", { className: "button primary", text: "去测量" });
    btn.addEventListener("click", () => navigate(ROUTES.MEASUREMENT));
    card.append(h("p", { text: "还没有记录。" }), btn);
  } else {
    const list = h("div", { className: "history-list" });
    records.forEach((record) => list.appendChild(historyRow(record)));
    card.appendChild(list);

    const trends = h("div", { className: "trend-wrap" });
    trends.append(
      h("h2", { text: "指标趋势" }),
      h("div", { className: "trend-block" }, [
        h("div", { className: "trend-title", text: "步态对称度" }),
        buildTrendChart(records, "symmetry"),
      ]),
      h("div", { className: "trend-block" }, [
        h("div", { className: "trend-title", text: "步态稳定度" }),
        buildTrendChart(records, "stability"),
      ]),
    );
    card.appendChild(trends);

    // 删除（事件委托）
    delegate(card, "click", '[data-action="delete"]', (target) => {
      const sessionId = target.dataset.sessionId;
      if (!sessionId) return;
      void ctx.store.delete(sessionId).then(() => {
        // 删除后重渲染本页
        navigate(ROUTES.HISTORY);
        // hash 相同时不触发 hashchange，强制刷新当前视图
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
    });
  }

  wrap.appendChild(card);
  return wrap;
}

// 让 escapeHtml 在本模块保持被引用（用于未来扩展动态文案），避免误删
void escapeHtml;
