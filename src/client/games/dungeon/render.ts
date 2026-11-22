/**
 * 「像素地牢」画布渲染：深色石墙 + 火把光晕迷雾（可见全亮 / 走过
 * 微亮 / 未知纯黑），矩形拼出的像素角色与怪物，血条 / 攻 / 层 / 金币
 * HUD，战斗浮动数字与死亡 / 通关 / 暂停 overlay。共享视觉件见
 * ../theme.ts；所有绘制都基于 logic.ts 的纯状态，不持有游戏逻辑。
 */
import { COLS, ROWS, TORCH_RADIUS, MONSTER_STATS, type DungeonState, type GameEvent } from './logic.ts'
import { THEME, accent, createParticles, drawBackground, drawOverlay, glow, hudPair, noGlow } from '../theme.ts'

/** 单格逻辑像素。 */
export const CELL = 34
/** 顶部 HUD 高度。 */
export const HUD_H = 54
/** 网格外边距（水平居中 + 上下留白）。 */
export const MARGIN = 8
export const LOGICAL_W = MARGIN * 2 + COLS * CELL
export const LOGICAL_H = HUD_H + MARGIN + ROWS * CELL + MARGIN

/** 网格左上角原点（固定 12×10，含边距居中）。 */
export const OX = MARGIN
export const OY = HUD_H + MARGIN

/** 一条浮动战斗数字（出生在格子中心，向上漂并淡出）。 */
export interface FloatText { x: number, y: number, text: string, color: string, age: number }
/** 浮动数字存活时长（ms）。 */
export const FLOAT_MS = 700

/** 本帧渲染输入。 */
export interface DungeonView {
  /** 火把可见格（logic.computeVisible）。 */
  visible: Uint8Array
  /** 活动中的浮动数字。 */
  floats: FloatText[]
  /** 暂停 overlay。 */
  paused: boolean
  /** 自上一帧的毫秒数（浮动数字 / 粒子推进）。 */
  dtMs: number
}

/** 格子中心像素坐标。 */
export function cellCenter(x: number, y: number): { px: number, py: number } {
  return { px: OX + x * CELL + CELL / 2, py: OY + y * CELL + CELL / 2 }
}

/** 事件 → 浮动数字（index 层在每回合调用）。 */
export function floatFromEvent(event: GameEvent): FloatText | null {
  const at = cellCenter(event.x, event.y)
  const mk = (text: string, color: string): FloatText => ({ x: at.px, y: at.py, text, color, age: 0 })
  switch (event.kind) {
    case 'hit': return mk('-' + String(event.value ?? 0), THEME.bad)
    case 'hurt': return mk('-' + String(event.value ?? 0), THEME.bad)
    case 'heal': return mk('+' + String(event.value ?? 0), THEME.good)
    case 'gold': return mk('+' + String(event.value ?? 0) + '金', THEME.gold)
    case 'atkup': return mk('攻+1', accent(2))
    case 'levelup': return mk('升级!', THEME.good)
    case 'kill': return mk('击杀', accent(4))
    default: return null
  }
}

/** 胜利 / 击杀粒子池（渲染模块私有）。 */
const particles = createParticles()
/** 在像素坐标爆一团粒子。 */
export function burstAt(px: number, py: number, color: string, count = 12): void {
  particles.burst(px, py, color, count)
}
/** 粒子是否仍在活动（index 层据此保持 dirty 渲染）。 */
export function particlesActive(): boolean {
  return particles.size() > 0
}

/** 深色石墙格：砖缝 + 微高光。 */
function drawWall(ctx: CanvasRenderingContext2D, px: number, py: number): void {
  ctx.fillStyle = '#2a2a3a'
  ctx.fillRect(px, py, CELL, CELL)
  ctx.fillStyle = '#33334a'
  ctx.fillRect(px + 2, py + 2, CELL - 4, CELL / 2 - 3)
  ctx.fillRect(px + 2, py + CELL / 2 + 1, CELL / 2 - 2, CELL / 2 - 3)
  ctx.fillRect(px + CELL / 2 + 1, py + CELL / 2 + 1, CELL / 2 - 3, CELL / 2 - 3)
}

/** 地板格：暗石板 + 细缝。 */
function drawFloorTile(ctx: CanvasRenderingContext2D, px: number, py: number): void {
  ctx.fillStyle = '#171724'
  ctx.fillRect(px, py, CELL, CELL)
  ctx.fillStyle = 'rgba(255,255,255,0.03)'
  ctx.fillRect(px + 3, py + 3, CELL - 6, CELL - 6)
}

/** 下行楼梯：石阶 + 金色 ▼。 */
function drawStairs(ctx: CanvasRenderingContext2D, px: number, py: number): void {
  ctx.fillStyle = '#3a3a52'
  ctx.fillRect(px + 4, py + 8, CELL - 8, CELL - 12)
  ctx.fillStyle = '#4a4a66'
  ctx.fillRect(px + 7, py + 12, CELL - 14, 6)
  ctx.fillRect(px + 10, py + 20, CELL - 20, 6)
  ctx.fillStyle = THEME.gold
  glow(ctx, THEME.gold, 8)
  ctx.font = 'bold 12px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('▼', px + CELL / 2, py + 16)
  noGlow(ctx)
}

