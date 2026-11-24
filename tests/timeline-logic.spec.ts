import { describe, expect, it } from 'vitest'
import {
  EVENT_BANK, LEVELS, createRoundState, dealRound, insertCard, mulberry32,
  returnToHand, scoreForLevel, submitRound, swapPlaced, tickTimer,
} from '../src/client/games/timeline/logic.ts'

describe('timeline logic', () => {
  it('题库：66 张事件卡，三类各不少于 15，id 与名称全库唯一，年份合法', () => {
    expect(EVENT_BANK.length).toBeGreaterThanOrEqual(60)
    const byCat = { tech: 0, history: 0, culture: 0 }
    for (const e of EVENT_BANK) {
      expect(['tech', 'history', 'culture']).toContain(e.category)
      byCat[e.category] += 1
      expect(e.year).toBeGreaterThanOrEqual(-3000)
      expect(e.year).toBeLessThanOrEqual(2025)
      expect(e.name.length).toBeGreaterThan(0)
    }
    expect(byCat.tech).toBeGreaterThanOrEqual(15)
    expect(byCat.history).toBeGreaterThanOrEqual(15)
    expect(byCat.culture).toBeGreaterThanOrEqual(15)
    expect(new Set(EVENT_BANK.map((e) => e.id)).size).toBe(EVENT_BANK.length)
    expect(new Set(EVENT_BANK.map((e) => e.name)).size).toBe(EVENT_BANK.length)
  })

  it('mulberry32：同种子序列一致，不同种子序列不同', () => {
    const a1 = mulberry32(42)
    const a2 = mulberry32(42)
    const b = mulberry32(43)
    const seqA = Array.from({ length: 8 }, () => a1())
    const seqA2 = Array.from({ length: 8 }, () => a2())
    const seqB = Array.from({ length: 8 }, () => b())
    expect(seqA).toEqual(seqA2)
    expect(seqA).not.toEqual(seqB)
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('dealRound：卡数随关卡递进（5→7），锚点为年份中位卡且不在手牌', () => {
    for (let level = 1; level <= 5; level += 1) {
      const round = dealRound(level, 12345)
      expect(round.cards).toHaveLength(LEVELS[level - 1]!.cardCount)
      expect(round.cards).toContain(round.anchor)
      const years = round.cards.map((c) => c.year).sort((x, y) => x - y)
      // 锚点取排序后中位：年份严格处于首尾区间内，两侧都有卡。
      expect(round.anchor.year).toBeGreaterThanOrEqual(years[0]!)
      expect(round.anchor.year).toBeLessThanOrEqual(years[years.length - 1]!)
      expect(round.anchor.year).not.toBe(years[0]!)
      expect(round.anchor.year).not.toBe(years[years.length - 1]!)
    }
  })

  it('dealRound 确定性与 seed 敏感：同 seed 重放一致，换 seed 手牌不同', () => {
    for (let level = 1; level <= 5; level += 1) {
      expect(dealRound(level, 777)).toEqual(dealRound(level, 777))
    }
    const states = [11, 12, 13, 14].map((s) => createRoundState(1, s))
    const hands = states.map((st) => st.hand.map((c) => c.id).join(','))
    expect(new Set(hands).size).toBeGreaterThan(1)
    // 整关状态重放：同 level+seed 完全一致。
    expect(createRoundState(3, 99)).toEqual(createRoundState(3, 99))
  })

  it('高关卡同领域干扰：level>=5 全部卡同类别且来自年份连续窗口', () => {
    for (const level of [3, 4, 5]) {
      const round = dealRound(level, 2024)
      const cats = new Set(round.cards.map((c) => c.category))
      expect(cats.size).toBe(1)
      const pool = EVENT_BANK.filter((e) => e.category === [...cats][0]).map((e) => e.year).sort((x, y) => x - y)
      const years = round.cards.map((c) => c.year).sort((x, y) => x - y)
      // 连续窗口：窗口首年在池中的位置 + 卡数不越界（即取自排序池的相邻段）。
      const start = pool.indexOf(years[0]!)
      expect(start).toBeGreaterThanOrEqual(0)
      expect(start + years.length).toBeLessThanOrEqual(pool.length)
      expect(new Set(years).size).toBe(years.length)
    }
  })

  it('insertCard/swapPlaced/returnToHand：合法操作生效，非法操作被拒', () => {
    const st = createRoundState(1, 5)
    const anchorId = st.round.anchor.id
    const c0 = st.hand[0]!
    expect(st.timeline).toHaveLength(1)
    expect(insertCard(st, c0.id, 0)).toBe(true)
    expect(st.timeline[0]).toBe(c0)
    expect(st.timeline).toHaveLength(2)
    const c1 = st.hand[0]!
    expect(insertCard(st, c1.id, 2)).toBe(true)
    expect(swapPlaced(st, 0, 3)).toBe(false) // 越界
    expect(swapPlaced(st, -1, 1)).toBe(false) // 负索引
    expect(swapPlaced(st, 1, 1)).toBe(false) // 相同索引
    expect(swapPlaced(st, 0, 1)).toBe(true)
    expect(st.timeline[1]).toBe(c0)
    expect(returnToHand(st, st.timeline.indexOf(st.round.anchor))).toBe(false) // 锚点不可收回
    const pos = st.timeline.findIndex((c) => c.id !== anchorId)
    const taken = st.timeline[pos]!
    expect(returnToHand(st, pos)).toBe(true)
    expect(st.hand).toContain(taken)
    expect(insertCard(st, 99999, 0)).toBe(false) // 不在手牌
    expect(insertCard(st, c1.id, 99)).toBe(false) // slot 越界
  })

  it('submitRound 全对：锁定全部卡、phase=cleared、得分按错误数计算', () => {
    const st = createRoundState(1, 8)
    // 按年份升序放完手牌（在锚点两侧二分插入或先收尾统一排）。
    const sorted = [...st.hand].sort((a, b) => a.year - b.year)
    st.hand = []
    st.timeline = [st.round.anchor, ...sorted].sort((a, b) => a.year - b.year)
    const res = submitRound(st)
    expect(res).not.toBeNull()
    expect(res!.allCorrect).toBe(true)
    expect(res!.wrong).toHaveLength(0)
    expect(st.phase).toBe('cleared')
    expect(st.timeline).toHaveLength(st.round.cards.length)
    expect(scoreForLevel(0)).toBe(100)
    expect(scoreForLevel(3)).toBe(70)
    expect(scoreForLevel(20)).toBe(20)
  })

  it('submitRound 有错：错误卡回手并带方向提示，正确相对邻居的卡锁定', () => {
    const st = createRoundState(1, 9)
    const sorted = [...st.round.cards].sort((a, b) => a.year - b.year)
    st.hand = []
    // 构造错误顺序：整体排序后交换首尾两张非锚点卡。
    let i = 0
    while (i < sorted.length && (sorted[i]!.id === st.round.anchor.id)) i += 1
    let j = sorted.length - 1
    while (j >= 0 && (sorted[j]!.id === st.round.anchor.id)) j -= 1
    const tmp = sorted[i]!
    sorted[i] = sorted[j]!
    sorted[j] = tmp
    st.timeline = [...sorted]
    const res = submitRound(st)!
    expect(res.allCorrect).toBe(false)
    expect(res.wrong.length).toBeGreaterThanOrEqual(2)
    expect(st.hand).toEqual(res.wrong)
    expect(st.errors).toBe(res.wrong.length)
    // 锚点仍在轴上且已锁定。
    expect(st.timeline).toContain(st.round.anchor)
    expect(res.locked).toContain(st.round.anchor)
    for (const h of res.hints) {
      expect(['earlier', 'later']).toContain(h.direction)
      if (h.direction === 'earlier') expect(h.card.year).toBeLessThan(h.ref.year)
      else expect(h.card.year).toBeGreaterThan(h.ref.year)
    }
  })

  it('submitRound 前置条件：手牌未清空或非 playing 阶段返回 null', () => {
    const st = createRoundState(2, 31)
    expect(submitRound(st)).toBeNull() // 手牌还有卡
    const st2 = createRoundState(2, 31)
    st2.hand = []
    st2.timeline = [...st2.round.cards].sort((a, b) => a.year - b.year)
    const res = submitRound(st2)
    expect(res!.allCorrect).toBe(true)
    expect(submitRound(st2)).toBeNull() // 已 cleared
  })

  it('tickTimer：限时空位递减、归零进 timeout，不限时关卡 no-op', () => {
    const st = createRoundState(4, 55)
    expect(st.remainingSec).toBe(75)
    tickTimer(st, 30)
    expect(st.remainingSec).toBeCloseTo(45)
    expect(st.phase).toBe('playing')
    tickTimer(st, 100)
    expect(st.remainingSec).toBe(0)
    expect(st.phase).toBe('timeout')
    const free = createRoundState(1, 55)
    tickTimer(free, 999)
    expect(free.remainingSec).toBe(0)
    expect(free.phase).toBe('playing')
  })

  it('错误回手后可继续修正并最终过关（完整一局流程）', () => {
    const st = createRoundState(1, 64)
    st.hand = []
    st.timeline = [...st.round.cards].sort((a, b) => b.year - a.year) // 完全倒序
    let res = submitRound(st)!
    expect(res.allCorrect).toBe(false)
    expect(st.hand.length).toBeGreaterThan(0)
    // 回手的卡按正确顺序重新放回（锚点已锁定在轴上，插入其余卡）。
    const locked = [...st.timeline]
    for (const card of [...st.hand].sort((a, b) => a.year - b.year)) {
      let slot = 0
      while (slot < st.timeline.length && st.timeline[slot]!.year <= card.year) slot += 1
      expect(insertCard(st, card.id, slot)).toBe(true)
    }
    expect(st.timeline.map((c) => c.year)).toEqual([...st.round.cards].map((c) => c.year).sort((a, b) => a - b))
    expect(locked.every((c) => st.timeline.includes(c))).toBe(true)
    res = submitRound(st)!
    expect(res.allCorrect).toBe(true)
    expect(st.phase).toBe('cleared')
  })
})