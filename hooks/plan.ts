import type {
  PlanCategory,
  PlanChangeCategory,
  PlanDiagnostic,
  PlanGit,
  PlanProp,
  PlanRun,
  PlanStep,
} from '../types'

export const CHANGE_CATEGORIES: readonly PlanChangeCategory[] = ['create', 'update', 'replace', 'delete']

const UPDATE_VALUE_CAP = 4000
const INVENTORY_VALUE_CAP = 2000
const DIAGNOSTIC_CAP = 4000
const MAX_PROPS = 200

type RawState = {
  id?: unknown
  type?: unknown
  inputs?: unknown
  outputs?: unknown
}

type RawDiffEntry = { kind?: unknown }

export type RawStep = {
  op?: unknown
  urn?: unknown
  provider?: unknown
  oldState?: RawState | null
  newState?: RawState | null
  diffReasons?: unknown
  replaceReasons?: unknown
  detailedDiff?: Record<string, RawDiffEntry> | null
}

export type RawDiagnostic = { message?: unknown; severity?: unknown; urn?: unknown }

export type Preview = {
  steps: RawStep[]
  diagnostics: RawDiagnostic[]
  duration: number | null
  changeSummary: Record<string, number> | null
}

export function parsePreview(text: string): Preview {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    if (start < 0) {
      throw new Error('no JSON object in the file')
    }
    try {
      json = JSON.parse(text.slice(start))
    } catch (second) {
      throw new Error(`not valid JSON: ${(second as Error).message}`)
    }
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error('the JSON is not an object')
  }
  const root = json as Record<string, unknown>
  if (!Array.isArray(root.steps)) {
    throw new Error('no steps array: is this `pulumi preview --json` output?')
  }

  return {
    steps: root.steps as RawStep[],
    diagnostics: Array.isArray(root.diagnostics) ? (root.diagnostics as RawDiagnostic[]) : [],
    duration: typeof root.duration === 'number' ? root.duration : null,
    changeSummary: isNumberRecord(root.changeSummary) ? root.changeSummary : null,
  }
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(v => typeof v === 'number')
  )
}

export type Urn = { stack: string; project: string; type: string; name: string }

export function parseUrn(urn: string): Urn | null {
  const parts = urn.split('::')
  const head = parts[0] ?? ''
  if (!head.startsWith('urn:pulumi:') || parts.length < 4) {
    return null
  }
  const chain = parts[2] ?? ''

  return {
    stack: head.slice('urn:pulumi:'.length),
    project: parts[1] ?? '',
    type: chain.split('$').pop() ?? chain,
    name: parts.slice(3).join('::'),
  }
}

export function deriveTarget(steps: readonly RawStep[]): { project: string; stack: string } | null {
  for (const step of steps) {
    const urn = typeof step.urn === 'string' ? parseUrn(step.urn) : null
    if (urn) {
      return { project: urn.project, stack: urn.stack }
    }
  }

  return null
}

export function categoryOf(op: string): PlanCategory {
  switch (op) {
    case 'create':
    case 'update':
    case 'delete':
    case 'replace':
      return op
    case 'create-replacement':
    case 'delete-replaced':
      return 'replace'
    default:
      return 'other'
  }
}

type Segment = string | number

export function parsePath(path: string): Segment[] {
  const segments: Segment[] = []
  let key = ''
  let hasKey = false
  let i = 0
  const flush = () => {
    if (hasKey) {
      segments.push(key)
    }
    key = ''
    hasKey = false
  }
  while (i < path.length) {
    const c = path[i]
    if (c === '.') {
      flush()
      i += 1
      continue
    }
    if (c === '[') {
      const index = /^\[(\d+)\]/.exec(path.slice(i))
      if (index) {
        flush()
        segments.push(Number(index[1]))
        i += index[0].length
        continue
      }
      if (path[i + 1] === '"') {
        flush()
        let j = i + 2
        let quoted = ''
        while (j < path.length && path[j] !== '"') {
          if (path[j] === '\\' && j + 1 < path.length) {
            j += 1
          }
          quoted += path[j]
          j += 1
        }
        segments.push(quoted)
        i = path[j + 1] === ']' ? j + 2 : j + 1
        continue
      }
    }
    key += c
    hasKey = true
    i += 1
  }
  flush()

  return segments
}