/** 药水：红瓶。 */
function drawPotion(ctx: CanvasRenderingContext2D, px: number, py: number): void {
  ctx.fillStyle = '#8b4049'
  ctx.fillRect(px + 13, py + 8, 8, 4)
  ctx.fillStyle = THEME.bad
  glow(ctx, THEME.bad, 6)
  ctx.fillRect(px + 10, py + 12, 14, 14)
  noGlow(ctx)
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  ctx.fillRect(px + 12, py + 14, 3, 6)
}

/** 宝箱：棕箱金边。 */
function drawChest(ctx: CanvasRenderingContext2D, px: number, py: number): void {
  ctx.fillStyle = '#7a5a2e'
  ctx.fillRect(px + 7, py + 12, 20, 12)
  ctx.fillStyle = '#9a743a'
  ctx.fillRect(px + 7, py + 9, 20, 5)
  ctx.fillStyle = THEME.gold
  ctx.fillRect(px + 15, py + 12, 4, 6)
}

/** 矩形拼像素小怪（每只 ≤ 10 块矩形）。 */
function drawMonster(ctx: CanvasRenderingContext2D, kind: keyof typeof MONSTER_STATS, px: number, py: number, hpRatio: number): void {
  const u = CELL / 17 // 像素单位
  const R = (x: number, y: number, w: number, h: number, color: string): void => {
    ctx.fillStyle = color
    ctx.fillRect(px + x * u, py + y * u, w * u, h * u)
  }
  if (kind === 'slime') {
    R(4, 7, 9, 7, '#5fae5f'); R(5, 5, 7, 3, '#5fae5f')
    R(6, 8, 2, 2, '#0f1f0f'); R(9, 8, 2, 2, '#0f1f0f'); R(6, 14, 5, 1, '#3f7f3f')
  } else if (kind === 'bat') {
    R(2, 7, 4, 4, '#8a6fc0'); R(11, 7, 4, 4, '#8a6fc0')
    R(6, 6, 5, 6, '#6a4fa0'); R(7, 4, 1, 2, '#6a4fa0'); R(9, 4, 1, 2, '#6a4fa0')
    R(7, 8, 1, 1, '#ffdd66'); R(9, 8, 1, 1, '#ffdd66')
  } else if (kind === 'skeleton') {
    R(5, 4, 7, 5, '#d8d8d2'); R(6, 5, 2, 2, '#1a1a24'); R(9, 5, 2, 2, '#1a1a24')
    R(7, 9, 3, 2, '#d8d8d2'); R(5, 11, 7, 4, '#c4c4bc')
    R(5, 12, 7, 1, '#8a8a80'); R(7, 15, 3, 2, '#d8d8d2')
  } else if (kind === 'mage') {
    R(4, 5, 9, 2, '#7a4fd0'); R(6, 3, 5, 2, '#7a4fd0')
    R(5, 7, 7, 8, '#5a3fa0'); R(7, 9, 3, 4, '#3a2a70')
    R(7, 8, 2, 1, '#7dcfff'); R(9, 8, 2, 1, '#7dcfff')
  } else if (kind === 'dragon') {
    R(3, 6, 4, 5, '#c06040'); R(10, 6, 4, 5, '#c06040')
    R(5, 7, 7, 6, '#e07040'); R(5, 5, 7, 2, '#e07040')
    R(6, 8, 2, 1, '#ffdd66'); R(9, 8, 2, 1, '#ffdd66'); R(6, 13, 5, 2, '#a04828')
  } else {
    // boss 龙王：撑满整格 + 金瞳。
    R(1, 5, 5, 7, '#a03040'); R(11, 5, 5, 7, '#a03040')
    R(3, 6, 11, 9, '#d04050'); R(3, 3, 11, 3, '#d04050')
    R(5, 7, 2, 2, '#ffdd66'); R(10, 7, 2, 2, '#ffdd66')
    R(5, 15, 7, 2, '#802030'); R(3, 1, 2, 2, THEME.gold); R(12, 1, 2, 2, THEME.gold)
  }
  // 受伤怪物头顶微型血条。
  if (hpRatio < 1) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(px + 5, py + 1, CELL - 10, 3)
    ctx.fillStyle = THEME.bad
    ctx.fillRect(px + 5, py + 1, (CELL - 10) * hpRatio, 3)
  }
}

/** 玩家：蓝色小勇者 + 金剑。 */
function drawHero(ctx: CanvasRenderingContext2D, px: number, py: number): void {
  const u = CELL / 17
  const R = (x: number, y: number, w: number, h: number, color: string): void => {
    ctx.fillStyle = color
    ctx.fillRect(px + x * u, py + y * u, w * u, h * u)
  }
  R(5, 3, 7, 4, accent(0))
  R(6, 4, 2, 2, '#10101a'); R(9, 4, 2, 2, '#10101a')
  R(4, 7, 9, 6, '#4a6ab0')
  R(6, 9, 5, 4, '#7aa2f7')
  R(13, 5, 2, 8, THEME.gold)
  R(12, 11, 4, 2, '#8a6a3a')
}

