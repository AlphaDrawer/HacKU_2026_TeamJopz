/**
 * ui/appContext.ts（应用依赖容器 / 轻量状态）
 * ------------------------------------------------------------------
 * 采用「依赖注入」而非在各视图里直接 new：
 *  - 视图只依赖 GaitCore / ReportStore【接口】，不知道背后是真实
 *    MediaPipe 实现还是 MockGaitCore。切换真实 core 只改这一个文件。
 *  - 保存跨视图的少量会话状态（当前 sessionId、最近报告、语音开关）。
 *
 * 当前默认注入真实 createGaitCore()（MediaPipe）。若需离线测试，可把
 * createCore() 换成 MockGaitCore，视图与测量会话无需改动。
 */
import type { GaitCore, ReportRecord, ReportStore } from "../contracts/types";
import { LocalReportStore } from "../services/storage";
import { VoicePrompt } from "../services/voicePrompt";
import { createGaitCore } from "../core";
import { VOICE_STORAGE_KEY } from "./constants";

export interface AppContext {
  core: GaitCore;
  store: ReportStore;
  voice: VoicePrompt;
  /** 读取语音开关（持久化在 localStorage） */
  isVoiceEnabled(): boolean;
  setVoiceEnabled(enabled: boolean): void;
  /** 最近一次报告（供 report 视图直接展示，避免再查一次库） */
  lastRecord: ReportRecord | null;
  setLastRecord(record: ReportRecord | null): void;
}

/** 创建 GaitCore：真实 MediaPipe 实现（算法层 src/core） */
function createCore(): GaitCore {
  return createGaitCore();
}

function readVoiceEnabled(): boolean {
  try {
    return localStorage.getItem(VOICE_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function createAppContext(): AppContext {
  const ctx: AppContext = {
    core: createCore(),
    store: new LocalReportStore(),
    voice: new VoicePrompt(),
    lastRecord: null,
    isVoiceEnabled: () => readVoiceEnabled(),
    setVoiceEnabled: (enabled: boolean) => {
      try {
        localStorage.setItem(VOICE_STORAGE_KEY, enabled ? "1" : "0");
      } catch {
        // 隐私模式下 localStorage 可能不可用，忽略即可
      }
    },
    setLastRecord: (record) => {
      ctx.lastRecord = record;
    },
  };
  return ctx;
}
