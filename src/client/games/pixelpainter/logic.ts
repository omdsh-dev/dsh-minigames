/**
 * 像素画家 PixelPainter 纯逻辑：内置 14 幅像素图案（8x8 到 12x12，含
 * 4-6 色），按注入的 mulberry32 种子确定性地为 5 个递进关卡选图并打乱
 * 调色板顺序。提供画布着色/清除、参考图实时比对（对/错格计数与错格
 * 列表）、完成度、提示（自动修正一个错格）、过关判定与计分。无 DOM、
 * 无副作用，同一种子序列完全一致，可在 vitest 中直接复放验证。
 */

/** 一种图案颜色：字符与其十六进制色值（点号恒为空格，不入列）。 */
export interface PatternColor {
  char: string
  color: string
}

/** 一幅内置像素图案：grid x grid 字符画 + 颜色表。 */
export interface PatternDef {
  id: string
  name: string
  grid: number
  rows: string[]
  colors: PatternColor[]
}

/** 网格坐标：列 x、行 y，均从 0 起。 */
export interface Cell {
  x: number
  y: number
}

/** 一关内容：选定的图案、展平的参考图（-1 空、否则颜色下标）、打乱后的调色板。 */
export interface PainterLevel {
  pattern: PatternDef
  reference: number[]
  palette: number[]
}

/** 比对结果。 */
export interface CompareResult {
  correct: number
  wrong: number
  total: number
  /** 全部错格（画布与参考不一致的格子，含多涂与漏涂）。 */
  wrongCells: Cell[]
}

/** 总关卡数。 */
export const LEVEL_COUNT = 5
/** 每关可用提示次数。 */
export const HINTS_PER_LEVEL = 2

