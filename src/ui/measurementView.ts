/**
 * ui/measurementView.ts（测量页：相机 + 实时骨架 + 倒计时/计时）
 * ------------------------------------------------------------------
 * 本视图只负责「画面与交互」，测量流程全部交给 MeasurementSession：
 *   - 建立视频元素（object-fit:contain）+ 叠加画布（骨架）
 *   - 请求相机；失败显示可理解的错误文案
 *   - 启动 MeasurementSession，用其回调更新倒计时、进度、骨架
 *   - analyzeSession 回 ok:false 或主指标缺失时：不显示任何分数，
 *     改弹大白话「這次沒測準，請重新走一次」+ 重走入口（原地重开）
 *   - 离开页面时停相机、取消会话（生命周期清理）
 *
 * 返回对象带 destroy()，由 router 在切路由时统一清理，杜绝旧版
 * 「相机/监听器泄漏」问题。
 */
import type { PoseFrame } from "../contracts/types";
import { CameraController, CameraError } from "../services/cameraController";
import { SkeletonRenderer, type CycleMark } from "../services/skeletonRenderer";
import { h } from "./dom";
import { ROUTES } from "./constants";
import { MeasurementSession, type SessionFailure } from "./measurementSession";
import type { AppContext } from "./appContext";

type Navigate = (route: string) => void;

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
  const status = h("div", { className: "measure-status", text: "正在準備相機…" });

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
  const retryBtn = h("button", { className: "button primary", text: "重新走一次" });
  failCard.append(
    h("h2", { text: "這次沒測準" }),
    h("p", { className: "retry-msg", text: "可能是畫面不夠清楚、光線不足，或沒有完整拍到全身。" }),
    h("p", { className: "retry-tip", text: "請按準備頁要領，重新走一次。" }),
    retryBtn,
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

  /** 全新开始一次会话（首次与「重新走一次」共用） */
  function startSession(): void {
    latestFrame = null;
    progressFill.style.width = "0%";

    session = new MeasurementSession(ctx.core, ctx.store, video, MODEL_URL, {
      onCountdown: (remain) => {
        status.textContent = remain > 0 ? `準備…${remain}` : "開始行走";
      },
      onTick: (elapsedSec, totalSec) => {
        status.textContent = `測量中 ${elapsedSec}/${totalSec} 秒`;
        progressFill.style.width = `${(elapsedSec / totalSec) * 100}%`;
      },
      onFrame: (frame) => {
        latestFrame = frame;
      },
      onDone: (record) => {
        ctx.setLastRecord(record);
        if (ctx.isVoiceEnabled()) {
          ctx.voice.speak("測量完成", true);
        }
        if (!destroyed) navigate(ROUTES.REPORT);
      },
      onFail: (failure: SessionFailure) => {
        if (destroyed) return;
        // 绝不显示分数：隐藏测量画面，只给大白话 + 重走入口
        void failure; // 文案对用户统一为「没测准」，reason 留作诊断/日志
        showRetryCard();
      },
      onError: () => {
        if (!destroyed) showRetryCard();
      },
    });
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
        if (!destroyed) showRetryCard("相機已中斷，請重新走一次。");
      };
    } catch (error) {
      // 相机不可用就无法真实测量：如实提示并给返回入口，不再假装模拟
      const message = error instanceof CameraError ? error.message : "無法開啟相機。";
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
    failCard.querySelector(".retry-tip")?.replaceWith(h("p", { className: "retry-tip", text: "請檢查相機權限後返回準備頁重試。" }));
    retryBtn.textContent = "返回準備頁";
  }

  /** 没测准：隐藏测量画面，显示大白话重走卡片 */
  function showRetryCard(headingMsg?: string): void {
    stage.hidden = true;
    progressBar.hidden = true;
    status.textContent = "";
    failCard.hidden = false;
    retryBtn.textContent = "重新走一次";
    if (headingMsg) {
      failCard.querySelector(".retry-msg")?.replaceWith(h("p", { className: "retry-msg", text: headingMsg }));
    }
  }

  // 重走：先停掉旧会话，恢复测量画面，再开新会话（相机复用）
  retryBtn.addEventListener("click", () => {
    if (retryBtn.textContent === "返回準備頁") {
      navigate(ROUTES.SETUP);
      return;
    }
    session?.cancel();
    failCard.hidden = true;
    stage.hidden = false;
    progressBar.hidden = false;
    status.textContent = "準備…";
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
