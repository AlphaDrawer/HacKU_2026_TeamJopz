/**
 * ui/measurementView.ts（测量页：相机 + 实时骨架 + 倒计时/计时）
 * ------------------------------------------------------------------
 * 本视图只负责「画面与交互」，测量流程全部交给 MeasurementSession：
 *   - 建立视频元素（object-fit:contain）+ 叠加画布（骨架）
 *   - 请求相机；失败显示可理解的错误文案
 *   - 启动 MeasurementSession，用其回调更新倒计时、进度、骨架
 *   - analyzeSession 回 ok:false 或主指标缺失时：不显示任何分数，
 *     改弹大白话「这次没测准，请再测一次」+ 重测入口（原地重开）
 *   - 离开页面时停相机、取消会话（生命周期清理）
 *
 * 返回对象带 destroy()，由 router 在切路由时统一清理，杜绝旧版
 * 「相机/监听器泄漏」问题。
 */
import type { PoseFrame } from "../contracts/types";
import { CameraController, CameraError } from "../services/cameraController";
import { SkeletonRenderer, type CycleMark } from "../services/skeletonRenderer";
import { h } from "./dom";
import { ROUTES, HEIGHT_STORAGE_KEY } from "./constants";
import { MeasurementSession, type SessionFailure } from "./measurementSession";
import type { AppContext } from "./appContext";

type Navigate = (route: string) => void;

/**
 * 读取准备页记住的身高（厘米）；无记录、格式非法或 localStorage
 * 不可用时返回 null（按未校准处理，不阻断测量）。
 */
function readHeightCm(): number | null {
  try {
    const raw = window.localStorage.getItem(HEIGHT_STORAGE_KEY);
    if (raw === null || raw.trim() === "") return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    return value;
  } catch {
    return null;
  }
}

/**
 * 模型地址：真实 core 用它加载 pose 模型。
 * 地址按部署 base 拼同源路径（模型文件由算法/部署侧放入 public/models）。
 */
const MODEL_URL = `${import.meta.env.BASE_URL}models/pose_landmarker_lite.task`;

