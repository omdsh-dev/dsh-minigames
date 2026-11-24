/**
 * 飞行棋 Ludo 纯逻辑单元测试：盘面几何、掷骰确定性、起飞与连掷、移动
 * 与踩子、安全格、终点精确到达与反弹、无着过手、胜负判定、AI 决策确
 * 定性、整场重放一致性。全部只依赖 logic.ts，不触 DOM。
 */
import { describe, expect, it } from 'vitest'
import {
  GOAL_POS, PLANES, RING_LEN, SAFE_CELLS, START_INDEX,
  aiChooseMove, applyPieceMove, chooseMove, createLudo, finishedCount,
  legalMovesFor, mulberry32, nextRound, ringIndexFor, rollFor, safeOwner,
  type LudoState,
} from '../src/client/games/ludo/logic.ts'

/**
 * 强制下一次掷出指定点数：rollFor 的骰面只由 seed 与 rollNo 决定，穷举
 * 平移 rollNo 直到该步产出目标面（探测流与 rollFor 内部公式一致）。
 */
function forceRoll(state: LudoState, face: number): void {
  const savedNo = state.rollNo
  for (let k = 0; k < 64; k += 1) {
    state.rollNo = savedNo + k
    const probe = mulberry32(state.seed ^ Math.imul(state.rollNo + 1, 0x9e3779b9))()
    if (1 + Math.floor(probe * 6) === face) {
      rollFor(state)
      return
    }
  }
  state.rollNo = savedNo
  throw new Error('forceRoll: cannot produce face ' + face)
}

