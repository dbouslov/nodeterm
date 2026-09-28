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

/** The body of a `const <name> = useCallback(` in Canvas.tsx, up to the next top-level const. */
function callbackBody(name: string): string {
  const start = src.indexOf(`const ${name} = useCallback(`)
  if (start === -1) return ''
  const rest = src.slice(start + 1)
  const end = rest.search(/\n {2}const [A-Za-z]+ = /)
  return end === -1 ? rest : rest.slice(0, end)
}

describe('Dock guards: every path (T8 step 4)', () => {
  it('the close verb refuses the Dock and its pages before any confirm', () => {
    const body = caseBody('close')
    const at = body.indexOf("dockRefusal(ctlNodes(), 'close', closeIds)")
    expect(at).toBeGreaterThan(-1)
    expect(at).toBeLessThan(body.indexOf('setConfirm({'))
    expect(at).toBeLessThan(body.indexOf('controlConfirmDecision('))
  })
  it('the ungroup verb refuses the Dock', () => {
    expect(caseBody('ungroup')).toContain("dockRefusal(live, 'ungroup', [gid])")
  })
  it('the move verb refuses move-out and moving the Dock', () => {
    expect(caseBody('move')).toContain("dockRefusal(live, 'move', ids, targetGroup, ")
  })
  it('pin --set off refuses the Dock', () => {
    expect(caseBody('pin')).toContain("dockRefusal(nodesRef.current as CanvasNode[], 'unpin', [id])")
  })
  it('deleteNodes and closeStoredNodes never remove the Dock frame (Cmd+W, menu, kanban, retire, off-screen)', () => {
    expect(callbackBody('deleteNodes')).toContain('withoutDock(')
    expect(callbackBody('closeStoredNodes')).toContain('withoutDock(')
  })
  it('the UI Ungroup and Unpin skip the Dock', () => {
    expect(callbackBody('ungroup')).toMatch(/isDock\(/)
    expect(callbackBody('setPinned')).toContain('withoutDock(')
  })
  it('the frame menu of a Dock is the Dock menu, chosen by the frame alone', () => {
    const body = callbackBody('groupItems')
    const at = body.indexOf('dockFrameMenu(')
    expect(at).toBeGreaterThan(-1)
    // Chosen before anything reads selection or children.
    expect(at).toBeLessThan(body.indexOf('selectedIds'))
  })
  it('Release Dock is human UI only: it never closes, ungroups, confirms or goes through a control verb', () => {
    const body = callbackBody('releaseDock')
    expect(body).not.toBe('')
    for (const bad of ['deleteNodes', 'closeStoredNodes', 'ungroup', 'setConfirm', 'controlConfirmDecision', 'reply(', 'window.api']) {
      expect(body).not.toContain(bad)
    }
    expect(body).toContain('fixture: undefined')
  })
})

describe('Dock placement rules on the live and cold open paths (review fix 3)', () => {
  it('resolveIntoGroup refuses through dockOpenRefusal before any --group is used', () => {
    const at = src.indexOf('const resolveIntoGroup = ')
    const body = src.slice(at, src.indexOf('const resolveAfter = ', at))
    expect(body).toContain('dockOpenRefusal(ctlNodes(), verb, sourceNodeId, ')
    // Checked before the "no --group" early return, so an implicit open is covered too.
    expect(body.indexOf('dockOpenRefusal(')).toBeLessThan(body.indexOf('if (!args.group) return undefined'))
  })
  it('the cold open refuses the same way', () => {
    expect(src).toContain('dockOpenRefusal(coldNodes, verb, coldSrc.id, ')
  })
  it('move passes the caller, so only a Dock member moves nodes in', () => {
    expect(caseBody('move')).toContain("dockRefusal(live, 'move', ids, targetGroup, sourceNodeId)")
  })
})
