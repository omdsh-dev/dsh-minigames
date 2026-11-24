/**
 * 字母雨 TypeFall 渲染：夜空星点背景、拖尾下落的字母方块、顶部目标
 * 单词槽（已拼字母亮显、命中闪光）、接地线与溅落、HUD（命/关/分数）、
 * 关卡横幅、暂停/结束/通关遮罩，以及最后绘制的「说明」按钮与帮助面板
 * （任何阶段可开合，永远最上层）。
 *
 * 布局核算（两两不相交，均在 480x560 内）：
 * - HUD 行基线 y=26：「命」左锚 x=12（宽约 50），「关」左锚 x=110（宽约
 *   55，右缘约 165），「词」左锚 x=190（宽约 55，右缘约 245），「分数」
 *   右锚 x=394（最长『分数 99999』宽约 100，左缘约 294，与「词」右缘
 *   245 间距 49）；
 * - 说明按钮矩形 (406,8,60,24)：分数右锚 394 与其左缘 406 间距 12；
 * - 单词槽行 y=50..84：最多 7 槽共 286px，居中 97..383，与 HUD 行
 *   （y<=32）纵向间隔 18，与说明按钮（y<=32，x>=406）横向不相交；
 * - 接地线 y=460，下落字母方块 30px 底缘触线即漏；
 * - 帮助面板 (32,114,416,332) 居中，最后绘制覆盖其余一切。
 */
import { drawBackground, drawOverlay, glow, hudPair, noGlow, roundRectPath, THEME, accent } from '../theme.ts'
import { mulberry32, GROUND_Y, LETTER_SIZE, currentWord, type TypeFallState } from './logic.ts'

/** 逻辑画布宽（px）。 */
export const LOGICAL_W = 480
/** 逻辑画布高（px）。 */
export const LOGICAL_H = 560
/** 说明按钮矩形（渲染最末尾绘制；60x24）。 */
export const HELP_RECT = { x: 406, y: 8, w: 60, h: 24 } as const
/** 单词槽边长（px）。 */
const SLOT = 34
/** 单词槽间距（px）。 */
const SLOT_GAP = 8
/** 单词槽行顶边 y（px）。 */
const SLOT_Y = 50
/** HUD 行文字基线 y（px）。 */
const HUD_Y = 26
/** 分数右锚 x（说明按钮左侧 12px）。 */
const SCORE_RIGHT = 394

/** 固定种子生成的夜空星点（模块加载时一次确定，不随帧变化）。 */
const STARS: readonly { x: number, y: number, r: number, a: number }[] = (() => {
  const rand = mulberry32(7)
  const out: { x: number, y: number, r: number, a: number }[] = []
  for (let i = 0; i < 26; i += 1) {
    out.push({
      x: 12 + rand() * (LOGICAL_W - 24),
      y: 96 + rand() * 320,
      r: 0.8 + rand() * 1.4,
      a: 0.25 + rand() * 0.45,
    })
  }
  return out
})()

/** 说明按钮是否被点中（逻辑坐标）。 */
export function helpButtonHit(x: number, y: number): boolean {
  return x >= HELP_RECT.x && x <= HELP_RECT.x + HELP_RECT.w
    && y >= HELP_RECT.y && y <= HELP_RECT.y + HELP_RECT.h
}

