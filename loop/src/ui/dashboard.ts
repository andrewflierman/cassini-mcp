import { SPINNER_FRAMES } from './theme.js'

const HIDE_CURSOR  = '\x1b[?25l'
const SHOW_CURSOR  = '\x1b[?25h'
const ENTER_ALT    = '\x1b[?1049h'
const EXIT_ALT     = '\x1b[?1049l'
const CURSOR_HOME  = '\x1b[H'
const CLEAR_SCREEN = '\x1b[2J'

export class Dashboard {
  private interval: ReturnType<typeof setInterval> | null = null
  private frame = 0

  render(content: string): void {
    process.stdout.write(CLEAR_SCREEN + CURSOR_HOME + content)
    if (!content.endsWith('\n')) process.stdout.write('\n')
  }

  start(contentFn: () => string, intervalMs = 120): void {
    process.stdout.write(ENTER_ALT)
    this.hideCursor()
    this.render(contentFn())
    this.interval = setInterval(() => {
      this.render(contentFn())
    }, intervalMs)
  }

  stop(finalContent?: string): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    process.stdout.write(EXIT_ALT)
    this.showCursor()
    if (finalContent !== undefined) {
      process.stdout.write(finalContent + '\n')
    }
  }

  nextFrame(): string {
    const f = SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length]
    this.frame++
    return f
  }

  hideCursor(): void {
    process.stdout.write(HIDE_CURSOR)
  }

  showCursor(): void {
    process.stdout.write(SHOW_CURSOR)
  }
}
