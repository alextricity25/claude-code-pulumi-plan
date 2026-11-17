import type { PlanTheme } from '../types'

export const DEFAULT_PALETTE = {
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
  riskLow: '#abf6d3',
  riskMedium: '#ffe48b',
  riskHigh: '#ad080a',
} as const

export type PaletteKey = keyof typeof DEFAULT_PALETTE

export type Palette = Record<PaletteKey, string>

export const PILL_KEYS = [
  'pillCard',
  'accent',
  'pillNeutral',
  'pillCreate',
  'pillUpdate',
  'pillDanger',
  'pillPending',
  'pillInfo',
] as const satisfies readonly PaletteKey[]

export type PillKey = (typeof PILL_KEYS)[number]

export function pillHoverFill(fill: string, ink: string = DEFAULT_PALETTE.ink): string {
  const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16)

  return `#${[1, 3, 5]
    .map(at => {
      const v = channel(fill, at)

      return Math.round(v + (channel(ink, at) - v) * 0.2).toString(16).padStart(2, '0')
    })
    .join('')}`
}

export const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace'

export type Theme = { palette: Palette; font: string }

export const DEFAULT_THEME: Theme = { palette: DEFAULT_PALETTE, font: MONO_FONT }

const THEME_HEX = /^#[0-9a-fA-F]{6}$/

const THEME_FONT_LIMIT = 200

export type ParsedTheme = { theme: PlanTheme; problems: string[] }

export type ThemeLoad = ParsedTheme & { path: string | null; isFound: boolean }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPaletteKey(key: string): key is PaletteKey {
  return Object.hasOwn(DEFAULT_PALETTE, key)
}

function isFont(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= THEME_FONT_LIMIT
}

function shown(value: unknown): string {
  const json = JSON.stringify(value) ?? String(value)

  return json.length > 40 ? `${json.slice(0, 39)}…` : json
}

export function parseTheme(text: string): ParsedTheme {
  let root: unknown
  try {
    root = JSON.parse(text)
  } catch (error) {
    return { theme: { colors: {} }, problems: [`not valid JSON: ${error instanceof Error ? error.message : String(error)}`] }
  }
  if (!isRecord(root)) {
    return { theme: { colors: {} }, problems: [`the file must hold a JSON object, not ${shown(root)}`] }
  }
  const problems = Object.keys(root)
    .filter(key => key !== 'colors' && key !== 'font')
    .map(key => `${shown(key)} is not read: only "colors" and "font" are`)
  const colors: Record<string, string> = {}
  const given = root.colors === undefined ? {} : root.colors
  if (!isRecord(given)) {
    problems.push(`"colors" must be an object of palette keys to "#rrggbb" colours, not ${shown(given)}`)
  } else {
    for (const [key, value] of Object.entries(given)) {
      if (!isPaletteKey(key)) {
        problems.push(`${shown(key)} in "colors" is not a palette key`)
      } else if (typeof value !== 'string') {
        problems.push(`${shown(key)} in "colors" is ${shown(value)}, not a string`)
      } else if (!THEME_HEX.test(value)) {
        problems.push(`${shown(key)} in "colors" is ${shown(value)}, not a "#rrggbb" colour`)
      } else {
        colors[key] = value
      }
    }
  }
  if (root.font !== undefined && !isFont(root.font)) {
    problems.push(`"font" is ${shown(root.font)}, not a CSS font-family string of 1 to ${THEME_FONT_LIMIT} characters`)
  }

  return { theme: isFont(root.font) ? { colors, font: root.font } : { colors }, problems }
}

export function resolveTheme(theme: PlanTheme): Theme {
  const palette: Palette = { ...DEFAULT_PALETTE }
  for (const [key, value] of Object.entries(theme.colors)) {
    if (isPaletteKey(key) && THEME_HEX.test(value)) {
      palette[key] = value
    }
  }

  return { palette, font: isFont(theme.font) ? theme.font : MONO_FONT }
}

export function describeTheme(load: ThemeLoad): string {
  if (load.path === null) {
    return 'HOME is not set, so there is no theme file to read: the Pulumi plan pane keeps its default look.'
  }
  if (!load.isFound) {
    return `No theme file at ${load.path}: the Pulumi plan pane uses its default look.`
  }
  const { colors, font } = load.theme
  const lines = [
    `Theme file ${load.path}: ${plural(Object.keys(colors).length, 'colour override')} and ${font === undefined ? 'no font override' : `the font ${JSON.stringify(font)}`} in effect.`,
  ]
  if (load.problems.length > 0) {
    lines.push(`${plural(load.problems.length, 'problem')}, each ignored (what it names keeps its default):`, ...load.problems.map(p => `- ${p}`))
  }

  return lines.join('\n')
}

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

export function bannerSvg(title: string, subtitle: string, theme: Theme = DEFAULT_THEME): string {
  const font = escapeXml(theme.font)
  const P = theme.palette

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="76" viewBox="0 0 480 76">',
    `<rect x="5" y="5" width="474" height="70" fill="${P.ink}"/>`,
    `<rect x="1" y="1" width="472" height="68" fill="${P.card}" stroke="${P.ink}" stroke-width="2"/>`,
    `<text x="18" y="32" font-family="${font}" font-size="22" font-weight="700" letter-spacing="3" fill="${P.ink}">${escapeXml(title)}</text>`,
    `<text x="18" y="54" font-family="${font}" font-size="13" letter-spacing="1" fill="${P.muted}">${escapeXml(subtitle)}</text>`,
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

export function chipSvg(text: string, fill: string, ink: string, theme: Theme = DEFAULT_THEME): ChipSvg {
  const label = text.toUpperCase()
  const width = Math.ceil(16 + [...label].length * 7.4)
  const height = 22
  const source = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect x="0.75" y="0.75" width="${width - 1.5}" height="${height - 1.5}" fill="${fill}" stroke="${theme.palette.ink}" stroke-width="1.5"/>`,
    `<text x="8" y="15" font-family="${escapeXml(theme.font)}" font-size="11" font-weight="600" letter-spacing="0.5" fill="${ink}">${escapeXml(label)}</text>`,
    '</svg>',
  ].join('')

  return { source, width, height, alt: label }
}
