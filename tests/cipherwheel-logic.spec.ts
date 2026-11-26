import { describe, expect, it } from 'vitest'
import {
  AFFINE_MULTIPLIERS, LEVELS, MAX_HINTS, affineEncrypt, applyDigit, applyHint,
  caesarEncrypt, createChallenge, createCipherWheelState, decryptPreview,
  letterCounts, modInverse26, mulberry32, rotateWheel, scoreForLevel,
  setMultiplier, setShift, setWheelTarget, stateWithChallenge, submitAnswer,
  totalPerfectScore, vigenereEncrypt,
} from '../src/client/games/cipherwheel/logic.ts'

/** 便捷：纯字母文本。 */
const PLAIN = 'ATTACKATDAWN'

describe('cipherwheel logic', () => {
  it('凯撒加密/解密往返：P+s=C，转轮对齐 s 预览即还原', () => {
    const cipher = caesarEncrypt(PLAIN, 7)
    expect(cipher).toBe('HAAHJRHAKHDU')
    const state = stateWithChallenge({
      kind: 'caesar', plainText: PLAIN, cipherText: cipher,
      shift: 7, multiplier: 1, keyOffsets: [],
    }, 0)
    setShift(state, 7)
    expect(decryptPreview(state.challenge, state.wheel)).toBe(PLAIN)
    setShift(state, 7 + 26)
    expect(decryptPreview(state.challenge, state.wheel)).toBe(PLAIN)
  })

  it('仿射加密要求乘数与 26 互质，合法乘数可逆可往返', () => {
    expect(() => affineEncrypt(PLAIN, 2, 3)).toThrow()
    for (const a of AFFINE_MULTIPLIERS) {
      expect(modInverse26(a)).not.toBeNull()
    }
    const a = 5
    const b = 8
    const cipher = affineEncrypt(PLAIN, a, b)
    const state = stateWithChallenge({
      kind: 'affine', plainText: PLAIN, cipherText: cipher,
      shift: b, multiplier: a, keyOffsets: [],
    }, 1)
    setShift(state, b)
    setMultiplier(state, a)
    expect(decryptPreview(state.challenge, state.wheel)).toBe(PLAIN)
  })

  it('维吉尼亚逐字母轮换：正确钥匙序列预览还原，错位不行', () => {
    const key = [2, 4, 19]
    const cipher = vigenereEncrypt(PLAIN, key)
    const challenge = {
      kind: 'vigenere' as const, plainText: PLAIN, cipherText: cipher,
      shift: 0, multiplier: 1, keyOffsets: key,
    }
    const state = stateWithChallenge(challenge, 2)
    state.wheel.keyOffsets = [...key]
    expect(decryptPreview(state.challenge, state.wheel)).toBe(PLAIN)
    state.wheel.keyOffsets = [2, 4, 20]
    expect(decryptPreview(state.challenge, state.wheel)).not.toBe(PLAIN)
  })

  it('频率统计：letterCounts 计数与文本一致', () => {
    const counts = letterCounts('AABZ')
    expect(counts[0]).toBe(2)
    expect(counts[1]).toBe(1)
    expect(counts[25]).toBe(1)
    expect(counts.reduce((s, c) => s + c, 0)).toBe(4)
  })

  it('出题确定性：同 seed 生成完全一致，五种关卡类型与密钥约束正确', () => {
    const gen = (): ReturnType<typeof createChallenge>[] => {
      const rng = mulberry32(42)
      return LEVELS.map((_, i) => createChallenge(rng, i))
    }
    const first = gen()
    const second = gen()
    expect(second).toEqual(first)
    expect(first.map((c) => c.kind)).toEqual(['caesar', 'affine', 'vigenere', 'vigenere', 'vigenere'])
    for (const c of first) {
      expect(c.cipherText).not.toBe(c.plainText)
      expect(c.cipherText).toMatch(/^[A-Z]+$/)
      if (c.kind === 'caesar') expect(c.shift % 26).not.toBe(0)
      if (c.kind === 'affine') {
        expect(AFFINE_MULTIPLIERS).toContain(c.multiplier)
        if (c.multiplier === 1) expect(c.shift % 26).not.toBe(0)
      }
      if (c.kind === 'vigenere') {
        expect(c.keyOffsets.length).toBeGreaterThanOrEqual(3)
        for (const k of c.keyOffsets) expect(k).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('转轮状态：rotateWheel 按目标类型作用于 b 或选中槽，数字键两位自动应用', () => {
    const state = createCipherWheelState(mulberry32(7))
    rotateWheel(state, 5)
    expect(state.wheel.shift).toBe(5)
    rotateWheel(state, -30)
    expect(state.wheel.shift).toBe(1)
    applyDigit(state, '1')
    expect(state.wheel.digitBuffer).toBe('1')
    applyDigit(state, '9')
    expect(state.wheel.shift).toBe(19)
    expect(state.wheel.digitBuffer).toBe('')

    const vig = stateWithChallenge({
      kind: 'vigenere', plainText: PLAIN, cipherText: vigenereEncrypt(PLAIN, [3, 3, 3]),
      shift: 0, multiplier: 1, keyOffsets: [3, 3, 3],
    }, 2)
    vig.wheel.selectedSlot = 1
    rotateWheel(vig, 2)
    expect(vig.wheel.keyOffsets[1]).toBe(2)
    expect(vig.wheel.keyOffsets[0]).toBe(0)
  })

  it('提交判定：解对计分过关，解错不动；提示扣分计入该关', () => {
    const state = createCipherWheelState(mulberry32(9))
    // 第 1 关凯撒：先把转轮对到错值再对值，覆盖两条分支。
    setShift(state, (state.challenge.shift + 13) % 26)
    expect(submitAnswer(state)).toBe('wrong')
    expect(state.level).toBe(0)
    setShift(state, state.challenge.shift)
    expect(submitAnswer(state)).toBe('correct')
    expect(state.level).toBe(1)
    expect(state.score).toBe(scoreForLevel(0, 0))

    // 第 2 关用 2 次提示后过关：计分扣提示代价。
    const before = state.score
    applyHint(state)
    applyHint(state)
    expect(applyHint(state)).toBeNull()
    setShift(state, state.challenge.shift)
    setMultiplier(state, state.challenge.multiplier)
    expect(submitAnswer(state)).toBe('correct')
    expect(state.score).toBe(before + scoreForLevel(1, MAX_HINTS))
    expect(state.hintsUsed).toBe(0)
  })

  it('提示揭示真实的密文→明文映射，且每关限 2 次', () => {
    const state = createCipherWheelState(mulberry32(11))
    const pair = applyHint(state)
    expect(pair).not.toBeNull()
    const plainIdx = state.challenge.plainText.indexOf(pair!.to)
    expect(plainIdx).toBeGreaterThanOrEqual(0)
    // 揭示的映射必须与真实密钥一致：
    const pos = state.challenge.cipherText.indexOf(pair!.from)
    expect(state.challenge.plainText[pos]).toBe(pair!.to)
    expect(applyHint(state)).not.toBeNull()
    expect(applyHint(state)).toBeNull()
    expect(state.hintsUsed).toBe(MAX_HINTS)
    // 两次揭示的密文字母互不相同。
    expect(state.revealed[0]!.from).not.toBe(state.revealed[1]!.from)
  })

  it('完整通关：五关依序解出，phase 置 won，总分等于逐关之和', () => {
    const state = createCipherWheelState(mulberry32(123))
    let guard = 0
    while (state.phase === 'playing' && guard < 20) {
      guard += 1
      const c = state.challenge
      if (c.kind === 'vigenere') state.wheel.keyOffsets = [...c.keyOffsets]
      else {
        setShift(state, c.shift)
        setMultiplier(state, c.multiplier)
      }
      expect(decryptPreview(state.challenge, state.wheel)).toBe(c.plainText)
      expect(submitAnswer(state)).toBe('correct')
    }
    expect(state.phase).toBe('won')
    expect(state.level).toBe(LEVELS.length - 1)
    expect(state.score).toBe(totalPerfectScore())
    expect(submitAnswer(state)).toBe('wrong')
  })

  it('seed 重放：同一 seed 从头再玩一遍，题目与分数完全一致', () => {
    const play = (seed: number): string => {
      const state = createCipherWheelState(mulberry32(seed))
      const transcript: string[] = []
      let guard = 0
      while (state.phase === 'playing' && guard < 20) {
        guard += 1
        const c = state.challenge
        transcript.push(c.cipherText)
        applyHint(state)
        if (c.kind === 'vigenere') state.wheel.keyOffsets = [...c.keyOffsets]
        else {
          setShift(state, c.shift)
          setMultiplier(state, c.multiplier)
        }
        submitAnswer(state)
      }
      transcript.push('score=' + state.score)
      return transcript.join('|')
    }
    expect(play(2024)).toBe(play(2024))
    expect(play(2024)).not.toBe(play(2025))
  })

  it('关卡递进配置：五关凯撒→仿射→短钥→长钥→无频率图硬模式', () => {
    expect(LEVELS).toHaveLength(5)
    expect(LEVELS[0]!.kind).toBe('caesar')
    expect(LEVELS[1]!.kind).toBe('affine')
    expect(LEVELS[2]!.keyLen).toBe(3)
    expect(LEVELS[3]!.keyLen).toBe(6)
    expect(LEVELS[4]!.freqChart).toBe(false)
    expect(LEVELS.slice(0, 4).every((l) => l.freqChart)).toBe(true)
    expect(scoreForLevel(4, 0)).toBeGreaterThan(scoreForLevel(0, 0))
    expect(scoreForLevel(0, 2)).toBeLessThan(scoreForLevel(0, 0))
  })
})
