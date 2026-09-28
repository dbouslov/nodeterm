import type { MenuItem } from '../components/ContextMenu'
import { IconLock, IconPin, IconTrash, IconUngroup } from '../components/icons'
import { isDock, type DockShape } from '@shared/dock'

const WHY = 'The Dock stays put. Use Release Dock first.'
const inert = (): void => {}

/**
 * The frame menu of the Dock (@shared/dock), built from the frame alone: whatever it holds,
 * including nothing (its GO chat gone), David can always release it. The rows that would unpin,
 * dissolve or delete it stay visible but greyed, with the reason, so nothing silently vanishes.
 * Release is plain human UI: `release` only clears the mark.
 */
export function dockFrameMenu(release: () => void): MenuItem[] {
  return [
    { type: 'label', label: 'Dock' },
    { label: 'Unpin frame', icon: <IconPin />, disabled: true, hint: WHY, onClick: inert },
    { label: 'Ungroup', icon: <IconUngroup />, disabled: true, hint: WHY, onClick: inert },
    { label: 'Delete (keeps nodes)', icon: <IconTrash />, disabled: true, hint: WHY, onClick: inert },
    { type: 'separator' },
    {
      label: 'Release Dock',
      icon: <IconLock />,
      hint: 'Turn the Dock back into an ordinary pinned frame.',
      onClick: release
    }
  ]
}

/** The frame-menu choice, pure: the Dock's own menu for the Dock (whatever it holds, including
 *  nothing), the ordinary frame menu (`normal`, built only when needed) for anything else. */
export function frameMenuFor(
  groupId: string,
  nodes: readonly DockShape[],
  release: (groupId: string) => void,
  normal: () => MenuItem[]
): MenuItem[] {
  return isDock(nodes.find((n) => n.id === groupId)) ? dockFrameMenu(() => release(groupId)) : normal()
}
