export const PALETTE = {
  paper: '#edf7fe',
  card: '#ffffff',
  panel: '#f9fafb',
  ink: '#002a54',
  muted: '#49545c',
  faint: '#68717a',
  divider: '#d1d4d6',
  accent: '#5a58eb',
  accentSoft: '#dfe5fb',
  accentPaper: '#eef2ff',
  onAccent: '#ffffff',
  create: '#abf6d3',
  update: '#fff38e',
  replace: '#f9c8c7',
  delete: '#fbe1e1',
  drift: '#e5e6e8',
  pendingDrift: '#ffe48b',
  info: '#d3e4f9',
  warning: '#fff2c9',
  removedBg: '#fef2f2',
  removedInk: '#7c1918',
  addedBg: '#ecfdf5',
  addedInk: '#034f3b',
  danger: '#eb3233',
  dangerInk: '#ad080a',
  ok: '#009c69',
  okInk: '#034f3b',
  warnInk: '#ba4e11',
  logBg: '#0c1926',
  logInk: '#f3f4f4',
  pillCard: '#006fd7',
  pillNeutral: '#68717a',
  pillCreate: '#007d57',
  pillUpdate: '#8c7c16',
  pillDanger: '#eb3233',
  pillPending: '#ba4e11',
  pillInfo: '#0074f8',
} as const

export const PILL_FILLS = [
  PALETTE.pillCard,
  PALETTE.accent,
  PALETTE.pillNeutral,
  PALETTE.pillCreate,
  PALETTE.pillUpdate,
  PALETTE.pillDanger,
  PALETTE.pillPending,
  PALETTE.pillInfo,
] as const

export function pillHoverFill(fill: string): string {
  const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16)

  return `#${[1, 3, 5]
    .map(at => {
      const v = channel(fill, at)

      return Math.round(v + (channel(PALETTE.ink, at) - v) * 0.2).toString(16).padStart(2, '0')
    })
    .join('')}`
}

export const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace'

export const LABEL_WIDTH = 13

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
}

export function bannerSvg(title: string, subtitle: string): string {
  const font = escapeXml(MONO_FONT)

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="76" viewBox="0 0 480 76">',
    `<rect x="5" y="5" width="474" height="70" fill="${PALETTE.ink}"/>`,
    `<rect x="1" y="1" width="472" height="68" fill="${PALETTE.card}" stroke="${PALETTE.ink}" stroke-width="2"/>`,
    `<text x="18" y="32" font-family="${font}" font-size="22" font-weight="700" letter-spacing="3" fill="${PALETTE.ink}">${escapeXml(title)}</text>`,
    `<text x="18" y="54" font-family="${font}" font-size="13" letter-spacing="1" fill="${PALETTE.muted}">${escapeXml(subtitle)}</text>`,
    '</svg>',
  ].join('')
}

export function metaLabel(label: string): string {
  return label.toUpperCase().padEnd(LABEL_WIDTH, ' ')
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

export type ChipSvg = { source: string; width: number; height: number; alt: string }

export function chipSvg(text: string, fill: string, ink: string): ChipSvg {
  const label = text.toUpperCase()
  const width = Math.ceil(16 + [...label].length * 7.4)
  const height = 22
  const source = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect x="0.75" y="0.75" width="${width - 1.5}" height="${height - 1.5}" fill="${fill}" stroke="${PALETTE.ink}" stroke-width="1.5"/>`,
    `<text x="8" y="15" font-family="${escapeXml(MONO_FONT)}" font-size="11" font-weight="600" letter-spacing="0.5" fill="${ink}">${escapeXml(label)}</text>`,
    '</svg>',
  ].join('')

  return { source, width, height, alt: label }
}
