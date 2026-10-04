import { describe, expect, it } from 'vitest'
import type { Metric, MetricKey } from '../contracts/types'
import {
  formatMetric,
  formatMetricValue,
  formatPercent,
  formatSpeed,
  formatStride,
} from './format'

function metric(key: MetricKey, value: number | null, unit: Metric['unit']): Metric {
  return {
    key,
    label: key,
    value,
    unit,
    level: value === null ? 'none' : 'green',
    calibrated: true,
    confidence: 0.9,
    hint: '',
  }
}

describe('指标显示数值格式化（只改显示，不改存储）', () => {
  it('百分比类：四舍五入到整数', () => {
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(92.4)).toBe('92%')
    expect(formatPercent(92.5)).toBe('93%')
    expect(formatPercent(66.666_666)).toBe('67%')
    expect(formatPercent(100)).toBe('100%')
  })

  it('速度：保留 1 位小数（带 m/s 单位）', () => {
    expect(formatSpeed(0)).toBe('0.0 m/s')
    expect(formatSpeed(1.234)).toBe('1.2 m/s')
    expect(formatSpeed(0.95)).toBe('1.0 m/s')
    expect(formatSpeed(1.25)).toBe('1.3 m/s')
  })

  it('步幅：保留 2 位小数（带 m 单位）', () => {
    expect(formatStride(0)).toBe('0.00 m')
    expect(formatStride(1.1)).toBe('1.10 m')
    expect(formatStride(0.789)).toBe('0.79 m')
    expect(formatStride(0.005)).toBe('0.01 m')
  })

  it('null 一律显示长横线（无单位）', () => {
    expect(formatPercent(null)).toBe('—')
    expect(formatSpeed(null)).toBe('—')
    expect(formatStride(null)).toBe('—')
  })

  it('非数值（NaN/Infinity）按无数据处理', () => {
    expect(formatPercent(Number.NaN)).toBe('—')
    expect(formatSpeed(Number.POSITIVE_INFINITY)).toBe('—')
    expect(formatStride(Number.NEGATIVE_INFINITY)).toBe('—')
  })

  it('formatMetric 按指标 key 分派（含单位）', () => {
    expect(formatMetric(metric('symmetry', 88.8, '%'))).toBe('89%')
    expect(formatMetric(metric('stability', 52.3, '%'))).toBe('52%')
    expect(formatMetric(metric('speed', 1.05, 'm/s'))).toBe('1.1 m/s')
    expect(formatMetric(metric('strideLength', 0.666, 'm'))).toBe('0.67 m')
    expect(formatMetric(metric('symmetry', null, '%'))).toBe('—')
  })

  it('formatMetricValue：不带单位的纯文本（坐标轴/数据标签用）', () => {
    expect(formatMetricValue('symmetry', 88.8)).toBe('89')
    expect(formatMetricValue('stability', 52.3)).toBe('52')
    expect(formatMetricValue('speed', 1.05)).toBe('1.1')
    expect(formatMetricValue('strideLength', 0.666)).toBe('0.67')
    expect(formatMetricValue('stability', null)).toBe('—')
  })
})
