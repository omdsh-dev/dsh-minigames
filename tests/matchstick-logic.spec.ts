/**
 * 火柴算式逻辑测试：七段编码与字型合法性、等式求值、移动/补/抽的
 * 合法性校验、题库生成的确定性与可还原性、交互状态机（拿起/放置/
 * 丢弃/计时/推进）。
 */
import { describe, expect, it } from 'vitest'
import {
  LEVELS,
  PUZZLES_PER_LEVEL,
  SOLVE_BASE_SCORE,
  addSeg,
  addableSegs,
  applyStickMove,
  charFromBits,
  createMatchstick,
  discardStick,
  evaluateEquation,
  generatePuzzle,
  glyphBits,
  grabReserve,
  mulberry32,
  pickStick,
  placeStick,
  putDownHeld,
  removableSegs,
  removeSeg,
  tickMatchstick,
  variantLevel,
  type MatchstickState,
} from '../src/client/games/matchstick/logic.ts'

describe('matchstick 七段编码', () => {
  it('数字段位符合七段数码管标准定义', () => {
    // 段数：0/6/8/9 六或七段，1 两段，4 四段，7 三段
    expect(bitCount(glyphBits('8'))).toBe(7)
    expect(bitCount(glyphBits('0'))).toBe(6)
    expect(bitCount(glyphBits('6'))).toBe(6)
    expect(bitCount(glyphBits('4'))).toBe(4)
    expect(bitCount(glyphBits('1'))).toBe(2)
    expect(bitCount(glyphBits('7'))).toBe(3)
    // 段包含关系：1 ⊂ 0 ⊂ 8、5 ⊂ 6、3 ∪ f = 9
    expect(glyphBits('0') & glyphBits('1')).toBe(glyphBits('1'))
    expect(glyphBits('8') & glyphBits('0')).toBe(glyphBits('0'))
    expect(glyphBits('6') & glyphBits('5')).toBe(glyphBits('5'))
    expect(glyphBits('3') | (glyphBits('8') & ~glyphBits('3') & glyphBits('9'))).toBe(glyphBits('9'))
    // 每个字符的掩码互不相同且非零
    const masks = ['0','1','2','3','4','5','6','7','8','9','+','-','='].map(glyphBits)
    expect(new Set(masks).size).toBe(13)
    expect(masks.every(m => m > 0)).toBe(true)
  })

  it('charFromBits 与 addable/removable 段位表自洽', () => {
    for (const ch of ['0','1','2','3','4','5','6','7','8','9','+','-','=']) {
      expect(charFromBits(glyphBits(ch))).toBe(ch)
    }
    expect(charFromBits(glyphBits('8') | glyphBits('='))).toBeNull()
    // 8 补不了任何段（已满 7 段，m/n/x/y 补入均非法）
    expect(addableSegs('8')).toEqual([])
    // '-' 与 '=' 抽走任何一根都非法
    expect(removableSegs('-')).toEqual([])
    expect(removableSegs('=')).toEqual([])
    // 6 补 b 得 8
    expect(addableSegs('6')).toEqual(['b'])
    // 9 抽 f 得 3、抽 b 得 5
    expect(removableSegs('9')).toEqual(['b', 'f'])
  })
})

describe('matchstick 等式求值与段操作', () => {
  it('evaluateEquation 校验结构与算术', () => {
    expect(evaluateEquation('9-6=3')).toEqual({ parsed: true, correct: true })
    expect(evaluateEquation('12+35=47')).toEqual({ parsed: true, correct: true })
    expect(evaluateEquation('9-6=4').correct).toBe(false)
    expect(evaluateEquation('9=6=3').parsed).toBe(false)
    expect(evaluateEquation('9-6=').parsed).toBe(false)
    expect(evaluateEquation('=9-6').parsed).toBe(false)
    expect(evaluateEquation('-9=9').parsed).toBe(false)
    expect(evaluateEquation('9+-6=3').parsed).toBe(false)
  })

  it('addSeg/removeSeg/applyStickMove 严格校验段存在性与字型合法性', () => {
    // 抽不存在的段 / 补已存在的段 → null
    expect(removeSeg('9-6=3', 0, 'f')).toBe('3-6=3')
    // '-' 格没有 a 段、'9' 格的 f 段已存在
    expect(removeSeg('9-6=3', 1, 'a')).toBeNull()
    expect(addSeg('9-6=3', 0, 'f')).toBeNull()
    // 补后非法字型 → null（'4' 是唯一无任何可补段的数字）
    expect(addSeg('4+4=8', 0, 'a')).toBeNull()
    // 合法移动：9-6=3 → 3-8=3（'9' 抽 f 成 '3'，'6' 补 b 成 '8'）
    expect(applyStickMove('9-6=3', { fromCell: 2, fromSeg: 'b', toCell: 0, toSeg: 'f' })).toBeNull()
    expect(applyStickMove('9-6=3', { fromCell: 0, fromSeg: 'f', toCell: 2, toSeg: 'b' })).toBe('3-8=3')
    // 越界格 → null
    expect(applyStickMove('9-6=3', { fromCell: 2, fromSeg: 'b', toCell: 9, toSeg: 'f' })).toBeNull()
  })
})