/** 绘制一帧。 */
export function renderDungeon(ctx: CanvasRenderingContext2D, state: DungeonState, view: DungeonView): void {
  drawBackground(ctx, LOGICAL_W, LOGICAL_H)
  const floor = state.floor

  // —— HUD（两行，右锚动态值）——
  hudPair(ctx, 12, 16, '血 ', state.hp + '/' + state.maxHp, 'left', state.hp <= state.maxHp / 4 ? THEME.bad : THEME.good)
  ctx.fillStyle = 'rgba(255,255,255,0.12)'
  ctx.fillRect(12, 21, 100, 7)
  ctx.fillStyle = state.hp <= state.maxHp / 4 ? THEME.bad : THEME.good
  ctx.fillRect(12, 21, Math.max(0, Math.min(1, state.hp / state.maxHp)) * 100, 7)
  hudPair(ctx, 130, 16, '攻 ', String(2 + state.atkUp) + '-' + String(4 + state.atkUp))
  hudPair(ctx, 196, 16, '层 ', state.floorIndex + '/' + 5)
  ctx.fillStyle = THEME.textMuted
  ctx.font = '600 11px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('方向键/WASD 移动 · 走入怪物=攻击 · R 重开 · P 暂停', 12, 44)
  hudPair(ctx, LOGICAL_W - 12, 16, '金币 ', String(state.gold), 'right', THEME.gold)
  hudPair(ctx, LOGICAL_W - 12, 44, '级 ', String(state.level), 'right')

  // —— 网格（未知格保持背景黑，不做任何绘制）——
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const i = y * COLS + x
      const px = OX + x * CELL
      const py = OY + y * CELL
      if (view.visible[i] !== 1 && state.explored[i] !== 1) continue
      if (floor.tiles[i] === 1) drawFloorTile(ctx, px, py)
      else drawWall(ctx, px, py)
    }
  }
  // 探索记忆区整体压暗（迷雾渐隐的"半亮"层）。
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const i = y * COLS + x
      if (view.visible[i] === 1 || state.explored[i] !== 1) continue
      ctx.fillStyle = 'rgba(8,8,16,0.62)'
      ctx.fillRect(OX + x * CELL, OY + y * CELL, CELL, CELL)
    }
  }

  // 楼梯 / 物品（只在见过或正看见时画；微亮区仍显示已记忆内容）。
  if (floor.stairs !== null) {
    const s = floor.stairs
    if (view.visible[s.y * COLS + s.x] === 1 || state.explored[s.y * COLS + s.x] === 1) {
      drawStairs(ctx, OX + s.x * CELL, OY + s.y * CELL)
    }
  }
  for (const item of floor.items) {
    const i = item.y * COLS + item.x
    if (view.visible[i] !== 1 && state.explored[i] !== 1) continue
    if (item.kind === 'potion') drawPotion(ctx, OX + item.x * CELL, OY + item.y * CELL)
    else drawChest(ctx, OX + item.x * CELL, OY + item.y * CELL)
  }
  for (const mon of floor.monsters) {
    const i = mon.y * COLS + mon.x
    if (view.visible[i] !== 1) continue
    drawMonster(ctx, mon.kind, OX + mon.x * CELL, OY + mon.y * CELL, mon.hp / mon.maxHp)
  }
  drawHero(ctx, OX + state.player.x * CELL, OY + state.player.y * CELL)

  // 火把光晕：以玩家为中心的暖色径向渐变，压在网格上。
  const torchR = (TORCH_RADIUS + 0.5) * CELL
  const pc = cellCenter(state.player.x, state.player.y)
  const grad = ctx.createRadialGradient(pc.px, pc.py, CELL * 0.5, pc.px, pc.py, torchR)
  grad.addColorStop(0, 'rgba(255,190,90,0.10)')
  grad.addColorStop(0.6, 'rgba(255,170,70,0.04)')
  grad.addColorStop(1, 'rgba(10,8,20,0.32)')
  ctx.fillStyle = grad
  ctx.fillRect(OX, OY, COLS * CELL, ROWS * CELL)

  // 粒子与浮动数字。
  particles.tick(ctx, view.dtMs)
  for (const f of view.floats) {
    const t = Math.min(1, f.age / FLOAT_MS)
    ctx.globalAlpha = 1 - t
    ctx.font = 'bold 12px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = f.color
    ctx.fillText(f.text, f.x, f.y - 14 - t * 18)
  }
  ctx.globalAlpha = 1

  if (state.status === 'dead') {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '你死了', '金币减半 · 按 R 重新开始', THEME.bad)
  } else if (state.status === 'won') {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '地牢制霸', '击败龙王 · 按 R 再来一局', THEME.gold)
  } else if (view.paused) {
    drawOverlay(ctx, LOGICAL_W, LOGICAL_H, '已暂停', '按 P 继续 · R 重开')
  }
}
