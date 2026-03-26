#!/usr/bin/env node

import { runCli } from "./cli/run"

async function main() {
  const exitCode = await runCli(process.argv.slice(2))
  process.exit(exitCode)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Unknown CLI error")
  process.exit(1)
})
