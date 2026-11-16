import { describe, expect, test } from 'claude-code/testing'

import { URNS, applyPreview, baselinePreview, branchPreview, toRun } from './fixtures'
import type { PlanGit, PlanRun } from '../types'
import { sameTargets } from './apply'
import { baselineAlone, buildSteps, changeOnly, compare, cutSubject, diffHunk, gitLine, lookup, parsePreview, refNames } from './plan'
import type { Card } from './plan'

const urnsOf = (entries: readonly { step: { urn: string } }[]) => entries.map(e => e.step.urn)

describe('change only', () => {
  const applyCard = (run: PlanRun, baseline: PlanRun | undefined): Card => ({
    id: 'card',
    run,
    baseline,
    isBaselineOnly: false,
    isApply: true,
    comparison: compare(run, baseline),
  })
  const drift = {
    op: 'update',
    urn: URNS.SVC,
    oldState: { urn: URNS.SVC, id: 'w', inputs: { port: 80 } },
    newState: { urn: URNS.SVC, inputs: { port: 81 } },
    detailedDiff: { port: { kind: 'update' } },
  }
  const apply = toRun(
    {
      steps: [
        { op: 'delete', urn: URNS.OLD, oldState: { urn: URNS.OLD, id: 'o', inputs: { name: 'legacy' } } },
        {
          op: 'update',
          urn: URNS.MAP,
          oldState: { urn: URNS.MAP, id: 'm', inputs: { a: 1 } },
          newState: { urn: URNS.MAP, inputs: { a: 2 } },
          detailedDiff: { a: { kind: 'update' } },
        },
        { op: 'create', urn: URNS.NEW, newState: { urn: URNS.NEW, inputs: { name: 'jobs' } } },
        drift,
        { op: 'read', urn: URNS.LOOKUP, newState: { urn: URNS.LOOKUP, id: 'z' } },
      ],
    },
    'apply',
  )
  const baseline = toRun({ steps: [drift] }, 'baseline')

  test('the change steps and their URNs come in create, update, replace, delete order', async () => {
    const offer = changeOnly(applyCard(apply, baseline))
    expect(offer).toEqual({ steps: expect.any(Array), targets: [URNS.NEW, URNS.MAP, URNS.OLD] })
    expect(offer !== null && 'steps' in offer ? offer.steps.map(step => step.category) : []).toEqual(['create', 'update', 'delete'])
  })

  test('nothing is offered without a paired baseline, with registered targets, with no drift or with no change', async () => {
    expect(changeOnly(applyCard(apply, undefined))).toBeNull()
    expect(changeOnly(applyCard({ ...apply, targets: [URNS.NEW] }, baseline))).toBeNull()
    expect(changeOnly(applyCard(apply, toRun({ steps: [] }, 'baseline')))).toBeNull()
    const same = toRun(applyPreview('dev'), 'apply')
    expect(changeOnly(applyCard(same, toRun(applyPreview('dev'), 'baseline')))).toBeNull()
    expect(changeOnly({ ...applyCard(apply, baseline), isApply: false })).toBeNull()
  })

  test('a change step on a resource with pending drift blocks it with the reason', async () => {
    const branch = toRun(branchPreview, 'apply')
    expect(changeOnly(applyCard(branch, toRun(baselinePreview, 'baseline')))).toEqual({
      blocked: '1 change step touches a resource that also has pending drift, so --target would apply that drift too',
    })
  })

  test('targets compare as sets', async () => {
    expect(sameTargets([URNS.NEW, URNS.MAP], [URNS.MAP, URNS.NEW])).toBe(true)
    expect(sameTargets([URNS.NEW, URNS.NEW], [URNS.NEW])).toBe(true)
    expect(sameTargets([URNS.NEW], [URNS.NEW, URNS.MAP])).toBe(false)
    expect(sameTargets([URNS.NEW], [URNS.MAP])).toBe(false)
  })
})

