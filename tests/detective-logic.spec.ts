import { describe, expect, it } from 'vitest'
import {
  CENTER_ROOM, CARD_COUNT, SUSPECTS, WEAPONS, ROOMS, accuse, cardIdOf, cardName, categoryOf,
  createDetective, deriveNotes, manhattan, moveTo, reachableRooms, rollDie, snapshot, suggest,
  type DetectiveState,
} from '../src/client/games/detective/logic.ts'

/** 构造可控局面：底牌与双方手牌由测试直接指定（rng 用不到即可）。 */
function crafted(): DetectiveState {
  const s = createDetective(7)
  s.secret = { suspect: 0, weapon: 0, room: 0 }
  s.playerHand = [cardIdOf(0, 1), cardIdOf(1, 1), cardIdOf(2, 1)]
  s.aiHand = [cardIdOf(0, 0), cardIdOf(1, 0), cardIdOf(2, 0), cardIdOf(0, 2), cardIdOf(1, 2), cardIdOf(2, 2), cardIdOf(0, 3), cardIdOf(1, 3), cardIdOf(2, 3)]
  return s
}

/** 走进 0 号书房（非中央）并标记已移动，凑齐盘问前提。 */
function enterRoom0(s: DetectiveState): void {
  s.pos = CENTER_ROOM
  s.steps = 3
  expect(moveTo(s, 0)).toBe(true)
}

describe('detective setup', () => {
  it('partitions all 21 cards into secret + two 9-card hands', () => {
    for (const seed of [1, 42, 999, 123456]) {
      const s = createDetective(seed)
      expect(s.secret.suspect).toBeGreaterThanOrEqual(0)
      expect(s.secret.suspect).toBeLessThan(6)
      expect(s.secret.weapon).toBeLessThan(6)
      expect(s.secret.room).toBeLessThan(9)
      expect(s.playerHand).toHaveLength(9)
      expect(s.aiHand).toHaveLength(9)
      const all = [cardIdOf(0, s.secret.suspect), cardIdOf(1, s.secret.weapon), cardIdOf(2, s.secret.room), ...s.playerHand, ...s.aiHand]
      expect(new Set(all).size).toBe(CARD_COUNT)
      expect(s.pos).toBe(CENTER_ROOM)
      expect(s.won).toBeNull()
    }
  })

  it('is deterministic for a given seed and rerolls with another', () => {
    expect(snapshot(createDetective(77))).toEqual(snapshot(createDetective(77)))
    const a = snapshot(createDetective(1)).playerHand.join(',')
    const b = snapshot(createDetective(2)).playerHand.join(',')
    expect(a).not.toBe(b)
  })
})

describe('detective dice and movement', () => {
  it('rolls 1-3 deterministically and gates on remaining steps', () => {
    const s = createDetective(5)
    const r1 = rollDie(s)
    expect(r1).toBeGreaterThanOrEqual(1)
    expect(r1).toBeLessThanOrEqual(3)
    expect(s.steps).toBe(r1)
    expect(rollDie(s)).toBe(0)
    const t = createDetective(5)
    expect(rollDie(t)).toBe(r1)
  })

  it('moves within manhattan steps, consumes them, and rejects illegal targets', () => {
    const s = createDetective(9)
    s.steps = 2
    expect(moveTo(s, CENTER_ROOM)).toBe(false) // 原地
    expect(moveTo(s, 0)).toBe(true) // 4→0 距离 2
    expect(s.pos).toBe(0)
    expect(s.steps).toBe(0)
    expect(s.movedThisTurn).toBe(true)
    expect(moveTo(s, 1)).toBe(false) // 无剩余步
    s.steps = 1
    expect(moveTo(s, 8)).toBe(false) // 0→8 距离 4 超步
    expect(manhattan(0, 8)).toBe(4)
    expect(reachableRooms(s)).toEqual([1, 3])
  })
})

