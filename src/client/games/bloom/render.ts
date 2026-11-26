/**
 * 开花连消 Bloom 渲染：花园风画面——花苞为发光圆点、绽放为双层五瓣
 * 花、连锁按波次延迟逐层绽放（涟漪动画）、石头格灰纹、连锁得分浮字、
 * 点击/花苞/分数 HUD、暂停与过关失败遮罩、过关粒子。说明按钮与帮助
 * 面板画在整个渲染函数的最末尾，保证盖在盘面与遮罩之上。
 *
 * 布局常量与命中函数全部导出，index.ts 用同一份布局做点击命中，杜绝
 * 绘制与命中错位。
 */
import { THEME, accent, glow, noGlow, roundRectPath, drawBackground, drawOverlay, hudPair } from '../theme.ts'
import { GRID, countBuds, type BloomState, type ChainStep } from './logic.ts'

/** 逻辑画布尺寸（关卡间不变，自适应交给 fitCanvas 变换）。 */
export const LOGICAL_W = 960
export const LOGICAL_H = 600

/** 网格布局：58px 格 + 6px 缝，居中含边距。 */
export const CELL = 58
export const GAP = 6
const BOARD_SIZE = GRID * CELL + (GRID - 1) * GAP
export const BOARD_X = (LOGICAL_W - BOARD_SIZE) / 2
export const BOARD_Y = 76

/** 一个矩形（逻辑坐标）。 */
export interface Rect { x: number, y: number, w: number, h: number }

/** 「说明」按钮矩形（60×24，右下角；渲染在最上层，index.ts 复用命中）。 */
export const HELP_BUTTON: Rect = { x: LOGICAL_W - 84, y: LOGICAL_H - 38, w: 60, h: 24 }

/** 涟漪动画参数：每波 0.16s 延迟、花瓣 0.42s 展开、浮字 0.9s。 */
const LAYER_S = 0.16
const OPEN_S = 0.42
const FLOAT_S = 0.9

/** 连锁涟漪动画（index.ts 推进 t，秒）。 */
export interface RippleAnim {
  /** 连锁步骤（含波次）。 */
  steps: ChainStep[]
  /** 动画已播放秒数。 */
  t: number
}

/** 渲染选项：暂停、帮助面板、悬停/键盘光标、涟漪动画、过关文案。 */
export interface BloomView {
  paused: boolean
  /** 说明面板是否展开。 */
  helpOpen: boolean
  /** 鼠标悬停格（-1 无）。 */
  hoverIndex: number
  /** 键盘光标格（-1 无）。 */
  cursorIndex: number
  /** 进行中的连锁涟漪（null 无）。 */
  anim: RippleAnim | null
  /** 过关遮罩副标题（null 用默认文案）。 */
  winText: string | null
}

/**
 * 逻辑坐标落在哪个格（含缝隙归入邻近格，宽松命中）。
 * @param x - 逻辑横坐标。
 * @param y - 逻辑纵坐标。
 * @returns 格子下标（行主序），盘面外返回 -1。
 */
export function gridCellAt(x: number, y: number): number {
  const c = Math.floor((x - BOARD_X) / (CELL + GAP))
  const r = Math.floor((y - BOARD_Y) / (CELL + GAP))
  if (r < 0 || r >= GRID || c < 0 || c >= GRID) return -1
  return r * GRID + c
}

/**
 * 说明按钮是否被点中。
 * @param x - 逻辑横坐标。
 * @param y - 逻辑纵坐标。
 */
export function helpButtonHit(x: number, y: number): boolean {
  return x >= HELP_BUTTON.x && x < HELP_BUTTON.x + HELP_BUTTON.w
    && y >= HELP_BUTTON.y && y < HELP_BUTTON.y + HELP_BUTTON.h
}

/** 某格中心点（逻辑坐标）。 */
function cellCenter(i: number): { x: number, y: number } {
  const r = Math.floor(i / GRID)
  const c = i % GRID
  return {
    x: BOARD_X + c * (CELL + GAP) + CELL / 2,
    y: BOARD_Y + r * (CELL + GAP) + CELL / 2,
  }
}

