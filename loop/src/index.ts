#!/usr/bin/env bun
import { runCommand } from './commands/run.js'

const argv = process.argv.slice(2)

runCommand(argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`\nFatal: ${msg}`)
  process.exit(1)
})
