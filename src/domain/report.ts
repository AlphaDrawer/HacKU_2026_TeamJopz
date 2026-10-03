/**
 * UI-facing contract for the not-yet-integrated algorithm/service layer.
 * A measurement is only reportable once a supplied adapter returns validated
 * metrics and an assessment. The UI must never derive clinical values itself.
 */
export interface GaitMetrics {
  symmetryPct: number | null
  stabilityCvPct: number | null
  speedMps: number | null
  strideLengthM: number | null
}

export type Indicator = 'green' | 'yellow' | 'red'

export interface AlgorithmAssessment {
  compositeScore: number
  summary: string
  indicators: {
    symmetry: Indicator
    stability: Indicator
    speed: Indicator | null
    strideLength: Indicator | null
  }
  carePrompt?: string
}

export interface PoseKeypoint {
  /** Normalized frame coordinates in the range 0..1. */
  x: number
  y: number
  score: number
}

export interface PoseFrame {
  keypoints: PoseKeypoint[]
  width: number
  height: number
}

export interface PosePipeline {
  /** Processes one local video frame. This app deliberately ships no model. */
  processFrame(video: HTMLVideoElement): Promise<PoseFrame | null>
  dispose(): void
}

export interface GaitAnalysisAdapter {
  analyze(frames: PoseFrame[]): Promise<{
    metrics: GaitMetrics
    assessment: AlgorithmAssessment
  } | null>
}

export type ReportStatus = 'measurement-unavailable' | 'measured'

/** Persisted locally only; intentionally excludes identity, frames and pose data. */
export interface ReportRecord {
  id: string
  measuredAt: number
  status: ReportStatus
  metrics: GaitMetrics
  compositeScore: number | null
  summary: string
  indicators: AlgorithmAssessment['indicators'] | null
  carePrompt: string | null
}

export function unavailableRecord(now = Date.now()): ReportRecord {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${now}-${Math.random().toString(36).slice(2)}`,
    measuredAt: now,
    status: 'measurement-unavailable',
    metrics: { symmetryPct: null, stabilityCvPct: null, speedMps: null, strideLengthM: null },
    compositeScore: null,
    summary: '目前尚未接入步態分析模型，因此本次沒有產生有效測量結果。',
    indicators: null,
    carePrompt: null,
  }
}

export function isFiniteMeasurement(record: ReportRecord): boolean {
  const values = Object.values(record.metrics)
  return record.status === 'measured'
    && values.every((value) => value === null || (typeof value === 'number' && Number.isFinite(value)))
    && values.some((value) => typeof value === 'number')
}
