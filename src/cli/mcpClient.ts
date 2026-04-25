import { CliError } from "./errors"

export type McpToolName =
  | "create_comment"
  | "create_note"
  | "create_project"
  | "create_task"
  | "create_task_group"
  | "delete_task"
  | "delete_task_group"
  | "get_note"
  | "get_project"
  | "get_task"
  | "list_comments"
  | "list_notes"
  | "list_projects"
  | "list_task_groups"
  | "list_tasks"
  | "update_task"
  | "update_task_group"

type JsonRpcError = {
  error?: {
    message?: string
  }
  result?: {
    content?: Array<{
      text?: string
      type?: string
    }>
    isError?: boolean
  }
}

type FetchLike = typeof fetch

function tryParseJsonRpcPayload(rawText: string): JsonRpcError | null {
  if (!rawText) return null

  try {
    return JSON.parse(rawText) as JsonRpcError
  } catch {
    return tryParseSseJsonRpcPayload(rawText)
  }
}

function tryParseSseJsonRpcPayload(rawText: string): JsonRpcError | null {
  const events = rawText
    .split(/\r?\n\r?\n+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    const dataLines = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean)

    if (dataLines.length === 0) continue

    const candidate = dataLines.join("\n")
    try {
      return JSON.parse(candidate) as JsonRpcError
    } catch {
      continue
    }
  }

  return null
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`
}

function buildEndpointUrl(baseUrl: string): string {
  return new URL("api/mcp-data/mcp", ensureTrailingSlash(baseUrl)).toString()
}

function extractMessage(
  payload: JsonRpcError | null,
  fallback: string
): string {
  const errorMessage = payload?.error?.message
  if (errorMessage) return errorMessage

  const toolMessage = payload?.result?.content
    ?.map((item) => item.text)
    .find((item): item is string => typeof item === "string" && item.length > 0)

  if (toolMessage) {
    return toolMessage.replace(/^Error:\s*/, "")
  }

  return fallback
}

export async function callMcpTool<T>(input: {
  arguments?: Record<string, unknown>
  baseUrl: string
  fetchImpl?: FetchLike
  token: string
  tool: McpToolName
}): Promise<T> {
  const fetchImpl = input.fetchImpl ?? fetch
  const response = await fetchImpl(buildEndpointUrl(input.baseUrl), {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: input.tool,
        arguments: input.arguments ?? {},
      },
      id: 1,
    }),
  })

  const rawText = await response.text()
  const payload = tryParseJsonRpcPayload(rawText)

  if (!response.ok) {
    throw new CliError(
      extractMessage(
        payload,
        rawText || `Request failed with status ${response.status}`
      ),
      1
    )
  }

  if (!payload) {
    throw new CliError("Received a non-JSON response from FeedbackHive", 1)
  }

  if (payload?.error?.message) {
    throw new CliError(payload.error.message, 1)
  }

  if (payload?.result?.isError) {
    throw new CliError(extractMessage(payload, "Command failed"), 1)
  }

  const contentText = payload?.result?.content
    ?.map((item) => item.text)
    .find((item): item is string => typeof item === "string" && item.length > 0)

  if (!contentText) {
    throw new CliError("Received an empty response from FeedbackHive", 1)
  }

  try {
    return JSON.parse(contentText) as T
  } catch {
    return contentText as T
  }
}