describe('matchstick 题库生成', () => {
  it('mulberry32 同种子同序列，不同种子不同序列', () => {
    const a1 = mulberry32(42)
    const a2 = mulberry32(42)
    const b = mulberry32(43)
    const s1 = [a1(), a1(), a1(), a1()]
    const s2 = [a2(), a2(), a2(), a2()]
    expect(s1).toEqual(s2)
    expect(s1).not.toEqual([b(), b(), b(), b()])
  })

  it('生成的每道题不成立、且保底解能还原出成立等式', () => {
    const rng = mulberry32(7)
    for (const cfg of LEVELS) {
      for (let i = 0; i < 25; i += 1) {
        const p = generatePuzzle(rng, cfg.maxDigits, cfg.variants)
        expect(evaluateEquation(p.cells).correct).toBe(false)
        expect(evaluateEquation(p.cells).parsed).toBe(true)
        let restored: string | null = null
        if (p.solution.fix === 'move') {
          restored = applyStickMove(p.cells, p.solution.move)
        } else if (p.solution.fix === 'add') {
          restored = addSeg(p.cells, p.solution.cell, p.solution.seg)
        } else {
          restored = removeSeg(p.cells, p.solution.cell, p.solution.seg)
        }
        expect(restored).not.toBeNull()
        expect(evaluateEquation(restored as string).correct).toBe(true)
        // 非变体关只出 move 题
        if (!cfg.variants) expect(p.fix).toBe('move')
      }
    }
  })

  it('题库覆盖三种修法（变体关出现 add/remove）', () => {
    const rng = mulberry32(99)
    const fixes = new Set<string>()
    for (let i = 0; i < 120; i += 1) {
      fixes.add(generatePuzzle(rng, 3, true).fix)
    }
    expect(fixes.has('move')).toBe(true)
    expect(fixes.has('add')).toBe(true)
    expect(fixes.has('remove')).toBe(true)
  })
})