/** 每格恒定的花瓣朝向偏角（让花田各花朝向错落）。 */
function petalSpin(i: number): number {
  return ((i * 37) % 16) * 0.13
}

/** easeOutBack：花瓣展开带一点回弹。 */
function easeOutBack(t: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  const u = t - 1
  return 1 + c3 * u * u * u + c1 * u * u
}

/** 画一朵绽放的花：外层 5 瓣 + 内层错开 5 瓣 + 金色花芯。
 * faded：已定格的旧花——半透明无辉光，与全色发光的花苞拉开视觉层次
 * （原先两者同色同亮，「还得一个个点过去」分不清哪些没点）。 */
function drawFlower(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string, age: number, spin: number, faded = false): void {
  const grow = age >= 1 ? 1 : easeOutBack(Math.max(0, Math.min(1, age)))
  const r = CELL * 0.46 * grow
  if (r < 2) {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(cx, cy, 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  // 定格花改为淡奶油色（与任何花苞色都拉开色相差异，而非仅透明度）。
  if (faded) {
    ctx.globalAlpha = 0.9
    ctx.fillStyle = '#d9d2c0'
  } else {
    glow(ctx, color, 8)
    ctx.fillStyle = color
  }
  for (let k = 0; k < 5; k += 1) {
    const a = spin + (k * Math.PI * 2) / 5
    ctx.beginPath()
    ctx.ellipse(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, r * 0.5, r * 0.24, a, 0, Math.PI * 2)
    ctx.fill()
  }
  noGlow(ctx)
  ctx.globalAlpha = faded ? 0.65 : 0.8
  ctx.fillStyle = faded ? '#efeae0' : color
  for (let k = 0; k < 5; k += 1) {
    const a = spin + Math.PI / 5 + (k * Math.PI * 2) / 5
    ctx.beginPath()
    ctx.ellipse(cx + Math.cos(a) * r * 0.34, cy + Math.sin(a) * r * 0.34, r * 0.36, r * 0.18, a, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  // 定格花芯：保留原色相的小色点（奶油花瓣会抹掉颜色信息——开局 5 朵
  // 初始花全变同色奶油的根因），金芯仅动画/新开时用。
  ctx.fillStyle = faded ? color : THEME.gold
  if (!faded) glow(ctx, THEME.gold, 4)
  ctx.beginPath()
  ctx.arc(cx, cy, Math.max(1.5, r * (faded ? 0.22 : 0.16)), 0, Math.PI * 2)
  ctx.fill()
  if (!faded) noGlow(ctx)
  ctx.globalAlpha = 1
}

/** 画一个花苞：发光圆点 + 高光；悬停时描白圈。 */
function drawBud(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string, emphasized: boolean): void {
  // 花苞：实心色盘 + 低辉光——高辉光会把小色点的色相差晕成一片（开局
  // 颜色分不清的根因）；实心填充+对比描边让色相清晰可辨。
  const r = CELL * 0.28
  glow(ctx, color, emphasized ? 12 : 4)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  noGlow(ctx)
  ctx.strokeStyle = emphasized ? THEME.text : 'rgba(15,15,22,0.85)'
  ctx.lineWidth = emphasized ? 2.5 : 2
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.beginPath()
  ctx.arc(cx - r * 0.3, cy - r * 0.3, r * 0.28, 0, Math.PI * 2)
  ctx.fill()
}

/** 画一个石头格：灰底石块 + 恒定杂色斑点（按下标错落）。 */
function drawStone(ctx: CanvasRenderingContext2D, i: number, x: number, y: number): void {
  roundRectPath(ctx, x + 5, y + 5, CELL - 10, CELL - 10, 8)
  ctx.fillStyle = '#343442'
  ctx.fill()
  ctx.strokeStyle = '#4a4a5c'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,255,255,0.09)'
  const a = (i * 5) % 7
  const b = i % 3
  ctx.fillRect(x + 12 + a * 4, y + 14 + b * 6, 6, 4)
  ctx.fillRect(x + CELL - 26, y + CELL - 22 - b * 5, 8, 5)
}

/** 帮助面板正文（15px 大字，宽度已按 680px 面板逐行核算）。 */
const HELP_LINES = [
  '8×8 花田：多种颜色花苞、少量开局已开的花，高关卡还有石头格。',
  '点击一个花苞：它与四邻同色花苞组成第一波「开放组」。',
  '连锁：已绽放的花（任何颜色）会卷入四邻中与本次同色的花苞，逐层扩散。',
  '石头格永不绽放、不传导连锁；异色花苞不会被卷入。',
  '每次点击得分 = 连锁规模 × 连锁规模（平方），大连锁才划算。',
  '目标：限定点击数内让花田全部绽放；点击用尽仍有花苞即失败。',
  '策略：先点零散小簇铺开「已开网络」，再点大簇收割超级连锁。',
  'R 重开 · P 暂停 · H / 右下角「说明」随时开合（暂停时也能看）。',
]

/**
 * 整幅渲染：背景 → HUD → 盘面（槽、石头、花苞/花、涟漪）→ 连锁浮字
 * → 粒子 → 暂停/过关/失败遮罩 → 说明按钮 → 帮助面板（最后两步永远
 * 最上层，任何阶段可开合）。
 * @param ctx - 画布上下文（fitCanvas 已做逻辑坐标变换）。
 * @param state - 对局状态。
 * @param view - 渲染选项。
 * @param particles - 可选粒子系统（过关庆祝）。
 * @param dtMs - 本帧毫秒（粒子推进用）。
 */
export function renderBloom(
  ctx: CanvasRenderingContext2D,
  state: BloomState,
  view: BloomView,
  particles?: { tick(ctx: CanvasRenderingContext2D, dtMs: number): void },
  dtMs = 16,
): void {
  drawBackground(ctx, LOGICAL_W, LOGICAL_H)

  // HUD：左侧三对 + 右侧分数；中列提示（三块互不重叠，见布局核算）。
  ctx.textBaseline = 'alphabetic'
  hudPair(ctx, 24, 26, '关卡', state.level + '/' + 5)
  const clicksColor = state.clicksLeft <= 2 ? THEME.bad : THEME.text
  hudPair(ctx, 170, 26, '点击', String(Math.max(0, state.clicksLeft)), 'left', clicksColor)
  hudPair(ctx, 285, 26, '花苞', String(countBuds(state.grid)))
  hudPair(ctx, LOGICAL_W - 140, 26, '点击', String(Math.max(0, state.clicksLeft)), 'right', state.clicksLeft <= 1 ? THEME.bad : THEME.text)
  hudPair(ctx, LOGICAL_W - 24, 26, '分数', String(state.score), 'right', THEME.gold)
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('限定点击内全田绽放 · 大连锁得分平方', LOGICAL_W / 2, 26)

  // 盘面底板 + 每格浅色槽。
  roundRectPath(ctx, BOARD_X - 12, BOARD_Y - 12, BOARD_SIZE + 24, BOARD_SIZE + 24, 12)
  ctx.fillStyle = THEME.panel
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  for (let i = 0; i < GRID * GRID; i += 1) {
    const p = cellCenter(i)
    roundRectPath(ctx, p.x - CELL / 2 + 2, p.y - CELL / 2 + 2, CELL - 4, CELL - 4, 6)
    ctx.fillStyle = 'rgba(255,255,255,0.03)'
    ctx.fill()
  }

  // 涟漪动画：该格的绽放时刻 = 波次 × LAYER_S；未到点仍画花苞，
  // 已到点按已过时间展开花瓣（scale 回弹）。
  const animMap = new Map<number, number>()
  if (view.anim !== null) {
    for (const s of view.anim.steps) animMap.set(s.index, s.layer)
  }
  const playing = state.status === 'playing' && !view.paused
  for (let i = 0; i < GRID * GRID; i += 1) {
    const cell = state.grid[i]!
    const p = cellCenter(i)
    const x = p.x - CELL / 2
    const y = p.y - CELL / 2
    if (cell.kind === 'stone') {
      drawStone(ctx, i, x, y)
      continue
    }
    const layer = animMap.get(i)
    if (layer !== undefined && view.anim !== null && view.anim.t < layer * LAYER_S) {
      drawBud(ctx, p.x, p.y, accent(cell.color), playing && (view.hoverIndex === i || view.cursorIndex === i))
      continue
    }
    let age = 1
    if (layer !== undefined && view.anim !== null) {
      age = (view.anim.t - layer * LAYER_S) / OPEN_S
    }
    const settled = layer === undefined
    drawFlower(ctx, p.x, p.y, accent(cell.color), age, petalSpin(i), settled)
    if (playing && (view.hoverIndex === i || view.cursorIndex === i)) {
      ctx.strokeStyle = THEME.text
      ctx.lineWidth = 1.5
      roundRectPath(ctx, x + 1, y + 1, CELL - 2, CELL - 2, 7)
      ctx.stroke()
    }
  }

  // 连锁得分浮字：连锁质心上浮 + 淡出。
  if (view.anim !== null && view.anim.steps.length > 0) {
    const life = view.anim.t / FLOAT_S
    if (life < 1) {
      let sx = 0
      let sy = 0
      for (const s of view.anim.steps) {
        const p = cellCenter(s.index)
        sx += p.x
        sy += p.y
      }
      const n = view.anim.steps.length
      ctx.globalAlpha = 1 - life
      ctx.font = 'bold 24px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillStyle = THEME.gold
      glow(ctx, THEME.gold, 10)
      ctx.fillText('+' + n * n + '（连开 ' + n + '）', sx / n, sy / n - 18 - 26 * life)
      noGlow(ctx)
      ctx.globalAlpha = 1
    }
  }

  particles?.tick(ctx, dtMs)

  if (view.paused) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '暂停', '按 P 继续浇灌', THEME.gold)
  } else if (state.status === 'won') {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '满园盛放', view.winText ?? '限定点击内全部绽放', THEME.good)
  } else if (state.status === 'lost') {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '花苞未开', '点击用尽 · 按 R 重开', THEME.bad)
  }

  drawHelpButton(ctx, view.helpOpen)
  if (view.helpOpen) drawHelpPanel(ctx)
}

