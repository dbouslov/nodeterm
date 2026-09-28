// The Dock seat's helper-count chip (T8). A chat inside the Dock draws no helper cards
// (`fanoutHidden`), so its header says what it has instead: "3 helpers", plus a loop glyph when a
// cron or loop is armed. Header-only, no size change; absent when there is nothing to say.

export interface HelperChip {
  text: string
  loop: boolean
}

export function helperChip(helpers: number, loopArmed: boolean): HelperChip | null {
  if (helpers > 0) return { text: `${helpers} helper${helpers === 1 ? '' : 's'}`, loop: loopArmed }
  return loopArmed ? { text: 'loop', loop: true } : null
}