function parseJsonContainer(text: string): unknown {
  const start = text.trimStart()[0]
  if (start !== '{' && start !== '[') {
    return text
  }
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export function lookup(root: unknown, path: string): { isFound: boolean; value?: unknown } {
  let node: unknown = root
  for (const segment of parsePath(path)) {
    if (typeof node === 'string') {
      node = parseJsonContainer(node)
    }
    if (typeof segment === 'number' && Array.isArray(node) && segment < node.length) {
      node = node[segment]
      continue
    }
    if (
      typeof node === 'object' &&
      node !== null &&
      !Array.isArray(node) &&
      Object.prototype.hasOwnProperty.call(node, String(segment))
    ) {
      node = (node as Record<string, unknown>)[String(segment)]
      continue
    }

    return { isFound: false }
  }

  return { isFound: true, value: node }
}

export function valueText(value: unknown, cap: number): string {
  const text = typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? String(value))
  if (text.length <= cap) {
    return text
  }

  return `${text.slice(0, cap)}\n… [${text.length - cap} of ${text.length} chars cut]`
}

function pathKey(prefix: string, key: string): string {
  if (/^[^.[\]"]+$/.test(key)) {
    return prefix === '' ? key : `${prefix}.${key}`
  }

  return `${prefix}[${JSON.stringify(key)}]`
}

type DiffLeaf = { path: string; kind: string; old: { value: unknown } | null; new: { value: unknown } | null }

export function deepDiff(oldValue: unknown, newValue: unknown, prefix = ''): DiffLeaf[] {
  const isObject = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v)
  if (Array.isArray(oldValue) && Array.isArray(newValue)) {
    const leaves: DiffLeaf[] = []
    for (let i = 0; i < Math.max(oldValue.length, newValue.length); i += 1) {
      const path = `${prefix}[${i}]`
      if (i >= oldValue.length) {
        leaves.push({ path, kind: 'add', old: null, new: { value: newValue[i] } })
      } else if (i >= newValue.length) {
        leaves.push({ path, kind: 'delete', old: { value: oldValue[i] }, new: null })
      } else {
        leaves.push(...deepDiff(oldValue[i], newValue[i], path))
      }
    }

    return leaves
  }
  if (isObject(oldValue) && isObject(newValue)) {
    const oldRecord = oldValue as Record<string, unknown>
    const newRecord = newValue as Record<string, unknown>
    const keys = [...new Set([...Object.keys(oldRecord), ...Object.keys(newRecord)])].sort()
    const leaves: DiffLeaf[] = []
    for (const key of keys) {
      const path = pathKey(prefix, key)
      const hasOld = Object.prototype.hasOwnProperty.call(oldRecord, key)
      const hasNew = Object.prototype.hasOwnProperty.call(newRecord, key)
      if (!hasOld) {
        leaves.push({ path, kind: 'add', old: null, new: { value: newRecord[key] } })
      } else if (!hasNew) {
        leaves.push({ path, kind: 'delete', old: { value: oldRecord[key] }, new: null })
      } else {
        leaves.push(...deepDiff(oldRecord[key], newRecord[key], path))
      }
    }

    return leaves
  }
  if (JSON.stringify(oldValue) === JSON.stringify(newValue)) {
    return []
  }

  return [{ path: prefix, kind: 'update', old: { value: oldValue }, new: { value: newValue } }]
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function propsOfDiff(step: RawStep): PlanProp[] {
  const entries = Object.entries(step.detailedDiff ?? {})
  if (entries.length > 0) {
    return entries.map(([path, entry]) => {
      const prop: PlanProp = { path, kind: typeof entry?.kind === 'string' ? entry.kind : 'update' }
      let old = lookup(step.oldState?.inputs, path)
      if (!old.isFound) {
        old = lookup(step.oldState?.outputs, path)
      }
      const next = lookup(step.newState?.inputs, path)
      if (old.isFound) {
        prop.old = valueText(old.value, UPDATE_VALUE_CAP)
      }
      if (next.isFound) {
        prop.new = valueText(next.value, UPDATE_VALUE_CAP)
      }

      return prop
    })
  }
  if (!step.oldState || !step.newState) {
    return []
  }

  return deepDiff(step.oldState.inputs ?? {}, step.newState.inputs ?? {}).map(leaf => {
    const prop: PlanProp = { path: leaf.path, kind: leaf.kind }
    if (leaf.old) {
      prop.old = valueText(leaf.old.value, UPDATE_VALUE_CAP)
    }
    if (leaf.new) {
      prop.new = valueText(leaf.new.value, UPDATE_VALUE_CAP)
    }

    return prop
  })
}

function inventory(inputs: unknown, side: 'old' | 'new', kind: string): PlanProp[] {
  if (typeof inputs !== 'object' || inputs === null || Array.isArray(inputs)) {
    return []
  }

  return Object.keys(inputs)
    .sort()
    .map(key => {
      const prop: PlanProp = { path: pathKey('', key), kind }
      prop[side] = valueText((inputs as Record<string, unknown>)[key], INVENTORY_VALUE_CAP)

      return prop
    })
}

function propsOf(category: PlanCategory, step: RawStep): PlanProp[] {
  switch (category) {
    case 'update':
    case 'replace':
      return propsOfDiff(step)
    case 'create':
      return inventory(step.newState?.inputs, 'new', 'add')
    case 'delete': {
      const id = step.oldState?.id
      const props = inventory(step.oldState?.inputs, 'old', 'delete')

      return id === undefined || id === null || id === ''
        ? props
        : [{ path: 'id', kind: 'delete', old: valueText(id, INVENTORY_VALUE_CAP) }, ...props]
    }
    default:
      return []
  }
}

function propKey(prop: PlanProp): string {
  return JSON.stringify([prop.path, prop.kind, prop.old ?? null, prop.new ?? null])
}

function capProps(props: PlanProp[], overflow: number): { props: PlanProp[]; propsOverflow: number } {
  return props.length > MAX_PROPS
    ? { props: props.slice(0, MAX_PROPS), propsOverflow: overflow + props.length - MAX_PROPS }
    : { props, propsOverflow: overflow }
}

export function buildSteps(raw: readonly RawStep[]): { steps: PlanStep[]; sameCount: number } {
  const steps: PlanStep[] = []
  const replaces = new Map<string, { step: PlanStep; all: PlanProp[] }>()
  let sameCount = 0
  for (const rawStep of raw) {
    const op = typeof rawStep.op === 'string' ? rawStep.op : 'unknown'
    if (op === 'same') {
      sameCount += 1
      continue
    }
    const urnText = typeof rawStep.urn === 'string' ? rawStep.urn : ''
    const urn = parseUrn(urnText)
    const category = categoryOf(op)
    const props = propsOf(category, rawStep)
    const id = rawStep.oldState?.id ?? rawStep.newState?.id
    const existing = category === 'replace' ? replaces.get(urnText) : undefined
    if (existing) {
      const seen = new Set(existing.all.map(propKey))
      existing.all.push(...props.filter(p => !seen.has(propKey(p))))
      existing.step.ops.push(op)
      for (const reason of stringList(rawStep.replaceReasons)) {
        if (!existing.step.replaceReasons.includes(reason)) {
          existing.step.replaceReasons.push(reason)
        }
      }
      for (const reason of stringList(rawStep.diffReasons)) {
        if (!existing.step.diffReasons.includes(reason)) {
          existing.step.diffReasons.push(reason)
        }
      }
      existing.step.provider ??= typeof rawStep.provider === 'string' ? rawStep.provider : undefined
      continue
    }
    const step: PlanStep = {
      urn: urnText,
      type: urn?.type ?? (typeof rawStep.newState?.type === 'string' ? rawStep.newState.type : 'unknown'),
      name: urn?.name ?? urnText,
      category,
      ops: [op],
      diffReasons: stringList(rawStep.diffReasons),
      replaceReasons: stringList(rawStep.replaceReasons),
      props: [],
      propsOverflow: 0,
      isOpaque: false,
    }
    if (typeof rawStep.provider === 'string') {
      step.provider = rawStep.provider
    }
    if (typeof id === 'string' && id !== '') {
      step.id = id
    }
    steps.push(step)
    if (category === 'replace') {
      replaces.set(urnText, { step, all: [...props] })
    } else {
      Object.assign(step, capProps(props, 0))
      step.isOpaque = category === 'update' && props.length === 0
    }
  }
  for (const { step, all } of replaces.values()) {
    Object.assign(step, capProps(all, 0))
    step.isOpaque = all.length === 0
  }

  return { steps, sameCount }
}

export function buildDiagnostics(raw: readonly RawDiagnostic[]): PlanDiagnostic[] {
  return raw.map(d => {
    const message = typeof d.message === 'string' ? d.message : JSON.stringify(d.message ?? '')
    const diagnostic: PlanDiagnostic = {
      severity: typeof d.severity === 'string' ? d.severity : 'info',
      message: message.length > DIAGNOSTIC_CAP ? `${message.slice(0, DIAGNOSTIC_CAP)}… [${message.length - DIAGNOSTIC_CAP} chars cut]` : message,
    }
    if (typeof d.urn === 'string' && d.urn !== '') {
      diagnostic.urn = d.urn
    }

    return diagnostic
  })
}

export type CategoryCounts = Record<PlanCategory, number>

export function countSteps(steps: readonly PlanStep[]): CategoryCounts {
  const counts: CategoryCounts = { create: 0, update: 0, replace: 0, delete: 0, other: 0 }
  for (const step of steps) {
    counts[step.category] += 1
  }

  return counts
}

export function stepIdentity(step: PlanStep): string {
  const props = step.props.map(propKey).sort()

  return JSON.stringify([step.category, step.urn, props, step.propsOverflow])
}

export type Tag = 'overlaps drift' | 'opaque'

export type Entry = { step: PlanStep; tags: Tag[] }

export type Comparison = {
  hasBaseline: boolean
  change: Record<PlanChangeCategory, Entry[]>
  drift: Record<PlanChangeCategory, Entry[]>
  baselineOnly: Entry[]
  other: Entry[]
  newDiagnostics: PlanDiagnostic[]
  driftDiagnostics: PlanDiagnostic[]
}

function emptyGroups(): Record<PlanChangeCategory, Entry[]> {
  return { create: [], update: [], replace: [], delete: [] }
}

function matchKey(step: PlanStep): string {
  return `${step.category}\u0000${step.urn}`
}

function entryOf(step: PlanStep, tags: Tag[] = []): Entry {
  return { step, tags: step.isOpaque ? [...tags, 'opaque'] : tags }
}

export function compare(branch: PlanRun, baseline: PlanRun | undefined): Comparison {
  const result: Comparison = {
    hasBaseline: baseline !== undefined,
    change: emptyGroups(),
    drift: emptyGroups(),
    baselineOnly: [],
    other: [],
    newDiagnostics: [],
    driftDiagnostics: [],
  }
  const baseSteps = new Map<string, PlanStep>()
  for (const step of baseline?.steps ?? []) {
    if (step.category !== 'other') {
      baseSteps.set(matchKey(step), step)
    }
  }
  const matched = new Set<string>()
  for (const step of branch.steps) {
    if (step.category === 'other') {
      result.other.push(entryOf(step))
      continue
    }
    const key = matchKey(step)
    const base = baseSteps.get(key)
    if (!base) {
      result.change[step.category].push(entryOf(step))
      continue
    }
    matched.add(key)
    if (stepIdentity(base) === stepIdentity(step)) {
      result.drift[step.category].push(entryOf(step))
    } else {
      result.change[step.category].push(entryOf(step, ['overlaps drift']))
    }
  }
  for (const [key, step] of baseSteps) {
    if (!matched.has(key)) {
      result.baselineOnly.push(entryOf(step))
    }
  }
  const baseMessages = new Set((baseline?.diagnostics ?? []).map(d => d.message))
  for (const diagnostic of branch.diagnostics) {
    if (baseMessages.has(diagnostic.message)) {
      result.driftDiagnostics.push(diagnostic)
    } else {
      result.newDiagnostics.push(diagnostic)
    }
  }

  return result
}

export function baselineAlone(run: PlanRun): Comparison {
  const result: Comparison = {
    hasBaseline: true,
    change: emptyGroups(),
    drift: emptyGroups(),
    baselineOnly: [],
    other: [],
    newDiagnostics: [],
    driftDiagnostics: [...run.diagnostics],
  }
  for (const step of run.steps) {
    if (step.category === 'other') {
      result.other.push(entryOf(step))
    } else {
      result.drift[step.category].push(entryOf(step))
    }
  }

  return result
}

export function driftCount(comparison: Comparison): number {
  return CHANGE_CATEGORIES.reduce((sum, category) => sum + comparison.drift[category].length, 0)
}

export function runKey(run: Pick<PlanRun, 'role' | 'label' | 'project' | 'stack'>): string {
  return run.role === 'branch'
    ? JSON.stringify(['branch', run.label, run.project, run.stack])
    : JSON.stringify([run.role, run.project, run.stack])
}

export function upsertRun(runs: readonly PlanRun[], run: PlanRun): PlanRun[] {
  const key = runKey(run)

  return [...runs.filter(r => runKey(r) !== key), run]
}

export type Card = {
  id: string
  run: PlanRun
  baseline: PlanRun | undefined
  isBaselineOnly: boolean
  isApply: boolean
  comparison: Comparison
  noBaselineReason?: string
}

export function preMergeBaseline(apply: PlanRun, baseline: PlanRun | undefined): { baseline?: PlanRun; reason?: string } {
  if (!baseline) {
    return { reason: 'no baseline registered for this stack' }
  }
  const since = apply.since
  if (!since) {
    return { reason: 'the baseline has not been compared with the apply run' }
  }
  if (!baseline.git.isAvailable || since.baselineHead !== baseline.git.head) {
    return { reason: 'the baseline changed since it was compared; register it again' }
  }
  if (!since.isAncestor) {
    return { reason: since.reason ?? 'the baseline commit is not an ancestor of the apply run' }
  }

  return { baseline }
}

export function buildCards(runs: readonly PlanRun[]): Card[] {
  const baselines = new Map<string, PlanRun>()
  for (const run of runs) {
    if (run.role === 'baseline') {
      baselines.set(`${run.project}\u0000${run.stack}`, run)
    }
  }
  const paired = new Set<string>()
  const cards: Card[] = []
  for (const run of runs) {
    if (run.role !== 'apply') {
      continue
    }
    const stackKey = `${run.project}\u0000${run.stack}`
    const pair = preMergeBaseline(run, baselines.get(stackKey))
    if (pair.baseline) {
      paired.add(stackKey)
    }
    cards.push({
      id: runKey(run),
      run,
      baseline: pair.baseline,
      isBaselineOnly: false,
      isApply: true,
      comparison: compare(run, pair.baseline),
      ...(pair.reason === undefined ? {} : { noBaselineReason: pair.reason }),
    })
  }
  for (const run of runs) {
    if (run.role !== 'branch') {
      continue
    }
    const stackKey = `${run.project}\u0000${run.stack}`
    const baseline = baselines.get(stackKey)
    if (baseline) {
      paired.add(stackKey)
    }
    cards.push({ id: runKey(run), run, baseline, isBaselineOnly: false, isApply: false, comparison: compare(run, baseline) })
  }
  for (const [stackKey, run] of baselines) {
    if (!paired.has(stackKey)) {
      cards.push({
        id: runKey(run),
        run,
        baseline: undefined,
        isBaselineOnly: true,
        isApply: false,
        comparison: baselineAlone(run),
      })
    }
  }
  const label = (card: Card) => (card.isBaselineOnly ? 'baseline only' : card.isApply ? 'apply' : card.run.label)

  return cards.sort(
    (a, b) =>
      label(a).localeCompare(label(b)) ||
      a.run.project.localeCompare(b.run.project) ||
      a.run.stack.localeCompare(b.run.stack),
  )
}

export type ChangeOnly = { blocked: string } | { steps: PlanStep[]; targets: string[] }

export function changeOnly(card: Card): ChangeOnly | null {
  const { run, comparison } = card
  if (!card.isApply || card.baseline === undefined || (run.targets ?? []).length > 0) {
    return null
  }
  const entries = CHANGE_CATEGORIES.flatMap(category => comparison.change[category])
  if (entries.length === 0 || driftCount(comparison) === 0) {
    return null
  }
  const overlapping = entries.filter(entry => entry.tags.includes('overlaps drift')).length
  if (overlapping > 0) {
    return {
      blocked: `${overlapping} change step${overlapping === 1 ? ' touches' : 's touch'} a resource that also has pending drift, so --target would apply that drift too`,
    }
  }
  const steps = entries.map(entry => entry.step)

  return { steps, targets: [...new Set(steps.map(step => step.urn))] }
}

export function shortSha(sha: string): string {
  return sha.slice(0, 8)
}

const SUBJECT_LIMIT = 72

export function cutSubject(subject: string): string {
  return subject.length > SUBJECT_LIMIT ? `${subject.slice(0, SUBJECT_LIMIT)}…` : subject
}

export function refNames(refs: readonly string[]): string {
  const named = refs.filter(ref => ref !== 'origin/HEAD' && ref !== 'origin' && ref !== '')
  if (named.includes('origin/main')) {
    return 'origin/main'
  }
  const ordered = [...named.filter(ref => ref.startsWith('origin/')), ...named.filter(ref => !ref.startsWith('origin/'))]
  const shown = ordered.slice(0, 2).join(', ')

  return ordered.length > 2 ? `${shown} +${ordered.length - 2}` : shown
}

export function gitLine(git: PlanGit): { text: string; dirty: string | null; isAvailable: boolean } {
  if (!git.isAvailable) {
    return { text: `git unavailable: ${git.reason}`, dirty: null, isAvailable: false }
  }
  const at = (refs: readonly string[], sha: string) => {
    const name = refNames(refs)

    return name === '' ? shortSha(sha) : `${name} @ ${shortSha(sha)}`
  }
  const subject = git.subject.split('\n')[0] ?? ''
  const withSubject = (line: string) => (subject === '' ? line : `${line} · ${cutSubject(subject)}`)
  let text: string
  const [first, second] = git.parents
  if (git.branch !== null) {
    text = `${git.branch} @ ${shortSha(git.head)}`
  } else if (git.originMain !== undefined && git.head === git.originMain) {
    text = withSubject(`origin/main @ ${shortSha(git.head)}`)
  } else if (git.isOnMain === true) {
    const behind = git.behindMain
    text = withSubject(
      behind === undefined
        ? `${shortSha(git.head)} on main, behind origin/main`
        : `${shortSha(git.head)} on main, ${behind} commit${behind === 1 ? '' : 's'} behind origin/main`,
    )
  } else if (git.parents.length === 2 && first && second) {
    text = `${at(second.refs, second.sha)} merged onto ${at(first.refs, first.sha)} (HEAD ${shortSha(git.head)}, detached)`
  } else {
    text = `${at(git.headRefs, git.head)} (detached)`
  }
  const dirty =
    git.dirtyCount > 0 ? `${git.dirtyCount} uncommitted file${git.dirtyCount === 1 ? '' : 's'}` : null

  return { text, dirty, isAvailable: true }
}

export function diffHunk(prop: PlanProp): string | null {
  const oldLines = prop.old === undefined ? [] : prop.old.split('\n')
  const newLines = prop.new === undefined ? [] : prop.new.split('\n')
  if (oldLines.length === 0 && newLines.length === 0) {
    return null
  }
  const range = (lines: readonly string[]) => (lines.length === 0 ? '0,0' : `1,${lines.length}`)

  return [
    `@@ -${range(oldLines)} +${range(newLines)} @@`,
    ...oldLines.map(line => `-${line}`),
    ...newLines.map(line => `+${line}`),
  ].join('\n')
}

export function rowPreview(step: PlanStep): string {
  switch (step.category) {
    case 'create':
      return `${step.props.length + step.propsOverflow} inputs`
    case 'delete':
      return step.id ? `id ${step.id}` : ''
    case 'replace':
      if (step.replaceReasons.length > 0) {
        return `replaces: ${step.replaceReasons.join(', ')}`
      }
      break
    case 'other':
      return step.ops.join(', ')
    default:
      break
  }
  const paths = step.props.map(p => p.path)
  const total = paths.length + step.propsOverflow
  const shown = paths.slice(0, 3).join(', ')

  return total > 3 ? `${shown} +${total - 3} more` : shown
}

export function cleanText(text: string): string {
  return text
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/<\{%[a-z]+%\}>/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, c => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
}
