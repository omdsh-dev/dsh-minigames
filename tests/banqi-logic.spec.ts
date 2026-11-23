import { describe, expect, it } from 'vitest'
import {
  applyAction, aiChooseAction, canCapture, createBanqiState, legalActions,
  moveTargets, SIDE_COUNTS, CELLS,
  type BanqiState, type Piece, type PieceType, type Side,
} from '../src/client/games/banqi/logic.ts'

/** 直接按 (格号, 阵营, 牌型, 是否亮) 摆一盘残局，其余格留空。 */
function makeState(entries: Array<[number, Side, PieceType] | [number, Side, PieceType, boolean]>): BanqiState {
  const board: (Piece | null)[] = new Array(CELLS).fill(null)
  for (const [index, side, type, revealed] of entries) {
    board[index] = { side, type, revealed: revealed !== false }
  }
  return { board, turn: 'red', winner: null, ply: 0 }
}

/** 曼哈顿距离到最近的黑子（红方测试驱动的逼近度量）。 */
function nearestBlackDist(s: BanqiState, idx: number): number {
  let best = 99
  for (let i = 0; i < CELLS; i += 1) {
    const p2 = s.board[i]
    if (p2 == null || p2.side !== 'black') continue
    best = Math.min(best, Math.abs((idx % 8) - (i % 8)) + Math.abs(Math.floor(idx / 8) - Math.floor(i / 8)))
  }
  return best
}

