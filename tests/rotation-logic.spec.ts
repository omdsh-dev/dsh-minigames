import { describe, expect, it } from 'vitest'
import {
  BONUS_MAX, LEVEL_COUNT, LEVEL_DEFS, STEP_COST, WIN_BASE, advanceLevel, angleIndex,
  beamAt, createRotationState, findOpening, generateLevel, layerOpenAtAngle, levelSeed,
  mod, mulberry32, restartLevel, rotateLayer, winScore,
  type RotationLevel, type RotationState,
} from '../src/client/games/rotation/logic.ts'

/** 求解当前目标角：逐层拧到可解朝向（中途贯通即提前返回）。 */
function solveCurrentTarget(state: RotationState): void {
  const idx = state.targetIndex
  const angle = state.board.targetAngles[idx]!
  for (let i = 0; i < state.board.layers.length; i += 1) {
    const layer = state.board.layers[i]!
    const want = findOpening(layer, angle)
    expect(want).not.toBeNull()
    let guard = 0
    while (layer.rotation !== want && guard < 400) {
      expect(rotateLayer(state, i, 1)).toBe(true)
      guard += 1
    }
    if (state.targetIndex !== idx) return
  }
}

/** 判断是否仍在进行（避免属性窄化跨调用传播）。 */
const isPlaying = (s: RotationState): boolean => s.status === 'playing'

/** 深拷贝盘面（见证朝向组合用）。 */
function cloneLevel(level: RotationLevel): RotationLevel {
  return JSON.parse(JSON.stringify(level)) as RotationLevel
}

