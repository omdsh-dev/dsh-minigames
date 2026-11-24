/**
 * 时间线 Timeline 纯逻辑：内置 66 张事件卡题库（科技/历史/文化）、按注入
 * seed 发牌（mulberry32，锚点取年份中位卡）、插入/交换/收回操作、提交
 * 判定（相对邻居正确即锁定，错误卡回手并附「比 X 更早/更晚」提示）、
 * 错误计分与关卡限时。无 DOM、无副作用，全部确定性可测：同 level+seed
 * 重放完全一致，供 tests/timeline-logic.spec.ts 与渲染层共用。
 */

/** 事件领域：科技 / 历史 / 文化。 */
export type Category = 'tech' | 'history' | 'culture'

/** 一张事件卡：稳定 id、名称、年份（公元前为负）、领域。 */
export interface TimelineEvent {
  id: number
  name: string
  year: number
  category: Category
}

/** 内置题库：66 张事件卡，id 与名称全库唯一，年份覆盖公元前至现代。 */
export const EVENT_BANK: TimelineEvent[] = [
  { id: 1, name: '造纸术', year: 105, category: 'tech' },
  { id: 2, name: '活字印刷', year: 1041, category: 'tech' },
  { id: 3, name: '指南针航海', year: 1119, category: 'tech' },
  { id: 4, name: '眼镜', year: 1286, category: 'tech' },
  { id: 5, name: '机械钟', year: 1360, category: 'tech' },
  { id: 6, name: '古腾堡印刷机', year: 1440, category: 'tech' },
  { id: 7, name: '望远镜', year: 1608, category: 'tech' },
  { id: 8, name: '瓦特蒸汽机', year: 1769, category: 'tech' },
  { id: 9, name: '蒙戈尔菲热气球', year: 1783, category: 'tech' },
  { id: 10, name: '史蒂芬孙火车', year: 1825, category: 'tech' },
  { id: 11, name: '电报', year: 1837, category: 'tech' },
  { id: 12, name: '电话', year: 1876, category: 'tech' },
  { id: 13, name: '白炽电灯', year: 1879, category: 'tech' },
  { id: 14, name: '奔驰汽车', year: 1886, category: 'tech' },
  { id: 15, name: '电影放映机', year: 1895, category: 'tech' },
  { id: 16, name: '莱特飞机', year: 1903, category: 'tech' },
  { id: 17, name: '电视', year: 1926, category: 'tech' },
  { id: 18, name: '青霉素', year: 1928, category: 'tech' },
  { id: 19, name: '原子弹', year: 1945, category: 'tech' },
  { id: 20, name: '晶体管', year: 1947, category: 'tech' },
  { id: 21, name: '人造卫星', year: 1957, category: 'tech' },
  { id: 22, name: '集成电路', year: 1958, category: 'tech' },
  { id: 23, name: '阿波罗登月', year: 1969, category: 'tech' },
  { id: 24, name: '个人计算机', year: 1975, category: 'tech' },
  { id: 25, name: '万维网', year: 1989, category: 'tech' },
  { id: 26, name: '智能手机', year: 2007, category: 'tech' },
  { id: 27, name: '秦统一六国', year: -221, category: 'history' },
  { id: 28, name: '罗马帝国建立', year: -27, category: 'history' },
  { id: 29, name: '大宪章', year: 1215, category: 'history' },
  { id: 30, name: '郑和下西洋', year: 1405, category: 'history' },
  { id: 31, name: '哥伦布到美洲', year: 1492, category: 'history' },
  { id: 32, name: '宗教改革', year: 1517, category: 'history' },
  { id: 33, name: '光荣革命', year: 1688, category: 'history' },
  { id: 34, name: '法国大革命', year: 1789, category: 'history' },
  { id: 35, name: '拿破仑称帝', year: 1804, category: 'history' },
  { id: 36, name: '鸦片战争', year: 1840, category: 'history' },
  { id: 37, name: '美国内战', year: 1861, category: 'history' },
  { id: 38, name: '明治维新', year: 1868, category: 'history' },
  { id: 39, name: '一战爆发', year: 1914, category: 'history' },
  { id: 40, name: '十月革命', year: 1917, category: 'history' },
  { id: 41, name: '二战全面爆发', year: 1939, category: 'history' },
  { id: 42, name: '联合国成立', year: 1945, category: 'history' },
  { id: 43, name: '柏林墙修建', year: 1961, category: 'history' },
  { id: 44, name: '改革开放', year: 1978, category: 'history' },
  { id: 45, name: '柏林墙倒塌', year: 1989, category: 'history' },
  { id: 46, name: '苏联解体', year: 1991, category: 'history' },
  { id: 47, name: '香港回归', year: 1997, category: 'history' },
  { id: 48, name: '9·11事件', year: 2001, category: 'history' },
  { id: 49, name: '秦始皇兵马俑', year: -210, category: 'culture' },
  { id: 50, name: '《蒙娜丽莎》', year: 1503, category: 'culture' },
  { id: 51, name: '莎士比亚《哈姆雷特》', year: 1601, category: 'culture' },
  { id: 52, name: '《勃兰登堡协奏曲》', year: 1721, category: 'culture' },
  { id: 53, name: '贝多芬《第九交响曲》', year: 1824, category: 'culture' },
  { id: 54, name: '《神奈川冲浪里》', year: 1831, category: 'culture' },
  { id: 55, name: '《悲惨世界》出版', year: 1862, category: 'culture' },
  { id: 56, name: '《印象·日出》', year: 1872, category: 'culture' },
  { id: 57, name: '埃菲尔铁塔落成', year: 1889, category: 'culture' },
  { id: 58, name: '新文化运动', year: 1915, category: 'culture' },
  { id: 59, name: '《了不起的盖茨比》', year: 1925, category: 'culture' },
  { id: 60, name: '米老鼠动画', year: 1928, category: 'culture' },
  { id: 61, name: '《摩登时代》', year: 1936, category: 'culture' },
  { id: 62, name: '披头士成立', year: 1960, category: 'culture' },
  { id: 63, name: '伍德斯托克音乐节', year: 1969, category: 'culture' },
  { id: 64, name: '少林寺电影', year: 1982, category: 'culture' },
  { id: 65, name: '《哈利·波特》出版', year: 1997, category: 'culture' },
  { id: 66, name: '《千与千寻》上映', year: 2001, category: 'culture' },
]
/** mulberry32：32 位种子 -> [0,1) 确定性伪随机序列（所有随机仅经此处）。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 关卡递进配置：卡片 5→7、后期同领域干扰 + 限时（0 = 不限）。 */
export interface LevelConfig {
  cardCount: number
  timeLimitSec: number
  focusCategory: boolean
}