/** 夜空星点。 */
function drawStars(ctx: CanvasRenderingContext2D): void {
  for (const s of STARS) {
    ctx.globalAlpha = s.a
    ctx.fillStyle = THEME.text
    ctx.beginPath()
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

/** 接地线与地面微光。 */
function drawGround(ctx: CanvasRenderingContext2D): void {
  const grad = ctx.createLinearGradient(0, GROUND_Y - 26, 0, LOGICAL_H)
  grad.addColorStop(0, 'rgba(122,162,247,0)')
  grad.addColorStop(1, 'rgba(122,162,247,0.16)')
  ctx.fillStyle = grad
  ctx.fillRect(0, GROUND_Y - 26, LOGICAL_W, LOGICAL_H - (GROUND_Y - 26))
  ctx.strokeStyle = 'rgba(122,162,247,0.5)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, GROUND_Y)
  ctx.lineTo(LOGICAL_W, GROUND_Y)
  ctx.stroke()
}

/** 顶部目标单词槽：已拼字母亮显，下一格呼吸描边。 */
function drawWordSlots(ctx: CanvasRenderingContext2D, state: TypeFallState): void {
  const word = currentWord(state).toUpperCase()
  const total = word.length * SLOT + (word.length - 1) * SLOT_GAP
  const x0 = (LOGICAL_W - total) / 2
  for (let i = 0; i < word.length; i += 1) {
    const x = x0 + i * (SLOT + SLOT_GAP)
    roundRectPath(ctx, x, SLOT_Y, SLOT, SLOT, 7)
    if (i < state.typed) {
      const color = accent(i)
      glow(ctx, color, state.flashMs > 0 && i === state.typed - 1 ? 16 : 7)
      ctx.fillStyle = color
      ctx.fill()
      noGlow(ctx)
      ctx.fillStyle = '#15151b'
      ctx.font = 'bold 20px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(word[i]!, x + SLOT / 2, SLOT_Y + SLOT / 2 + 1)
    } else {
      ctx.fillStyle = 'rgba(30,30,42,0.85)'
      ctx.fill()
      const next = i === state.typed
      ctx.strokeStyle = next ? accent(i) : THEME.panelEdge
      ctx.lineWidth = next ? 2 : 1
      if (next) glow(ctx, accent(i), 8)
      ctx.stroke()
      noGlow(ctx)
      ctx.fillStyle = next ? THEME.text : THEME.textMuted
      ctx.font = 'bold 20px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(word[i]!, x + SLOT / 2, SLOT_Y + SLOT / 2 + 1)
    }
  }
  ctx.textBaseline = 'alphabetic'
}

/** 一个下落字母方块（含拖尾与命中高亮差异）。 */
function drawLetter(ctx: CanvasRenderingContext2D, x: number, y: number, ch: string, decoy: boolean): void {
  const color = decoy ? 'rgba(226,226,238,0.45)' : accent(0)
  // 拖尾：方块上方三段渐隐残影。
  if (!decoy) {
    for (let k = 1; k <= 3; k += 1) {
      ctx.globalAlpha = 0.22 - k * 0.06
      ctx.fillStyle = accent(0)
      ctx.fillRect(x + 4, y - k * 13, LETTER_SIZE - 8, 8)
    }
    ctx.globalAlpha = 1
  }
  glow(ctx, decoy ? 'transparent' : accent(0), decoy ? 0 : 10)
  roundRectPath(ctx, x, y, LETTER_SIZE, LETTER_SIZE, 7)
  ctx.fillStyle = decoy ? 'rgba(30,30,42,0.7)' : THEME.panel
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.stroke()
  noGlow(ctx)
  ctx.fillStyle = decoy ? THEME.textMuted : THEME.text
  ctx.font = 'bold 18px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(ch, x + LETTER_SIZE / 2, y + LETTER_SIZE / 2 + 1)
  ctx.textBaseline = 'alphabetic'
}

/** HUD：命（剩 1 时红色）、关、词序，分数右锚避免宽度漂移。 */
function drawHud(ctx: CanvasRenderingContext2D, state: TypeFallState): void {
  hudPair(ctx, 12, HUD_Y, '命', String(state.lives), 'left', state.lives <= 1 ? THEME.bad : THEME.text)
  hudPair(ctx, 110, HUD_Y, '关', (state.level + 1) + '/5')
  const total = state.queues[state.level]!.length
  hudPair(ctx, 190, HUD_Y, '词', (state.wordIndex + 1) + '/' + total)
  hudPair(ctx, SCORE_RIGHT, HUD_Y, '分数', String(state.score), 'right')
}

/** 关卡横幅（进入新关后短暂居中显示）。 */
function drawBanner(ctx: CanvasRenderingContext2D, state: TypeFallState): void {
  if (state.levelBannerMs <= 0) return
  ctx.textAlign = 'center'
  ctx.font = 'bold 22px system-ui, sans-serif'
  ctx.fillStyle = accent(state.level)
  glow(ctx, accent(state.level), 12)
  ctx.fillText('第 ' + (state.level + 1) + ' 关 · 速度提升', LOGICAL_W / 2, 148)
  noGlow(ctx)
}

/** 说明按钮（60x24，渲染末尾、最上层）。 */
function drawHelpButton(ctx: CanvasRenderingContext2D, open: boolean): void {
  roundRectPath(ctx, HELP_RECT.x, HELP_RECT.y, HELP_RECT.w, HELP_RECT.h, 6)
  ctx.fillStyle = open ? accent(0) : THEME.panel
  ctx.fill()
  ctx.strokeStyle = THEME.panelEdge
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = open ? '#15151b' : THEME.text
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(open ? '关闭' : '说明', HELP_RECT.x + HELP_RECT.w / 2, HELP_RECT.y + HELP_RECT.h / 2 + 1)
  ctx.textBaseline = 'alphabetic'
}

/** 帮助面板的八行完整规则（含易误解点）。 */
const HELP_LINES: string[] = [
  '屏幕上方是目标单词，它的字母会按顺序一个个从夜空落下。',
  '在下落途中按下对应字母键，字母就按顺序接入上方的拼词槽。',
  '按错字母键、或目标字母落到底线没接到，都会漏掉一个（扣 1 命）。',
  '注意：按错只扣命，正在下落的目标字母仍在，可以继续接住它。',
  '拼完整个单词得分（每字母 10 分 + 关卡加成），随后进入下一词。',
  '每关 3-5 个词，拼完升关，下落速度逐关变快，共 5 关。',
  '第 2 关起会落下灰暗的干扰字母：落地无害，但按到它算按错。',
  '3 命用完即结束；R 重开、P 暂停、H 或右上按钮开合本说明。',
]

/** 帮助面板（渲染最末尾、盖在一切之上，任何阶段可开合）。 */
function drawHelpPanel(ctx: CanvasRenderingContext2D): void {
  const w = 416
  const h = 332
  const x = (LOGICAL_W - w) / 2
  const y = (LOGICAL_H - h) / 2
  roundRectPath(ctx, x, y, w, h, 10)
  ctx.fillStyle = 'rgba(20,20,30,0.96)'
  ctx.fill()
  ctx.strokeStyle = accent(0)
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.font = 'bold 20px system-ui, sans-serif'
  ctx.fillStyle = THEME.text
  ctx.fillText('字母雨 TypeFall 规则说明', LOGICAL_W / 2, y + 40)
  ctx.font = '500 15px system-ui, sans-serif'
  ctx.textAlign = 'left'
  for (let i = 0; i < HELP_LINES.length; i += 1) {
    ctx.fillText(HELP_LINES[i]!, x + 26, y + 78 + i * 27)
  }
  ctx.textAlign = 'center'
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.fillStyle = THEME.textMuted
  ctx.fillText('点右上角「说明」或按 H 关闭 · 暂停时也能看', LOGICAL_W / 2, y + h - 18)
}

/** 渲染选项：暂停标志与帮助面板开合。 */
export interface RenderOptions {
  paused: boolean
  helpOpen: boolean
}

/**
 * 绘制整帧：背景 → 星点 → 地面 → 单词槽 → 下落字母 → HUD → 横幅 →
 * 遮罩 → 说明按钮 → 帮助面板（最后两步永远最上层）。
 * @param ctx - 逻辑坐标系已就位的 2d 上下文。
 * @param state - 当前游戏状态。
 * @param opts - 暂停与帮助面板标志。
 */
export function renderTypeFall(ctx: CanvasRenderingContext2D, state: TypeFallState, opts: RenderOptions): void {
  drawBackground(ctx, LOGICAL_W, LOGICAL_H)
  const shakeDx = state.shakeMs > 0 ? Math.sin(state.shakeMs / 16) * 4 : 0
  ctx.save()
  ctx.translate(shakeDx, 0)
  drawStars(ctx)
  drawGround(ctx)
  drawWordSlots(ctx, state)
  if (state.active !== null) {
    drawLetter(ctx, state.active.x, state.active.y, state.active.ch, false)
  }
  for (const d of state.decoys) {
    drawLetter(ctx, d.x, d.y, d.ch, true)
  }
  ctx.restore()
  drawHud(ctx, state)
  drawBanner(ctx, state)
  if (state.over) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '游戏结束', '得分 ' + state.score + ' · 按 R 重新开始', THEME.bad)
  } else if (state.won) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '全部通关', '得分 ' + state.score + ' · 按 R 再来一局', THEME.gold)
  } else if (opts.paused) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '已暂停', '按 P 继续 · 按 R 重开')
  }
  drawHelpButton(ctx, opts.helpOpen)
  if (opts.helpOpen) drawHelpPanel(ctx)
}