describe('matchstick 对局状态机', () => {
  it('createMatchstick 同种子完全可重放，结构 5 关 x 5 题', () => {
    const s1 = createMatchstick(2026)
    const s2 = createMatchstick(2026)
    expect(s1.puzzles).toEqual(s2.puzzles)
    expect(s1.puzzles).toHaveLength(LEVELS.length)
    for (const level of s1.puzzles) expect(level).toHaveLength(PUZZLES_PER_LEVEL)
    expect(createMatchstick(2027).puzzles).not.toEqual(s1.puzzles)
    expect(s1.status).toBe('playing')
    expect(s1.timeLeft).toBe(LEVELS[0]!.timeLimit)
  })

  it('移动修法：拿起→放置还原保底解即判定过关并计分推进', () => {
    const state = createMatchstick(5)
    // 直接用第 1 题的保底解走一遍玩家操作路径
    const p = state.puzzles[0]![0]!
    state.cells = p.cells
    state.fix = p.fix
    if (p.solution.fix !== 'move') throw new Error('前几关必出 move 题')
    const { fromCell, fromSeg, toCell, toSeg } = p.solution.move
    expect(pickStick(state, fromCell, fromSeg)).toBe(true)
    const before = state.score
    expect(placeStick(state, toCell, toSeg)).toBe('solved')
    expect(state.score).toBe(before + SOLVE_BASE_SCORE + LEVELS[0]!.timeLimit)
    expect(state.solved).toBe(1)
    expect(state.puzzleIndex).toBe(1)
    expect(state.held).toBeNull()
  })

  it('不成立的修改自动还原且步数 +1；点回原位只是放回', () => {
    const state = createMatchstick(11)
    // 第 1 关非变体：先确保拿起合法段（'9' 的 f 可抽）
    state.cells = '3-8=3'
    state.fix = 'move'
    state.attempts = 0
    expect(pickStick(state, 2, 'b')).toBe(true)
    // 放到 8 缺的 f（格 0 是 '3'，补 f 成 9）→ 9-6=3 成立
    expect(placeStick(state, 0, 'f')).toBe('solved')
    // 重新摆一题测错误分支
    const s2 = createMatchstick(12)
    s2.cells = '3-8=3'
    s2.fix = 'move'
    s2.puzzles[0] = [{ cells: '3-8=3', fix: 'move', solution: { fix: 'move', move: { fromCell: 2, fromSeg: 'b', toCell: 0, toSeg: 'f' } } }]
    // 点回原位只是放回，不计步
    expect(pickStick(s2, 2, 'b')).toBe(true)
    expect(placeStick(s2, 2, 'b')).toBe('returned')
    expect(s2.attempts).toBe(0)
    // 合法但不成立的移动：'8' 的 e 移到格 0 的 f → 9-9=3，自动还原
    expect(pickStick(s2, 2, 'e')).toBe(true)
    expect(placeStick(s2, 0, 'f')).toBe('wrong')
    expect(s2.cells).toBe('3-8=3')
    expect(s2.attempts).toBe(1)
    // U 放回手中火柴
    expect(pickStick(s2, 2, 'b')).toBe(true)
    putDownHeld(s2)
    expect(s2.held).toBeNull()
  })

  it('备用匣：变体关可取新柴补位，非变体 move 关不可取', () => {
    const base = createMatchstick(33)
    // 前三关（非变体）move 题不可取备用
    base.fix = 'move'
    base.level = 0
    expect(variantLevel(base)).toBe(false)
    expect(grabReserve(base)).toBe(false)
    // 第 4 关（level 3）为变体关
    base.level = 3
    expect(variantLevel(base)).toBe(true)
    expect(grabReserve(base)).toBe(true)
    expect(base.held).toEqual({ from: 'reserve' })
    // 手上已有再取 → false
    expect(grabReserve(base)).toBe(false)
  })

  it('补/抽修法经玩家路径可解（grabReserve→place / pick→discard）', () => {
    const state = createMatchstick(77)
    // 找一道变体关的 add 题与 remove 题各自验证
    const addPuzzle = findPuzzle(state, 'add')
    const removePuzzle = findPuzzle(state, 'remove')
    expect(addPuzzle).not.toBeNull()
    expect(removePuzzle).not.toBeNull()
    // add：从匣中取柴补回被抽走的段
    state.level = 3
    state.puzzleIndex = 0
    state.cells = addPuzzle!.cells
    state.fix = 'add'
    state.timeLeft = 10
    const scoreBefore = state.score
    expect(grabReserve(state)).toBe(true)
    expect(placeStick(state, (addPuzzle!.solution as { cell: number }).cell, (addPuzzle!.solution as { seg: 'a' }).seg)).toBe('solved')
    expect(state.score).toBeGreaterThan(scoreBefore)
    // remove：拿起多塞的火柴丢进匣中
    state.level = 3
    state.puzzleIndex = 0
    state.status = 'playing'
    state.cells = removePuzzle!.cells
    state.fix = 'remove'
    state.held = null
    const rs = removePuzzle!.solution as { cell: number, seg: 'a' }
    expect(pickStick(state, rs.cell, rs.seg)).toBe(true)
    expect(discardStick(state)).toBe('solved')
  })

  it('计时：逐帧递减、整题超时计 failed 并自动换题，全清后 won', () => {
    const state = createMatchstick(9)
    for (let i = 0; i < 130; i += 1) tickMatchstick(state, 0.5)
    expect(state.failed).toBeGreaterThanOrEqual(1)
    expect(state.timeLeft).toBeGreaterThan(0)
    // 快进全部 25 题（每题最长 60s，按 0.6s/帧推进足够）
    let guard = 0
    while (state.status === 'playing' && guard < 20000) {
      tickMatchstick(state, 0.6)
      guard += 1
    }
    expect(state.status).toBe('won')
    expect(state.failed + state.solved).toBe(25)
    // 终局后计时为空转
    expect(tickMatchstick(state, 5)).toBe('ok')
    expect(state.status).toBe('won')
  })
})

/** 数一数掩码里 1 的个数。 */
function bitCount(bits: number): number {
  let n = bits
  let c = 0
  while (n !== 0) {
    n &= n - 1
    c += 1
  }
  return c
}

/** 在整局题库里找指定修法的第一道题。 */
function findPuzzle(state: MatchstickState, fix: 'add' | 'remove') {
  for (let li = 0; li < state.puzzles.length; li += 1) {
    for (const p of state.puzzles[li]!) {
      if (p.fix === fix) return p
    }
  }
  return null
}
