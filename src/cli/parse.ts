import { CliError } from "./errors"

export type FlagValue = boolean | string | string[]

export type ParsedCliArgs = {
  action?: string
  flags: Record<string, FlagValue>
  group?: string
  helpRequested: boolean
  positionals: string[]
}

function appendFlagValue(
  flags: Record<string, FlagValue>,
  name: string,
  value: boolean | string
) {
  const existing = flags[name]
  if (existing === undefined) {
    flags[name] = value
    return
  }

  if (Array.isArray(existing)) {
    existing.push(String(value))
    flags[name] = existing
    return
  }

  flags[name] = [String(existing), String(value)]
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const commandParts: string[] = []
  const optionTokens: string[] = []

  for (const token of argv) {
    if (commandParts.length < 2 && token !== "--" && !token.startsWith("-")) {
      commandParts.push(token)
      continue
    }

    optionTokens.push(token)
  }

  const flags: Record<string, FlagValue> = {}
  const positionals: string[] = []
  let parsePositionalsOnly = false

  for (let index = 0; index < optionTokens.length; index += 1) {
    const token = optionTokens[index]

    if (parsePositionalsOnly) {
      positionals.push(token)
      continue
    }

    if (token === "--") {
      parsePositionalsOnly = true
      continue
    }

    if (token === "--help" || token === "-h") {
      flags.help = true
      continue
    }

    if (token.startsWith("--no-")) {
      appendFlagValue(flags, token.slice(5), false)
      continue
    }

    if (token.startsWith("--")) {
      const withoutPrefix = token.slice(2)
      const equalsIndex = withoutPrefix.indexOf("=")

      if (equalsIndex >= 0) {
        const name = withoutPrefix.slice(0, equalsIndex)
        const value = withoutPrefix.slice(equalsIndex + 1)
        appendFlagValue(flags, name, value)
        continue
      }

      const nextToken = optionTokens[index + 1]
      const canTakeValue =
        nextToken !== undefined &&
        nextToken !== "--" &&
        !nextToken.startsWith("--")

      if (canTakeValue) {
        appendFlagValue(flags, withoutPrefix, nextToken)
        index += 1
      } else {
        appendFlagValue(flags, withoutPrefix, true)
      }
      continue
    }

    positionals.push(token)
  }

  return {
    group: commandParts[0],
    action: commandParts[1],
    flags,
    helpRequested: flags.help === true,
    positionals,
  }
}

export function getFlagValue(
  flags: Record<string, FlagValue>,
  name: string
): FlagValue | undefined {
  return flags[name]
}

export function getStringFlag(
  flags: Record<string, FlagValue>,
  name: string
): string | undefined {
  const value = getFlagValue(flags, name)
  if (value === undefined) return undefined

  if (Array.isArray(value)) {
    if (value.length !== 1) {
      throw new CliError(`Flag --${name} can only be provided once`)
    }
    return value[0]
  }

  if (typeof value === "boolean") {
    throw new CliError(`Flag --${name} requires a value`)
  }

  return value
}

export function getStringListFlag(
  flags: Record<string, FlagValue>,
  name: string
): string[] | undefined {
  const value = getFlagValue(flags, name)
  if (value === undefined) return undefined

  if (typeof value === "boolean") {
    throw new CliError(`Flag --${name} requires a value`)
  }

  const values = Array.isArray(value) ? value : [String(value)]
  return values
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function getBooleanFlag(
  flags: Record<string, FlagValue>,
  name: string
): boolean | undefined {
  const value = getFlagValue(flags, name)
  if (value === undefined) return undefined

  if (Array.isArray(value)) {
    if (value.length !== 1) {
      throw new CliError(`Flag --${name} can only be provided once`)
    }
    return parseBooleanString(value[0], name)
  }

  if (typeof value === "boolean") return value

  return parseBooleanString(value, name)
}

export function getNumberFlag(
  flags: Record<string, FlagValue>,
  name: string
): number | undefined {
  const value = getStringFlag(flags, name)
  if (value === undefined) return undefined

  const parsed = Number(value)
  if (Number.isNaN(parsed)) {
    throw new CliError(`Flag --${name} must be a number`)
  }
  return parsed
}

export function getPositionalOrFlag(
  parsed: ParsedCliArgs,
  positionalIndex: number,
  flagName: string,
  label: string
): string {
  const fromFlag = getStringFlag(parsed.flags, flagName)
  if (fromFlag !== undefined) return fromFlag

  const fromPositional = parsed.positionals[positionalIndex]
  if (fromPositional) return fromPositional

  throw new CliError(`${label} is required`)
}

function parseBooleanString(value: string, name: string): boolean {
  if (value === "true") return true
  if (value === "false") return false
  throw new CliError(`Flag --${name} must be true or false`)
}