describe('compare', () => {
  const baseline = toRun(baselinePreview, 'baseline')
  const branch = toRun(branchPreview, 'branch', 'T-1')
  const result = compare(branch, baseline)

  test('a step only in the branch run is change', async () => {
    expect(urnsOf(result.change.create)).toEqual([URNS.NEW])
  })

  test('a step identical in both runs is drift', async () => {
    expect(urnsOf(result.drift.update)).toContain(URNS.MAP)
    expect(urnsOf(result.change.update)).not.toContain(URNS.MAP)
  })

  test('the same resource with different props is change that overlaps drift', async () => {
    expect(result.change.update).toEqual([expect.objectContaining({ tags: ['overlaps drift'] })])
    expect(urnsOf(result.change.update)).toEqual([URNS.SVC])
  })

  test('an opaque update in both runs is drift tagged opaque', async () => {
    const entry = result.drift.update.find(e => e.step.urn === URNS.SECRET)
    expect(entry?.step.isOpaque).toBe(true)
    expect(entry?.tags).toEqual(['opaque'])
  })

  test('a step only in the baseline is listed as baseline only', async () => {
    expect(urnsOf(result.baselineOnly)).toEqual([URNS.OLD])
  })

  test('reads are neither change nor drift', async () => {
    expect(urnsOf(result.other)).toEqual([URNS.LOOKUP])
    const counted = [...Object.values(result.change), ...Object.values(result.drift)].flat()
    expect(urnsOf(counted)).not.toContain(URNS.LOOKUP)
    expect(urnsOf(result.baselineOnly)).not.toContain(URNS.LOOKUP)
  })

  test('a replacement is one entry with its reasons and props merged', async () => {
    expect(result.change.replace).toHaveLength(1)
    const step = result.change.replace[0]?.step
    expect(step?.ops).toEqual(['create-replacement', 'delete-replaced'])
    expect(step?.replaceReasons).toEqual(['size', 'zone'])
    expect(step?.props).toEqual([{ path: 'size', kind: 'update-replace', old: '10', new: '20' }])
  })

  test('a diagnostic with the same text in the baseline is drift', async () => {
    expect(result.driftDiagnostics.map(d => d.message)).toEqual(['shared note'])
    expect(result.newDiagnostics.map(d => d.message)).toEqual(['new warning'])
  })

  test('with no baseline every step is change', async () => {
    const alone = compare(branch, undefined)
    expect(alone.hasBaseline).toBe(false)
    expect(urnsOf(alone.change.update).sort()).toEqual([URNS.MAP, URNS.SECRET, URNS.SVC].sort())
    expect(alone.newDiagnostics).toHaveLength(2)
  })

  test('a baseline with no branch run puts every step under drift', async () => {
    const alone = baselineAlone(baseline)
    expect(urnsOf(alone.drift.delete)).toEqual([URNS.OLD])
    expect(Object.values(alone.change).flat()).toHaveLength(0)
  })
})

describe('steps', () => {
  test('an update with an empty detailedDiff falls back to a deep diff of inputs', async () => {
    const { steps } = buildSteps([
      {
        op: 'update',
        urn: URNS.MAP,
        oldState: { inputs: { data: { a: 1, b: [1, 2] } } },
        newState: { inputs: { data: { a: 1, b: [1, 3] }, extra: 'x' } },
        detailedDiff: {},
      },
    ])
    expect(steps[0]?.isOpaque).toBe(false)
    expect(steps[0]?.props).toEqual([
      { path: 'data.b[1]', kind: 'update', old: '2', new: '3' },
      { path: 'extra', kind: 'add', new: 'x' },
    ])
  })

  test('create and delete list top-level inputs; delete leads with the id', async () => {
    const { steps } = buildSteps(parsePreview(JSON.stringify(branchPreview)).steps)
    const created = steps.find(s => s.category === 'create')
    expect(created?.props.map(p => p.path)).toEqual(['name', 'retries'])
    const deleted = toRun(baselinePreview, 'baseline').steps.find(s => s.category === 'delete')
    expect(deleted?.props.map(p => p.path)).toEqual(['id', 'name'])
  })

  test('values over the cap are cut with a marker', async () => {
    const { steps } = buildSteps([
      {
        op: 'update',
        urn: URNS.MAP,
        oldState: { inputs: { body: 'a'.repeat(5000) } },
        newState: { inputs: { body: 'b' } },
        detailedDiff: { body: { kind: 'update' } },
      },
    ])
    expect(steps[0]?.props[0]?.old).toMatch(/\[1000 of 5000 chars cut\]$/)
  })
})

describe('preview parsing', () => {
  test('noise before the first brace is skipped', async () => {
    const parsed = parsePreview(`warning: something\n${JSON.stringify(branchPreview)}`)
    expect(parsed.steps).toHaveLength(branchPreview.steps.length)
  })
})

describe('lookup', () => {
  const root = {
    values: { config: { receivers: { 'sqlquery/assistant': { queries: Array.from({ length: 11 }, (_, i) => ({ sql: `q${i}` })) } } } },
    'a.b': { c: true },
    list: [{ name: 'first' }],
  }

  test('keys holding a slash and [n] indexes resolve', async () => {
    expect(lookup(root, 'values.config.receivers.sqlquery/assistant.queries[10].sql')).toEqual({ isFound: true, value: 'q10' })
  })

  test('quoted segments resolve', async () => {
    expect(lookup(root, '["a.b"].c')).toEqual({ isFound: true, value: true })
    expect(lookup(root, 'list[0]["name"]')).toEqual({ isFound: true, value: 'first' })
  })

  test('a path into a JSON-encoded string resolves inside it', async () => {
    expect(lookup({ policy: '{"Statement":[{"Effect":"Allow"}]}' }, 'policy.Statement[0].Effect')).toEqual({
      isFound: true,
      value: 'Allow',
    })
  })

  test('a missing path is not found', async () => {
    expect(lookup(root, 'list[3].name').isFound).toBe(false)
  })
})

