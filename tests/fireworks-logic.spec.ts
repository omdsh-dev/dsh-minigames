import { describe, expect, it } from 'vitest'
import {
  burstTick,
  computeScore,
  describeItem,
  ignite,
  itemSatisfied,
  itemStateAt,
  lastFallSatisfied,
  LEVELS,
  LEVEL_COUNT,
  MAX_DELAY,
  MIN_DELAY,
  mulberry32,
  newGame,
  RECIPE_COUNT,
  RECIPES,
  recipeById,
  setPadDelay,
  setPadRecipe,
  simulateShow,
  starsForLevel,
  step,
  syncSatisfied,
  windShift,
  type Assignment,
  type GameState,
  type SpectrumItem,
} from '../src/client/games/fireworks/logic.ts'

/** 按关卡内置解装配一局并点火。 */
function playSolution(levelIndex: number): GameState {
  const state = newGame(levelIndex)
  for (const a of LEVELS[levelIndex]!.solution) {
    expect(setPadRecipe(state, a.pad, a.recipe)).toBe(true)
    expect(setPadDelay(state, a.pad, a.delay)).toBe(true)
  }
  expect(ignite(state)).toBe(true)
  return state
}

describe('fireworks logic', () => {
  it('配方表结构: 9 种、id/形状/色彩合法、四种形状齐备、金菊金柳同色异形', () => {
    expect(RECIPE_COUNT).toBe(9)
    expect(new Set(RECIPES.map((r) => r.id)).size).toBe(9)
    expect(recipeById('gold-chrys')?.shape).toBe('chrys')
    expect(recipeById('nope')).toBeNull()
    const shapes = new Set(RECIPES.map((r) => r.shape))
    expect(shapes).toEqual(new Set(['chrys', 'peony', 'ring', 'willow']))
    const colors = new Set(RECIPES.map((r) => r.color))
    expect(colors.size).toBeGreaterThanOrEqual(8)
    for (const r of RECIPES) {
      expect(r.rise).toBeGreaterThan(0)
      expect(r.life).toBeGreaterThan(0)
      expect(r.height).toBeGreaterThan(0)
      expect(r.height).toBeLessThanOrEqual(330)
    }
    // 同色异形: 金菊 vs 金柳——谱项需要颜色x形状双轴判别。
    expect(recipeById('gold-chrys')?.color).toBe(recipeById('gold-willow')?.color)
    expect(recipeById('gold-chrys')?.shape).not.toBe(recipeById('gold-willow')?.shape)
    // 柳形燃程最长（「最后落下」谱项的物理依据）。
    const maxLife = Math.max(...RECIPES.map((r) => r.life))
    expect(recipeById('green-willow')?.life).toBe(maxLife)
  })

  it('装配: 选配方默认延时 0、改延时保留配方、延时钳制 0-5、运行期锁定', () => {
    const state = newGame(0)
    expect(state.phase).toBe('setup')
    expect(state.assignments).toEqual([null, null, null])
    expect(setPadRecipe(state, 0, 'blue-ring')).toBe(true)
    expect(state.assignments[0]).toEqual({ pad: 0, recipe: 'blue-ring', delay: MIN_DELAY })
    expect(setPadDelay(state, 0, 2)).toBe(true)
    expect(state.assignments[0]).toEqual({ pad: 0, recipe: 'blue-ring', delay: 2 })
    // 钳制: 负数与超界都收回到 [0,5]，四舍五入到整秒。
    setPadDelay(state, 0, 9)
    expect(state.assignments[0]?.delay).toBe(MAX_DELAY)
    setPadDelay(state, 0, -3)
    expect(state.assignments[0]?.delay).toBe(MIN_DELAY)
    setPadDelay(state, 0, 2.6)
    expect(state.assignments[0]?.delay).toBe(3)
    // 换配方沿用延时。未装配的位不能只设延时; 非法配方/越界位拒绝。
    expect(setPadRecipe(state, 0, 'red-peony')).toBe(true)
    expect(state.assignments[0]?.delay).toBe(3)
    expect(setPadDelay(state, 1, 1)).toBe(false)
    expect(setPadRecipe(state, 0, 'nope')).toBe(false)
    expect(setPadRecipe(state, 9, 'red-peony')).toBe(false)
  })

  it('时序模拟: 绽放=延时+升空+风偏，窗口 [burst,end)，事件升序、时长含收尾', () => {
    const level = LEVELS[0]!
    const assignments: (Assignment | null)[] = [
      { pad: 0, recipe: 'gold-chrys', delay: 2 },
      { pad: 1, recipe: 'red-peony', delay: 0 },
      null,
    ]
    const result = simulateShow(level, assignments)
    // null 位跳过不发射。
    expect(result.events).toHaveLength(2)
    // red-peony: 0s 延时 + 1.5s 升空 = 1.5s 绽放先发生（事件按绽放时刻升序）。
    expect(result.events[0]?.recipe).toBe('red-peony')
    expect(result.events[0]?.burst).toBe(15)
    expect(result.events[0]?.end).toBe(25)
    // gold-chrys: 2s 延时 + 1.0s 升空 = 3.0s 绽放，燃程 1.2s。
    expect(result.events[1]?.launch).toBe(20)
    expect(result.events[1]?.burst).toBe(30)
    expect(result.events[1]?.end).toBe(42)
    // duration = 最晚熄灭 + 收尾缓冲。
    expect(result.duration).toBe(42 + 15)
    expect(burstTick(level, assignments[0] as Assignment)).toBe(30)
  })

  it('sync 谱项: 判定时刻可见性（含绽放瞬间、不含熄灭瞬间）x颜色x形状x数量', () => {
    const events = simulateShow(LEVELS[1]!, [
      { pad: 0, recipe: 'gold-chrys', delay: 1 },
      { pad: 1, recipe: 'gold-chrys', delay: 2 },
      { pad: 2, recipe: 'blue-ring', delay: 1 },
      { pad: 3, recipe: 'green-willow', delay: 2 },
    ]).events
    const at = (tick: number, color?: string, shape?: SpectrumItem['shape'], count = 1): boolean =>
      syncSatisfied({ kind: 'sync', tick, color, shape: shape ?? 'chrys', count }, events)
    // 两朵金菊窗口 [2.0,3.2) 与 [3.0,4.2): 3.0-3.1s 时刻恰 2 朵同放。
    expect(at(30, '#e0af68', 'chrys', 2)).toBe(true)
    expect(at(31, '#e0af68', 'chrys', 2)).toBe(true)
    // 3.2s 第一朵熄灭（开区间右端不含）。
    expect(at(32, '#e0af68', 'chrys', 2)).toBe(false)
    expect(at(29, '#e0af68', 'chrys', 2)).toBe(false)
    // 数量不足 3 朵。
    expect(at(30, '#e0af68', 'chrys', 3)).toBe(false)
    // 颜色或形状错轴都不算: 金柳不是金菊。
    expect(at(40, '#e0af68', 'willow')).toBe(false)
    expect(at(30, '#bb9af7', 'chrys')).toBe(false)
    // 蓝环 3.0s 可见（3.0-4.0）。
    expect(at(30, '#7aa2f7', 'ring')).toBe(true)
  })

  it('lastFall 谱项: 最晚熄灭必须是柳形; 并列最晚算命中、空场判负', () => {
    const events = simulateShow(LEVELS[0]!, LEVELS[0]!.solution).events
    expect(lastFallSatisfied({ kind: 'lastFall', shape: 'willow' }, events)).toBe(true)
    expect(lastFallSatisfied({ kind: 'lastFall', shape: 'chrys' }, events)).toBe(false)
    // 两个金菊同延时同配方（都 2.0-3.2s）并列最晚; 牡丹更早。
    const tie = simulateShow(LEVELS[0]!, [
      { pad: 0, recipe: 'gold-chrys', delay: 1 },
      { pad: 1, recipe: 'red-peony', delay: 0 },
      { pad: 2, recipe: 'gold-chrys', delay: 1 },
    ]).events
    expect(lastFallSatisfied({ kind: 'lastFall', shape: 'chrys' }, tie)).toBe(true)
    expect(lastFallSatisfied({ kind: 'lastFall', shape: 'peony' }, tie)).toBe(false)
    // 空演出: 无法判定，判负。
    expect(lastFallSatisfied({ kind: 'lastFall', shape: 'willow' }, [])).toBe(false)
  })

  it('风偏: 风关奇数位 +10 tick，偶数位与无风关不受影响（排程干扰项）', () => {
    const windy = LEVELS[3]!
    expect(windy.wind).toBe(true)
    expect(windShift(windy, 1)).toBe(10)
    expect(windShift(windy, 3)).toBe(10)
    expect(windShift(windy, 0)).toBe(0)
    expect(windShift(windy, 2)).toBe(0)
    const calm = LEVELS[0]!
    expect(windShift(calm, 1)).toBe(0)
    // 同一延时下奇偶位的实际绽放时刻差 1 秒——玩家必须避开。
    const odd = burstTick(windy, { pad: 1, recipe: 'gold-chrys', delay: 0 })
    const even = burstTick(windy, { pad: 0, recipe: 'gold-chrys', delay: 0 })
    expect(odd - even).toBe(10)
  })

  it('全关可赢（内置解 x 5 关全谱项命中）且错开一个延时即失败', () => {
    for (const level of LEVELS) {
      const state = playSolution(level.index)
      expect(state.phase).toBe('running')
      expect(state.result?.win).toBe(true)
      expect(state.result?.hits.every((h) => h)).toBe(true)
      expect(state.result?.events).toHaveLength(level.pads)
    }
    // 反例: 第 1 关把金菊延时 2s 改 3s——3.0s 的谱项落空。
    const wrong = newGame(0)
    setPadRecipe(wrong, 0, 'gold-chrys')
    setPadDelay(wrong, 0, 3)
    setPadRecipe(wrong, 1, 'red-peony')
    setPadRecipe(wrong, 2, 'green-willow')
    setPadDelay(wrong, 2, 1)
    ignite(wrong)
    expect(wrong.result?.win).toBe(false)
    expect(itemSatisfied(LEVELS[0]!.items[0]!, wrong.result!.events)).toBe(false)
    // 反例: 第 4 关忽略风偏（把偶数位 pad0 当成有风的奇数位，提前 1 秒点）——3.0s 只剩 1 朵金菊。
    const ignored = simulateShow(LEVELS[3]!, LEVELS[3]!.solution.map((a) => ({ ...a })))
    const tampered = simulateShow(LEVELS[3]!, LEVELS[3]!.solution.map((a) => (a.pad === 0 ? { ...a, delay: 0 } : { ...a })))
    expect(ignored.win).toBe(true)
    expect(tampered.win).toBe(false)
  })

  it('点火门槛: 装配不全不点火; step 推进回放并在总时长处结算', () => {
    const state = newGame(2)
    expect(ignite(state)).toBe(false)
    expect(state.phase).toBe('setup')
    expect(state.attempts).toBe(0)
    for (const a of LEVELS[2]!.solution) {
      setPadRecipe(state, a.pad, a.recipe)
      setPadDelay(state, a.pad, a.delay)
    }
    expect(ignite(state)).toBe(true)
    expect(state.attempts).toBe(1)
    expect(state.selectedPad).toBeNull()
    const duration = state.result!.duration
    // 中途: running 且 sync 谱项按时刻三态推进。
    step(state, 25)
    expect(state.phase).toBe('running')
    expect(itemStateAt(state, 0)).toBe('hit')
    expect(itemStateAt(state, 2)).toBe('pending')
    expect(itemStateAt(state, 3)).toBe('pending')
    step(state, duration - 25 + 1)
    expect(state.phase).toBe('done')
    expect(itemStateAt(state, 3)).toBe('hit')
    // step 在 done 后不再变化。
    expect(step(state, 10)).toBe(false)
  })

  it('计分: 底分+谱项+用时奖励，重试扣分有下限; 快演出不比慢演出得分低', () => {
    const fast = computeScore(0, 2, 300, 1)
    const slow = computeScore(0, 2, 600, 1)
    expect(fast).toBeGreaterThan(slow)
    expect(computeScore(0, 2, 300, 3)).toBe(fast - 120)
    expect(computeScore(4, 5, 400, 1)).toBeGreaterThan(computeScore(0, 5, 400, 1))
    // 命中谱项越多越高。
    expect(computeScore(1, 3, 400, 1)).toBeGreaterThan(computeScore(1, 1, 400, 1))
    // 极端重试也有 100 分下限。
    expect(computeScore(0, 1, 1000, 50)).toBe(100)
    expect(fast).toBe(300 + 120 + 2 * 120 + (400 - 300))
  })

  it('seed 重放: mulberry32 确定性、星点同关必同异关必异; 谱项文案完整可读', () => {
    const ra = mulberry32(42)
    const rb = mulberry32(42)
    const seqA = Array.from({ length: 20 }, () => ra())
    expect(seqA).toEqual(Array.from({ length: 20 }, () => rb()))
    const rc = mulberry32(43)
    expect(seqA).not.toEqual(Array.from({ length: 20 }, () => rc()))
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
    const a1 = starsForLevel(3)
    const a2 = starsForLevel(3)
    expect(a1).toEqual(a2)
    expect(a1).toHaveLength(40)
    expect(starsForLevel(3, 12)).toHaveLength(12)
    expect(starsForLevel(4)).not.toEqual(a1)
    for (const s of a1) {
      expect(s.x).toBeGreaterThanOrEqual(16)
      expect(s.x).toBeLessThanOrEqual(450)
      expect(s.y).toBeGreaterThanOrEqual(36)
      expect(s.y).toBeLessThanOrEqual(380)
    }
    expect(describeItem(LEVELS[0]!.items[0]!)).toBe('3.0s 时金色菊花正在绽放')
    expect(describeItem(LEVELS[4]!.items[4]!)).toBe('柳形要最后落下')
    expect(describeItem({ kind: 'sync', tick: 20, color: '#7aa2f7', shape: 'ring', count: 2 })).toBe('2.0s：蓝色圆环 ×2 同放（亮着也算）')
  })

  it('关卡递进: 5 关、位数 3到6、谱项 2到5、第 4 关起有风', () => {
    expect(LEVEL_COUNT).toBe(5)
    expect(LEVELS.map((l) => l.pads)).toEqual([3, 4, 5, 5, 6])
    expect(LEVELS.map((l) => l.items.length)).toEqual([2, 3, 4, 4, 5])
    expect(LEVELS.map((l) => l.wind)).toEqual([false, false, false, true, true])
    for (const level of LEVELS) {
      for (const a of level.solution) {
        expect(a.pad).toBeGreaterThanOrEqual(0)
        expect(a.pad).toBeLessThan(level.pads)
        expect(a.delay).toBeGreaterThanOrEqual(MIN_DELAY)
        expect(a.delay).toBeLessThanOrEqual(MAX_DELAY)
        expect(recipeById(a.recipe)).not.toBeNull()
      }
    }
  })
})
