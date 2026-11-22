import { describe, expect, it } from 'vitest'
import {
  ROUNDS_TO_WIN, START_HAND, aiCandidates, aiDecide, aiTakeTurn, buildDeck, closestHiddenIndex,
  createDavinci, deserializeState, drawAndInsert, endTurn, guess, legalInsertPositions,
  mulberry32, playerDraw, playerInsert, serializeState, shuffle, sortHand, sortKey,
  startNextRound, type DavinciCard, type DavinciState,
} from '../src/client/games/davinci/logic.ts'

const c = (value: number, color: 'w' | 'b'): DavinciCard => ({ value, color, dash: value === 0 && color === 'b' })

/** 牌身份（数值+颜色，牌组内唯一）。 */
const cid = (card: DavinciCard): string => card.value + card.color

/** 布一个可控局面：改写双方手牌（已升序）与翻开标记，牌堆为其余 16 张（保持牌组顺序，堆顶 pop 末尾的 10w）。 */
function rig(yours: DavinciCard[], ais: DavinciCard[]): DavinciState {
  const s = createDavinci(12345)
  s.yourHand = [...yours]
  s.aiHand = [...ais]
  sortHand(s.yourHand)
  sortHand(s.aiHand)
  s.revealedYou = s.yourHand.map(() => false)
  s.revealedAi = s.aiHand.map(() => false)
  s.pile = buildDeck().filter(card => !yours.some(y => cid(y) === cid(card)) && !ais.some(a => cid(a) === cid(card)))
  s.log = []
  s.phase = 'playing'
  s.turn = 'you'
  s.drew = null
  s.pending = null
  return s
}