/**
 * mulberry32 伪随机数发生器：返回 [0,1) 均匀分布，同一种子序列完全
 * 一致，供生成与测试复放使用。
 * @param seed - 32 位整数种子。
 * @returns 产生 [0,1) 随机数的函数。
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

function pat(id: string, name: string, rows: string[], colors: Array<[string, string]>): PatternDef {
  return {
    id,
    name,
    grid: rows.length,
    rows,
    colors: colors.map((entry) => ({ char: entry[0], color: entry[1] })),
  }
}

/** 内置图案库：14 幅，尺寸 8-12，每幅 3-5 色（加空格共 4-6 色）。 */
export const PATTERN_LIBRARY: PatternDef[] = [
  pat('heart', '心形', [
    '.RR..RR.',
    'RHRRRRRR',
    'RRRRRRRR',
    'DRRRRRRD',
    '.DRRRRD.',
    '..DRRD..',
    '...DD...',
    '........',
  ], [['R', '#f7768e'], ['H', '#ff9e64'], ['D', '#8b3a52']]),
  pat('cat', '小猫', [
    '.O....O.',
    '.OO..OO.',
    '.OOOOOO.',
    'OOKOOOKO',
    'OOOPPOOO',
    '.OOOOOO.',
    '..OOOO..',
    '...OO...',
  ], [['O', '#ff9e64'], ['K', '#1a1a24'], ['P', '#f7768e']]),
  pat('ghost', '幽灵', [
    '..WWWW..',
    '.WWWWWW.',
    'WWKWWKWW',
    'WWWWWWWW',
    'WWWWWWWW',
    'WWWWWWWW',
    'WBWBWBWB',
    'W.WW.WW.',
  ], [['W', '#e2e2ee'], ['K', '#1a1a24'], ['B', '#7aa2f7']]),
  pat('mushroom', '蘑菇', [
    '..MMMMM..',
    '.MMWMMWM.',
    'MMWMMMWMM',
    'MMMMMMMMM',
    '.MMMMMMM.',
    '...SSS...',
    '...SSS...',
    '...SSS...',
    '..SSSSS..',
  ], [['M', '#f7768e'], ['W', '#e2e2ee'], ['S', '#e0af68']]),
  pat('flower', '小花', [
    '..PP.PP..',
    '..PPPPP..',
    '..PYYYP..',
    '..PPPPP..',
    '..PP.PP..',
    '....G....',
    '....G....',
    '.GG.G.GG.',
    '....G....',
  ], [['P', '#bb9af7'], ['Y', '#e0af68'], ['G', '#9ece6a']]),
  pat('star', '星星', [
    '....Y....',
    '....Y....',
    '...WYW...',
    'YYYYYYYYY',
    '.YYYYYYY.',
    '..YYYYY..',
    '..OO.OO..',
    '.OO...OO.',
    '.O.....O.',
  ], [['Y', '#e0af68'], ['O', '#ff9e64'], ['W', '#e2e2ee']]),
  pat('spaceship', '飞船', [
    '....CC....',
    '...CCCC...',
    '...CGGC...',
    '..CCCCCC..',
    '.CCCRRCCC.',
    'RCCCCCCCCR',
    '..CCCCCC..',
    '...R..R...',
    '...Y..Y...',
    '..YY..YY..',
  ], [['C', '#7dcfff'], ['G', '#9ece6a'], ['R', '#f7768e'], ['Y', '#e0af68']]),
  pat('fish', '小鱼', [
    '..........',
    '...BBBB...',
    '..BBBBBB..',
    '.BBKBBBB.Y',
    '.BBBBBB.YY',
    '.BBWBBB.YY',
    '..BBBBBB.Y',
    '...BBBB...',
    '..........',
    '..........',
  ], [['B', '#7aa2f7'], ['K', '#1a1a24'], ['Y', '#e0af68'], ['W', '#e2e2ee']]),
  pat('tree', '大树', [
    '....GG....',
    '...GGGG...',
    '..GGGGGG..',
    '.GGRGGRGG.',
    '.GGGGGGGG.',
    '..GGGGGG..',
    '...GGGG...',
    '....NN....',
    '....NN....',
    '....NN....',
  ], [['G', '#9ece6a'], ['N', '#8b6042'], ['R', '#f7768e']]),
  pat('house', '房子', [
    '....RR....',
    '...RRRR...',
    '..RRRRRR..',
    '.RRRRRRRR.',
    'RRRRRRRRRR',
    '.WWBWWBWW.',
    '.WWBWWBWW.',
    '.WWWDDWWW.',
    '.WWWDDWWW.',
    '.WWWDDWWW.',
  ], [['R', '#f7768e'], ['W', '#e2e2ee'], ['B', '#7aa2f7'], ['D', '#8b6042']]),
  pat('frog', '青蛙', [
    '...........',
    '..GG...GG..',
    '.GWKG.GWKG.',
    'GGGGGGGGGGG',
    'GGGGGGGGGGG',
    'GGGKKKKKGGG',
    'GGGGGGGGGGG',
    '.GGGGGGGGG.',
    '..GGGGGGG..',
    '...G.G.G...',
    '...........',
  ], [['G', '#9ece6a'], ['W', '#e2e2ee'], ['K', '#1a1a24']]),
  pat('sword', '宝剑', [
    '.....S.....',
    '....SSS....',
    '....SSS....',
    '....SSS....',
    '....SSS....',
    '....SSS....',
    '..GGGGGGG..',
    '.....N.....',
    '.....N.....',
    '.....N.....',
    '.....R.....',
  ], [['S', '#e2e2ee'], ['G', '#e0af68'], ['N', '#8b6042'], ['R', '#f7768e']]),
  pat('castle', '城堡', [
    'W.W......W.W',
    'WWW......WWW',
    'WWW......WWW',
    'WWWWWWWWWWWW',
    'WWWWWWWWWWWW',
    'WWWBBWWBBWWW',
    'WWWBBWWBBWWW',
    'WWWWWNNWWWWW',
    'WWWWWNNWWWWW',
    'WWWWWDDWWWWW',
    'WWWWWDDWWWWW',
    'WWWWWDDWWWWW',
  ], [['W', '#e2e2ee'], ['B', '#7aa2f7'], ['N', '#8b6042'], ['D', '#5a3a28']]),
  pat('invader', '太空侵略者', [
    '............',
    '..W......W..',
    '..G......G..',
    '...G....G...',
    '..GGGGGGGG..',
    '..GGKGGKGG..',
    '.GGGGGGGGGG.',
    '.G.GGGGGG.G.',
    '.G.G....G.G.',
    '....GG.GG...',
    '............',
    '............',
  ], [['G', '#9ece6a'], ['K', '#1a1a24'], ['W', '#e2e2ee']]),
]

/**
 * 第 level 关（0 起）允许的图案边长范围：5 关从 8x8 递进到 12x12。
 * @param level - 0 起的关卡下标（0-4）。
 * @returns [最小边长, 最大边长]。
 */
export function levelGridRange(level: number): [number, number] {
  const idx = Math.min(Math.max(level, 0), LEVEL_COUNT - 1)
  const ranges: Array<[number, number]> = [[8, 8], [8, 9], [9, 10], [10, 11], [11, 12]]
  return ranges[idx]!
}

/**
 * 第 level 关可用的图案列表（边长落在该关范围内）。
 * @param level - 0 起的关卡下标。
 * @returns 图案子集（至少 2 幅）。
 */
export function eligiblePatterns(level: number): PatternDef[] {
  const [min, max] = levelGridRange(level)
  return PATTERN_LIBRARY.filter((p) => p.grid >= min && p.grid <= max)
}

/**
 * 把图案字符画展平为参考图数组：-1 表示空格，否则为 colors 下标。
 * @param pattern - 图案。
 * @returns 长度 grid*grid 的颜色下标数组。
 */