/** 5 个关卡的固定难度曲线。 */
export const LEVELS: LevelConfig[] = [
  { cardCount: 5, timeLimitSec: 0, focusCategory: false },
  { cardCount: 6, timeLimitSec: 0, focusCategory: false },
  { cardCount: 6, timeLimitSec: 90, focusCategory: true },
  { cardCount: 7, timeLimitSec: 75, focusCategory: true },
  { cardCount: 7, timeLimitSec: 60, focusCategory: true },
]

/** 一局发牌结果：本关全部事件卡 + 固定已放置的锚点卡。 */
export interface Round {
  cards: TimelineEvent[]
  anchor: TimelineEvent
}

/** Fisher-Yates 洗牌（就地，使用注入 rng）。 */
function shuffle<T>(items: T[], rng: () => number): T[] {
  for (let i = items.length - 1; i >= 1; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = items[i]!
    items[i] = items[j]!
    items[j] = tmp
  }
  return items
}

/**
 * 发一关牌：level 3 起锁定单一领域并在该领域按年份取连续窗口（相邻年代
 * 干扰更强），低关卡跨领域随机抽样；锚点取按年份排序后的中位卡（年份必
 * 然落在首尾之间，且不取极端，保证两侧都有推理空间）。
 * @param level 关卡号（1..5）。
 * @param seed 注入种子；同 level+seed 结果完全一致。
 */
