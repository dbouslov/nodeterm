import type { MenuItem } from '../components/ContextMenu'
import { IconLock, IconPin, IconTrash, IconUngroup } from '../components/icons'

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