export function referenceCells(pattern: PatternDef): number[] {
  const out: number[] = []
  for (const row of pattern.rows) {
    for (const ch of row) {
      if (ch === dot) {
        out.push(-1)
        continue
      }
      const idx = pattern.colors.findIndex((c) => c.char === ch)
      out.push(idx >= 0 ? idx : -1)
    }
  }
  return out
}
/** 空格字符约定。 */
const dot = '.'

/**
 * 生成第 level 关：按种子确定性选图，并把颜色下标打乱为调色板顺序。
 * @param level - 0 起的关卡下标（0-4）。
 * @param seed - 种子（同关卡同种子产出完全一致）。
 * @returns 关卡内容。
 */
export function buildLevel(level: number, seed: number): PainterLevel {
  const idx = Math.min(Math.max(level, 0), LEVEL_COUNT - 1)
  const rng = mulberry32((seed ^ Math.imul(idx + 1, 0x85ebca6b)) >>> 0)
  const pool = eligiblePatterns(idx)
  const pattern = pool[Math.floor(rng() * pool.length)]!
  const palette = pattern.colors.map((_, i) => i)
  for (let i = palette.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = palette[i]!
    palette[i] = palette[j]!
    palette[j] = tmp
  }
  return { pattern, reference: referenceCells(pattern), palette }
}

/**
 * 新建空画布（全部 -1）。
 * @param grid - 网格边长。
 * @returns 长度 grid*grid 的数组。
 */
export function createCanvas(grid: number): number[] {
  return Array.from({ length: grid * grid }, () => -1)
}

function inGrid(grid: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid && y < grid
}

/**
 * 在画布一格涂色（颜色未变化时不算涂改）。
 * @param cells - 画布数组（原地修改）。
 * @param grid - 网格边长。
 * @param x - 列。
 * @param y - 行。
 * @param colorIdx - 颜色下标（-1 视为清除）。
 * @returns 发生了涂改返回 true。
 */
export function paintCell(cells: number[], grid: number, x: number, y: number, colorIdx: number): boolean {
  if (!inGrid(grid, x, y)) return false
  const at = y * grid + x
  if (cells[at] === colorIdx) return false
  cells[at] = colorIdx
  return true
}

/**
 * 清除画布一格（已为空时不算涂改）。
 * @param cells - 画布数组（原地修改）。
 * @param grid - 网格边长。
 * @param x - 列。
 * @param y - 行。
 * @returns 发生了清除返回 true。
 */
export function eraseCell(cells: number[], grid: number, x: number, y: number): boolean {
  return paintCell(cells, grid, x, y, -1)
}

/**
 * 实时比对画布与参考图：统计涂对/涂错格数并给出全部错格。
 * @param reference - 参考图数组。
 * @param canvas - 画布数组。
 * @param grid - 网格边长。
 * @returns 比对结果。
 */
export function compareCells(reference: number[], canvas: number[], grid: number): CompareResult {
  let correct = 0
  const wrongCells: Cell[] = []
  for (let y = 0; y < grid; y += 1) {
    for (let x = 0; x < grid; x += 1) {
      if (reference[y * grid + x] === canvas[y * grid + x]) correct += 1
      else wrongCells.push({ x, y })
    }
  }
  return { correct, wrong: wrongCells.length, total: grid * grid, wrongCells }
}

/**
 * 完成度百分比（涂对格数占比，四舍五入到整数）。
 * @param result - 比对结果。
 * @returns 0-100。
 */
export function completionPct(result: CompareResult): number {
  return Math.round((result.correct / result.total) * 100)
}

/**
 * 过关判定：全格一致。
 * @param result - 比对结果。
 * @returns 无错格返回 true。
 */
export function isSolved(result: CompareResult): boolean {
  return result.wrong === 0
}

/**
 * 提示：把第一个错格自动修正为参考值（原地修改画布，不计步数）。
 * @param reference - 参考图数组。
 * @param canvas - 画布数组（原地修改）。
 * @param grid - 网格边长。
 * @returns 被修正的格子，已无错格时返回 null。
 */
export function applyHint(reference: number[], canvas: number[], grid: number): Cell | null {
  for (let y = 0; y < grid; y += 1) {
    for (let x = 0; x < grid; x += 1) {
      const at = y * grid + x
      if (reference[at] !== canvas[at]) {
        canvas[at] = reference[at]!
        return { x, y }
      }
    }
  }
  return null
}

/**
 * 过关计分：基础分随关卡上升，步数（涂改次数）与已用提示扣分，下限 100。
 * @param level - 1 起的关卡序号。
 * @param steps - 本关涂改步数。
 * @param hintsUsed - 已用提示次数。
 * @returns 得分。
 */
export function computeScore(level: number, steps: number, hintsUsed: number): number {
  return Math.max(100, 320 + level * 110 - steps * 4 - hintsUsed * 45)
}