export function dealRound(level: number, seed: number): Round {
  const cfg = LEVELS[level - 1]!
  const rng = mulberry32(((seed ^ 0x9e3779b9) >>> 0) + level * 74779621)
  let chosen: TimelineEvent[]
  if (cfg.focusCategory) {
    const cats: Category[] = ['tech', 'history', 'culture']
    const cat = cats[Math.floor(rng() * cats.length)]!
    const pool = EVENT_BANK.filter((e) => e.category === cat).sort((a, b) => a.year - b.year)
    const start = Math.floor(rng() * (pool.length - cfg.cardCount + 1))
    chosen = pool.slice(start, start + cfg.cardCount)
  } else {
    chosen = shuffle(EVENT_BANK.slice(), rng).slice(0, cfg.cardCount)
  }
  chosen.sort((a, b) => a.year - b.year)
  const anchor = chosen[Math.floor(chosen.length / 2)]!
  return { cards: chosen, anchor }
}

/** 一局的运行阶段：进行中 / 已过关 / 时间耗尽。 */
export type Phase = 'playing' | 'cleared' | 'timeout'

/** 错误卡的相对位置提示：应比参照卡更早或更晚。 */
export interface Hint {
  card: TimelineEvent
  ref: TimelineEvent
  direction: 'earlier' | 'later'
}

/** 一次提交的判定结果。 */
export interface JudgeResult {
  locked: TimelineEvent[]
  wrong: TimelineEvent[]
  hints: Hint[]
  allCorrect: boolean
}

/** 一关的完整可变状态（操作均为就地变更，返回值指示是否成功）。 */
export interface TimelineState {
  level: number
  seed: number
  round: Round
  /** 手中未放置的卡（显示顺序）。 */
  hand: TimelineEvent[]
  /** 时间轴上已放置的卡（索引 0 为最左/最早端）。 */
  timeline: TimelineEvent[]
  /** 本关累计错误张次（每次提交按错误张数累加）。 */
  errors: number
  /** 剩余秒数；0 表示本关不限时。 */
  remainingSec: number
  phase: Phase
  /** 最近一次提交产生的提示（渲染层展示，逻辑不清理）。 */
  hints: Hint[]
}

/** 起始一关状态：锚点已在时间轴上，其余卡洗入手牌。 */
export function createRoundState(level: number, seed: number): TimelineState {
  const cfg = LEVELS[level - 1]!
  const rng = mulberry32(((seed ^ 0x85ebca6b) >>> 0) + level * 2654435761)
  const round = dealRound(level, seed)
  const hand = shuffle(round.cards.filter((c) => c.id !== round.anchor.id), rng)
  return {
    level,
    seed,
    round,
    hand,
    timeline: [round.anchor],
    errors: 0,
    remainingSec: cfg.timeLimitSec,
    phase: 'playing',
    hints: [],
  }
}

/** 将手牌中的一张插入时间轴指定空位（0..长度，即两端或任意卡间）。 */
export function insertCard(state: TimelineState, cardId: number, slot: number): boolean {
  if (state.phase !== 'playing') return false
  if (!Number.isInteger(slot) || slot < 0 || slot > state.timeline.length) return false
  const idx = state.hand.findIndex((c) => c.id === cardId)
  if (idx < 0) return false
  state.timeline.splice(slot, 0, state.hand[idx]!)
  state.hand.splice(idx, 1)
  state.hints = []
  return true
}

/** 交换时间轴上两张已放置卡（提交前可自由调整；锚点同样可被换位）。 */
export function swapPlaced(state: TimelineState, i: number, j: number): boolean {
  if (state.phase !== 'playing') return false
  if (i === j || i < 0 || j < 0 || i >= state.timeline.length || j >= state.timeline.length) return false
  const tmp = state.timeline[i]!
  state.timeline[i] = state.timeline[j]!
  state.timeline[j] = tmp
  state.hints = []
  return true
}

