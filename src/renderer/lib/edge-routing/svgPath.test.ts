import { describe, it, expect } from 'vitest'
import { svgPathFrom, arrowheadPoints } from './svgPath'

describe('svgPathFrom', () => {
  it('a straight line is M + L', () => {
    expect(svgPathFrom([{ x: 0, y: 0 }, { x: 100, y: 0 }])).toBe('M 0 0 L 100 0')
  })
  it('a corner becomes an arc of the radius, clamped to half the shorter leg', () => {
    const d = svgPathFrom([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 10 }], 8)
    // shorter leg is 10 ⇒ radius 5
    expect(d).toBe('M 0 0 L 95 0 A 5 5 0 0 1 100 5 L 100 10')
  })
  it('uses only M, L and A commands', () => {
    const d = svgPathFrom([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }])
    expect(d.replace(/[MLA0-9.\s-]/g, '')).toBe('')
  })
})

describe('arrowheadPoints', () => {
  it('points left-to-right at the end of a rightward last segment', () => {
    expect(arrowheadPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }], 'end', 'triangle', 7)).toBe('100,0 93,-3.5 93,3.5')
  })
  it('points downward at the end of a downward last segment', () => {
    expect(arrowheadPoints([{ x: 0, y: 0 }, { x: 0, y: 100 }], 'end', 'triangle', 7)).toBe('0,100 -3.5,93 3.5,93')
  })
  it('a start arrow points back along the first segment', () => {
    expect(arrowheadPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }], 'start', 'triangle', 7)).toBe('0,0 7,-3.5 7,3.5')
  })
  it('a diamond has four points', () => {
    expect(arrowheadPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }], 'end', 'diamond', 7).split(' ')).toHaveLength(4)
  })
})
