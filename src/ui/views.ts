/**
 * ui/views.ts（各页面视图渲染）
 * ------------------------------------------------------------------
 * 每个视图都是一个 render 函数：输入依赖容器 + 导航器，输出一个可挂载
 * 的 HTMLElement，并在内部绑定本页事件。视图：
 *   - homeView    ：产品说明 + 开始入口 + 隐私要点
 *   - setupView   ：拍摄指引（斜角 30–45°/光线/平地原地踏步）+ 语音开关 + 进入测量
 *   - reportView  ：展示最近一次报告（指标卡 + 严重预警 + 免责）
 *   - historyView ：历史列表 + 趋势图 + 删除
 * 测量页因为含相机+实时骨架+计时，单独放在 measurementView.ts。
 *
 * 所有历史/用户文本经 escapeHtml 插入，避免 XSS。
 */
import type { Metric, ReportRecord } from "../contracts/types";
import { metricList } from "../domain/report";
import { buildAlertBanner } from "./alertBanner";
import { delegate, escapeHtml, h } from "./dom";
import { ROUTES } from "./constants";
import { buildTrendChart } from "./trendChart";
import type { AppContext } from "./appContext";

type Navigate = (route: string) => void;

const LEVEL_LABEL: Record<Metric["level"], string> = {
  green: "良好",
  yellow: "留意",
  red: "需關注",
  none: "未測量",
};

/** 指标卡 */
function metricCard(metric: Metric): HTMLElement {
  const value = metric.value === null ? "—" : `${metric.value}${metric.unit === "cv" ? "%" : " " + metric.unit}`;
  const card = h("div", { className: `metric-card level-${metric.level}` });
  card.append(
    h("div", { className: "metric-label", text: metric.label }),
    h("div", { className: "metric-value", text: value }),
    h("div", { className: "metric-level", text: LEVEL_LABEL[metric.level] }),
    h("div", { className: "metric-hint", text: metric.hint }),
  );
  if (!metric.calibrated) card.append(h("div", { className: "metric-uncali", text: "未標定" }));
  return card;
}

/** 首页 */
export function homeView(_ctx: AppContext, navigate: Navigate): HTMLElement {
  const hero = h("section", { className: "hero card" });
  hero.append(
    h("h1", { text: "用手機鏡頭，記錄你的步態" }),
    h("p", {
      text: "GaitTrace 喺手機本機以斜角影像、靠原地踏步估算左右對稱同步間穩定，幫你長期自我追蹤。影片唔會離開裝置。",
    }),
  );
  const cta = h("button", { className: "button primary", text: "開始準備" });
  cta.addEventListener("click", () => navigate(ROUTES.SETUP));
  hero.appendChild(cta);

  const privacy = h("section", { className: "privacy-points card" });
  privacy.append(
    h("h2", { text: "私隱與安全" }),
    h("ul", {}, [
      h("li", { text: "影片只用於即時姿態估算，不上傳、不儲存影片。" }),
      h("li", { text: "報告只存於本機瀏覽器，可隨時刪除。" }),
      h("li", { text: "結果為篩查用途，出現不適請及時就醫。" }),
    ]),
  );

  return h("div", { className: "stack" }, [hero, privacy]);
}

/** 准备页（拍摄指引 + 语音开关） */
export function setupView(ctx: AppContext, navigate: Navigate): HTMLElement {
  const card = h("section", { className: "card setup-card" });
  card.append(
    h("h1", { text: "拍攝前準備" }),
    h("ol", { className: "guide-list" }, [
      h("li", { text: "搵個平坦、光線充足、大約一塊墊咁大嘅位置，將手機擺穩。" }),
      h("li", { text: "手機擺喺斜側大約 30–45°（唔好正對身體嘅正側面），令雙腳喺畫面入面左右錯開，全身、尤其雙腳都要入鏡。" }),
      h("li", { text: "聽到提示之後原地抬膝踏步，節奏保持穩定，全程大約 12 秒。" }),
    ]),
  );

  const label = h("label", { className: "switch-row" });
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = ctx.isVoiceEnabled();
  checkbox.addEventListener("change", () => ctx.setVoiceEnabled(checkbox.checked));
  label.append(checkbox, h("span", { text: "開啟語音提示" }));
  card.appendChild(label);

  const tip = h("p", {
    className: "setup-tip",
    text: "測量影片只在本機即時分析，不會上傳，也不會儲存影片。",
  });
  const start = h("button", { className: "button primary", text: "進入測量" });
  start.addEventListener("click", () => navigate(ROUTES.MEASUREMENT));
  card.append(tip, start);

  return h("div", { className: "stack" }, [card]);
}

/** 报告页：展示最近一次报告 */
export function reportView(ctx: AppContext, navigate: Navigate): HTMLElement {
  const record = ctx.lastRecord;
  if (!record) {
    const empty = h("section", { className: "card empty-state" });
    const btn = h("button", { className: "button primary", text: "去測量" });
    btn.addEventListener("click", () => navigate(ROUTES.MEASUREMENT));
    empty.append(h("h1", { text: "尚無報告" }), h("p", { text: "完成一次測量後，這裡會顯示結果。" }), btn);
    return h("div", { className: "stack" }, [empty]);
  }

  const card = h("section", { className: "card report-card" });
  card.append(
    h("h1", { text: "本次報告" }),
    h("div", {
      className: "report-date",
      text: new Date(record.createdAtMs).toLocaleString("zh-HK"),
    }),
  );

  const alert = buildAlertBanner(record);
  if (alert) card.appendChild(alert);

  const grid = h("div", { className: "metric-grid" });
  metricList(record.metrics).forEach((metric) => grid.appendChild(metricCard(metric)));
  card.appendChild(grid);

  card.append(
    h("p", { className: "disclaimer", text: record.conclusion.disclaimer }),
  );

  const actions = h("div", { className: "row-actions" });
  const again = h("button", { className: "button primary", text: "再測一次" });
  again.addEventListener("click", () => navigate(ROUTES.MEASUREMENT));
  const history = h("button", { className: "button ghost", text: "看歷史" });
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
  row.append(
    h("div", {
      className: "history-date",
      text: new Date(record.createdAtMs).toLocaleString("zh-HK"),
    }),
    h("div", {
      className: "history-sym",
      text: symmetry === null ? "未測量" : `對稱 ${symmetry}%`,
    }),
  );
  const del = h("button", { className: "button tiny ghost", text: "刪除" });
  del.dataset.action = "delete";
  del.dataset.sessionId = record.sessionId;
  row.appendChild(del);
  return row;
}

/** 历史页：列表 + 趋势图 + 删除 */
export async function historyView(ctx: AppContext, navigate: Navigate): Promise<HTMLElement> {
  const wrap = h("div", { className: "stack" });
  const card = h("section", { className: "card" });
  card.append(h("h1", { text: "歷史記錄" }));

  let records: ReportRecord[] = [];
  try {
    records = await ctx.store.getAll();
  } catch (error) {
    card.appendChild(h("p", { className: "error-text", text: "無法讀取本機歷史。" }));
    void error;
  }

  if (records.length === 0) {
    const btn = h("button", { className: "button primary", text: "去測量" });
    btn.addEventListener("click", () => navigate(ROUTES.MEASUREMENT));
    card.append(h("p", { text: "還沒有記錄。" }), btn);
  } else {
    const list = h("div", { className: "history-list" });
    records.forEach((record) => list.appendChild(historyRow(record)));
    card.appendChild(list);

    const trends = h("div", { className: "trend-wrap" });
    trends.append(
      h("h2", { text: "對稱趨勢" }),
      buildTrendChart(records, "symmetry"),
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