describe('rotation logic', () => {
  it('mulberry32 确定且 levelSeed 随 seed/关卡变化', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 8; i += 1) expect(a()).toBe(b())
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
    expect(levelSeed(42, 1)).not.toBe(levelSeed(42, 2))
    expect(levelSeed(42, 1)).not.toBe(levelSeed(43, 1))
  })

  it('generateLevel 结构正确且确定：同 seed 同盘面', () => {
    for (let level = 1; level <= LEVEL_COUNT; level += 1) {
      const x = generateLevel(level, mulberry32(7))
      const y = generateLevel(level, mulberry32(7))
      expect(x).toEqual(y)
      const def = LEVEL_DEFS[level - 1]!
      expect(x.layers.length).toBe(def.slots.length)
      x.layers.forEach((layer, i) => {
        expect(layer.slots).toBe(def.slots[i])
        expect(layer.rotation).toBeGreaterThanOrEqual(0)
        expect(layer.rotation).toBeLessThan(layer.slots)
        expect(layer.gaps.filter(Boolean).length).toBe(def.gapCounts[i])
        expect(layer.gaps.some(Boolean)).toBe(true)
        expect(layer.gaps.every(Boolean)).toBe(false)
      })
      expect(x.targetAngles.length).toBe(def.targetCount)
      const angles = x.targetAngles
      for (const deg of angles) expect(deg % 30).toBe(0)
      for (let i = 0; i < angles.length; i += 1) {
        for (let j = i + 1; j < angles.length; j += 1) {
          const d = Math.abs(mod(angles[i]! - angles[j]!, 360))
          expect(Math.min(d, 360 - d)).toBeGreaterThanOrEqual(60)
        }
      }
    }
    expect(generateLevel(1, mulberry32(7))).toEqual(generateLevel(1, mulberry32(7)))
    const boards = new Set(Array.from({ length: 8 }, (_, i) => JSON.stringify(generateLevel(1, mulberry32(i + 1)))))
    expect(boards.size).toBeGreaterThan(1)
  })

  it('每个目标角都存在可解朝向：组合见证后全层贯通', () => {
    for (let level = 1; level <= LEVEL_COUNT; level += 1) {
      const board = generateLevel(level, mulberry32(99))
      for (const deg of board.targetAngles) {
        const witness = cloneLevel(board)
        witness.layers.forEach((layer, i) => {
          const r = findOpening(board.layers[i]!, deg)
          expect(r).not.toBeNull()
          witness.layers[i]!.rotation = r!
        })
        expect(beamAt(witness, deg).every(Boolean)).toBe(true)
      }
    }
  })

  it('打乱后的初始盘面在首个目标角必不通', () => {
    for (const seed of [1, 7, 42, 99, 2026]) {
      for (let level = 1; level <= LEVEL_COUNT; level += 1) {
        const state = createRotationState(level, 0, seed)
        const open = beamAt(state.board, state.board.targetAngles[0]!)
        expect(open.some(v => v === false)).toBe(true)
        expect(state.status).toBe('playing')
        expect(state.targetIndex).toBe(0)
        expect(state.steps).toBe(0)
      }
    }
  })

  it('layerOpenAtAngle / angleIndex 模长边界正确', () => {
    const layer = { slots: 4, gaps: [true, false, false, false], rotation: 0 }
    expect(angleIndex(4, 0)).toBe(0)
    expect(angleIndex(4, 360)).toBe(0)
    expect(angleIndex(4, 89.9)).toBe(0)
    expect(angleIndex(4, 90)).toBe(1)
    expect(layerOpenAtAngle(layer, 0)).toBe(true)
    expect(layerOpenAtAngle(layer, 90)).toBe(false)
    expect(layerOpenAtAngle(layer, 360)).toBe(true)
    // 旋转 +1：图案格 p 移到盘面格 p+1，即盘面格 j 显示图案格 j-1。
    const rotated = { ...layer, rotation: 1 }
    expect(layerOpenAtAngle(rotated, 0)).toBe(false)
    expect(layerOpenAtAngle(rotated, 90)).toBe(true)
    // 模长：rotation 4 ≡ 0，负数等价取正。
    expect(layerOpenAtAngle({ ...layer, rotation: 4 }, 0)).toBe(true)
    expect(layerOpenAtAngle({ ...layer, rotation: -3 }, 0)).toBe(false)
    expect(layerOpenAtAngle({ ...layer, rotation: -3 }, 90)).toBe(true)
  })

  it('rotateLayer：步数计费、模长回绕、越界与非进行态拒绝', () => {
    const state = createRotationState(1, 0, 5)
    const before = state.board.layers[0]!.rotation
    expect(rotateLayer(state, 0, 1)).toBe(true)
    expect(state.board.layers[0]!.rotation).toBe((before + 1) % state.board.layers[0]!.slots)
    expect(state.steps).toBe(1)
    expect(rotateLayer(state, -1, 1)).toBe(false)
    expect(rotateLayer(state, 99, 1)).toBe(false)
    expect(state.steps).toBe(1)
    expect(rotateLayer(state, 0, -1)).toBe(true)
    expect(state.steps).toBe(2)
    expect(state.board.layers[0]!.rotation).toBe(before)
    // 拧一整圈回到原位，步数照计。
    const slots = state.board.layers[0]!.slots
    for (let i = 0; i < slots; i += 1) rotateLayer(state, 0, 1)
    expect(state.board.layers[0]!.rotation).toBe(before)
    expect(state.steps).toBe(2 + slots)
  })

  it('多目标流转：打通一个推进一个，全通过关并计分一次', () => {
    const state = createRotationState(2, 0, 11)
    expect(state.board.targetAngles.length).toBe(2)
    solveCurrentTarget(state)
    expect(state.targetIndex).toBe(1)
    expect(state.status).toBe('playing')
    const stepsAfterFirst = state.steps
    solveCurrentTarget(state)
    expect(state.status).toBe('won')
    expect(state.steps).toBeGreaterThan(stepsAfterFirst)
    expect(state.score).toBe(winScore(2, state.steps))
    // 过关后拒绝继续旋转，重复计分不会发生。
    const finalSteps = state.steps
    expect(rotateLayer(state, 0, 1)).toBe(false)
    expect(state.score).toBe(winScore(2, finalSteps))
    expect(state.steps).toBe(finalSteps)
  })

  it('winScore 公式：基础分 × 关卡 + 步数效率奖励（下限 0）', () => {
    expect(winScore(1, 0)).toBe(WIN_BASE + BONUS_MAX)
    expect(winScore(2, 10)).toBe(WIN_BASE * 2 + BONUS_MAX - STEP_COST * 10)
    expect(winScore(3, 50)).toBe(WIN_BASE * 3)
    expect(winScore(5, 1000)).toBe(WIN_BASE * 5)
  })

  it('restartLevel：同 seed 同盘面，分数回滚、进度清零', () => {
    const state = createRotationState(3, 40, 77)
    solveCurrentTarget(state)
    expect(state.targetIndex).toBe(1)
    const snapshot = JSON.stringify(createRotationState(3, 40, 77).board)
    restartLevel(state)
    expect(JSON.stringify(state.board)).toBe(snapshot)
    expect(state.status).toBe('playing')
    expect(state.score).toBe(40)
    expect(state.levelStartScore).toBe(40)
    expect(state.steps).toBe(0)
    expect(state.targetIndex).toBe(0)
    expect(state.selectedLayer).toBe(0)
  })

  it('advanceLevel：换关重生成同 seed 盘面；第 5 关获胜即 cleared', () => {
    const state = createRotationState(1, 0, 21)
    while (isPlaying(state)) solveCurrentTarget(state)
    expect(state.status).toBe('won')
    const gained = state.score
    advanceLevel(state)
    expect(state.level).toBe(2)
    expect(state.status).toBe('playing')
    expect(state.levelStartScore).toBe(gained)
    expect(state.board).toEqual(createRotationState(2, 0, 21).board)
    // 冲到第 5 关并获胜。
    for (let i = 0; i < 3; i += 1) {
      while (isPlaying(state)) solveCurrentTarget(state)
      advanceLevel(state)
    }
    expect(state.level).toBe(5)
    while (isPlaying(state)) solveCurrentTarget(state)
    advanceLevel(state)
    expect(state.status).toBe('cleared')
    expect(state.level).toBe(5)
  })

  it('seed 重放：同 seed 全状态一致，异 seed 盘面不同', () => {
    const a = createRotationState(4, 0, 123)
    const b = createRotationState(4, 0, 123)
    expect(a).toEqual(b)
    let differing = 0
    for (let seed = 1; seed <= 20; seed += 1) {
      const x = createRotationState(4, 0, seed)
      const y = createRotationState(4, 0, seed + 1000)
      if (JSON.stringify(x.board) !== JSON.stringify(y.board)) differing += 1
    }
    expect(differing).toBeGreaterThan(0)
  })
})
