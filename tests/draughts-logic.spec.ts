import { describe, expect, it } from 'vitest'
import {
  AI_DEPTH, applyMove, chooseMove, createStartPosition, evaluate, isDark,
  legalMoves, mulberry32, simulateGame, status,
  type DraughtsPosition, type Piece,
} from '../src/client/games/draughts/logic.ts'

/** 按坐标放子构造局面（未提到的格子留空）。 */
function positionWith(pieces: Array<[number, number, Piece]>, turn: 'r' | 'b'): DraughtsPosition {
  const board: Piece[] = new Array(64).fill('')
  for (const [r, c, p] of pieces) board[r * 8 + c] = p
  return { board, turn }
}

const sq = (r: number, c: number): number => r * 8 + c

describe('draughts logic', () => {
  it('initial layout: 12 pieces per side on dark squares of the first three rows', () => {
    const pos = createStartPosition()
    let red = 0
    let black = 0
    for (let i = 0; i < 64; i += 1) {
      if (pos.board[i] === 'r') { red += 1; expect(i >> 3).toBeGreaterThanOrEqual(5); expect(isDark(i)).toBe(true) }
      if (pos.board[i] === 'b') { black += 1; expect(i >> 3).toBeLessThanOrEqual(2); expect(isDark(i)).toBe(true) }
    }
    expect(red).toBe(12)
    expect(black).toBe(12)
    expect(pos.turn).toBe('r')
  })

  it('generates 7 opening quiet moves for red (men only step forward-diagonal)', () => {
    const moves = legalMoves(createStartPosition())
    // 第 5 排 4 枚红子：左侧边线那枚只有一个前向落点，共 3*2+1=7 步。
    expect(moves).toHaveLength(7)
    expect(moves.every(m => m.captures.length === 0)).toBe(true)
    // 全部落到第 4 排（红方向上）。
    expect(moves.every(m => (m.to >> 3) === 4)).toBe(true)
    const loner = positionWith([[5, 5, 'r']], 'r')
    const lm = legalMoves(loner).map(m => m.to).sort((a, b) => a - b)
    expect(lm).toEqual([sq(4, 4), sq(4, 6)])
  })

  it('forced capture: when any capture exists, only captures are legal', () => {
    const pos = positionWith([[5, 5, 'r'], [3, 1, 'r'], [4, 4, 'b']], 'r')
    const moves = legalMoves(pos)
    expect(moves).toHaveLength(1)
    expect(moves[0]!.from).toBe(sq(5, 5))
    expect(moves[0]!.to).toBe(sq(3, 3))
    expect(moves[0]!.captures).toEqual([sq(4, 4)])
    const next = applyMove(pos, moves[0]!)
    expect(next.board[sq(4, 4)]).toBe('')
    expect(next.board[sq(3, 3)]).toBe('r')
    expect(next.turn).toBe('b')
  })

  it('multi-jump: enumerates complete terminal sequences and removes all captures', () => {
    // 红 (4,3) 跳 (3,4)，落 (2,5) 后必须续跳 (1,4) 至 (0,3) 升王——唯一终局序列。
    const pos = positionWith([[4, 3, 'r'], [3, 4, 'b'], [1, 4, 'b']], 'r')
    const moves = legalMoves(pos)
    expect(moves).toHaveLength(1)
    expect(moves[0]!.to).toBe(sq(0, 3))
    expect(moves[0]!.captures).toEqual([sq(3, 4), sq(1, 4)])
    const next = applyMove(pos, moves[0]!)
    expect(next.board[sq(3, 4)]).toBe('')
    expect(next.board[sq(1, 4)]).toBe('')
    // 多一个 (1,6) 分支后出现两条终局序列（落 (0,3) 或 (0,7)）。
    const branch = positionWith([[4, 3, 'r'], [3, 4, 'b'], [1, 4, 'b'], [1, 6, 'b']], 'r')
    const bMoves = legalMoves(branch).map(m => m.to).sort((a, b) => a - b)
    expect(bMoves).toEqual([sq(0, 3), sq(0, 7)])
  })

  it('promotion: man landing on the far row becomes a king (and jump ends there)', () => {
    const pos = positionWith([[2, 5, 'r'], [1, 4, 'b']], 'r')
    const moves = legalMoves(pos)
    expect(moves).toHaveLength(1)
    expect(moves[0]!.to).toBe(sq(0, 3))
    const next = applyMove(pos, moves[0]!)
    expect(next.board[sq(0, 3)]).toBe('R')
    expect(next.board[sq(1, 4)]).toBe('')
  })

  it('kings move and capture in all four diagonal directions', () => {
    const pos = positionWith([[4, 4, 'R'], [3, 3, 'b']], 'r')
    const moves = legalMoves(pos)
    // 吃 (3,3) 落 (2,2)；其余四向静走（(3,3) 被占）。有吃必吃：只有吃。
    expect(moves).toHaveLength(1)
    expect(moves[0]!.to).toBe(sq(2, 2))
    expect(moves[0]!.captures).toEqual([sq(3, 3)])
    const free = positionWith([[4, 4, 'R']], 'r')
    const targets = legalMoves(free).map(m => m.to).sort((a, b) => a - b)
    expect(targets).toEqual([sq(3, 3), sq(3, 5), sq(5, 3), sq(5, 5)])
  })

  it('win by capturing the last enemy piece', () => {
    const pos = positionWith([[4, 3, 'r'], [3, 4, 'b']], 'r')
    const m = legalMoves(pos)[0]!
    const next = applyMove(pos, m)
    expect(status(next)).toEqual({ kind: 'win', winner: 'r' })
  })

  it('win by blocking: a side with no legal move loses', () => {
    // 黑 (0,1) 前方 (1,0)/(1,2) 被红王占住，(2,3) 也被占 → 黑无子可动。
    const pos = positionWith([[0, 1, 'b'], [1, 0, 'R'], [1, 2, 'R'], [2, 3, 'r']], 'b')
    expect(status(pos)).toEqual({ kind: 'win', winner: 'r' })
  })

  it('AI is deterministic per seed and takes a winning capture', () => {
    expect(AI_DEPTH).toBe(2)
    const start = createStartPosition()
    expect(chooseMove(start, 12345)).toEqual(chooseMove(start, 12345))
    // 黑有跳吃（吃后子力净赚），2 层搜索必选吃法。
    const pos = positionWith([[5, 5, 'r'], [4, 4, 'b'], [4, 6, 'b']], 'b')
    const m = chooseMove(pos, 777)!
    expect(m.captures.length).toBe(1)
    expect(m.from).toBe(sq(4, 4))
    // mulberry32 同种子同序列。
    const a = mulberry32(42)
    const b = mulberry32(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('evaluation counts kings at 1.5 and men at 1 with advancement', () => {
    expect(evaluate(new Array(64).fill(''))).toBe(0)
    const kings = positionWith([[0, 1, 'B'], [7, 0, 'R']], 'r')
    expect(evaluate(kings.board)).toBeCloseTo(0, 10)
    const men = positionWith([[6, 1, 'b'], [1, 0, 'r']], 'r')
    // 黑子推进 6 行 (+0.12)，红子推进 6 行 (-0.12)，互相抵消。
    expect(evaluate(men.board)).toBeCloseTo(0, 10)
    const ahead = positionWith([[6, 1, 'b'], [6, 3, 'r']], 'r')
    expect(evaluate(ahead.board)).toBeGreaterThan(0.1)
  })

  it('full-game simulation is seed-deterministic and replayable', () => {
    const g1 = simulateGame(2024)
    const g2 = simulateGame(2024)
    expect(g2.moves).toEqual(g1.moves)
    expect(g2.winner).toBe(g1.winner)
    expect(g2.final).toEqual(g1.final)
    expect(g1.moves.length).toBeGreaterThan(20)
    expect(g1.winner === 'r' || g1.winner === 'b' || g1.winner === 'draw').toBe(true)
    // 整局重放：逐手 applyMove 得到与模拟一致的终局。
    let replay = createStartPosition()
    for (const m of g1.moves) replay = applyMove(replay, m)
    expect(replay).toEqual(g1.final)
    const st = status(replay)
    if (g1.winner !== 'draw') expect(st).toEqual({ kind: 'win', winner: g1.winner })
  })
})
