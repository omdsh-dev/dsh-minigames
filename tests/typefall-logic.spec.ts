import { describe, expect, it } from 'vitest'
import {
  mulberry32, WORD_BANK, WORDS_PER_LEVEL, LEVELS, START_LIVES, GROUND_Y,
  LETTER_SIZE, SIDE_MARGIN, FIELD_W, CATCH_SCORE, WORD_BONUS_PER_LETTER, LEVEL_BONUS,
  createTypeFallState, currentWord, pressLetter, tickTypeFall,
  letterSpeed, spawnDelayMs, decoyIntervalMs, type TypeFallState,
} from '../src/client/games/typefall/logic.ts'

/** 等到目标字母生成（返回它）。 */
function waitActive(state: TypeFallState, maxMs = 4000): { ch: string, x: number, y: number } {
  for (let t = 0; t < maxMs; t += 50) {
    tickTypeFall(state, 50)
    if (state.active !== null) return state.active
  }
  throw new Error("letter never spawned within " + maxMs + "ms")
}

/** 把当前词整词拼完（每个字母等生成后立刻按键）。 */
function spellCurrentWord(state: TypeFallState): void {
  const word = currentWord(state)
  for (let i = 0; i < word.length; i += 1) {
    waitActive(state)
    const r = pressLetter(state, word[i]!)
    expect(r === 'hit' || r === 'complete').toBe(true)
  }
}