describe('detective suggestion', () => {
  it('shows the first matching card in ai-hand deal order and excludes it', () => {
    const s = crafted()
    enterRoom0(s)
    // aiHand 首张 = 嫌疑人0（卡号0）；声明 嫌疑人0 + 凶器2 + 本房间0 → 首个匹配即首张。
    const shown = suggest(s, 0, 2)
    expect(shown).toBe(cardIdOf(0, 0))
    expect(s.excluded[cardIdOf(0, 0)]).toBe(true)
  })

  it('matches the current room card too', () => {
    const s = crafted()
    enterRoom0(s)
    // 嫌疑人1 / 凶器1 在玩家手里，房间0 在 AI 手里 → 亮房间卡。
    expect(suggest(s, 1, 1)).toBe(cardIdOf(2, 0))
    expect(s.excluded[cardIdOf(2, 0)]).toBe(true)
  })

  it('infers locked secret cards when the witness holds no match', () => {
    const s = crafted()
    enterRoom0(s)
    // 嫌疑人1/凶器1 在玩家手，本房间0（已从 AI 手移走）不在玩家手 → 房间0 锁定为底牌。
    const shown = suggest(s, 1, 1)
    // 上一用例同盘面会亮房间0，这里先移走 AI 的房间0 再试：
    expect(shown).not.toBeNull()
    const t = crafted()
    t.aiHand = t.aiHand.filter(c => c !== cardIdOf(2, 0))
    enterRoom0(t)
    expect(suggest(t, 1, 1)).toBeNull()
    expect(t.confirmed[cardIdOf(2, 0)]).toBe(true)
    expect(t.confirmed[cardIdOf(0, 1)]).toBe(false) // 玩家持有，不锁定
    expect(t.confirmed[cardIdOf(1, 1)]).toBe(false)
  })

  it('requires a just-entered non-center room', () => {
    const s = crafted()
    expect(suggest(s, 0, 0)).toBe(-1) // 未移动
    s.pos = CENTER_ROOM
    s.movedThisTurn = true
    expect(suggest(s, 0, 0)).toBe(-1) // 中央大厅不可盘问
  })
})

describe('detective accusation', () => {
  it('wins on all three exact cards and loses otherwise, once per game', () => {
    const s = crafted()
    expect(accuse(s, 0, 0, 0)).toBe('win')
    expect(s.won).toBe(true)
    expect(accuse(s, 0, 0, 0)).toBe('used')
    const t = crafted()
    expect(accuse(t, 1, 0, 0)).toBe('lose')
    expect(t.won).toBe(false)
    expect(accuse(t, 0, 0, 0)).toBe('used')
  })

  it('blocks movement and dice after the game ends', () => {
    const s = crafted()
    accuse(s, 0, 0, 0)
    s.steps = 3
    expect(moveTo(s, 1)).toBe(false)
    expect(rollDie(s)).toBe(0)
  })
})

describe('detective notes and replay', () => {
  it('derives notes from hand, exclusions and confirmations', () => {
    const s = crafted()
    enterRoom0(s)
    suggest(s, 0, 0) // 亮嫌疑人0
    const notes = deriveNotes(s)
    expect(notes[cardIdOf(0, 0)]).toBe('excluded')
    for (const c of s.playerHand) expect(notes[c]).toBe('held')
    expect(notes.filter(m => m === 'unknown').length).toBe(CARD_COUNT - 3 - 1)
    const t = crafted()
    t.aiHand = []
    t.playerHand = []
    enterRoom0(t)
    expect(suggest(t, 1, 1)).toBeNull()
    const n2 = deriveNotes(t)
    expect(n2[cardIdOf(2, 0)]).toBe('confirmed')
  })

  it('replays identically from the same seed and action script', () => {
    const script = (s: DetectiveState): void => {
      while (s.won === null) {
        const v = rollDie(s)
        if (v === 0) break
        const rooms = reachableRooms(s)
        const target = rooms.find(r => r !== CENTER_ROOM) ?? rooms[0]!
        moveTo(s, target)
        if (s.pos !== CENTER_ROOM) suggest(s, 1, 2)
        const guess = deriveNotes(s)
        const sus = guess.findIndex((m, i) => m === 'confirmed' && i < 6)
        const wep = guess.findIndex((m, i) => m === 'confirmed' && i >= 6 && i < 12)
        const rm = guess.findIndex((m, i) => m === 'confirmed' && i >= 12)
        accuse(s, sus >= 0 ? sus : 0, wep >= 0 ? wep - 6 : 0, rm >= 0 ? rm - 12 : 0)
      }
    }
    const a = createDetective(314)
    const b = createDetective(314)
    script(a)
    script(b)
    expect(snapshot(a)).toEqual(snapshot(b))
    expect(a.won).not.toBeNull()
  })

  it('exposes stable display names for every card', () => {
    expect(SUSPECTS.length + WEAPONS.length + ROOMS.length).toBe(CARD_COUNT)
    for (let c = 0; c < CARD_COUNT; c += 1) {
      expect(cardName(c).length).toBeGreaterThanOrEqual(2)
      expect(categoryOf(c)).toBe(c < 6 ? 0 : c < 12 ? 1 : 2)
    }
  })
})