export function measurementView(ctx: AppContext, navigate: Navigate): { el: HTMLElement; destroy(): void } {
  let destroyed = false;
  let session: MeasurementSession | null = null;
  const camera = new CameraController();

  const wrap = h("section", { className: "card measure-card" });

  // 状态文本（倒计时 / 计时 / 错误）
  const status = h("div", { className: "measure-status", text: "正在准备相机…" });

  // 视频 + 叠加画布（同一容器，均 contain，保证对齐）
  const stage = h("div", { className: "measure-stage" });
  const video = document.createElement("video");
  video.className = "measure-video";
  video.muted = true;
  video.playsInline = true;
  const canvas = document.createElement("canvas");
  canvas.className = "measure-overlay";
  stage.append(video, canvas);

  // 进度条
  const progressBar = h("div", { className: "progress" });
  const progressFill = h("div", { className: "progress-fill" });
  progressBar.appendChild(progressFill);

  const cancelBtn = h("button", { className: "button ghost", text: "取消" });
  wrap.append(status, stage, progressBar, cancelBtn);

  // ---- 失败卡片（默认隐藏）：没测准时替代分数展示 ----
  const failCard = h("div", { className: "retry-card", attrs: { hidden: "" } });
  const retryBtn = h("button", { className: "button primary", text: "再测一次" });
  const failDiag = h("p", { className: "retry-diag" });
  failCard.append(
    h("h2", { text: "这次没测准" }),
    h("p", { className: "retry-msg", text: "可能是画面不够清楚、光线不足、没有完整拍到全身，或者踏步/来回走不够稳定。" }),
    h("p", { className: "retry-tip", text: "请按照准备页的要求，摆好斜角，再测一次。" }),
    retryBtn,
    failDiag,
  );
  wrap.appendChild(failCard);

  const renderer = new SkeletonRenderer(canvas);
  let latestFrame: PoseFrame | null = null;

  /** 用 rAF 把最新一帧画到叠加层（与会话的取帧解耦） */
  const renderLoop = (): void => {
    if (destroyed) return;
    const rect = stage.getBoundingClientRect();
    if (canvas.width !== Math.round(rect.width * (window.devicePixelRatio || 1))) {
      renderer.resize(rect.width, rect.height);
    }
    renderer.draw({
      videoWidth: video.videoWidth || 640,
      videoHeight: video.videoHeight || 480,
      frame: video.videoWidth ? latestFrame : null,
    });
    requestAnimationFrame(renderLoop);
  };

  // 读取准备页记住的身高（厘米）；解析失败或隐私模式下 localStorage
  // 不可用时按未提供身高处理（speed/stride 不校准）。
  const heightCm: number | null = readHeightCm();

  /** 全新开始一次会话（首次与「再测一次」共用） */
  function startSession(): void {
    latestFrame = null;
    progressFill.style.width = "0%";

    session = new MeasurementSession(
      ctx.core,
      ctx.store,
      video,
      MODEL_URL,
      {
        onCountdown: (remain) => {
          status.textContent = remain > 0 ? `准备…${remain}` : "开始";
        },
        onTick: (elapsedSec, totalSec) => {
          status.textContent = `测量中 ${elapsedSec}/${totalSec} 秒`;
          progressFill.style.width = `${(elapsedSec / totalSec) * 100}%`;
        },
        onFrame: (frame) => {
          latestFrame = frame;
        },
        onDone: (record) => {
          ctx.setLastRecord(record);
          if (ctx.isVoiceEnabled()) {
            ctx.voice.speak("测量完成", true);
          }
          if (!destroyed) navigate(ROUTES.REPORT);
        },
        onFail: (failure: SessionFailure) => {
          if (destroyed) return;
          // 绝不显示分数：隐藏测量画面，只给大白话 + 重测入口。
          // 诊断行（v1.3）：除 reason/message 外，把模式/髋摆幅/切段/事件/
          // 能量统计一并展开，真机一失败即可定位卡点（模式误判 / 入不了段 /
          // 裁太短 / 事件不足 / 低置信）。只读诊断，不改变任何门控结果。
          const d = failure.debug;
          const segDetail = d
            ? d.segments
                .map(
                  (sg, i) =>
                    `段${i + 1}:${sg.direction} ${sg.startMs}-${sg.endMs}ms/${(
                      sg.durationMs / 1000
                    ).toFixed(1)}s`,
                )
                .join("；")
            : "";
          const diagParts = [
            `[诊断] ${failure.reason}｜${failure.message}`,
            d ? `模式=${d.mode}` : "",
            d
              ? `髋摆幅=${Math.round(d.hipRangePx)}px(阈值${d.marchHipRangePx})`
              : "",
            d
              ? `段数=${d.segmentCount}${segDetail ? "｜" + segDetail : ""}`
              : "",
            d
              ? `跟着地 左${d.strikesLeft}/右${d.strikesRight}｜关键关节可见度=${(
                  d.meanJointVisibility * 100
                ).toFixed(0)}%`
              : "",
            d
              ? `踝能量 中位${Math.round(d.energyMedianPxS)}/峰值${Math.round(
                  d.energyPeakPxS,
                )}px·s⁻¹｜入段阈值${Math.round(d.energyEnterPxS)}(旧固定阈值${
                  d.legacyEnterPxS
                })`
              : "",
          ];
          failDiag.textContent = diagParts.filter(Boolean).join("｜");
          showRetryCard();
        },
        onError: () => {
          if (!destroyed) showRetryCard();
        },
      },
      heightCm,
    );
    void session.start();
  }

  const begin = async (): Promise<void> => {
    try {
      // 请求并附加相机（真机路径）
      const stream = await camera.start();
      if (destroyed) {
        camera.stop();
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      camera.onEnded = () => {
        if (!destroyed) showRetryCard("相机已中断，请再测一次。");
      };
    } catch (error) {
      // 相机不可用就无法真实测量：如实提示并给返回入口，不再假装模拟
      const message = error instanceof CameraError ? error.message : "无法开启相机。";
      showCameraError(message);
      return;
    }

    if (destroyed) return;
    requestAnimationFrame(renderLoop);
    startSession();
  };

  /** 相机打不开：显示错误 + 返回准备页 */
  function showCameraError(message: string): void {
    stage.hidden = true;
    progressBar.hidden = true;
    failCard.hidden = false;
    failCard.querySelector(".retry-msg")?.replaceWith(h("p", { className: "retry-msg", text: message }));
    failCard.querySelector(".retry-tip")?.replaceWith(h("p", { className: "retry-tip", text: "请检查相机权限后返回准备页重试。" }));
    retryBtn.textContent = "返回准备页";
    failDiag.textContent = "";
  }

  /** 没测准：隐藏测量画面，显示大白话重走卡片 */
  function showRetryCard(headingMsg?: string): void {
    stage.hidden = true;
    progressBar.hidden = true;
    status.textContent = "";
    failCard.hidden = false;
    retryBtn.textContent = "再测一次";
    if (headingMsg) {
      failCard.querySelector(".retry-msg")?.replaceWith(h("p", { className: "retry-msg", text: headingMsg }));
    }
  }

  // 重走：先停掉旧会话，恢复测量画面，再开新会话（相机复用）
  retryBtn.addEventListener("click", () => {
    if (retryBtn.textContent === "返回准备页") {
      navigate(ROUTES.SETUP);
      return;
    }
    session?.cancel();
    failCard.hidden = true;
    stage.hidden = false;
    progressBar.hidden = false;
    status.textContent = "准备…";
    startSession();
  });

  cancelBtn.addEventListener("click", () => navigate(ROUTES.SETUP));

  void begin();

  return {
    el: wrap,
    destroy: () => {
      destroyed = true;
      session?.cancel();
      camera.stop();
      ctx.voice.stop();
    },
  };
}

// 周期标记类型在完成真实事件接线后会用到；此处保留导出引用以便联调
export type { CycleMark };
