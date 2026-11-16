import type { PlanApproval, PlanJob, PlanRun, PlanStep } from '../types'
import { cleanText, stepIdentity } from './plan'

export const STACK_PATTERN = /^[A-Za-z0-9._-]+$/
export const APPROVAL_TTL_MS = 15 * 60 * 1000
export const WAIT_SECONDS = 540
export const TAIL_LINES = 60
export const TAIL_CHARS = 6000

export function stackKey(run: Pick<PlanRun, 'project' | 'stack'>): string {
  return `${run.project}/${run.stack}`
}

export function isProduction(stack: string): boolean {
  return /prod/i.test(stack)
}

export function isBusy(job: PlanJob | undefined): boolean {
  return job?.status === 'previewing' || job?.status === 'running'
}

export function blocksApproval(job: PlanJob | undefined, run: PlanRun): boolean {
  if (isBusy(job)) {
    return true
  }

  return (job?.status === 'succeeded' || job?.status === 'failed') && job.runId === run.runId
}

export function changeCount(run: PlanRun): number {
  return run.steps.filter(step => step.category !== 'other').length
}

export function approvalProblem(approval: PlanApproval | undefined, run: PlanRun, now: number): string | null {
  if (!approval) {
    return `No approval for ${stackKey(run)}.`
  }
  if (approval.runId !== run.runId || approval.registeredAt !== run.registeredAt) {
    return `The approval for ${stackKey(run)} belongs to an earlier apply preview and is void.`
  }
  if (approval.status !== 'approved') {
    return `The production apply for ${stackKey(run)} is armed but not confirmed ("Yes, apply to production" was not pressed).`
  }
  if (now - approval.at >= APPROVAL_TTL_MS) {
    return `The approval for ${stackKey(run)} expired (older than 15 minutes).`
  }

  return null
}

export function pulumiProjectName(yaml: string): string | null {
  for (const line of yaml.split(/\r?\n/)) {
    const match = /^name:\s*(.*)$/.exec(line)
    if (!match) {
      continue
    }
    const value = (match[1] ?? '').replace(/\s+#.*$/, '').trim()
    const quoted = /^(['"])(.*)\1$/.exec(value)

    return quoted ? (quoted[2] ?? '') : value
  }

  return null
}

export function isInside(child: string, parent: string): boolean {
  const base = parent.replace(/\/+$/, '')

  return child === base || child.startsWith(`${base}/`)
}

export function stepSetDiff(approved: readonly PlanStep[], fresh: readonly PlanStep[]): { added: number; removed: number } {
  const identities = (steps: readonly PlanStep[]) =>
    new Set(steps.filter(step => step.category !== 'other').map(stepIdentity))
  const before = identities(approved)
  const after = identities(fresh)

  return {
    added: [...after].filter(id => !before.has(id)).length,
    removed: [...before].filter(id => !after.has(id)).length,
  }
}

export function sameTargets(a: readonly string[], b: readonly string[]): boolean {
  const left = [...new Set(a)].sort()
  const right = [...new Set(b)].sort()

  return left.length === right.length && left.every((target, i) => target === right[i])
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function targetArgs(targets: readonly string[] | undefined): string[] {
  return (targets ?? []).flatMap(target => ['--target', target])
}

export function previewArgv(stack: string, targets: readonly string[] | undefined): string[] {
  return [
    '/bin/zsh',
    '-lic',
    'exec "$@"',
    'zsh',
    'pulumi',
    'preview',
    '--stack',
    stack,
    '--json',
    '--non-interactive',
    '--suppress-outputs',
    ...targetArgs(targets),
  ]
}

export function upArgs(stack: string, targets: readonly string[] | undefined): string[] {
  return [
    'pulumi',
    'up',
    '--stack',
    stack,
    '--yes',
    '--skip-preview',
    '--non-interactive',
    '--suppress-outputs',
    ...targetArgs(targets),
  ]
}

export function runScript(projectDir: string, jobDir: string, stack: string, targets: readonly string[] | undefined): string {
  const log = shellQuote(`${jobDir}/up.log`)
  const exitTmp = shellQuote(`${jobDir}/up.exit.tmp`)
  const exit = shellQuote(`${jobDir}/up.exit`)

  return [
    '#!/bin/sh',
    `cd ${shellQuote(projectDir)} || { echo 1 > ${exitTmp}; mv ${exitTmp} ${exit}; exit 1; }`,
    `${upArgs(stack, targets).map(shellQuote).join(' ')} > ${log} 2>&1`,
    'code=$?',
    `echo "$code" > ${exitTmp}`,
    `mv ${exitTmp} ${exit}`,
    '',
  ].join('\n')
}

export function launchArgv(scriptPath: string): string[] {
  return ['/bin/zsh', '-lic', 'nohup /bin/sh "$1" </dev/null >/dev/null 2>&1 &!', 'zsh', scriptPath]
}

export function waitArgv(exitPath: string, seconds: number): string[] {
  return [
    '/bin/sh',
    '-c',
    'i=0; while [ ! -f "$1" ] && [ "$i" -lt "$2" ]; do sleep 1; i=$((i+1)); done',
    'sh',
    exitPath,
    String(seconds),
  ]
}

export function jobFolderName(now: number, project: string, stack: string): string {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')

  return `${stamp}-${project.replace(/[^A-Za-z0-9._-]/g, '_')}-${stack}`
}

export function logTail(text: string, lines = TAIL_LINES, chars = TAIL_CHARS): string {
  const tail = cleanText(text).replace(/\n+$/, '').split('\n').slice(-lines).join('\n')

  return tail.length > chars ? tail.slice(tail.length - chars) : tail
}

export function hhmm(ms: number): string {
  return `${new Date(ms).toISOString().slice(11, 16)} UTC`
}

export function hasControl(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value)
}