describe('diff hunks', () => {
  test('line counts match the lines', async () => {
    expect(diffHunk({ path: 'p', kind: 'update', old: 'a\nb', new: 'c' })).toBe('@@ -1,2 +1,1 @@\n-a\n-b\n+c')
    expect(diffHunk({ path: 'p', kind: 'add', new: 'x' })).toBe('@@ -0,0 +1,1 @@\n+x')
  })
})

describe('git line', () => {
  const HEAD = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555'
  const MAIN = 'ffff6666aaaa7777bbbb8888cccc9999dddd0000'
  const P1 = '1111aaaa2222bbbb3333cccc4444dddd5555eeee'
  const P2 = '6666ffff7777aaaa8888bbbb9999cccc0000dddd'
  const SUBJECT = "Merge branch 'demo-1' into 'main'"
  const git = (fields: Partial<Extract<PlanGit, { isAvailable: true }>> = {}): PlanGit => ({
    isAvailable: true,
    head: HEAD,
    branch: null,
    subject: SUBJECT,
    parents: [
      { sha: P1, refs: ['main'] },
      { sha: P2, refs: ['origin/demo-1'] },
    ],
    headRefs: [],
    dirtyCount: 0,
    ...fields,
  })

  test('a: on a branch', async () => {
    expect(gitLine(git({ branch: 'demo-1', originMain: MAIN, isOnMain: false })).text).toBe('demo-1 @ aaaa1111')
  })

  test('b: detached at origin/main, merge commit of main itself', async () => {
    expect(gitLine(git({ originMain: HEAD, isOnMain: true, behindMain: 0 })).text).toBe(
      `origin/main @ aaaa1111 · ${SUBJECT}`,
    )
  })

  test('c: detached on main behind origin/main', async () => {
    expect(gitLine(git({ originMain: MAIN, isOnMain: true, behindMain: 2 })).text).toBe(
      `aaaa1111 on main, 2 commits behind origin/main · ${SUBJECT}`,
    )
    expect(gitLine(git({ originMain: MAIN, isOnMain: true, behindMain: 1 })).text).toMatch(/, 1 commit behind origin\/main · /)
  })

  test('d: detached scratch merge not on main', async () => {
    expect(gitLine(git({ originMain: MAIN, isOnMain: false })).text).toBe(
      'origin/demo-1 @ 6666ffff merged onto main @ 1111aaaa (HEAD aaaa1111, detached)',
    )
  })

  test('e: other detached commits', async () => {
    const single = { parents: [{ sha: P1, refs: [] }] }
    expect(gitLine(git({ ...single, originMain: MAIN, isOnMain: false, headRefs: ['demo-2'] })).text).toBe(
      'demo-2 @ aaaa1111 (detached)',
    )
    expect(gitLine(git({ ...single, originMain: MAIN, isOnMain: false })).text).toBe('aaaa1111 (detached)')
  })

  test('a run stored before main ancestry was recorded still draws the old way', async () => {
    expect(gitLine(git()).text).toBe('origin/demo-1 @ 6666ffff merged onto main @ 1111aaaa (HEAD aaaa1111, detached)')
    expect(gitLine(git({ parents: [{ sha: P1, refs: [] }], headRefs: ['demo-2'], dirtyCount: 3 }))).toEqual({
      text: 'demo-2 @ aaaa1111 (detached)',
      dirty: '3 uncommitted files',
      isAvailable: true,
    })
  })

  test('refs: origin/main wins, remotes first, two names then +N, origin/HEAD dropped', async () => {
    expect(refNames(['main', 'demo-1', 'origin/main', 'origin/staging'])).toBe('origin/main')
    expect(refNames(['local-a', 'local-b', 'origin/x', 'origin/HEAD', 'origin', 'local-c'])).toBe('origin/x, local-a +2')
    expect(refNames(['origin/HEAD', 'origin'])).toBe('')
    expect(refNames(['one'])).toBe('one')
  })

  test('the subject is cut at 72 characters with an ellipsis', async () => {
    const long = 'x'.repeat(80)
    expect(cutSubject(long)).toBe(`${'x'.repeat(72)}…`)
    expect(cutSubject('x'.repeat(72))).toBe('x'.repeat(72))
    expect(gitLine(git({ originMain: HEAD, isOnMain: true, subject: `${long}\nbody` })).text).toBe(
      `origin/main @ aaaa1111 · ${'x'.repeat(72)}…`,
    )
  })
})
