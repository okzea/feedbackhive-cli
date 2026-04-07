import { createInterface } from "node:readline/promises"

import { CliError } from "./errors"

export type LoginMethod = "token" | "web"
export type PromptHandler = (message: string) => Promise<string>

export function createPromptHandler(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout
): PromptHandler {
  return async (message: string) => {
    const rl = createInterface({ input, output })
    try {
      return (await rl.question(message)).trim()
    } finally {
      rl.close()
    }
  }
}

export function isInteractiveLoginAvailable(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout
): boolean {
  return Boolean(
    "isTTY" in input && (input as { isTTY?: boolean }).isTTY &&
      "isTTY" in output && (output as { isTTY?: boolean }).isTTY
  )
}

export function normalizeLoginMethod(value: string): LoginMethod | null {
  const normalized = value.trim().toLowerCase()
  if (normalized === "1" || normalized === "w" || normalized === "web") {
    return "web"
  }
  if (normalized === "2" || normalized === "t" || normalized === "token") {
    return "token"
  }
  return null
}

export async function promptForLoginMethod(
  prompt: PromptHandler
): Promise<LoginMethod> {
  while (true) {
    const response = await prompt("Login method? [1] Web [2] Token: ")
    const method = normalizeLoginMethod(response)
    if (method) return method
  }
}

export async function promptForRequiredValue(
  prompt: PromptHandler,
  label: string,
  currentValue?: string
): Promise<string> {
  if (currentValue) return currentValue

  while (true) {
    const value = (await prompt(`${label}: `)).trim()
    if (value) return value
  }
}

export function resolveRequestedLoginMethod(
  input?: string
): LoginMethod | null {
  if (!input) return null
  const method = normalizeLoginMethod(input)
  if (!method) {
    throw new CliError("Login method must be either web or token")
  }
  return method
}
