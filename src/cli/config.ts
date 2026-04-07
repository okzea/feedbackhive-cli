import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { CLI_DEFAULT_BASE_URL } from "./constants"
import { getStringFlag, type ParsedCliArgs } from "./parse"

export type PersistedCliConfig = {
  authMode?: "token" | "web"
  token: string
  url: string
  version: 1
}

export type ResolvedCliConfig = {
  authMode?: "token" | "web"
  configPath: string
  configSource: "default" | "env" | "flag"
  savedConfig: PersistedCliConfig | null
  token?: string
  tokenSource: "default" | "env" | "flag" | "none" | "saved"
  url: string
  urlSource: "default" | "env" | "flag" | "saved"
}

type EnvLike = Record<string, string | undefined>

const IGNORED_CONFIG_ERROR_CODES = new Set([
  "EACCES",
  "EISDIR",
  "ENOENT",
  "ENOTDIR",
  "EPERM",
])

export function getConfigPath(
  flags: ParsedCliArgs["flags"],
  env: EnvLike = process.env
): { configPath: string; configSource: ResolvedCliConfig["configSource"] } {
  const flagPath = getStringFlag(flags, "config")
  if (flagPath) {
    return {
      configPath: path.resolve(flagPath),
      configSource: "flag",
    }
  }

  if (typeof env.FBH_CONFIG === "string" && env.FBH_CONFIG) {
    return {
      configPath: path.resolve(env.FBH_CONFIG),
      configSource: "env",
    }
  }

  return {
    configPath: path.join(os.homedir(), ".feedbackhive", "config.json"),
    configSource: "default",
  }
}

export function normalizeBaseUrl(url: string): string {
  const parsed = new URL(url)
  const normalizedPath = parsed.pathname.replace(/\/+$/, "")
  return `${parsed.origin}${normalizedPath}`
}

function getErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error && "code" in error
    ? String((error as { code?: string }).code)
    : undefined
}

export async function readCliConfig(
  configPath: string
): Promise<PersistedCliConfig | null> {
  try {
    const raw = await readFile(configPath, "utf8")
    let parsed: Partial<PersistedCliConfig>

    try {
      parsed = JSON.parse(raw) as Partial<PersistedCliConfig>
    } catch {
      return null
    }

    if (
      parsed.version !== 1 ||
      typeof parsed.url !== "string" ||
      typeof parsed.token !== "string"
    ) {
      return null
    }

    return {
      authMode:
        parsed.authMode === "token" || parsed.authMode === "web"
          ? parsed.authMode
          : undefined,
      version: 1,
      url: parsed.url,
      token: parsed.token,
    }
  } catch (error) {
    if (IGNORED_CONFIG_ERROR_CODES.has(getErrorCode(error) ?? "")) {
      return null
    }
    throw error
  }
}

export async function resolveCliConfig(
  parsed: ParsedCliArgs,
  env: EnvLike = process.env
): Promise<ResolvedCliConfig> {
  const { configPath, configSource } = getConfigPath(parsed.flags, env)
  const savedConfig = await readCliConfig(configPath)

  const rawFlagUrl = getStringFlag(parsed.flags, "url")
  const flagUrl = rawFlagUrl ? normalizeBaseUrl(rawFlagUrl.trim()) : undefined
  const envUrl =
    typeof env.FBH_URL === "string" && env.FBH_URL.trim()
      ? normalizeBaseUrl(env.FBH_URL.trim())
      : undefined
  const savedUrl = savedConfig?.url

  const flagToken = getStringFlag(parsed.flags, "token")?.trim() || undefined
  const envToken =
    typeof env.FBH_TOKEN === "string" && env.FBH_TOKEN.trim()
      ? env.FBH_TOKEN.trim()
      : undefined
  const savedToken = savedConfig?.token

  const resolvedUrl = flagUrl ?? envUrl ?? savedUrl ?? CLI_DEFAULT_BASE_URL

  return {
    configPath,
    configSource,
    authMode: savedConfig?.authMode,
    savedConfig,
    token: flagToken ?? envToken ?? savedToken,
    tokenSource: flagToken
      ? "flag"
      : envToken
        ? "env"
        : savedToken
          ? "saved"
          : "none",
    url: resolvedUrl,
    urlSource: flagUrl
      ? "flag"
      : envUrl
        ? "env"
        : savedUrl
          ? "saved"
          : "default",
  }
}

export async function writeCliConfig(
  configPath: string,
  config: Omit<PersistedCliConfig, "version">
) {
  const serialized = JSON.stringify({ version: 1, ...config }, null, 2)
  const directoryPath = path.dirname(configPath)

  await mkdir(directoryPath, { recursive: true, mode: 0o700 })
  await writeFile(configPath, `${serialized}\n`, { mode: 0o600 })
  await chmod(configPath, 0o600).catch(() => undefined)
}

export async function removeCliConfig(configPath: string): Promise<boolean> {
  try {
    await rm(configPath, { force: false })
    return true
  } catch (error) {
    const errorCode =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: string }).code)
        : undefined

    if (errorCode === "ENOENT") return false
    throw error
  }
}
