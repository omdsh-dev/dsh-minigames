/**
 * 点球大战 PenaltyKick 纯逻辑层：射门（六区落点 + 力度）与扑救（六区
 * 选择）的判定、守门员 AI 倾向模型（统计玩家射门习惯 + seed 噪声）、
 * AI 射门计划与站位预读提示、五轮 + 骤死轮的轮次流转与胜负判定、
 * 计分。全部随机由注入 seed 的 mulberry32 驱动，同 seed 同操作序列
 * 完全可重放（无 Math.random、无 Date）。渲染无关、DOM 无关。
 */

/** 球门六区编号：行×列（行 0 高 / 1 中 / 2 低，列 0 左 / 1 右），zone = 行 * 2 + 列。 */
export type Zone = 0 | 1 | 2 | 3 | 4 | 5

/** 一次射门：落点区 + 力度（范围见 {@link MIN_POWER}/{@link MAX_POWER}）。 */
export interface Shot {
  /** 落点区。 */
  zone: Zone
  /** 力度。 */
  power: number
}

/** 一次罚球的三种结果：进球 / 被扑出 / 打飞。 */
export type KickResult = 'goal' | 'saved' | 'miss'

/** 谁罚的这脚球。 */
export type Shooter = 'player' | 'ai'

/** 一脚罚球的完整记录（比分板、动画与重放的数据源）。 */
export interface KickRecord {
  /** 罚球方。 */
  shooter: Shooter
  /** 罚球方选择的射门（区 + 力度）。 */
  shot: Shot
  /** 扑救方选择的区（守门员/玩家扑向哪格）。 */
  counter: Zone
  /** 结果。 */
  result: KickResult
  /** 第几组（1 起，骤死轮继续递增）。 */
  round: number
  /** 是否骤死轮。 */
  suddenDeath: boolean
}

/** 比赛阶段：玩家罚球 / 玩家扑救（AI 罚球）/ 已结束。 */
export type Phase = 'shoot' | 'keep' | 'over'

/** 一场完整比赛的可变状态（纯逻辑，无 DOM）。 */
export interface MatchState {
  /** 注入种子（重放依据）。 */
  seed: number
  /** 等级（1 起）：影响 AI 力度与提示欺骗率。 */
  level: number
  /** 当前第几组（1 起）。 */
  round: number
  /** 是否已进入骤死轮。 */
  suddenDeath: boolean
  /** 当前阶段。 */
  phase: Phase
  /** 玩家进球数。 */
  playerGoals: number
  /** AI 进球数。 */
  aiGoals: number
  /** 玩家扑救成功次数。 */
  playerSaves: number
  /** 玩家射门落点历史（守门员 AI 的读人依据）。 */
  history: number[]
  /** 全部罚球记录（按时间序）。 */
  records: KickRecord[]
  /** 本组 AI 的射门计划（仅 keep 阶段非空，渲染不得提前泄露）。 */
  aiShot: Shot | null
  /** 本组站位预读提示区（仅 keep 阶段非空）。 */
  hint: Zone | null
  /** 结局（仅 over 阶段非空）。 */
  outcome: 'win' | 'lose' | null
  /** 种子驱动的随机源（逻辑层独占调用，渲染/交互层不得抽取）。 */
  rng: () => number
}

/** 常规轮数：双方各罚 5 脚。 */
export const REGULATION_KICKS = 5
/** 力度下限。 */
export const MIN_POWER = 0.3
/** 力度上限。 */
export const MAX_POWER = 1.0
/** 打飞风险起点：力度超过该值才开始有打飞概率。 */
export const MISS_THRESHOLD = 0.75
/** 打飞概率上限（满力度时）。 */
export const MISS_CAP = 0.15

/** 六区中文名（渲染与提示共用）。 */
export const ZONE_LABELS = ['左上', '右上', '左中', '右中', '左下', '右下'] as const

/**
 * mulberry32 种子随机源：同种子序列完全一致，值域 [0,1)。
 * @param seed - 非负整数种子。
 * @returns 产出一 [0,1) 随机数的函数。
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 力度收敛到合法区间。
 * @param power - 任意力度值。
 * @returns 收敛后的力度。
 */
export function clampPower(power: number): number {
  return Math.min(MAX_POWER, Math.max(MIN_POWER, power))
}

/**
 * 打飞概率：力度不超过 75% 恒为 0，从 75% 起线性上升到满力度的 15%。
 * @param power - 力度。
 * @returns 打飞概率。
 */
