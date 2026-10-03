/**
 * ui/alertBanner.ts（单次严重异常预警条）
 * 规范 §4.4：当结论 alertLevel=seekCare 时显示醒目、克制的就医提示，
 * 不制造恐慌、也不淡化。纯展示组件。
 */
import type { ReportRecord } from "../contracts/types";
import { h } from "./dom";

export function buildAlertBanner(record: ReportRecord): HTMLElement | null {
  if (record.conclusion.alertLevel !== "seekCare") return null;

  const banner = h("div", { className: "alert-banner seek-care" });
  const title = h("strong", { text: "需要盡快關注" });
  const body = h("p", {
    text:
      record.conclusion.alerts[0] ??
      "本次測量出現明顯異常訊號，建議盡快聯絡醫護人員進行專業評估。",
  });
  const note = h("small", { text: "此提示不等同診斷結果。" });
  banner.append(title, body, note);
  return banner;
}
