/**
 * 解绳谜题 Planarity 渲染层：极简网面——干净边绿色、交叉边红色粗描、
 * 顶点可拖圆点（拖动中放大发光跟随指针）、过关时顶点平滑归位动画与
 * 粒子庆祝、交叉数 / 步数 / 关卡 / 用时 HUD、说明按钮与大字帮助面板
 *（画在渲染函数末尾，任何阶段最上层）。状态由 logic 提供，纯绘制。
 */
import {
  THEME, accent, glow, noGlow, drawBackground, drawOverlay, hudPair, createParticles, roundRectPath,
} from '../theme.ts'
import {
  LEVEL_COUNT, W, H, countCrossings, crossingEdgeSet, totalScore,
  type PlanarityState, type Pt,
} from './logic.ts'

/** 顶点绘制半径（命中半径略大，见 index 层）。 */
export const VERTEX_R = 9
/** 说明按钮矩形（右下角，60x24）。 */
export const HELP_BTN = { x: W - 72, y: H - 32, w: 60, h: 24 } as const
/** 帮助面板矩形（居中，大字 15px）。 */
const HELP_PANEL = { x: W / 2 - 280, y: H / 2 - 112, w: 560, h: 224 } as const
/** 帮助面板文案（完整规则 + 易误解点）。 */
const HELP_LINES = [
  '玩法速览',
  '· 拖动圆点顶点，让所有连线互不交叉，全部变绿即过关',
  '· 共享端点的两条边永远合法——只看不共端点边对的交叉',
  '· 红边 = 与某条边交叉；绿边 = 目前干净。红的都消失就赢',
  '· 题目必有解：盘面就是由一张无交叉平面网打乱而来',
  '· 共 5 关，顶点 6→10、连线越来越密，拖动次数越少分越高',
  '· 用时也计分：120 秒内过关每秒 +2 分 · P 暂停 · R 重开本关',
  '· 再点「说明」关闭本面板 · 暂停中也可随时查看',
]

/** 渲染视图选项（index 层传入的瞬态 UI 状态）。 */
export interface PlanarityView {
  /** 暂停中（叠加暂停 overlay，帮助面板仍画在其上）。 */
  paused: boolean
  /** 帮助面板打开。 */
  helpOpen: boolean
  /** 过关归位动画进度 [0,1]，< 0 表示未在动画。 */
  winAnimT: number
}