export function missProbability(power: number): number {
  if (power <= MISS_THRESHOLD) return 0
  return Math.min(MISS_CAP, (power - MISS_THRESHOLD) * 0.6)
}

/**
 * 扑出概率：扑对区时的覆盖成功率，随力度线性下降（高力贴角难扑）。
 * @param power - 力度。
 * @returns 扑对区时实际扑出的概率。
 */
export function saveProbability(power: number): number {
  return 0.92 - 0.62 * power
}

/**
 * 判定一脚射门：先掷打飞（力度风险），未打飞且扑对区再掷扑出，否则进球。
 * @param shot - 射门（区 + 力度）。
 * @param counterZone - 扑救方选择的区。
 * @param rng - 随机源（先打飞后扑救，抽取顺序固定保证可重放）。
 * @returns 判定结果。
 */
export function resolveShot(shot: Shot, counterZone: Zone, rng: () => number): KickResult {
  if (rng() < missProbability(shot.power)) return 'miss'
  if (counterZone === shot.zone && rng() < saveProbability(shot.power)) return 'saved'
  return 'goal'
}

/**
 * 守门员 AI 倾向模型：以玩家历史射门频率为权重（每脚 +1.6）加均匀噪声
 * （每区 +0~3.0）取最大——零历史近似均匀；连续 3 脚以上同区则几乎必然
 * 被读穿。
 * @param history - 玩家历史射门落点（0-5）。
 * @param rng - 随机源（恰好抽取 6 个噪声值，顺序固定）。
 * @returns 守门员选择的扑救区。
 */
export function keeperPickZone(history: number[], rng: () => number): Zone {
  const weights = [1, 1, 1, 1, 1, 1]
  for (const zone of history) weights[zone] = weights[zone]! + 1.6
  for (let i = 0; i < 6; i += 1) weights[i] = weights[i]! + rng() * 3.0
  let best = 0
  for (let i = 1; i < 6; i += 1) {
    if (weights[i]! > weights[best]!) best = i
  }
  return best as Zone
}

/**
 * AI 射门计划：区按权重抽样（等级越高越偏爱两个上角），力度 0.55~1.0。
 * @param level - 比赛等级（1 起）。
 * @param rng - 随机源（先抽区再抽力度，顺序固定）。
 * @returns AI 的射门计划。
 */
export function planAiShot(level: number, rng: () => number): Shot {
  const cornerBias = Math.min(1.2, (level - 1) * 0.15)
  const weights = [1 + cornerBias, 1 + cornerBias, 1, 1, 1, 1]
  let r = rng() * 6 + cornerBias * 2
  let zone: Zone = 5
  for (let i = 0; i < 6; i += 1) {
    if (r < weights[i]!) {
      zone = i as Zone
      break
    }
    r -= weights[i]!
  }
  const power = clampPower(0.55 + 0.45 * rng())
  return { zone, power }
}

/**
 * 站位预读提示：以提示真率给出 AI 真实落点，否则给一个必然不同的假区
 * （假动作）。等级越高真率越低（下限 0.5）。
 * @param shot - AI 的真实射门计划。
 * @param level - 比赛等级（1 起）。
 * @param rng - 随机源（真提示只抽 1 次，假提示再抽 1 次，顺序固定）。
 * @returns 预读提示区（可能与真实落点不同）。
 */
export function preReadHint(shot: Shot, level: number, rng: () => number): Zone {
  const trueProb = Math.max(0.5, 0.75 - (level - 1) * 0.05)
  if (rng() < trueProb) return shot.zone
  const d = Math.floor(rng() * 5)
  return (d < shot.zone ? d : d + 1) as Zone
}

/**
 * 开一场新比赛。
 * @param seed - 随机种子。
 * @param level - 等级（1 起）。
 * @returns 初始比赛状态（玩家先罚）。
 */
export function newMatch(seed: number, level: number): MatchState {
  return {
    seed,
    level: Math.max(1, Math.floor(level)),
    round: 1,
    suddenDeath: false,
    phase: 'shoot',
    playerGoals: 0,
    aiGoals: 0,
    playerSaves: 0,
    history: [],
    records: [],
    aiShot: null,
    hint: null,
    outcome: null,
    rng: mulberry32(seed),
  }
}

function kicksTaken(state: MatchState, shooter: Shooter): number {
  let n = 0
  for (const record of state.records) {
    if (record.shooter === shooter) n += 1
  }
  return n
}