describe("typefall logic", () => {
  it("word bank: 5 level groups of 3-5 words, all 4-7 letters, 80+ unique words", () => {
    expect(WORDS_PER_LEVEL.length).toBe(LEVELS)
    for (const n of WORDS_PER_LEVEL) {
      expect(n).toBeGreaterThanOrEqual(3)
      expect(n).toBeLessThanOrEqual(5)
    }
    expect(WORD_BANK.length).toBeGreaterThanOrEqual(80)
    expect(new Set(WORD_BANK).size).toBe(WORD_BANK.length)
    for (const w of WORD_BANK) {
      expect(w.length).toBeGreaterThanOrEqual(4)
      expect(w.length).toBeLessThanOrEqual(7)
      expect(w).toMatch(/^[a-z]+$/)
    }
  })

  it("mulberry32 is deterministic, and the same seed draws the same per-level queues", () => {
    const seqA = mulberry32(42)
    const seqB = mulberry32(42)
    const seqC = mulberry32(43)
    const sa = [seqA(), seqA(), seqA()]
    const sb = [seqB(), seqB(), seqB()]
    expect(sa).toEqual(sb)
    for (const v of sa) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
    expect(sa[0]).not.toBe(seqC())
    const s1 = createTypeFallState(7)
    const s2 = createTypeFallState(7)
    const s3 = createTypeFallState(8)
    expect(s1.queues).toEqual(s2.queues)
    expect(s1.queues.length).toBe(LEVELS)
    for (let lv = 0; lv < LEVELS; lv += 1) {
      expect(s1.queues[lv]!.length).toBe(WORDS_PER_LEVEL[lv])
      const pool = new Set(WORD_BANK)
      for (const w of s1.queues[lv]!) expect(pool.has(w)).toBe(true)
    }
    expect(s1.queues).not.toEqual(s3.queues)
  })

  it("spawns letters of the word in order and catches advance the slot", () => {
    const state = createTypeFallState(11)
    const word = currentWord(state)
    const first = waitActive(state)
    expect(first.ch).toBe(word[0]!.toUpperCase())
    expect(first.y).toBeLessThan(0) // 从画面上方外进入
    expect(pressLetter(state, word[0]!)).toBe('hit')
    expect(state.typed).toBe(1)
    expect(state.score).toBe(CATCH_SCORE)
    const second = waitActive(state)
    expect(second.ch).toBe(word[1]!.toUpperCase())
  })

  it("a wrong key costs a life but the falling letter stays catchable; empty air also counts as wrong", () => {
    const state = createTypeFallState(11)
    // 无字母下落时按键同样算按错。
    expect(state.active).toBeNull()
    expect(pressLetter(state, 'q')).toBe('wrong')
    expect(state.lives).toBe(START_LIVES - 1)
    const word = currentWord(state)
    waitActive(state)
    const wrong = word[0] === 'a' ? 'z' : 'a'
    expect(pressLetter(state, wrong)).toBe('wrong')
    expect(state.lives).toBe(START_LIVES - 2) // 空按一次 + 按错一次
    expect(state.active).not.toBeNull() // 目标字母仍在下落
    expect(pressLetter(state, word[0]!)).toBe('hit')
    expect(state.pendingSplats.some(s => s.kind === 'miss')).toBe(false)
  })

  it("a letter reaching the ground costs a life and respawns", () => {
    const state = createTypeFallState(11)
    const word = currentWord(state)
    waitActive(state)
    const active = state.active!
    // 快进到落地（不按键）。
    for (let t = 0; t < 20000 && state.active !== null; t += 100) {
      tickTypeFall(state, 100)
    }
    expect(state.active).toBeNull()
    expect(state.lives).toBe(START_LIVES - 1)
    expect(state.pendingSplats.some(s => s.kind === 'miss' && s.y === GROUND_Y)).toBe(true)
    state.pendingSplats.length = 0
    // 下一封信会重新落下，仍是同一个（未拼入的）字母。
    const again = waitActive(state)
    expect(again.ch).toBe(word[0]!.toUpperCase())
    expect(again.x).toBeGreaterThanOrEqual(SIDE_MARGIN)
    expect(again.x).toBeLessThanOrEqual(FIELD_W - SIDE_MARGIN - LETTER_SIZE)
  })

  it("completing a word scores the bonus and moves to the next word", () => {
    const state = createTypeFallState(11)
    const word = currentWord(state)
    spellCurrentWord(state)
    const bonus = word.length * WORD_BONUS_PER_LETTER + 0 * LEVEL_BONUS
    expect(state.score).toBe(word.length * CATCH_SCORE + bonus)
    expect(state.wordIndex).toBe(1)
    expect(state.typed).toBe(0)
    expect(currentWord(state)).toBe(state.queues[0]![1])
  })

  it("finishing a level's word group advances the level and speeds up", () => {
    const state = createTypeFallState(11)
    for (let i = 0; i < WORDS_PER_LEVEL[0]!; i += 1) spellCurrentWord(state)
    expect(state.level).toBe(1)
    expect(state.wordIndex).toBe(0)
    expect(state.levelBannerMs).toBeGreaterThan(0)
    expect(letterSpeed(1, 0)).toBeGreaterThan(letterSpeed(0, 0))
    expect(spawnDelayMs(1)).toBeLessThan(spawnDelayMs(0))
    expect(decoyIntervalMs(0)).toBeGreaterThan(0)
  })

  it("decoys appear from level 2, are harmless on the ground, but cost a life when pressed", () => {
    const state = createTypeFallState(11)
    for (let i = 0; i < WORDS_PER_LEVEL[0]!; i += 1) spellCurrentWord(state)
    expect(state.level).toBe(1)
    // 快进观察干扰字母：目标字母出现就立刻接住（不落地），干扰字母自然
    // 落地移除——全程不应扣任何命。
    const livesBefore = state.lives
    let sawDecoy = false
    for (let t = 0; t < 12000; t += 100) {
      tickTypeFall(state, 100)
      if (state.decoys.length > 0) sawDecoy = true
      if (state.active !== null) {
        pressLetter(state, currentWord(state)[state.typed]!.toUpperCase())
      }
    }
    expect(sawDecoy).toBe(true)
    expect(state.lives).toBe(livesBefore)
    expect(state.pendingSplats.every(s => s.kind === 'hit')).toBe(true)
    state.pendingSplats.length = 0
    // 直接注入一个干扰字母验证按键判定：按到干扰字母=按错。
    state.active = { id: 999, ch: 'Q', x: 100, y: 300, vy: 90, decoy: true }
    expect(pressLetter(state, 'q')).toBe('wrong')
    expect(state.lives).toBe(livesBefore - 1)
    state.active = null
  })

  it("three misses end the game; presses afterwards are ignored", () => {
    const state = createTypeFallState(11)
    expect(pressLetter(state, 'q')).toBe('wrong')
    expect(pressLetter(state, 'q')).toBe('wrong')
    expect(pressLetter(state, 'q')).toBe('wrong')
    expect(state.over).toBe(true)
    expect(state.lives).toBe(0)
    expect(pressLetter(state, 'a')).toBe('ignored')
  })

  it("finishing all 5 levels wins the run", () => {
    const state = createTypeFallState(11)
    for (let lv = 0; lv < LEVELS; lv += 1) {
      for (let i = 0; i < WORDS_PER_LEVEL[lv]!; i += 1) spellCurrentWord(state)
      // 升级瞬间清空同屏干扰字母。
      if (state.level === lv + 1) expect(state.decoys.length).toBe(0)
    }
    expect(state.won).toBe(true)
    expect(state.over).toBe(false)
    expect(pressLetter(state, 'a')).toBe('ignored')
    expect(state.score).toBeGreaterThan(0)
  })

  it("seed replay: identical script on identical seeds yields identical state", () => {
    const run = (): TypeFallState => {
      const s = createTypeFallState(1234)
      for (let i = 0; i < 6; i += 1) {
        waitActive(s)
        pressLetter(s, currentWord(s)[s.typed]!)
        for (let t = 0; t < 700; t += 50) tickTypeFall(s, 50)
      }
      return s
    }
    const a = run()
    const b = run()
    expect(b.score).toBe(a.score)
    expect(b.lives).toBe(a.lives)
    expect(b.level).toBe(a.level)
    expect(b.wordIndex).toBe(a.wordIndex)
    expect(b.typed).toBe(a.typed)
    expect(b.queues).toEqual(a.queues)
  })
})
