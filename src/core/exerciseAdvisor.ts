import type { Exercise, Metric } from '../contracts/types'
import exercisesData from '../data/exercises.json'

/**
 * exerciseAdvisor（§4.1 / §5.3）：根据本次偏离的指标推荐康复动作。
 *
 * 规则简单可解释：
 *  - symmetry 红/黄 → 强调左右均衡训练；
 *  - stability 红/黄 → 平衡与稳定训练；
 *  - speed/strideLength 红/黄 → 力量与步幅训练；
 *  - 全部绿色 → 给维持性建议。
 * 每个动作的 applicable 字段标记适用维度，advisor 做匹配去重。
 * 注意：动作仅为通用建议，具体方案应由物理治疗师确定（见 disclaimer）。
 */

const ALL = exercisesData as Exercise[]

type Tag = 'symmetry' | 'stability' | 'power' | 'maintain'

function metricTags(m: {
  symmetry: Metric
  stability: Metric
  speed: Metric
  strideLength: Metric
}): Tag[] {
  const tags: Tag[] = []
  if (m.symmetry.level === 'red' || m.symmetry.level === 'yellow') tags.push('symmetry')
  if (m.stability.level === 'red' || m.stability.level === 'yellow') tags.push('stability')
  if (
    m.speed.level === 'red' ||
    m.speed.level === 'yellow' ||
    m.strideLength.level === 'red' ||
    m.strideLength.level === 'yellow'
  ) {
    tags.push('power')
  }
  if (tags.length === 0) tags.push('maintain')
  return tags
}

export function adviseExercises(m: {
  symmetry: Metric
  stability: Metric
  speed: Metric
  strideLength: Metric
}): Exercise[] {
  const tags = metricTags(m)
  const picked = ALL.filter((ex) => tags.some((t) => ex.applicable.includes(t)))
  // 最多推荐 3 个，避免信息过载；按数据顺序保证稳定
  return picked.slice(0, 3)
}