/** 把一张已放置（非锚点）卡收回手牌。 */
export function returnToHand(state: TimelineState, pos: number): boolean {
  if (state.phase !== 'playing') return false
  if (pos < 0 || pos >= state.timeline.length) return false
  const card = state.timeline[pos]!
  if (card.id === state.round.anchor.id) return false
  state.timeline.splice(pos, 1)
  state.hand.push(card)
  state.hints = []
  return true
}

/** 一张卡在其位置是否相对两侧邻居有序（边界一侧恒满足；锚点恒正确）。 */
function isLockedAt(state: TimelineState, i: number): boolean {
  const card = state.timeline[i]!
  if (card.id === state.round.anchor.id) return true
  const prev = i > 0 ? state.timeline[i - 1]! : null
  const next = i < state.timeline.length - 1 ? state.timeline[i + 1]! : null
  if (prev !== null && card.year < prev.year) return false
  if (next !== null && card.year > next.year) return false
  return true
}

/**
 * 提交判定：手牌清空后才允许。相对邻居有序的卡锁定在轴上，其余回手并
 * 附提示（就近参照锁定卡：年份小于左侧锁定卡 → 更早，大于右侧锁定卡 →
 * 更晚；两侧都无锁定卡时退回与锚点比较）。错误张数计入 errors。
 * @returns 判定结果；未在 playing 或手牌未清空时返回 null（不改变状态）。
 */
export function submitRound(state: TimelineState): JudgeResult | null {
  if (state.phase !== 'playing' || state.hand.length > 0) return null
  const k = state.timeline.length
  const lockedFlag: boolean[] = []
  for (let i = 0; i < k; i += 1) lockedFlag.push(isLockedAt(state, i))
  const wrong: TimelineEvent[] = []
  const locked: TimelineEvent[] = []
  const hints: Hint[] = []
  for (let i = 0; i < k; i += 1) {
    const card = state.timeline[i]!
    if (lockedFlag[i]) {
      locked.push(card)
      continue
    }
    wrong.push(card)
    let ref: TimelineEvent | null = null
    let direction: 'earlier' | 'later' | null = null
    for (let j = i - 1; j >= 0; j -= 1) {
      if (lockedFlag[j]) {
        if (state.timeline[j]!.year > card.year) {
          ref = state.timeline[j]!
          direction = 'earlier'
        }
        break
      }
    }
    if (direction === null) {
      for (let j = i + 1; j < k; j += 1) {
        if (lockedFlag[j]) {
          if (state.timeline[j]!.year < card.year) {
            ref = state.timeline[j]!
            direction = 'later'
          }
          break
        }
      }
    }
    if (direction === null || ref === null) {
      ref = state.round.anchor
      direction = card.year < state.round.anchor.year ? 'earlier' : 'later'
    }
    hints.push({ card, ref, direction })
  }
  state.timeline = state.timeline.filter((_, i) => lockedFlag[i])
  state.hand = wrong
  state.errors += wrong.length
  state.hints = hints
  const allCorrect = wrong.length === 0
  if (allCorrect) state.phase = 'cleared'
  return { locked, wrong, hints, allCorrect }
}

/** 本关过关得分：100 起步，每错一张扣 10，下限 20。 */
export function scoreForLevel(errors: number): number {
  return Math.max(20, 100 - errors * 10)
}

/** 推进限时（不限时关卡为 no-op）；归零进入 timeout 阶段。 */
export function tickTimer(state: TimelineState, dtSec: number): void {
  if (state.phase !== 'playing' || state.remainingSec <= 0 || dtSec <= 0) return
  state.remainingSec = Math.max(0, state.remainingSec - dtSec)
  if (state.remainingSec === 0) state.phase = 'timeout'
}
