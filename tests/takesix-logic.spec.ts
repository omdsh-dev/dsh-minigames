import { describe, expect, it } from 'vitest'
import {
  aiChooseRow, aiPickCard, bullheads, chooseRow, createGame,
  HAND_SIZE, playCard, ROUND_COUNT, rowHeads, rowEnds,
  startNextRound, targetRow, type TakeSixState,
} from '../src/client/games/takesix/logic.ts'

/** 构造受控牌面：只换 rows/手牌，其余沿用 createGame(1) 的干净状态。 */
function craft(rows: number[][], yourHand: number[], aiHand: number[]): TakeSixState {
  const s = createGame(1)
  s.rows = rows.map(r => [...r])
  s.yourHand = [...yourHand]
  s.aiHand = [...aiHand]
  return s
}

/** 驱动策略：玩家永远出最小手牌；被迫收行时学 AI 选最少牛头行。 */
function driveStep(s: TakeSixState): void {
  if (s.phase === 'pick') playCard(s, s.yourHand[0]!)
  else if (s.phase === 'chooseRow') chooseRow(s, aiChooseRow(s.rows))
  else if (s.phase === 'roundOver') startNextRound(s)
}

/** 跑完整场比赛（含保险步数上限，逻辑死循环时测试失败而非挂起）。 */
function driveGame(seed: number): TakeSixState {
  const s = createGame(seed)
  for (let guard = 0; guard < 500 && s.phase !== 'matchOver'; guard += 1) driveStep(s)
  return s
}

