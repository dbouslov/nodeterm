import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Structural, like control-destructive.test.ts: the dispatch lives inside Canvas.tsx's IPC
// listener, so the source is the subject. These pin the Dock wiring (T8).
const src = readFileSync(new URL('./Canvas.tsx', import.meta.url), 'utf8')

function caseBody(verb: string): string {
  const start = src.indexOf(`case '${verb}': {`)
  if (start === -1) return ''
  const rest = src.slice(start + verb.length + 10)
  const end = rest.search(/\n {10}case '/)
  return end === -1 ? rest : rest.slice(0, end)
}

describe('pin --set dock (the mark)', () => {
  const body = caseBody('pin')
  const dockLeg = body.slice(body.indexOf('alwaysConfirms(verb, args)'), body.indexOf('// end dock mark'))

  it('the confirm lives only in the dock leg, which the routing picks by argument', () => {
    expect(body).toContain('alwaysConfirms(verb, args)')
    expect(dockLeg).toContain('setConfirm({')
    expect(body.split('setConfirm({').length - 1).toBe(1)
    expect(dockLeg).toContain("'denied by user'")
    expect(dockLeg).toContain('expiresAt: confirmExpiresAt(')
  })

  it('can never be waived', () => {
    expect(body).not.toContain('controlConfirmDecision(')
    expect(body).not.toMatch(/waiveVerb:/)
  })

  it('gates on the caller before asking, and again on confirm', () => {
    expect(dockLeg.split('dockMarkRefusal(').length - 1).toBe(2)
    expect(dockLeg).toContain('sourceNodeId')
  })

  it('plain on|off stays as it was: no confirm on that path', () => {
    const plain = body.slice(body.indexOf('// end dock mark'))
    expect(plain).not.toContain('setConfirm(')
    expect(plain).toContain("const on = args.set === 'on'")
  })
})