describe('banqi logic', () => {
  it('按种子洗牌布置：组成固定、全部暗扣、同种子同盘', () => {
    const a = createBanqiState(123)
    const b = createBanqiState(123)
    expect(a.board).toEqual(b.board)
    expect(a.turn).toBe('red')
    expect(a.winner).toBe(null)
    const counts = new Map<string, number>()
    for (const piece of a.board) {
      expect(piece).not.toBeNull()
      expect(piece!.revealed).toBe(false)
      const key = piece!.side + ':' + piece!.type
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    expect(a.board).toHaveLength(32)
    for (const side of ['red', 'black'] as const) {
      for (const type of Object.keys(SIDE_COUNTS) as PieceType[]) {
        expect(counts.get(side + ':' + type)).toBe(SIDE_COUNTS[type])
      }
    }
    // 不同种子应产生不同布置（取多种子至少一组不同即可）。
    let anyDiff = false
    for (const seed of [1, 2, 3, 4, 5]) {
      if (JSON.stringify(createBanqiState(seed).board) !== JSON.stringify(a.board)) anyDiff = true
    }
    expect(anyDiff).toBe(true)
  })

  it('翻开动作：亮出暗子并换手，重翻/非本回合非法', () => {
    const state = createBanqiState(42)
    expect(legalActions(state, 'black')).toEqual([])
    const flips = legalActions(state, 'red').filter((a) => a.kind === 'flip')
    expect(flips).toHaveLength(32)
    expect(applyAction(state, { kind: 'flip', index: 0 })).toBe(true)
    expect(state.board[0]!.revealed).toBe(true)
    expect(state.turn).toBe('black')
    expect(applyAction(state, { kind: 'flip', index: 0 })).toBe(false)
    // 换手后轮黑方：黑方翻另一枚暗子合法，随后轮换回红方。
    expect(applyAction(state, { kind: 'flip', index: 1 })).toBe(true)
    expect(state.turn).toBe('red')
  })

  it('普通移动：可走空格，不可入暗格、不可跨步、不可动对方或暗子', () => {
    const state = makeState([[0, 'red', 'che'], [1, 'black', 'ma', false], [3, 'black', 'bing']])
    expect(moveTargets(state, 0)).toEqual([8])
    expect(applyAction(state, { kind: 'move', from: 0, to: 8 })).toBe(true)
    expect(state.board[0]).toBe(null)
    expect(state.board[8]!.type).toBe('che')
    expect(state.turn).toBe('black')
    const hidden = makeState([[0, 'red', 'che'], [1, 'black', 'ma', false]])
    expect(moveTargets(hidden, 0)).toEqual([8])
    const far = makeState([[0, 'red', 'che'], [2, 'black', 'ma']])
    expect(applyAction(far, { kind: 'move', from: 0, to: 2 })).toBe(false)
    const wrongSide = makeState([[0, 'black', 'che'], [1, 'red', 'ma']])
    expect(applyAction(wrongSide, { kind: 'move', from: 0, to: 1 })).toBe(false)
  })

  it('吃子等级：大吃小、同级互吃、小吃大不可', () => {
    const eat = makeState([[0, 'red', 'che'], [1, 'black', 'ma']])
    expect(moveTargets(eat, 0)).toContain(1)
    const noEat = makeState([[0, 'black', 'ma'], [1, 'red', 'che']])
    expect(moveTargets(noEat, 0)).not.toContain(1)
    const sameRank = makeState([[0, 'red', 'che'], [1, 'black', 'che']])
    expect(moveTargets(sameRank, 0)).toContain(1)
    expect(canCapture(
      { side: 'red', type: 'xiang', revealed: true },
      { side: 'black', type: 'ma', revealed: true },
    )).toBe(true)
  })

  it('兵帅例外：兵可吃帅，帅不可吃兵', () => {
    const bingEatShuai = makeState([[0, 'red', 'bing'], [1, 'black', 'shuai']])
    expect(moveTargets(bingEatShuai, 0)).toContain(1)
    const shuaiNoEat = makeState([[0, 'red', 'shuai'], [1, 'black', 'bing']])
    expect(moveTargets(shuaiNoEat, 0)).not.toContain(1)
    const shuaiEatShi = makeState([[0, 'red', 'shuai'], [1, 'black', 'shi']])
    expect(moveTargets(shuaiEatShi, 0)).toContain(1)
  })

  it('炮：隔恰好一子跳吃，不可零屏/隔双跳/邻近吃，可走空格', () => {
    // 0=红炮, 2=任意屏（红仕）, 3=黑車 → 跳吃成立。
    const jump = makeState([[0, 'red', 'pao'], [2, 'red', 'shi'], [3, 'black', 'che']])
    expect(moveTargets(jump, 0)).toContain(3)
    // 无屏：3 前是空格，炮只能走到 1。
    const noScreen = makeState([[0, 'red', 'pao'], [3, 'black', 'che']])
    expect(moveTargets(noScreen, 0)).toEqual([8, 1])
    // 屏后隔着空格仍可跳到其后的第一枚子。
    const gapBeyond = makeState([[0, 'red', 'pao'], [2, 'red', 'shi'], [4, 'black', 'che']])
    expect(moveTargets(gapBeyond, 0)).toEqual([8, 1, 4])
    // 屏后是己方亮子：不可落。
    const ownBehind = makeState([[0, 'red', 'pao'], [2, 'black', 'shi'], [3, 'red', 'che']])
    expect(moveTargets(ownBehind, 0)).toEqual([8, 1])
    // 邻近敌子不可一步吃。
    const adjacent = makeState([[0, 'red', 'pao'], [1, 'black', 'bing']])
    expect(moveTargets(adjacent, 0)).toEqual([8])
    // 屏是暗子同样有效。
    const hiddenScreen = makeState([[0, 'red', 'pao'], [2, 'black', 'ma', false], [3, 'black', 'che']])
    expect(moveTargets(hiddenScreen, 0)).toContain(3)
  })

  it('无合法动作判负：仅剩被红兵困死的将，红走一步后即胜', () => {
    const state = makeState([[0, 'black', 'shuai'], [1, 'red', 'bing'], [8, 'red', 'bing'], [31, 'red', 'bing']])
    expect(moveTargets(state, 0)).toEqual([])
    expect(applyAction(state, { kind: 'move', from: 31, to: 30 })).toBe(true)
    expect(state.winner).toBe('red')
    expect(state.turn).toBe('black')
  })

  it('吃光判负：黑最后一子被吃即红胜', () => {
    const state = makeState([[0, 'red', 'che'], [1, 'black', 'bing'], [31, 'red', 'ma']])
    expect(applyAction(state, { kind: 'move', from: 0, to: 1 })).toBe(true)
    expect(state.board[1]!.side).toBe('red')
    expect(state.winner).toBe('red')
  })

  it('AI 决策确定性：同局面同种子必同手，且贪心吃帅', () => {
    const state = makeState([[1, 'black', 'bing'], [2, 'red', 'shuai'], [30, 'red', 'ma', false]])
    state.turn = 'black'
    const first = aiChooseAction(state, 777)
    const second = aiChooseAction(state, 777)
    expect(first).toEqual(second)
    expect(first).toEqual({ kind: 'move', from: 1, to: 2 })
  })

  it('AI 躲避：被红车瞄上的黑马选择离开而非翻子', () => {
    const state = makeState([[0, 'red', 'che'], [1, 'black', 'ma'], [31, 'red', 'shi', false]])
    state.turn = 'black'
    const action = aiChooseAction(state, 9)
    expect(action).not.toBeNull()
    expect(action!.kind).toBe('move')
    if (action!.kind === 'move') {
      expect(action!.from).toBe(1)
      expect([2, 9]).toContain(action!.to)
    }
  })

  it('整局重放：种子驱动的完整对局收敛且逐盘可复现', () => {
    const play = (seed: number): BanqiState => {
      const s = createBanqiState(seed)
      const seen = new Map<string, number>()
      let guard = 0
      while (s.winner === null && guard < 800) {
        // 位置重复时轮换候选，跳出镜像追逐循环；整体仍由种子确定。
        const key = s.board.map((p2) => p2 === null ? '.' : p2.side + p2.type + (p2.revealed ? '1' : '0')).join('') + s.turn
        const repeat = seen.get(key) ?? 0
        seen.set(key, repeat + 1)
        const actions = legalActions(s, s.turn)
        if (actions.length === 0) break
        const captures = actions
          .filter((a): a is { kind: 'move', from: number, to: number } => a.kind === 'move' && s.board[a.to] !== null)
          .sort((a, b) => (s.board[b.to]!.side === 'black' ? 1 : 0) - (s.board[a.to]!.side === 'black' ? 1 : 0))
        const flips = actions.filter((a) => a.kind === 'flip')
        let pool = captures.length > 0 ? captures : flips
        if (pool.length === 0) {
          // 无吃无翻：逼近最近黑子的安静步。
          pool = actions.filter((a): a is { kind: 'move', from: number, to: number } => a.kind === 'move')
            .sort((a, b) => nearestBlackDist(s, a.to) - nearestBlackDist(s, b.to))
        } else if (captures.length === 0 && repeat > 0 && flips.length === 0) {
          pool = actions.filter((a): a is { kind: 'move', from: number, to: number } => a.kind === 'move')
            .sort((a, b) => nearestBlackDist(s, a.to) - nearestBlackDist(s, b.to))
        }
        if (pool.length === 0) break
        let action = pool[repeat % pool.length]!
        if (s.turn === 'black') {
          const ai = aiChooseAction(s, seed)
          if (ai !== null) action = ai
        }
        applyAction(s, action)
        guard += 1
      }
      return s
    }
    for (const seed of [7, 2024]) {
      const one = play(seed)
      const two = play(seed)
      expect(one.winner).not.toBeNull()
      expect(one.board).toEqual(two.board)
      expect(one.ply).toBe(two.ply)
      expect(one.winner).toBe(two.winner)
    }
  })
})