/** mm:ss 计时文案。 */
function clockText(ms: number): string {
  const s = Math.floor(ms / 1000)
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

/** 缓出插值（过关归位动画）。 */
function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

/** 按动画进度混合当前与理想位置。 */
function blendedVertex(state: PlanarityState, i: number, t: number): Pt {
  const cur = state.vertices[i]!
  const sol = state.solution[i]!
  if (t <= 0) return cur
  const k = easeOut(Math.min(1, t))
  return { x: cur.x + (sol.x - cur.x) * k, y: cur.y + (sol.y - cur.y) * k }
}

/**
 * 渲染器句柄：draw 为整帧绘制（含末尾最上层的说明按钮 / 帮助面板与
 * 各 overlay），burst 在过关时喷发庆祝粒子。
 */
export interface PlanarityRenderer {
  /** 绘制一帧完整场景。 */
  draw(ctx: CanvasRenderingContext2D, state: PlanarityState, view: PlanarityView): void
  /** 在某点喷发庆祝粒子。 */
  burst(x: number, y: number, color?: string): void
  /** 是否仍有存活粒子（决定是否继续重绘）。 */
  busy(): boolean
}

/**
 * 创建渲染器（每画布一个粒子系统实例）。
 * @returns 渲染器句柄。 */
export function createPlanarityRenderer(): PlanarityRenderer {
  const particles = createParticles()
  const draw = (ctx: CanvasRenderingContext2D, state: PlanarityState, view: PlanarityView): void => {
    drawBackground(ctx, W, H)
    const animating = view.winAnimT >= 0 && state.phase !== 'playing'
    const t = animating ? view.winAnimT : -1
    const pos = (i: number): Pt => (t >= 0 ? blendedVertex(state, i, t) : state.vertices[i]!)
    const bad = crossingEdgeSet(state.vertices, state.edges)
    const solved = state.phase !== 'playing'

    // 边：干净绿、交叉红（加粗发光）；过关后全部金色。
    for (let i = 0; i < state.edges.length; i += 1) {
      const e = state.edges[i]!
      const crossing = !solved && bad.has(i)
      const color = solved ? THEME.gold : crossing ? THEME.bad : THEME.good
      ctx.strokeStyle = color
      ctx.lineWidth = crossing ? 3 : 2
      if (crossing || solved) glow(ctx, color, 8)
      ctx.globalAlpha = solved && !animating ? 0.9 : 1
      ctx.beginPath()
      ctx.moveTo(pos(e.a).x, pos(e.a).y)
      ctx.lineTo(pos(e.b).x, pos(e.b).y)
      ctx.stroke()
      noGlow(ctx)
      ctx.globalAlpha = 1
    }

    // 顶点：拖动中放大发光白环。
    for (let i = 0; i < state.vertices.length; i += 1) {
      const p = pos(i)
      const dragging = i === state.dragIndex
      const r = dragging ? VERTEX_R + 2.5 : VERTEX_R
      const color = solved ? THEME.gold : dragging ? accent(3) : accent(5)
      glow(ctx, color, dragging ? 16 : 8)
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      ctx.fill()
      noGlow(ctx)
      ctx.strokeStyle = 'rgba(16,16,26,0.85)'
      ctx.lineWidth = 2
      ctx.stroke()
      if (dragging) {
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    particles.tick(ctx, 16)

    // HUD（左列 2 行，右列 3 行右锚定，两列横向相距充足不重叠）。
    hudPair(ctx, 16, 26, '关卡', (state.levelIndex + 1) + '/' + LEVEL_COUNT)
    hudPair(ctx, 16, 46, '总分', String(totalScore(state)))
    const pairs = countCrossings(state.vertices, state.edges)
    hudPair(ctx, W - 16, 26, '交叉', String(pairs), 'right', pairs === 0 ? THEME.good : THEME.bad)
    hudPair(ctx, W - 16, 46, '步数', String(state.moves), 'right')
    hudPair(ctx, W - 16, 66, '用时', clockText(state.timeMs), 'right')

    if (view.paused && state.phase === 'playing') {
      drawOverlay(ctx, W, H, '暂停', 'P 继续 · R 重开本关')
    } else if (state.phase === 'won') {
      drawOverlay(ctx, W, H, '解开啦', '本关 +' + state.levelScore + ' 分 · 即将进入下一关', THEME.good)
    } else if (state.phase === 'allwon') {
      drawOverlay(ctx, W, H, '全部通关', '总分 ' + totalScore(state) + ' · R 再来一局', THEME.gold)
    }

    // 说明按钮 + 帮助面板：永远画在最上层（渲染函数末尾）。
    const hb = HELP_BTN
    ctx.fillStyle = THEME.panel
    roundRectPath(ctx, hb.x, hb.y, hb.w, hb.h, 8)
    ctx.fill()
    ctx.strokeStyle = view.helpOpen ? accent(2) : THEME.panelEdge
    ctx.lineWidth = view.helpOpen ? 2 : 1
    ctx.stroke()
    ctx.lineWidth = 1
    ctx.textAlign = 'center'
    ctx.font = '600 13px system-ui, sans-serif'
    ctx.fillStyle = view.helpOpen ? accent(2) : THEME.textMuted
    ctx.fillText('说明', hb.x + hb.w / 2, hb.y + 16.5)
    if (view.helpOpen) {
      ctx.fillStyle = 'rgba(13,13,20,0.92)'
      roundRectPath(ctx, HELP_PANEL.x, HELP_PANEL.y, HELP_PANEL.w, HELP_PANEL.h, 10)
      ctx.fill()
      ctx.strokeStyle = THEME.panelEdge
      ctx.stroke()
      ctx.textAlign = 'left'
      HELP_LINES.forEach((line, i) => {
        ctx.font = i === 0 ? 'bold 16px system-ui, sans-serif' : '600 15px system-ui, sans-serif'
        ctx.fillStyle = i === 0 ? accent(2) : THEME.text
        ctx.fillText(line, HELP_PANEL.x + 16, HELP_PANEL.y + 30 + i * 24)
      })
    }
  }

  return {
    draw,
    burst(x, y, color = THEME.gold): void {
      particles.burst(x, y, color, 14, 150)
    },
    busy(): boolean {
      return particles.size() > 0
    },
  }
}

