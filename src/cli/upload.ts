import { readFile, stat } from "node:fs/promises"
import { basename, extname } from "node:path"

import { CliError } from "./errors"
import { callMcpTool } from "./mcpClient"

type FetchLike = typeof fetch

type UploadTarget = {
  headers?: Record<string, string>
  method?: string
  objectKey: string
  uploadUrl: string
}

const CONTENT_TYPES: Record<string, string> = {
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif",
  ".html": "text/html",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".webp": "image/webp",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip",
}

export function guessContentType(fileName: string): string {
  return (
    CONTENT_TYPES[extname(fileName).toLowerCase()] ?? "application/octet-stream"
  )
}

export async function uploadTaskAttachment(input: {
  baseUrl: string
  contentType?: string
  fetchImpl?: FetchLike
  fileName?: string
  filePath: string
  projectId: string
  taskId: string
  token: string
}): Promise<Record<string, unknown>> {
  const fileStats = await stat(input.filePath).catch(() => null)
  if (!fileStats?.isFile()) {
    throw new CliError(`File not found: ${input.filePath}`)
  }
  if (fileStats.size === 0) {
    throw new CliError(`File is empty: ${input.filePath}`)
  }

  const fileName = input.fileName ?? basename(input.filePath)
  const fileType = input.contentType ?? guessContentType(fileName)
  const mcp = {
    baseUrl: input.baseUrl,
    fetchImpl: input.fetchImpl,
    token: input.token,
  }

  const target = await callMcpTool<UploadTarget>({
    ...mcp,
    tool: "create_task_attachment_upload",
    arguments: {
      projectId: input.projectId,
      taskId: input.taskId,
      fileName,
      fileType,
      fileSize: fileStats.size,
    },
  })

  const body = await readFile(input.filePath)
  const response = await (input.fetchImpl ?? fetch)(target.uploadUrl, {
    method: target.method ?? "PUT",
    headers: { "Content-Type": fileType, ...target.headers },
    body,
  })
  if (!response.ok) {
    throw new CliError(
      `File upload failed with status ${response.status}`,
      1
    )
  }

  return callMcpTool<Record<string, unknown>>({
    ...mcp,
    tool: "attach_task_file",
    arguments: {
      projectId: input.projectId,
      taskId: input.taskId,
      objectKey: target.objectKey,
      fileName,
      fileType,
    },
  })
}