describe('ludo logic', () => {
  it('盘面几何：52 格环 + 6 格终点，起飞格与安全格下标正确', () => {
    expect(RING_LEN).toBe(52)
    expect(GOAL_POS).toBe(56)
    expect(START_INDEX.you).toBe(40)
    expect(START_INDEX.ai).toBe(1)
    expect(SAFE_CELLS.you).toEqual([40, 48])
    expect(SAFE_CELLS.ai).toEqual([1, 9])
    expect(safeOwner(40)).toBe('you')
    expect(safeOwner(9)).toBe('ai')
    expect(safeOwner(5)).toBeNull()
    // 相对步数换算：己方 0 步即起飞格，环绕正确。
    expect(ringIndexFor('you', 0)).toBe(40)
    expect(ringIndexFor('ai', 0)).toBe(1)
    expect(ringIndexFor('you', 12)).toBe(0)
    expect(ringIndexFor('ai', 51)).toBe(0)
    expect(ringIndexFor('ai', 50)).toBe(51)
  })

  it('掷骰确定性：同 seed 同随机流完全一致且骰面在 1-6 内', () => {
    const r1 = mulberry32(777)
    const r2 = mulberry32(777)
    for (let i = 0; i < 50; i += 1) expect(r1()).toBe(r2())
    const a = createLudo(12345)
    const b = createLudo(12345)
    expect(a.seed).toBe(b.seed)
    for (let i = 0; i < 300; i += 1) {
      if (a.phase === 'matchOver') break
      if (a.phase === 'roundOver') {
        nextRound(a)
        continue
      }
      const f = rollFor(a)
      expect(f).toBeGreaterThanOrEqual(1)
      expect(f).toBeLessThanOrEqual(6)
      if (a.phase === 'move') {
        const m = legalMovesFor(a, a.turn, f)[0]
        if (m !== undefined) applyPieceMove(a, a.turn, m)
      }
    }
    expect(a.rollNo).toBeGreaterThan(0)
  })

  it('起飞规则：非 6 不能起飞，掷 6 起飞且额外再掷一次', () => {
    const s = createLudo(1)
    forceRoll(s, 3)
    expect(s.phase).toBe('roll')
    expect(s.pieces.you).toEqual([-1, -1, -1, -1])
    expect(s.turn).toBe('ai') // 无子可动，过手给对方
    // 轮到对方：非 6 同样无子可动，回到己方回合。
    while (s.turn !== 'you' || s.phase !== 'roll') {
      forceRoll(s, 4)
      if (s.phase === 'move') {
        const m = legalMovesFor(s, s.turn, s.dice ?? 1)[0]
        if (m !== undefined) applyPieceMove(s, s.turn, m)
      }
    }
    forceRoll(s, 6)
    expect(s.phase).toBe('move')
    const moves = legalMovesFor(s, 'you', 6)
    expect(moves.length).toBe(4)
    expect(moves.every(m => m.takeoff && m.to === 0)).toBe(true)
    applyPieceMove(s, 'you', moves[0]!)
    expect(s.pieces.you[0]).toBe(0)
    expect(s.turn).toBe('you') // 掷 6 行子后同一方再掷
    expect(s.phase).toBe('roll')
  })

  it('移动与踩子：落到敌机普通格将其送回机场', () => {
    const s = createLudo(2)
    s.pieces.you = [6, -1, -1, -1] // 红 6 步在环 46
    s.pieces.ai = [49, -1, -1, -1] // 黄 49 步在环 50；红 6+4=10 步落环 50
    forceRoll(s, 4)
    expect(s.phase).toBe('move')
    const m = legalMovesFor(s, 'you', 4).find(mm => mm.piece === 0)
    expect(m).toBeDefined()
    expect(m!.captured).toEqual([0])
    applyPieceMove(s, 'you', m!)
    expect(s.pieces.you[0]).toBe(10)
    expect(s.pieces.ai[0]).toBe(-1)
  })

  it('安全格：敌方不可踩入，己方可叠且不发生捕获', () => {
    const s = createLudo(3)
    s.pieces.ai = [43, -1, -1, -1] // 黄 43+4=47 步将落红方星格环 48
    const blocked = legalMovesFor(s, 'ai', 4)
    expect(blocked.find(m => m.piece === 0 && m.to === 47)).toBeUndefined()
    // 己方安全格：红 4 步 +4 → 8 步（环 48），叠子合法且无捕获。
    s.pieces.ai = [-1, -1, -1, -1]
    s.pieces.you = [4, 4, -1, -1]
    const m = legalMovesFor(s, 'you', 4).find(mm => mm.piece === 0)
    expect(m).toBeDefined()
    expect(m!.captured).toEqual([])
    applyPieceMove(s, 'you', m!)
    expect(s.pieces.you[0]).toBe(8)
    expect(s.pieces.you[1]).toBe(4)
  })

  it('终点直线：需精确点数到达终点，超出反弹', () => {
    const s = createLudo(4)
    s.pieces.you = [50, -1, -1, -1]
    forceRoll(s, 6)
    const m6 = legalMovesFor(s, 'you', 6)
    expect(m6.find(m => m.piece === 0)?.to).toBe(GOAL_POS)
    applyPieceMove(s, 'you', m6[0]!)
    expect(s.pieces.you[0]).toBe(GOAL_POS)
    expect(finishedCount(s, 'you')).toBe(1)
    // 反弹：53 + 6 → 59 → 112 - 59 = 53（弹回原地）。
    const t = createLudo(5)
    t.pieces.you = [53, -1, -1, -1]
    forceRoll(t, 6)
    expect(legalMovesFor(t, 'you', 6).find(m => m.piece === 0)?.to).toBe(53)
    // 52 + 6 → 58 → 112 - 58 = 54。
    t.pieces.you = [52, -1, -1, -1]
    expect(legalMovesFor(t, 'you', 6).find(m => m.piece === 0)?.to).toBe(54)
  })

  it('胜负判定：4 架全部到终点赢下一局，先下两局胜全场', () => {
    const s = createLudo(6)
    s.pieces.you = [56, 56, 56, 55]
    forceRoll(s, 1)
    applyPieceMove(s, 'you', legalMovesFor(s, 'you', 1)[0]!)
    expect(s.roundWinner).toBe('you')
    expect(s.roundWinsYou).toBe(1)
    expect(s.phase).toBe('roundOver')
    nextRound(s)
    expect(s.round).toBe(2)
    expect(s.pieces.you).toEqual([-1, -1, -1, -1])
    expect(s.turn).toBe('ai') // 第 2 局黄先
    // 第二局切回红方冲线：夺冠。
    s.phase = 'roll'
    s.turn = 'you'
    s.pieces.you = [56, 56, 56, 55]
    forceRoll(s, 1)
    applyPieceMove(s, 'you', legalMovesFor(s, 'you', 1)[0]!)
    expect(s.phase).toBe('matchOver')
    expect(s.matchWinner).toBe('you')
    expect(s.roundWinsYou).toBe(2)
  })

  it('无着过手：唯一可动机被敌方安全格卡死时掷骰后直接换手', () => {
    const s = createLudo(7)
    s.pieces.you = [56, 56, 56, 12] // 12+1=13 步落黄方起飞格环 1（非法）
    forceRoll(s, 1)
    expect(s.phase).toBe('roll')
    expect(s.turn).toBe('ai')
    expect(s.dice).toBeNull()
    expect(s.message).toContain('无子可动')
  })

  it('AI 决策确定性：能踩必踩，同状态同 seed 结论一致', () => {
    const s = createLudo(8)
    s.pieces.you = [5, -1, -1, -1] // 红 5 步在环 45
    s.pieces.ai = [43, 20, -1, -1] // 黄 43+1=44 步落环 45 踩红；另一机 20 步
    s.turn = 'ai'
    forceRoll(s, 1)
    expect(s.phase).toBe('move')
    const pick = aiChooseMove(s)
    expect(pick).not.toBeNull()
    expect(pick!.piece).toBe(0)
    expect(pick!.captured).toEqual([0])
    const t = createLudo(8)
    t.pieces.you = [5, -1, -1, -1]
    t.pieces.ai = [43, 20, -1, -1]
    t.turn = 'ai'
    forceRoll(t, 1)
    expect(aiChooseMove(t)).toEqual(pick)
  })

  it('整场重放：双方贪心自动对局必然终局且两次重放完全一致', () => {
    const play = (): LudoState => {
      const s = createLudo(4242)
      let guard = 0
      while (s.matchWinner === null) {
        guard += 1
        expect(guard).toBeLessThan(5000)
        if (s.phase === 'roundOver') {
          nextRound(s)
          continue
        }
        if (s.phase === 'roll') {
          rollFor(s)
          continue
        }
        const move = chooseMove(s, s.turn)
        if (move === null) {
          s.phase = 'roll'
          s.turn = s.turn === 'you' ? 'ai' : 'you'
          continue
        }
        applyPieceMove(s, s.turn, move)
      }
      return s
    }
    const a = play()
    const b = play()
    expect(a.matchWinner).not.toBeNull()
    expect(a.roundWinsYou + a.roundWinsAi).toBeLessThanOrEqual(3)
    expect(a.roundWinsYou >= 2 || a.roundWinsAi >= 2).toBe(true)
    expect(a.pieces).toEqual(b.pieces)
    expect(a.roundWinsYou).toBe(b.roundWinsYou)
    expect(a.roundWinsAi).toBe(b.roundWinsAi)
    expect(a.matchWinner).toBe(b.matchWinner)
    expect(a.rollNo).toBe(b.rollNo)
    expect(PLANES).toBe(4)
  })

  it('连掷：掷 6 行子后保持回合，其他点数换手', () => {
    const s = createLudo(9)
    s.pieces.you = [5, -1, -1, -1]
    s.pieces.ai = [-1, -1, -1, -1]
    forceRoll(s, 6)
    applyPieceMove(s, 'you', legalMovesFor(s, 'you', 6)[0]!)
    expect(s.turn).toBe('you')
    expect(s.phase).toBe('roll')
    forceRoll(s, 3)
    applyPieceMove(s, 'you', legalMovesFor(s, 'you', 3)[0]!)
    expect(s.turn).toBe('ai')
  })
})
