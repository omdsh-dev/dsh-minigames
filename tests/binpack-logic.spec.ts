import { describe, expect, it } from 'vitest'
import {
  LEVELS, generateLevel, createState, binLoad, canPlace, placeItem, takeOut,
  usedBins, allPlaced, isWon, ffd, exactBins, computeScore, mulberry32,
} from '../src/client/games/binpack/logic.ts'

describe('binpack logic', () => {
  it('mulberry32 is deterministic per seed', () => {
    const a = mulberry32(1234)
    const b = mulberry32(1234)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('every level generates 8-16 items of size 1-9 with total = bins * capacity', () => {
    for (let lv = 1; lv <= LEVELS.length; lv += 1) {
      const level = generateLevel(lv)!
      expect(level.items.length).toBeGreaterThanOrEqual(8)
      expect(level.items.length).toBeLessThanOrEqual(16)
      for (const size of level.items) {
        expect(size).toBeGreaterThanOrEqual(1)
        expect(size).toBeLessThanOrEqual(9)
      }
      const total = level.items.reduce((a, b) => a + b, 0)
      expect(total).toBe(level.optimal * level.capacity)
    }
  })

  it('the same seed replays identically and an override seed differs', () => {
    const a = generateLevel(3)!
    const b = generateLevel(3, 3 * 0x9e3779b9)!
    expect(a.items).toEqual(b.items)
    expect(generateLevel(2)!.items).not.toEqual(generateLevel(2, 999)!.items)
    expect(generateLevel(0)).toBeNull()
    expect(generateLevel(6)).toBeNull()
  })

  it('the exact solver agrees with the constructed optimum on all levels', () => {
    for (let lv = 1; lv <= LEVELS.length; lv += 1) {
      const level = generateLevel(lv)!
      expect(exactBins(level.items, level.capacity)).toBe(level.optimal)
    }
  })

  it('exact solver and FFD handle hand-checked cases', () => {
    expect(exactBins([9, 9, 9], 9)).toBe(3)
    expect(exactBins([5, 5, 5, 5], 10)).toBe(2)
    expect(exactBins([3, 3, 3, 3, 3], 12)).toBe(2)
    expect(exactBins([], 9)).toBe(0)
    expect(ffd([9, 9, 9], 9)).toBe(3)
    expect(ffd([5, 5, 5, 5], 10)).toBe(2)
  })

  it('FFD never beats the exact solver and stays close on level instances', () => {
    for (let lv = 1; lv <= LEVELS.length; lv += 1) {
      const level = generateLevel(lv)!
      const ffdBins = ffd(level.items, level.capacity)
      const exact = exactBins(level.items, level.capacity)
      expect(ffdBins).toBeGreaterThanOrEqual(exact)
      expect(ffdBins).toBeLessThanOrEqual(exact + 2)
    }
  })

  it('canPlace rejects overflow and foreign bins, accepts a legal load', () => {
    const state = createState(generateLevel(1)!)
    state.binOf[0] = 0 // 手工摆一个物品进箱 0
    const first = state.level.items[0]!
    const capacity = state.level.capacity
    expect(binLoad(state, 0)).toBe(first)
    // 找一个放不下的与放得下的物品分别验证
    const tooBig = state.level.items.findIndex((s, i) => i !== 0 && s > capacity - first)
    if (tooBig >= 0) expect(canPlace(state, tooBig, 0)).toBe(false)
    const fits = state.level.items.findIndex((s, i) => i !== 0 && s <= capacity - first)
    if (fits >= 0) expect(canPlace(state, fits, 0)).toBe(true)
    expect(canPlace(state, 0, 0)).toBe(false) // 已在该箱
    expect(canPlace(state, 0, state.binCount)).toBe(false) // 越界箱
  })

  it('playing the constructed solution wins in exactly optimal bins', () => {
    const level = generateLevel(4)!
    const state = createState(level)
    // 贪心按 FFD 顺序放进逐个新箱不一定恰好最优；直接按体积贪心模拟玩家：
    // 逐物品首次适应，若超过 optimal 则重排（本题构造保证 FFD 可行）。
    const order = state.level.items.map((size, i) => ({ size, i }))
      .sort((a, b) => b.size - a.size)
    for (const { i } of order) {
      let bin = 0
      while (!canPlace(state, i, bin)) bin += 1
      placeItem(state, i, bin)
    }
    expect(allPlaced(state)).toBe(true)
    expect(usedBins(state)).toBeLessThanOrEqual(level.optimal)
    expect(isWon(state)).toBe(true)
    expect(state.steps).toBe(level.items.length)
  })

  it('taking an item back un-wins and counts a step', () => {
    const level = generateLevel(1)!
    const state = createState(level)
    placeItem(state, 0, 0)
    expect(state.steps).toBe(1)
    takeOut(state, 0)
    expect(state.binOf[0]).toBe(-1)
    expect(state.steps).toBe(2)
    expect(allPlaced(state)).toBe(false)
    expect(isWon(state)).toBe(false)
    takeOut(state, 0) // 未放入的物品取出是无效操作
    expect(state.steps).toBe(2)
  })

  it('filling beyond the optimal bin count blocks the win', () => {
    const level = generateLevel(1)!
    const state = createState(level)
    // 每个物品单独一箱：全部装完但用箱数远超最优。
    for (let i = 0; i < state.level.items.length; i += 1) {
      const bin = Math.min(i, state.binCount - 1)
      placeItem(state, i, bin)
    }
    // binCount 有限，部分物品会塞不下：只断言“已装完 ⇒ 未必过关”。
    if (allPlaced(state)) expect(usedBins(state) <= level.optimal || !isWon(state)).toBe(true)
    else expect(isWon(state)).toBe(false)
  })

  it('score is positive and fewer steps score higher', () => {
    expect(computeScore(1, 9)).toBeGreaterThan(0)
    expect(computeScore(5, 10)).toBeGreaterThan(computeScore(5, 12))
    expect(computeScore(3, 1000)).toBe(300) // 步数惩罚封底
  })
})
