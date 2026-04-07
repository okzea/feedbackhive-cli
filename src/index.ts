#!/usr/bin/env node

import { runCli } from "./cli/run"

async function main() {
  process.exitCode = await runCli(process.argv.slice(2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Unknown CLI error")
  process.exitCode = 1
})
