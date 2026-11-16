import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_PALETTE, DEFAULT_THEME, MONO_FONT, bannerSvg, chipSvg, describeTheme, parseTheme, pillHoverFill, resolveTheme } from './style'

describe('theme file', () => {
  test('valid colours and a font overlay the defaults key by key', async () => {
    const parsed = parseTheme(JSON.stringify({ colors: { paper: '#101820', ink: '#F0F0F0' }, font: 'Iosevka, monospace' }))

    expect(parsed.problems).toEqual([])
    expect(parsed.theme).toEqual({ colors: { paper: '#101820', ink: '#F0F0F0' }, font: 'Iosevka, monospace' })
    const theme = resolveTheme(parsed.theme)
    expect(theme.palette).toEqual({ ...DEFAULT_PALETTE, paper: '#101820', ink: '#F0F0F0' })
    expect(theme.font).toBe('Iosevka, monospace')
  })

  test('{} and a file with only empty colours change nothing and report nothing', async () => {
    for (const text of ['{}', '{ "colors": {} }']) {
      const parsed = parseTheme(text)
      expect(parsed).toEqual({ theme: { colors: {} }, problems: [] })
      expect(resolveTheme(parsed.theme)).toEqual(DEFAULT_THEME)
    }
  })

  test('invalid JSON and a root that is not an object are one problem each and change nothing', async () => {
    for (const text of ['{ "colors": ', '', '[1, 2]', 'null', '"#000000"']) {
      const parsed = parseTheme(text)
      expect(parsed.theme).toEqual({ colors: {} })
      expect(parsed.problems).toHaveLength(1)
    }
    expect(parseTheme('{ "colors": ').problems[0]).toMatch(/^not valid JSON: /)
    expect(parseTheme('[1, 2]').problems[0]).toBe('the file must hold a JSON object, not [1,2]')
  })

  test('each bad entry is a problem and is ignored while the good ones apply', async () => {
    const parsed = parseTheme(
      JSON.stringify({
        colors: { paper: '#101820', paperr: '#000000', ink: 12, card: 'white', panel: '#fff', accent: '#5a58eb ' },
        font: '',
        colours: {},
      }),
    )

    expect(parsed.theme).toEqual({ colors: { paper: '#101820' } })
    expect(parsed.problems).toEqual([
      '"colours" is not read: only "colors" and "font" are',
      '"paperr" in "colors" is not a palette key',
      '"ink" in "colors" is 12, not a string',
      '"card" in "colors" is "white", not a "#rrggbb" colour',
      '"panel" in "colors" is "#fff", not a "#rrggbb" colour',
      '"accent" in "colors" is "#5a58eb ", not a "#rrggbb" colour',
      '"font" is "", not a CSS font-family string of 1 to 200 characters',
    ])
    expect(resolveTheme(parsed.theme).palette).toEqual({ ...DEFAULT_PALETTE, paper: '#101820' })
  })

  test('colors that is not an object, and a font that is not a string or too long, are problems', async () => {
    expect(parseTheme('{ "colors": ["#000000"] }').problems).toEqual([
      '"colors" must be an object of palette keys to "#rrggbb" colours, not ["#000000"]',
    ])
    expect(parseTheme('{ "colors": null }').problems).toHaveLength(1)
    expect(parseTheme('{ "font": 3 }')).toEqual({
      theme: { colors: {} },
      problems: ['"font" is 3, not a CSS font-family string of 1 to 200 characters'],
    })
    expect(parseTheme(JSON.stringify({ font: '   ' })).problems).toHaveLength(1)
    expect(parseTheme(JSON.stringify({ font: 'a'.repeat(201) })).problems).toHaveLength(1)
    expect(parseTheme(JSON.stringify({ font: 'a'.repeat(200) })).theme.font).toBe('a'.repeat(200))
  })

  test('a palette key inherited from Object is not a palette key', async () => {
    expect(parseTheme('{ "colors": { "constructor": "#000000", "__proto__": "#000000" } }').problems).toEqual([
      '"constructor" in "colors" is not a palette key',
      '"__proto__" in "colors" is not a palette key',
    ])
  })

  test('a stored theme with entries no file could pass is resolved to the defaults for them', async () => {
    const theme = resolveTheme({ colors: { paper: '"/><script>', nope: '#000000', ink: '#123456' }, font: '' })

    expect(theme.palette).toEqual({ ...DEFAULT_PALETTE, ink: '#123456' })
    expect(theme.font).toBe(MONO_FONT)
  })

  test('the report names the file, the overrides in effect and each problem', async () => {
    const path = '/home/u/.claude/pulumi-plan/theme.json'

    expect(describeTheme({ path: null, isFound: false, theme: { colors: {} }, problems: [] })).toMatch(/^HOME is not set/)
    expect(describeTheme({ path, isFound: false, theme: { colors: {} }, problems: [] })).toBe(
      `No theme file at ${path}: the Pulumi plan pane uses its default look.`,
    )
    expect(describeTheme({ path, isFound: true, theme: { colors: { paper: '#000000' }, font: 'Iosevka' }, problems: [] })).toBe(
      `Theme file ${path}: 1 colour override and the font "Iosevka" in effect.`,
    )
    expect(describeTheme({ path, isFound: true, ...parseTheme('{ "colors": { "ink": "red", "card": "#000000", "panel": "#111111" } }') })).toBe(
      [
        `Theme file ${path}: 2 colour overrides and no font override in effect.`,
        '1 problem, each ignored (what it names keeps its default):',
        '- "ink" in "colors" is "red", not a "#rrggbb" colour',
      ].join('\n'),
    )
  })
})

describe('themed drawing', () => {
  const dark = resolveTheme({ colors: { ink: '#e6edf3', card: '#161b22', muted: '#8b949e' }, font: 'Iosevka "Term"' })

  test('the banner and chips draw with the theme and escape its font', async () => {
    const banner = bannerSvg('PULUMI PLAN', 'DEMO', dark)
    expect(banner).toContain('fill="#e6edf3"')
    expect(banner).toContain('fill="#161b22" stroke="#e6edf3"')
    expect(banner).toContain('fill="#8b949e"')
    expect(banner).toContain('font-family="Iosevka &quot;Term&quot;"')
    expect(banner).not.toContain(DEFAULT_PALETTE.ink)

    const chip = chipSvg('drift 1', '#30363d', dark.palette.ink, dark)
    expect(chip.source).toContain('fill="#30363d" stroke="#e6edf3"')
    expect(chip.source).toContain('font-family="Iosevka &quot;Term&quot;"')
  })

  test('without a theme the banner and chips are what the defaults draw', async () => {
    expect(bannerSvg('A', 'B')).toBe(bannerSvg('A', 'B', resolveTheme({ colors: {} })))
    expect(chipSvg('x', DEFAULT_PALETTE.drift, DEFAULT_PALETTE.ink)).toEqual(
      chipSvg('x', DEFAULT_PALETTE.drift, DEFAULT_PALETTE.ink, resolveTheme({ colors: {} })),
    )
  })

  test('a pill darkens 20% toward the ink it is given', async () => {
    expect(pillHoverFill('#000000', '#ffffff')).toBe('#333333')
    expect(pillHoverFill('#006fd7')).toBe(pillHoverFill('#006fd7', DEFAULT_PALETTE.ink))
  })
})
