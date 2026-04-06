import type { ResolvedCliConfig } from "./config"
import { CLI_COMMAND_ALIAS, CLI_PRIMARY_COMMAND } from "./constants"

type CommandKind =
  | "auth-login"
  | "auth-logout"
  | "auth-status"
  | "comment-detail"
  | "comments-list"
  | "help"
  | "note-detail"
  | "notes-list"
  | "project-detail"
  | "projects-list"
  | "task-detail"
  | "tasks-list"

type CommandResponse = {
  data: Record<string, unknown>
  kind: CommandKind
}

function truncate(value: string, maxWidth: number): string {
  if (value.length <= maxWidth) return value
  return `${value.slice(0, Math.max(0, maxWidth - 3))}...`
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "-"
  if (typeof value === "boolean") return value ? "yes" : "no"
  if (Array.isArray(value)) return value.join(", ")
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

function renderTable(
  columns: Array<{ key: string; label: string; maxWidth?: number }>,
  rows: Array<Record<string, unknown>>
): string {
  if (rows.length === 0) return "No results."

  const widths = columns.map((column) => {
    const cellLengths = rows.map(
      (row) =>
        truncate(stringifyValue(row[column.key]), column.maxWidth ?? 32).length
    )
    return Math.max(column.label.length, ...cellLengths)
  })

  const header = columns
    .map((column, index) => column.label.padEnd(widths[index]))
    .join("  ")

  const separator = widths.map((width) => "-".repeat(width)).join("  ")

  const body = rows
    .map((row) =>
      columns
        .map((column, index) =>
          truncate(
            stringifyValue(row[column.key]),
            column.maxWidth ?? widths[index]
          ).padEnd(widths[index])
        )
        .join("  ")
    )
    .join("\n")

  return `${header}\n${separator}\n${body}`
}

function renderKeyValueLines(entries: Array<[string, unknown]>): string {
  const labelWidth = Math.max(...entries.map(([label]) => label.length))
  return entries
    .map(
      ([label, value]) =>
        `${label.padEnd(labelWidth)} : ${stringifyValue(value)}`
    )
    .join("\n")
}

function formatDateSummary(value: unknown): string {
  if (typeof value !== "string") return stringifyValue(value)
  return value.replace("T", " ").replace(".000Z", "Z")
}

const CLI_ASCII_ART = String.raw`
                                                 
                                                 
                                                 
                                                 
                  @           @:                 
                  #@         @#                  
                    @@@@@@@@@                    
                   @@@@@@@@@@@                   
                -  @@%*****%@@  -                
       .@@@@@   @@@  @@@@@@@  @@@   @@@@@=       
         @@@@@@=   @@  +#+  @@   :@@@@@@         
             @@@@@@%  .    . %@@@@@@             
            @@#@@@             @@@#@@            
            @@@@   @@@@@@@@@@@   @@%@            
            @@@  @#           +@  @@@            
            @@* @. @@@@@@@@@@@..@ -@@            
              = @@@#         *@@@ :.             
                *               *                
                 @%@@@@@@@@@@@%@                 
                  -@@@@@@@@@@@+                  
                                                 
                       -@=                       
                                                 
                                                 
                                                 
                                                 
`

export function renderHelpText(): string {
  return [
    CLI_ASCII_ART,
    "FeedbackHive CLI",
    "",
    "Usage:",
    `  ${CLI_PRIMARY_COMMAND} <group> <action> [options] [arguments]`,
    `  ${CLI_COMMAND_ALIAS} <group> <action> [options] [arguments]`,
    "",
    "Auth:",
    `  ${CLI_PRIMARY_COMMAND} login`,
    `  ${CLI_PRIMARY_COMMAND} auth login`,
    `  ${CLI_PRIMARY_COMMAND} auth login --method token --token fhp_xxx`,
    `  ${CLI_PRIMARY_COMMAND} auth login --method web`,
    `  ${CLI_PRIMARY_COMMAND} status`,
    `  ${CLI_PRIMARY_COMMAND} auth status`,
    `  ${CLI_PRIMARY_COMMAND} logout`,
    `  ${CLI_PRIMARY_COMMAND} auth logout`,
    "",
    "Projects:",
    `  ${CLI_PRIMARY_COMMAND} projects list [--status active] [--visibility private]`,
    `  ${CLI_PRIMARY_COMMAND} projects get <projectId>`,
    `  ${CLI_PRIMARY_COMMAND} projects create --title "Roadmap" [--description "..."]`,
    "",
    "Tasks:",
    `  ${CLI_PRIMARY_COMMAND} tasks list <projectId> [--status pending]`,
    `  ${CLI_PRIMARY_COMMAND} tasks get <projectId> <taskId>`,
    `  ${CLI_PRIMARY_COMMAND} tasks create <projectId> --title "Ship CLI"`,
    "",
    "Comments:",
    `  ${CLI_PRIMARY_COMMAND} comments list <projectId> <taskId>`,
    `  ${CLI_PRIMARY_COMMAND} comments create <projectId> <taskId> --content "<p>Looks good</p>"`,
    "",
    "Notes:",
    `  ${CLI_PRIMARY_COMMAND} notes list <projectId> [--include-content]`,
    `  ${CLI_PRIMARY_COMMAND} notes get <projectId> <noteId>`,
    `  ${CLI_PRIMARY_COMMAND} notes create <projectId> --title "Meeting notes"`,
    "",
    "Global options:",
    "  --url, --token, --method, --config, --json, --help",
    "",
    "Environment:",
    "  FBH_URL, FBH_TOKEN, FBH_CONFIG",
  ].join("\n")
}

function renderAuthStatus(
  config: ResolvedCliConfig,
  connected: boolean,
  projectCount: number
): string {
  return renderKeyValueLines([
    ["Configured", config.url && config.token ? "yes" : "no"],
    ["URL", config.url ?? "-"],
    ["Auth mode", config.authMode ?? "-"],
    ["URL source", config.urlSource],
    ["Token", config.token ? "configured" : "missing"],
    ["Token source", config.tokenSource],
    ["Config path", config.configPath],
    ["Config path source", config.configSource],
    ["Connection", connected ? "ok" : "not checked"],
    ["Projects sampled", projectCount],
  ])
}

function renderProjectDetail(data: Record<string, unknown>): string {
  const project = data.project as Record<string, unknown>
  const taskCounts =
    (data.taskCounts as {
      byStatus?: Array<{ count: number; status: string | null }>
    }) ?? {}

  const lines = [
    renderKeyValueLines([
      ["ID", project.id],
      ["Title", project.title],
      ["Slug", project.slug],
      ["Status", project.status],
      ["Visibility", project.visibility],
      ["Tags", project.tags],
      ["Owner", project.ownerId],
      ["Created", formatDateSummary(project.createdAt)],
      ["Updated", formatDateSummary(project.updatedAt)],
    ]),
  ]

  if (typeof project.description === "string" && project.description) {
    lines.push(`\nDescription:\n${project.description}`)
  }

  const byStatus = Array.isArray(taskCounts.byStatus) ? taskCounts.byStatus : []
  if (byStatus.length > 0) {
    lines.push(
      `\nTask counts:\n${byStatus
        .map((entry) => `${entry.status ?? "unknown"}=${entry.count}`)
        .join(", ")}`
    )
  }

  return lines.join("\n")
}

function renderTaskDetail(data: Record<string, unknown>): string {
  const task = data.task as Record<string, unknown>
  const assignee = task.assignee as {
    email?: string | null
    name?: string | null
  } | null

  const lines = [
    renderKeyValueLines([
      ["ID", task.id],
      ["Project", task.projectId],
      ["Title", task.title],
      ["Status", task.status],
      ["Priority", task.priority],
      ["Comments", task.commentCount],
      ["Due", formatDateSummary(task.dueDate)],
      ["Assignee", assignee?.name ?? assignee?.email ?? "-"],
      ["Created", formatDateSummary(task.createdAt)],
      ["Updated", formatDateSummary(task.updatedAt)],
    ]),
  ]

  if (typeof task.description === "string" && task.description) {
    lines.push(`\nDescription:\n${task.description}`)
  }

  return lines.join("\n")
}

function renderCommentDetail(data: Record<string, unknown>): string {
  const comment = data.comment as Record<string, unknown>
  const author = comment.author as {
    email?: string | null
    name?: string | null
  } | null

  const lines = [
    renderKeyValueLines([
      ["ID", comment.id],
      ["Task", comment.taskId],
      ["Author", author?.name ?? author?.email ?? "-"],
      ["Created", formatDateSummary(comment.createdAt)],
      ["Updated", formatDateSummary(comment.updatedAt)],
    ]),
  ]

  if (typeof comment.content === "string") {
    lines.push(`\nContent:\n${comment.content}`)
  }

  return lines.join("\n")
}

function renderNoteDetail(data: Record<string, unknown>): string {
  const note = data.note as Record<string, unknown>
  const author = note.author as {
    email?: string | null
    name?: string | null
  } | null

  const lines = [
    renderKeyValueLines([
      ["ID", note.id],
      ["Project", note.projectId],
      ["Title", note.title],
      ["Pinned", note.isPinned],
      ["Folder", (note.folder as { name?: string | null })?.name ?? "-"],
      ["Author", author?.name ?? author?.email ?? "-"],
      ["Created", formatDateSummary(note.createdAt)],
      ["Updated", formatDateSummary(note.updatedAt)],
    ]),
  ]

  if (typeof note.content === "string") {
    lines.push(`\nContent:\n${note.content}`)
  }

  return lines.join("\n")
}

export function renderCommandResponse(
  response: CommandResponse,
  config?: ResolvedCliConfig
): string {
  switch (response.kind) {
    case "help":
      return renderHelpText()
    case "auth-login":
      return renderKeyValueLines([
        ["Status", "saved"],
        ["Auth mode", response.data.authMode],
        ["URL", response.data.url],
        ["Config path", response.data.configPath],
      ])
    case "auth-logout":
      return renderKeyValueLines([
        ["Status", response.data.removed ? "removed" : "not found"],
        ["Config path", response.data.configPath],
      ])
    case "auth-status":
      return renderAuthStatus(
        config ?? (response.data.config as ResolvedCliConfig),
        response.data.connected === true,
        Number(response.data.projectCount ?? 0)
      )
    case "projects-list":
      return renderTable(
        [
          { key: "id", label: "ID", maxWidth: 18 },
          { key: "title", label: "Title", maxWidth: 28 },
          { key: "status", label: "Status", maxWidth: 12 },
          { key: "visibility", label: "Visibility", maxWidth: 12 },
          { key: "updatedAt", label: "Updated", maxWidth: 24 },
        ],
        (response.data.projects as Array<Record<string, unknown>>).map(
          (project) => ({
            ...project,
            updatedAt: formatDateSummary(project.updatedAt),
          })
        )
      )
    case "tasks-list":
      return renderTable(
        [
          { key: "id", label: "ID", maxWidth: 18 },
          { key: "title", label: "Title", maxWidth: 28 },
          { key: "status", label: "Status", maxWidth: 12 },
          { key: "priority", label: "Priority", maxWidth: 10 },
          { key: "assignee", label: "Assignee", maxWidth: 18 },
          { key: "updatedAt", label: "Updated", maxWidth: 24 },
        ],
        (response.data.tasks as Array<Record<string, unknown>>).map((task) => ({
          ...task,
          assignee:
            (
              task.assignee as {
                name?: string | null
                email?: string | null
              } | null
            )?.name ??
            (task.assignee as { email?: string | null } | null)?.email ??
            "-",
          updatedAt: formatDateSummary(task.updatedAt),
        }))
      )
    case "comments-list":
      return renderTable(
        [
          { key: "id", label: "ID", maxWidth: 18 },
          { key: "author", label: "Author", maxWidth: 18 },
          { key: "content", label: "Content", maxWidth: 40 },
          { key: "createdAt", label: "Created", maxWidth: 24 },
        ],
        (response.data.comments as Array<Record<string, unknown>>).map(
          (comment) => ({
            ...comment,
            author:
              (
                comment.author as {
                  name?: string | null
                  email?: string | null
                } | null
              )?.name ??
              (comment.author as { email?: string | null } | null)?.email ??
              "-",
            createdAt: formatDateSummary(comment.createdAt),
          })
        )
      )
    case "notes-list":
      return renderTable(
        [
          { key: "id", label: "ID", maxWidth: 18 },
          { key: "title", label: "Title", maxWidth: 24 },
          { key: "isPinned", label: "Pinned", maxWidth: 6 },
          { key: "folder", label: "Folder", maxWidth: 16 },
          { key: "author", label: "Author", maxWidth: 18 },
          { key: "updatedAt", label: "Updated", maxWidth: 24 },
        ],
        (response.data.notes as Array<Record<string, unknown>>).map((note) => ({
          ...note,
          author:
            (
              note.author as {
                name?: string | null
                email?: string | null
              } | null
            )?.name ??
            (note.author as { email?: string | null } | null)?.email ??
            "-",
          folder: (note.folder as { name?: string | null } | null)?.name ?? "-",
          updatedAt: formatDateSummary(note.updatedAt),
        }))
      )
    case "project-detail":
      return renderProjectDetail(response.data)
    case "task-detail":
      return renderTaskDetail(response.data)
    case "comment-detail":
      return renderCommentDetail(response.data)
    case "note-detail":
      return renderNoteDetail(response.data)
    default:
      return JSON.stringify(response.data, null, 2)
  }
}
