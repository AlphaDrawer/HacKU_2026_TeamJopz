import { describe, expect, it } from 'vitest'
import { isFiniteMeasurement, unavailableRecord } from './report'

describe('report data boundary', () => {
  it('creates an explicitly unavailable record with no invented measurements', () => {
    const record = unavailableRecord(1234)
    expect(record.measuredAt).toBe(1234)
    expect(record.status).toBe('measurement-unavailable')
    expect(record.compositeScore).toBeNull()
    expect(record.indicators).toBeNull()
    expect(Object.values(record.metrics)).toEqual([null, null, null, null])
    expect(Object.keys(record).sort()).toEqual([
      'carePrompt', 'compositeScore', 'id', 'indicators', 'measuredAt',
      'metrics', 'status', 'summary',
    ])
  })

  it('only considers supplied finite metrics measured when explicitly marked so', () => {
    const record = unavailableRecord()
    expect(isFiniteMeasurement(record)).toBe(false)
    expect(isFiniteMeasurement({
      ...record,
      status: 'measured',
      metrics: { symmetryPct: 12, stabilityCvPct: null, speedMps: null, strideLengthM: null },
    })).toBe(true)
    expect(isFiniteMeasurement({
      ...record,
      status: 'measured',
      metrics: { symmetryPct: Number.NaN, stabilityCvPct: null, speedMps: null, strideLengthM: null },
    })).toBe(false)
    expect(isFiniteMeasurement({
      ...record,
      status: 'measured',
      metrics: { symmetryPct: 12, stabilityCvPct: Number.POSITIVE_INFINITY, speedMps: null, strideLengthM: null },
    })).toBe(false)
  })
})