/** 一方在本组流程内还剩几脚未罚（常规按 5 脚余额，骤死按本组是否已罚）。 */
function kicksLeft(state: MatchState, shooter: Shooter): number {
  if (!state.suddenDeath) {
    return Math.max(0, REGULATION_KICKS - kicksTaken(state, shooter))
  }
  const kickedThisPair = state.records.some(
    (r) => r.shooter === shooter && r.suddenDeath && r.round === state.round,
  )
  return kickedThisPair ? 0 : 1
}

/** 一脚罚球后推进轮次：判胜负（含提前出线）→ 进骤死 → 进入下一组。 */
function advanceAfterKick(state: MatchState): void {
  const diff = state.playerGoals - state.aiGoals
  const decided = diff > kicksLeft(state, 'ai') || -diff > kicksLeft(state, 'player')
  if (decided) {
    state.phase = 'over'
    state.outcome = diff > 0 ? 'win' : 'lose'
    return
  }
  if (!state.suddenDeath && kicksTaken(state, 'player') >= REGULATION_KICKS && kicksTaken(state, 'ai') >= REGULATION_KICKS) {
    state.suddenDeath = true
  }
  if (kicksTaken(state, 'player') === kicksTaken(state, 'ai')) state.round += 1
  state.phase = 'shoot'
}

/**
 * 确认玩家射门：守门员按倾向模型选区并判定，随后生成本组 AI 射门计划
 * 与站位预读提示，进入扑救阶段。
 * @param state - 比赛状态（须处于 shoot 阶段）。
 * @param zone - 玩家选择的落点区。
 * @param power - 玩家选择的力度（自动收敛）。
 * @returns 本脚记录。
 */
export function confirmShoot(state: MatchState, zone: Zone, power: number): KickRecord {
  if (state.phase !== 'shoot') throw new Error('penaltykick: 只能在罚球阶段射门')
  const shot: Shot = { zone, power: clampPower(power) }
  const keeperZone = keeperPickZone(state.history, state.rng)
  const result = resolveShot(shot, keeperZone, state.rng)
  const record: KickRecord = {
    shooter: 'player',
    shot,
    counter: keeperZone,
    result,
    round: state.round,
    suddenDeath: state.suddenDeath,
  }
  state.records.push(record)
  state.history.push(zone)
  if (result === 'goal') state.playerGoals += 1
  state.aiShot = planAiShot(state.level, state.rng)
  state.hint = preReadHint(state.aiShot, state.level, state.rng)
  state.phase = 'keep'
  return record
}

/**
 * 确认玩家扑救：对已计划的 AI 射门判定，随后推进轮次（判胜/骤死/下一组）。
 * @param state - 比赛状态（须处于 keep 阶段）。
 * @param zone - 玩家选择的扑救区。
 * @returns 本脚记录。
 */
export function confirmDive(state: MatchState, zone: Zone): KickRecord {
  if (state.phase !== 'keep' || state.aiShot === null) {
    throw new Error('penaltykick: 只能在扑救阶段扑救')
  }
  const shot = state.aiShot
  const result = resolveShot(shot, zone, state.rng)
  const record: KickRecord = {
    shooter: 'ai',
    shot,
    counter: zone,
    result,
    round: state.round,
    suddenDeath: state.suddenDeath,
  }
  state.records.push(record)
  if (result === 'goal') state.aiGoals += 1
  else if (result === 'saved') state.playerSaves += 1
  state.aiShot = null
  state.hint = null
  advanceAfterKick(state)
  return record
}

/**
 * 终局得分（onScore 上报值）：胜 = 进球×50 + 扑救×40 + 150 + 等级加成，
 * 负 = 上述基础分减半。
 * @param state - 比赛状态。
 * @returns over 阶段的得分，进行中返回 0。
 */
export function matchScore(state: MatchState): number {
  if (state.phase !== 'over') return 0
  const base = state.playerGoals * 50 + state.playerSaves * 40
  return state.outcome === 'win' ? base + 150 + (state.level - 1) * 10 : Math.floor(base / 2)
}

/**
 * 按脚本重放一整场：操作序列依次执行直到终局（多余操作忽略）。
 * @param seed - 种子。
 * @param level - 等级。
 * @param actions - 操作序列（射门与扑救交错；守门员/AI 行为由种子决定）。
 * @returns 重放得到的比赛状态。
 */
export function replayMatch(seed: number, level: number, actions: Array<{ zone: Zone; power: number }>): MatchState {
  const state = newMatch(seed, level)
  for (const action of actions) {
    if (state.phase === 'over') break
    if (state.phase === 'shoot') confirmShoot(state, action.zone, action.power)
    else confirmDive(state, action.zone)
  }
  return state
}