describe('davinci logic', () => {
  it('牌组构成：0-11 各白黑两张共 24 张，黑 0 唯一带短横', () => {
    const deck = buildDeck()
    expect(deck).toHaveLength(24)
    const ids = new Set(deck.map(card => card.value + card.color))
    expect(ids.size).toBe(24)
    for (let v = 0; v <= 11; v += 1) {
      expect(deck.filter(card => card.value === v)).toHaveLength(2)
    }
    const dashed = deck.filter(card => card.dash)
    expect(dashed).toHaveLength(1)
    expect(dashed[0]!.value).toBe(0)
    expect(dashed[0]!.color).toBe('b')
  })

  it('升序排列：数值升序，同值白在黑前，短横黑 0 在白 0 之后', () => {
    const hand = [c(3, 'b'), c(7, 'w'), c(0, 'b'), c(3, 'w'), c(0, 'w')]
    sortHand(hand)
    expect(hand.map(card => card.value + card.color)).toEqual(['0w', '0b', '3w', '3b', '7w'])
    expect(sortKey(c(0, 'w'))).toBeLessThan(sortKey(c(0, 'b')))
    expect(sortKey(c(0, 'b'))).toBeLessThan(sortKey(c(1, 'w')))
  })

  it('开局发牌：双方各 4 张升序，牌堆 16 张，三者合成整副牌', () => {
    const s = createDavinci(777)
    expect(s.yourHand).toHaveLength(START_HAND)
    expect(s.aiHand).toHaveLength(START_HAND)
    expect(s.pile).toHaveLength(16)
    const keys = (cards: DavinciCard[]) => cards.map(sortKey)
    expect(keys(s.yourHand)).toEqual([...keys(s.yourHand)].sort((a, b) => a - b))
    expect(keys(s.aiHand)).toEqual([...keys(s.aiHand)].sort((a, b) => a - b))
    const all = [...s.yourHand, ...s.aiHand, ...s.pile].map(card => card.value + card.color).sort()
    expect(all).toEqual(buildDeck().map(card => card.value + card.color).sort())
    expect(s.turn).toBe('you')
    expect(s.revealedYou.every(v => !v)).toBe(true)
  })

  it('合法插入位置：保持升序（含同值白前黑后）的全部下标', () => {
    const hand = [c(0, 'w'), c(0, 'b'), c(3, 'w'), c(3, 'b')]
    expect(legalInsertPositions(hand, c(7, 'w'))).toEqual([4])
    expect(legalInsertPositions(hand, c(0, 'w'))).toEqual([0, 1])
    expect(legalInsertPositions(hand, c(3, 'w'))).toEqual([2, 3])
    expect(legalInsertPositions(hand, c(1, 'b'))).toEqual([2])
  })

  it('摸牌插入：牌堆减一、手牌保持升序且翻开标记平行；空堆拒摸', () => {
    const s = rig([c(2, 'w'), c(5, 'b'), c(9, 'w'), c(10, 'b')], [c(1, 'w'), c(4, 'w'), c(8, 'b'), c(11, 'w')])
    const pileBefore = s.pile.length
    expect(drawAndInsert(s, 'you', 4)).toBe(true) // 堆顶 11b 追加到末尾
    expect(s.pile.length).toBe(pileBefore - 1)
    expect(s.yourHand).toHaveLength(5)
    expect(s.yourHand.map(sortKey)).toEqual([...s.yourHand.map(sortKey)].sort((a, b) => a - b))
    expect(s.revealedYou).toHaveLength(5)
    // 玩家两段式摸牌：pending 挂起后按合法位插入。
    s.turn = 'you'
    s.drew = null
    expect(playerDraw(s)).toBe(true)
    expect(s.pending).not.toBeNull()
    expect(playerInsert(s, 3)).toBe(true) // 堆顶 10w 落在 9w 与 10b 之间
    expect(s.pending).toBeNull()
    s.pile = []
    s.drew = null
    s.turn = 'you'
    expect(playerDraw(s)).toBe(false)
  })

  it('猜对：翻开目标并保留回合并可再猜', () => {
    const s = rig([c(2, 'w'), c(5, 'b'), c(9, 'w'), c(10, 'b')], [c(1, 'w'), c(4, 'w'), c(8, 'b'), c(11, 'w')])
    expect(guess(s, 'you', 1, 4)).toBe(true)
    expect(s.revealedAi[1]).toBe(true)
    expect(s.turn).toBe('you')
    expect(s.phase).toBe('playing')
    expect(guess(s, 'you', 1, 4)).toBe(null) // 已翻开的牌不可再猜
  })

  it('猜错：翻开自己最接近所猜数值的牌（同距取靠前）并交出回合', () => {
    const s = rig([c(2, 'w'), c(5, 'b'), c(9, 'w'), c(10, 'b')], [c(1, 'w'), c(4, 'w'), c(8, 'b'), c(11, 'w')])
    // 猜 7：|7-5|=2 与 |7-9|=2 同距，取靠前的 5。
    expect(closestHiddenIndex(s, 'you', 7)).toBe(1)
    expect(guess(s, 'you', 0, 7)).toBe(false)
    expect(s.revealedYou[1]).toBe(true)
    expect(s.turn).toBe('ai')
    expect(s.drew).toBeNull()
    expect(s.lastReveal).toEqual({ side: 'you', index: 1, reason: 'penalty' })
  })

  it('胜负：猜开对方整手赢一局，被迫翻光自己输一局，2 胜定比赛', () => {
    const s = rig([c(2, 'w'), c(5, 'b'), c(9, 'w'), c(10, 'b')], [c(1, 'w'), c(4, 'w'), c(8, 'b'), c(11, 'w')])
    for (let i = 0; i < 4; i += 1) guess(s, 'you', i, s.aiHand[i]!.value)
    expect(s.phase).toBe('roundOver')
    expect(s.roundWinsYou).toBe(1)
    expect(startNextRound(s)).toBe(true)
    expect(s.round).toBe(2)
    expect(s.turn).toBe('ai')
    // 第二局：玩家只剩一张未翻开且猜错，被迫翻光即输局又输比赛。
    s.yourHand = [c(2, 'w'), c(5, 'b')]
    s.aiHand = [c(1, 'w'), c(4, 'w'), c(8, 'b'), c(11, 'w')]
    s.revealedYou = [false, true]
    s.revealedAi = [false, true, true, true]
    s.turn = 'you'
    s.phase = 'playing'
    expect(guess(s, 'you', 0, 11)).toBe(false)
    expect(s.revealedYou[0]).toBe(true)
    expect(s.roundWinsAi).toBe(1)
    expect(s.phase).toBe('roundOver')
    expect(endTurn(s, 'ai')).toBe(false) // 局已结束不可再交手
  })

  it('AI 候选集：排除己方手牌与双方已翻开牌，strict 应用邻居排序边界', () => {
    const s = rig([c(2, 'w'), c(5, 'b'), c(9, 'w'), c(10, 'b')], [c(1, 'w'), c(4, 'w'), c(8, 'b'), c(11, 'w')])
    // 玩家 0 位未翻开：宽候选 = 24 - AI 手 4 = 20 张。
    expect(aiCandidates(s, 0, false)).toHaveLength(20)
    s.revealedYou = [false, true, false, true] // 两侧翻开 5b 与 10b
    const strict = aiCandidates(s, 2, true).map(cid)
    // 第 2 位夹在 5b 与 10b 之间：候选 6-10（10 只剩白），再排除 AI 手里的 8b。
    expect(strict).toEqual(['6w', '6b', '7w', '7b', '8w', '9w', '9b', '10w'])
    expect(aiCandidates(s, 2, false).map(cid)).toContain('0w')
  })

  it('AI 决策与执行确定性：同 seed 同局面必得同决策，同流程重放一致', () => {
    const a = rig([c(2, 'w'), c(5, 'b'), c(9, 'w'), c(10, 'b')], [c(1, 'w'), c(4, 'w'), c(8, 'b'), c(11, 'w')])
    a.turn = 'ai'
    const d1 = aiDecide(a)
    const d2 = aiDecide(a)
    expect(d1).toEqual(d2)
    expect(a.yourHand[d1.index]).toBeDefined()
    expect(d1.value).toBeGreaterThanOrEqual(0)
    expect(d1.value).toBeLessThanOrEqual(11)
    // aiTakeTurn 完整回合重放一致。
    const b = deserializeState(serializeState(a))
    aiTakeTurn(a)
    aiTakeTurn(b)
    expect(serializeState(a)).toBe(serializeState(b))
  })

  it('AI 回合合法且推进：执行后回合交回玩家或局面阶段变化', () => {
    const s = createDavinci(4242)
    s.turn = 'ai'
    expect(aiTakeTurn(s)).toBe(true)
    expect(s.revealedAi).toHaveLength(s.aiHand.length)
    expect(s.aiHand.map(sortKey)).toEqual([...s.aiHand.map(sortKey)].sort((x, y) => x - y))
    const turnAfter: string = s.turn
    expect(turnAfter === 'you' || s.phase !== 'playing').toBe(true)
    expect(s.revealedYou.filter(Boolean).length).toBeLessThanOrEqual(s.yourHand.length)
  })

  it('seed 重放：同 seed 同操作序列得到逐字节相同的状态', () => {
    const run = (seed: number): string => {
      const s = createDavinci(seed)
      let guard = 0
      while (s.phase !== 'matchOver' && guard < 600) {
        guard += 1
        if (s.phase === 'roundOver') {
          startNextRound(s)
          continue
        }
        if (s.turn === 'you') {
          if (s.pile.length > 0 && s.drew !== 'you' && guard % 3 === 0) {
            drawAndInsert(s, 'you', 0)
            continue
          }
          const idx = s.yourHand.findIndex((_, i) => !s.revealedAi[i])
          const g = guess(s, 'you', Math.max(0, idx), guard % 12)
          if (g === null) endTurn(s, 'you')
        } else {
          aiTakeTurn(s)
        }
      }
      expect(s.roundWinsYou + s.roundWinsAi).toBeGreaterThanOrEqual(ROUNDS_TO_WIN)
      return serializeState(s)
    }
    expect(run(99)).toBe(run(99))
    expect(run(100)).not.toBe(run(99))
  })

  it('mulberry32 与 shuffle：确定性且打乱后仍是同一副牌', () => {
    const r1 = mulberry32(7)
    const r2 = mulberry32(7)
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()])
    const deckA = buildDeck()
    const deckB = buildDeck()
    shuffle(mulberry32(7), deckA)
    shuffle(mulberry32(8), deckB)
    expect(deckA.map(card => card.value + card.color).sort()).toEqual(deckB.map(card => card.value + card.color).sort())
    expect(deckA.map(card => card.value + card.color)).not.toEqual(buildDeck().map(card => card.value + card.color))
  })
})