/** 说明按钮（渲染末尾、最上层）。 */
function drawHelpButton(ctx: CanvasRenderingContext2D, open: boolean): void {
  const rect = HELP_BUTTON
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 6)
  ctx.fillStyle = open ? accent(2) : THEME.panel
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = open ? '#15151b' : THEME.text
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(open ? '关闭' : '说明', rect.x + rect.w / 2, rect.y + 16)
}

/** 帮助面板（渲染最末尾、盖在一切之上，任何阶段可开合）。 */
function drawHelpPanel(ctx: CanvasRenderingContext2D): void {
  const w = 680
  const h = 340
  const x = (LOGICAL_W - w) / 2
  const y = (LOGICAL_H - h) / 2
  roundRectPath(ctx, x, y, w, h, 10)
  ctx.fillStyle = 'rgba(20,20,30,0.96)'
  ctx.fill()
  ctx.strokeStyle = accent(2)
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.font = 'bold 20px system-ui, sans-serif'
  ctx.fillStyle = THEME.text
  ctx.fillText('开花连消 规则说明', LOGICAL_W / 2, y + 40)
  ctx.font = '500 15px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillStyle = THEME.text
  for (let i = 0; i < HELP_LINES.length; i += 1) {
    ctx.fillText(HELP_LINES[i]!, x + 28, y + 82 + i * 26)
  }
  ctx.textAlign = 'center'
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('点右下角「说明」或按 H 关闭 · 暂停时也能看', LOGICAL_W / 2, y + h - 18)
}
