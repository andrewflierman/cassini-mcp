import chalk from 'chalk'

export const c = {
  brand:   chalk.hex('#6366f1'),
  success: chalk.hex('#22c55e'),
  warning: chalk.hex('#f59e0b'),
  error:   chalk.hex('#ef4444'),
  muted:   chalk.dim,
  bold:    chalk.bold,
  task:    chalk.hex('#e2e8f0'),
}

export const icons = {
  done:    '✓',
  failed:  '✗',
  pending: '·',
  logo:    '⬡',
  arrow:   '→',
}

export const SPINNER_FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏']

const H = '─'
const TL = '╭'
const TR = '╮'
const BL = '╰'
const BR = '╯'

function fill(width: number, label?: string): string {
  if (!label) return H.repeat(width)
  const inner = ` ${label} `
  const remaining = Math.max(0, width - inner.length - 2)
  return `${H.repeat(2)}${inner}${H.repeat(remaining)}`
}

export const box = {
  top(width: number, label: string): string {
    return `${TL}${fill(width - 2, label)}${TR}`
  },
  bottom(width: number): string {
    return `${BL}${H.repeat(width - 2)}${BR}`
  },
  divider(width: number): string {
    return H.repeat(width)
  },
}

export const termWidth = () => process.stdout.columns ?? 80

export function fixedWidth(str: string, len: number, pad = ' '): string {
  if (str.length > len) return str.slice(0, len - 1) + '…'
  return str.padEnd(len, pad)
}

export function leftRight(left: string, right: string, width: number): string {
  const leftLen = stripAnsi(left).length
  const rightLen = stripAnsi(right).length
  const gap = Math.max(1, width - leftLen - rightLen)
  return `${left}${' '.repeat(gap)}${right}`
}

export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*m/g, '')
}

export function formatElapsed(startedAt: string | undefined): string {
  if (!startedAt) return '   —'
  const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  const m = Math.floor(elapsed / 60)
  const s = elapsed % 60
  return `${m}m ${s.toString().padStart(2, '0')}s`
}
