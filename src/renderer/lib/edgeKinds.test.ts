import { describe, it, expect } from 'vitest'
import { KIND_ORDER, lookOf, edgeAnimated, SELECTED_COLOR, DRIVEN_COLOR, type EdgeKind } from './edgeKinds'
import { ROPE_NEUTRAL } from './edgeModel'

const KINDS: EdgeKind[] = ['context', 'note', 'rope', 'fanout', 'trigger', 'annotation', 'handoff']

describe('edge look table', () => {
  it('every kind has a look and KIND_ORDER lists each exactly once', () => {
    for (const k of KINDS) expect(lookOf(k)).toBeTruthy()
    expect([...KIND_ORDER].sort()).toEqual([...KINDS].sort())
  })
  it('no two kinds share both hue and dash (decision 1: colourblind-safe)', () => {
    const seen = new Set<string>()
    for (const k of KINDS) {
      const l = lookOf(k, { agentColor: '#d97757' })
      const key = `${l.color}|${l.dash ?? 'solid'}`
      expect(seen.has(key), `${k} collides on ${key}`).toBe(false)
      seen.add(key)
    }
  })
  it('context: accent token, solid, arrows both ends; note: dotted, one arrow', () => {
    expect(lookOf('context')).toMatchObject({ color: 'var(--edge-context)', dash: null, width: 2, arrowStart: true, arrowEnd: true })
    expect(lookOf('note')).toMatchObject({ color: 'var(--edge-note)', dash: '2 4', arrowStart: false, arrowEnd: true })
  })
  it('rope: agent colour or neutral; dashed and animated only while waiting', () => {
    expect(lookOf('rope', { agentColor: '#10a37f' })).toMatchObject({ color: '#10a37f', dash: null, animated: false })
    expect(lookOf('rope')).toMatchObject({ color: ROPE_NEUTRAL })
    expect(lookOf('rope', { agentColor: '#10a37f', waiting: true })).toMatchObject({ dash: '6 4', animated: true })
  })
  it('fanout: parent colour at 0.55, dash-dot, no arrows, animated while working', () => {
    expect(lookOf('fanout', { agentColor: '#4285f4', working: true })).toMatchObject({ color: '#4285f4', opacity: 0.55, dash: '8 3 2 3', arrowEnd: false, animated: true })
    expect(lookOf('fanout', { agentColor: '#4285f4' }).animated).toBe(false)
  })
  it('overlays apply in order: driven, then selected wins', () => {
    expect(lookOf('rope', { agentColor: '#10a37f', driven: true })).toMatchObject({ color: DRIVEN_COLOR, width: 2.5, animated: true })
    expect(lookOf('rope', { agentColor: '#10a37f', driven: true }, true)).toMatchObject({ color: SELECTED_COLOR, width: 4 })
    expect(lookOf('context', undefined, true)).toMatchObject({ color: SELECTED_COLOR, width: 3.5 })
  })
  it('edgeAnimated agrees with lookOf', () => {
    expect(edgeAnimated('rope', { waiting: true })).toBe(true)
    expect(edgeAnimated('trigger')).toBe(false)
  })
  it('handoff uses a diamond head; everything else a triangle', () => {
    expect(lookOf('handoff').arrowShape).toBe('diamond')
    expect(lookOf('context').arrowShape).toBe('triangle')
  })
})