describe('takesix logic', () => {
  it('bullheads: 55=7、双同数=5、10 的倍数=3、其余 5 的倍数=2、其他=1，全牌分布正确', () => {
    expect(bullheads(55)).toBe(7)
    for (const c of [11, 22, 33, 44, 66, 77, 88, 99]) expect(bullheads(c)).toBe(5)
    for (const c of [10, 20, 90, 100]) expect(bullheads(c)).toBe(3)
    for (const c of [5, 15, 25, 35, 45, 65, 75, 85, 95]) expect(bullheads(c)).toBe(2)
    for (const c of [1, 7, 23, 104]) expect(bullheads(c)).toBe(1)
    const counts = { h7: 0, h5: 0, h3: 0, h2: 0, h1: 0 }
    for (let c = 1; c <= 104; c += 1) {
      const h = bullheads(c)
      if (h === 7) counts.h7 += 1
      else if (h === 5) counts.h5 += 1
      else if (h === 3) counts.h3 += 1
      else if (h === 2) counts.h2 += 1
      else counts.h1 += 1
    }
    expect(counts).toEqual({ h7: 1, h5: 8, h3: 10, h2: 9, h1: 76 })
  })

  it('createGame: 4 张开行 + 双方 10 张升序手牌，24 张互异且同 seed 可复现', () => {
    const a = createGame(42)
    expect(a.rows).toHaveLength(4)
    for (const row of a.rows) expect(row).toHaveLength(1)
    expect(a.yourHand).toHaveLength(HAND_SIZE)
    expect(a.aiHand).toHaveLength(HAND_SIZE)
    const all = [...a.rows.flat(), ...a.yourHand, ...a.aiHand]
    expect(new Set(all).size).toBe(24)
    expect([...a.yourHand]).toEqual([...a.yourHand].sort((x, y) => x - y))
    expect([...a.aiHand]).toEqual([...a.aiHand].sort((x, y) => x - y))
    expect(createGame(42)).toEqual(a)
    const b = createGame(43)
    expect([...b.rows.flat(), ...b.yourHand, ...b.aiHand]).not.toEqual(all)
  })

  it('targetRow/rowEnds: 取行尾小于该牌且最接近的行；全小为 null', () => {
    const rows = [[10, 20], [30], [60], [90]]
    expect(rowEnds(rows)).toEqual([20, 30, 60, 90])
    expect(targetRow(rows, 45)).toBe(1)
    expect(targetRow(rows, 95)).toBe(3)
    expect(targetRow(rows, 9)).toBeNull()
    expect(targetRow(rows, 10)).toBeNull()
    expect(targetRow(rows, 11)).toBeNull() // 行尾是 20 不是 10
    expect(targetRow(rows, 20)).toBeNull() // 行尾必须严格小于牌面
    expect(targetRow(rows, 21)).toBe(0)
    expect(targetRow(rows, 25)).toBe(0)
  })

  it('放第 6 张触发整行收走：罚分入账、该牌单独开新行', () => {
    const s = craft([[10, 21, 31, 41, 45], [2], [3], [4]], [60], [70])
    playCard(s, 60) // 行尾 45 最接近；该行已 5 张 → 收走
    expect(s.penaltyYou).toBe(3 + 1 + 1 + 1 + 2) // 10,21,31,41,45
    expect(s.events.some(e => e.kind === 'collect' && e.side === 'you' && e.heads === 8)).toBe(true)
    // 玩家的 60 单独开新行，随后 AI 的 70 追加到该新行尾
    expect(s.rows[0]).toEqual([60, 70])
    expect(s.penaltyAi).toBe(0)
  })

  it('回合顺序：牌面小者先落位（事件序列先 AI 后玩家）', () => {
    const s = craft([[30], [40], [50], [60]], [90], [35])
    playCard(s, 90)
    const seq = s.events.filter(e => e.kind !== 'reveal')
    expect(seq[0]).toMatchObject({ kind: 'placed', side: 'ai', card: 35, row: 0 })
    expect(seq[1]).toMatchObject({ kind: 'placed', side: 'you', card: 90, row: 3 })
    expect(s.rows[0]).toEqual([30, 35])
    expect(s.rows[3]).toEqual([60, 90])
  })

  it('玩家牌比所有行尾小 → chooseRow；选定行计罚分、该牌开新行后补完 AI', () => {
    const s = craft([[30], [40], [50], [60]], [5], [100])
    playCard(s, 5)
    expect(s.phase).toBe('chooseRow')
    expect(s.pendingYouCard).toBe(5)
    chooseRow(s, 0) // 收 30（3 头）
    expect(s.penaltyYou).toBe(3)
    expect(s.rows[0]).toEqual([5])
    // AI 的 100 在补结算中落位：行尾 5/40/50/60 里最接近的是 60 行
    expect(s.rows[3]).toEqual([60, 100])
    expect(s.aiSettled).toBe(true)
  })

  it('AI 被迫收行时选牛头最少的行（平局取牌更多）', () => {
    const s = craft([[51, 52, 53], [10, 20], [11, 22], [55]], [90], [7])
    expect(aiChooseRow(s.rows)).toBe(0) // 牛头 3/6/10/7 → 行 0
    playCard(s, 90) // 90 落行 3（55 尾）；AI 的 7 全小 → 走 aiChooseRow
    expect(s.rows[0]).toEqual([7])
    expect(s.penaltyAi).toBe(rowHeads([51, 52, 53]))
  })

  it('aiPickCard 同状态同选；出牌/选行非法输入抛错', () => {
    const s = craft([[30], [40], [50], [60]], [35, 65], [45, 95])
    const pick = aiPickCard(s)
    expect(aiPickCard(s)).toBe(pick)
    expect(s.aiHand).toContain(pick)
    expect(() => playCard(s, 999)).toThrow()
    expect(() => chooseRow(s, 0)).toThrow() // 非 chooseRow 阶段
    expect(() => startNextRound(s)).toThrow() // 非 roundOver 阶段
  })

  it('整局流程：10 回合后按罚分判局胜，三局后按局数（平则总罚分）定冠军', () => {
    const s = driveGame(7)
    expect(s.phase).toBe('matchOver')
    expect(s.round).toBe(ROUND_COUNT)
    expect(s.yourHand).toHaveLength(0)
    expect(s.aiHand).toHaveLength(0)
    // 平局不计胜：胜局总数不会超过局数
    expect(s.roundWinsYou + s.roundWinsAi).toBeLessThanOrEqual(ROUND_COUNT)
    if (s.roundWinsYou !== s.roundWinsAi) {
      expect(s.matchWinner).toBe(s.roundWinsYou > s.roundWinsAi ? 'you' : 'ai')
    } else if (s.totalYou !== s.totalAi) {
      expect(s.matchWinner).toBe(s.totalYou < s.totalAi ? 'you' : 'ai')
    } else {
      expect(s.matchWinner).toBeNull()
    }
  })

  it('重放确定性：同 seed 同策略跑两遍，最终状态逐字段相等', () => {
    const a = driveGame(2026)
    const b = driveGame(2026)
    expect(b).toEqual(a)
    // 不同 seed 的发牌不同（固定种子组合下验证）
    expect(createGame(2026).yourHand).not.toEqual(createGame(2027).yourHand)
  })

  it('局间切换：roundOver 开下一局重抽 24 张、罚分清零、局数推进', () => {
    const s = createGame(99)
    for (let guard = 0; guard < 100 && s.phase !== 'roundOver'; guard += 1) driveStep(s)
    expect(s.phase).toBe('roundOver')
    const before = s.totalYou + s.totalAi
    const round = s.round
    startNextRound(s)
    expect(s.round).toBe(round + 1)
    expect(s.penaltyYou).toBe(0)
    expect(s.penaltyAi).toBe(0)
    expect(s.yourHand).toHaveLength(HAND_SIZE)
    const all = [...s.rows.flat(), ...s.yourHand, ...s.aiHand]
    expect(new Set(all).size).toBe(24)
    expect(s.totalYou + s.totalAi).toBe(before) // 总罚分跨局累计
  })
})
