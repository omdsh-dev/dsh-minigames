// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderBloom } from '../src/client/games/bloom/render.ts'
import { clickCell, generateBoard } from '../src/client/games/bloom/logic.ts'

function makeCtx(): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas')
  canvas.width = 960
  canvas.height = 600
  return canvas.getContext('2d')!
}

describe('bloom render crash hunt', () => {
  it('renders full playthrough without throwing', () => {
    for (const seed of [123, 456, 789, 2024]) {
      const st = generateBoard(1, seed)
      if (st === null) continue
      const ctx = makeCtx()
      let steps: Array<{ index: number, layer: number }> = []
      let t = 0
      while (st.status === 'playing') {
        let idx = -1
        for (let i = 0; i < st.grid.length; i += 1) if (st.grid[i].kind === 'bud') { idx = i; break }
        if (idx < 0) break
        const r = clickCell(st, idx)
        if (r === null) break
        steps = r.steps
        t = 0
        for (let frameNo = 0; frameNo < 240; frameNo += 1) {
          t += 0.016
          let maxLayer = 0
          for (const s of steps) if (s.layer > maxLayer) maxLayer = s.layer
          const anim = t < maxLayer * 0.4 + 1.6 ? { steps, t } : null
          renderBloom(ctx, st, { paused: false, helpOpen: false, hoverIndex: -1, cursorIndex: -1, anim, winText: null }, undefined, 16)
        }
      }
      renderBloom(ctx, st, { paused: false, helpOpen: false, hoverIndex: -1, cursorIndex: -1, anim: null, winText: null }, undefined, 16)
      console.log('seed', seed, 'settled:', st.status)
      expect(true).toBe(true)
    }
  })
})
