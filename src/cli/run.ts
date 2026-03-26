import {
  CreateCommentSchema,
  CreateNoteSchema,
  CreateProjectSchema,
  CreateTaskSchema,
  GetNoteSchema,
  GetProjectSchema,
  GetTaskSchema,
  ListCommentsSchema,
  ListNotesSchema,
  ListProjectsSchema,
  ListTasksSchema,
} from "../schemas"
import {
  normalizeBaseUrl,
  removeCliConfig,
  resolveCliConfig,
  type ResolvedCliConfig,
  writeCliConfig,
} from "./config"
import { CLI_PRIMARY_COMMAND } from "./constants"
import { CliError } from "./errors"
import { renderCommandResponse } from "./format"
import {
  createPromptHandler,
  isInteractiveLoginAvailable,
  promptForLoginMethod,
  promptForRequiredValue,
  type PromptHandler,
  resolveRequestedLoginMethod,
} from "./login"
import { callMcpTool } from "./mcpClient"
import {
  getBooleanFlag,
  getNumberFlag,
  getPositionalOrFlag,
  getStringFlag,
  getStringListFlag,
  parseCliArgs,
  type ParsedCliArgs,
} from "./parse"
import { loginWithBrowser } from "./webLogin"

type EnvLike = Record<string, string | undefined>

type OutputKind =
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
  config?: ResolvedCliConfig
  data: Record<string, unknown>
  kind: OutputKind
}

type RunCliOptions = {
  env?: EnvLike
  fetchImpl?: typeof fetch
  input?: NodeJS.ReadableStream
  openBrowser?: (url: string) => Promise<boolean>
  prompt?: PromptHandler
  stderr?: (message: string) => void
  stdout?: (message: string) => void
  webLoginHandler?: (options: {
    baseUrl: string
    openBrowser?: (url: string) => Promise<boolean>
    stdout?: (message: string) => void
  }) => Promise<{ authMode: "web"; token: string; url: string }>
  output?: NodeJS.WritableStream
}

function cleanObject<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  ) as T
}

function parseJsonFlag(
  parsed: ParsedCliArgs,
  flagName: string
): Record<string, unknown> | unknown[] | undefined {
  const value = getStringFlag(parsed.flags, flagName)
  if (!value) return undefined

  try {
    return JSON.parse(value) as Record<string, unknown> | unknown[]
  } catch {
    throw new CliError(`Flag --${flagName} must be valid JSON`)
  }
}

function requireAuthConfig(config: ResolvedCliConfig) {
  if (!config.token) {
    throw new CliError(
      "Authentication required. Run: fbh auth login"
    )
  }

  return {
    token: config.token,
    url: config.url,
  }
}

async function resolveLoginValue(options: {
  canPrompt: boolean
  currentValue?: string
  errorMessage: string
  label: string
  prompt: PromptHandler
}): Promise<string> {
  if (options.currentValue) return options.currentValue
  if (!options.canPrompt) {
    throw new CliError(options.errorMessage)
  }

  return promptForRequiredValue(
    options.prompt,
    options.label,
    options.currentValue
  )
}

async function validateConnection(
  config: ResolvedCliConfig,
  fetchImpl?: typeof fetch
) {
  const auth = requireAuthConfig(config)
  return callMcpTool<{ projects?: Array<Record<string, unknown>> }>({
    baseUrl: auth.url,
    token: auth.token,
    tool: "list_projects",
    arguments: { limit: 1 },
    fetchImpl,
  })
}

async function executeAuthCommand(
  parsed: ParsedCliArgs,
  config: ResolvedCliConfig,
  fetchImpl?: typeof fetch,
  options: RunCliOptions = {}
): Promise<CommandResponse> {
  switch (parsed.action) {
    case "login": {
      const prompt =
        options.prompt ?? createPromptHandler(options.input, options.output)

      const requestedMethod = resolveRequestedLoginMethod(
        getStringFlag(parsed.flags, "method")
      )
      const canPromptForMethod =
        Boolean(options.prompt) ||
        isInteractiveLoginAvailable(options.input, options.output)
      const canPromptForValues = canPromptForMethod
      const loginMethod =
        requestedMethod ??
        (canPromptForMethod
          ? await promptForLoginMethod(prompt)
          : config.token
            ? "token"
            : null)
      const preferredUrl = config.url
      const preferredToken =
        canPromptForValues &&
        config.tokenSource !== "flag" &&
        config.tokenSource !== "env"
          ? undefined
          : config.token

      if (!loginMethod) {
        throw new CliError(
          `Login method is required. Use --method web|token or run ${CLI_PRIMARY_COMMAND} auth login interactively.`
        )
      }

      let normalizedConfig: {
        authMode: "token" | "web"
        token: string
        url: string
      }

      if (loginMethod === "web") {
        const baseUrl = await resolveLoginValue({
          canPrompt: canPromptForValues,
          currentValue: preferredUrl,
          errorMessage:
            "FeedbackHive URL is required for web login. Use --url or FBH_URL.",
          label: "FeedbackHive URL",
          prompt,
        })
        const webLoginHandler = options.webLoginHandler ?? loginWithBrowser
        const result = await webLoginHandler({
          baseUrl,
          openBrowser: options.openBrowser,
          stdout: options.stdout,
        })
        normalizedConfig = {
          authMode: "web",
          token: result.token,
          url: normalizeBaseUrl(result.url),
        }
      } else {
        const url = await resolveLoginValue({
          canPrompt: canPromptForValues,
          currentValue: preferredUrl,
          errorMessage:
            "FeedbackHive URL is required for token login. Use --url or FBH_URL.",
          label: "FeedbackHive URL",
          prompt,
        })
        const token = await resolveLoginValue({
          canPrompt: canPromptForValues,
          currentValue: preferredToken,
          errorMessage:
            "Personal access token is required for token login. Use --token or FBH_TOKEN.",
          label: "Personal access token",
          prompt,
        })
        normalizedConfig = {
          authMode: "token",
          token,
          url: normalizeBaseUrl(url),
        }
      }

      await validateConnection(
        {
          ...config,
          ...normalizedConfig,
        },
        fetchImpl
      )

      await writeCliConfig(config.configPath, normalizedConfig)

      return {
        kind: "auth-login",
        data: {
          authMode: normalizedConfig.authMode,
          configPath: config.configPath,
          url: normalizedConfig.url,
        },
      }
    }
    case "logout": {
      const removed = await removeCliConfig(config.configPath)
      return {
        kind: "auth-logout",
        data: {
          configPath: config.configPath,
          removed,
        },
      }
    }
    case "status": {
      if (!config.url || !config.token) {
        return {
          kind: "auth-status",
          config,
          data: {
            config,
            connected: false,
            projectCount: 0,
          },
        }
      }

      const result = await validateConnection(config, fetchImpl)

      return {
        kind: "auth-status",
        config,
        data: {
          config,
          connected: true,
          projectCount: Array.isArray(result.projects)
            ? result.projects.length
            : 0,
        },
      }
    }
    default:
      throw new CliError("Unknown auth command. Use login, logout, or status.")
  }
}

async function executeProjectsCommand(
  parsed: ParsedCliArgs,
  config: ResolvedCliConfig,
  fetchImpl?: typeof fetch
): Promise<CommandResponse> {
  const auth = requireAuthConfig(config)

  switch (parsed.action) {
    case "list": {
      const argumentsInput = ListProjectsSchema.parse(
        cleanObject({
          limit: getNumberFlag(parsed.flags, "limit"),
          status: getStringFlag(parsed.flags, "status"),
          tag: getStringFlag(parsed.flags, "tag"),
          visibility: getStringFlag(parsed.flags, "visibility"),
        })
      )

      const result = await callMcpTool<Record<string, unknown>>({
        arguments: argumentsInput,
        baseUrl: auth.url,
        fetchImpl,
        token: auth.token,
        tool: "list_projects",
      })

      return { kind: "projects-list", data: result }
    }
    case "get": {
      const argumentsInput = GetProjectSchema.parse({
        projectId: getPositionalOrFlag(parsed, 0, "project-id", "Project ID"),
      })

      const result = await callMcpTool<Record<string, unknown>>({
        arguments: argumentsInput,
        baseUrl: auth.url,
        fetchImpl,
        token: auth.token,
        tool: "get_project",
      })

      return { kind: "project-detail", data: result }
    }
    case "create": {
      const argumentsInput = CreateProjectSchema.parse(
        cleanObject({
          allowComments: getBooleanFlag(parsed.flags, "allow-comments"),
          description: getStringFlag(parsed.flags, "description"),
          requireApproval: getBooleanFlag(parsed.flags, "require-approval"),
          status: getStringFlag(parsed.flags, "status"),
          tags: getStringListFlag(parsed.flags, "tag"),
          taskPricingCurrency: getStringFlag(
            parsed.flags,
            "task-pricing-currency"
          ),
          taskPricingEnabled: getBooleanFlag(
            parsed.flags,
            "task-pricing-enabled"
          ),
          taskStatuses: parseJsonFlag(parsed, "task-statuses-json"),
          title: getStringFlag(parsed.flags, "title"),
          visibility: getStringFlag(parsed.flags, "visibility"),
        })
      )

      const result = await callMcpTool<Record<string, unknown>>({
        arguments: argumentsInput,
        baseUrl: auth.url,
        fetchImpl,
        token: auth.token,
        tool: "create_project",
      })

      return { kind: "project-detail", data: result }
    }
    default:
      throw new CliError("Unknown projects command. Use list, get, or create.")
  }
}

async function executeTasksCommand(
  parsed: ParsedCliArgs,
  config: ResolvedCliConfig,
  fetchImpl?: typeof fetch
): Promise<CommandResponse> {
  const auth = requireAuthConfig(config)

  switch (parsed.action) {
    case "list": {
      const argumentsInput = ListTasksSchema.parse(
        cleanObject({
          assigneeId: getStringFlag(parsed.flags, "assignee-id"),
          cursor: getStringFlag(parsed.flags, "cursor"),
          limit: getNumberFlag(parsed.flags, "limit"),
          projectId: getPositionalOrFlag(parsed, 0, "project-id", "Project ID"),
          status: getStringFlag(parsed.flags, "status"),
          updatedSince: getStringFlag(parsed.flags, "updated-since"),
        })
      )

      const result = await callMcpTool<Record<string, unknown>>({
        arguments: argumentsInput,
        baseUrl: auth.url,
        fetchImpl,
        token: auth.token,
        tool: "list_tasks",
      })

      return { kind: "tasks-list", data: result }
    }
    case "get": {
      const argumentsInput = GetTaskSchema.parse({
        projectId: getPositionalOrFlag(parsed, 0, "project-id", "Project ID"),
        taskId: getPositionalOrFlag(parsed, 1, "task-id", "Task ID"),
      })

      const result = await callMcpTool<Record<string, unknown>>({
        arguments: argumentsInput,
        baseUrl: auth.url,
        fetchImpl,
        token: auth.token,
        tool: "get_task",
      })

      return { kind: "task-detail", data: result }
    }
    case "create": {
      const argumentsInput = CreateTaskSchema.parse(
        cleanObject({
          assigneeId: getStringFlag(parsed.flags, "assignee-id"),
          description: getStringFlag(parsed.flags, "description"),
          dueDate: getStringFlag(parsed.flags, "due-date"),
          price: getStringFlag(parsed.flags, "price"),
          priority: getStringFlag(parsed.flags, "priority"),
          projectId: getPositionalOrFlag(parsed, 0, "project-id", "Project ID"),
          status: getStringFlag(parsed.flags, "status"),
          tags: getStringListFlag(parsed.flags, "tag"),
          taskGroupId: getStringFlag(parsed.flags, "task-group-id"),
          title: getStringFlag(parsed.flags, "title"),
        })
      )

      const result = await callMcpTool<Record<string, unknown>>({
        arguments: argumentsInput,
        baseUrl: auth.url,
        fetchImpl,
        token: auth.token,
        tool: "create_task",
      })

      return { kind: "task-detail", data: result }
    }
    default:
      throw new CliError("Unknown tasks command. Use list, get, or create.")
  }
}

async function executeNotesCommand(
  parsed: ParsedCliArgs,
  config: ResolvedCliConfig,
  fetchImpl?: typeof fetch
): Promise<CommandResponse> {
  const auth = requireAuthConfig(config)

  switch (parsed.action) {
    case "list": {
      const argumentsInput = ListNotesSchema.parse(
        cleanObject({
          cursor: getStringFlag(parsed.flags, "cursor"),
          includeContent: getBooleanFlag(parsed.flags, "include-content"),
          limit: getNumberFlag(parsed.flags, "limit"),
          projectId: getPositionalOrFlag(parsed, 0, "project-id", "Project ID"),
        })
      )

      const result = await callMcpTool<Record<string, unknown>>({
        arguments: argumentsInput,
        baseUrl: auth.url,
        fetchImpl,
        token: auth.token,
        tool: "list_notes",
      })

      return { kind: "notes-list", data: result }
    }
    case "get": {
      const argumentsInput = GetNoteSchema.parse({
        noteId: getPositionalOrFlag(parsed, 1, "note-id", "Note ID"),
        projectId: getPositionalOrFlag(parsed, 0, "project-id", "Project ID"),
      })

      const result = await callMcpTool<Record<string, unknown>>({
        arguments: argumentsInput,
        baseUrl: auth.url,
        fetchImpl,
        token: auth.token,
        tool: "get_note",
      })

      return { kind: "note-detail", data: result }
    }
    case "create": {
      const argumentsInput = CreateNoteSchema.parse(
        cleanObject({
          content: getStringFlag(parsed.flags, "content"),
          folderId: getStringFlag(parsed.flags, "folder-id"),
          isPinned: getBooleanFlag(parsed.flags, "pinned"),
          projectId: getPositionalOrFlag(parsed, 0, "project-id", "Project ID"),
          title: getStringFlag(parsed.flags, "title"),
        })
      )

      const result = await callMcpTool<Record<string, unknown>>({
        arguments: argumentsInput,
        baseUrl: auth.url,
        fetchImpl,
        token: auth.token,
        tool: "create_note",
      })

      return { kind: "note-detail", data: result }
    }
    default:
      throw new CliError("Unknown notes command. Use list, get, or create.")
  }
}

async function executeCommentsCommand(
  parsed: ParsedCliArgs,
  config: ResolvedCliConfig,
  fetchImpl?: typeof fetch
): Promise<CommandResponse> {
  const auth = requireAuthConfig(config)

  switch (parsed.action) {
    case "list": {
      const argumentsInput = ListCommentsSchema.parse(
        cleanObject({
          limit: getNumberFlag(parsed.flags, "limit"),
          projectId: getPositionalOrFlag(parsed, 0, "project-id", "Project ID"),
          taskId: getPositionalOrFlag(parsed, 1, "task-id", "Task ID"),
        })
      )

      const result = await callMcpTool<Record<string, unknown>>({
        arguments: argumentsInput,
        baseUrl: auth.url,
        fetchImpl,
        token: auth.token,
        tool: "list_comments",
      })

      return { kind: "comments-list", data: result }
    }
    case "create": {
      const argumentsInput = CreateCommentSchema.parse(
        cleanObject({
          content: getStringFlag(parsed.flags, "content"),
          projectId: getPositionalOrFlag(parsed, 0, "project-id", "Project ID"),
          taskId: getPositionalOrFlag(parsed, 1, "task-id", "Task ID"),
        })
      )

      const result = await callMcpTool<Record<string, unknown>>({
        arguments: argumentsInput,
        baseUrl: auth.url,
        fetchImpl,
        token: auth.token,
        tool: "create_comment",
      })

      return { kind: "comment-detail", data: result }
    }
    default:
      throw new CliError("Unknown comments command. Use list or create.")
  }
}

async function executeCommand(
  parsed: ParsedCliArgs,
  config: ResolvedCliConfig,
  fetchImpl?: typeof fetch
): Promise<CommandResponse> {
  if (parsed.helpRequested || !parsed.group) {
    return { kind: "help", data: {} }
  }

  if (!parsed.action) {
    throw new CliError("An action is required. Use --help for usage.")
  }

  switch (parsed.group) {
    case "auth":
      return executeAuthCommand(parsed, config, fetchImpl)
    case "projects":
      return executeProjectsCommand(parsed, config, fetchImpl)
    case "tasks":
      return executeTasksCommand(parsed, config, fetchImpl)
    case "comments":
      return executeCommentsCommand(parsed, config, fetchImpl)
    case "notes":
      return executeNotesCommand(parsed, config, fetchImpl)
    default:
      throw new CliError(
        "Unknown command group. Use auth, projects, tasks, comments, or notes."
      )
  }
}

function getJsonOutput(parsed: ParsedCliArgs) {
  return getBooleanFlag(parsed.flags, "json") === true
}

export async function runCli(
  argv: string[],
  options: RunCliOptions = {}
): Promise<number> {
  const stdout = options.stdout ?? console.log
  const stderr = options.stderr ?? console.error

  try {
    const parsed = parseCliArgs(argv)
    const config = await resolveCliConfig(parsed, options.env)
    const response =
      parsed.group === "auth" && parsed.action && !parsed.helpRequested
        ? await executeAuthCommand(parsed, config, options.fetchImpl, options)
        : await executeCommand(parsed, config, options.fetchImpl)
    const jsonOutput = getJsonOutput(parsed)

    stdout(
      jsonOutput && response.kind !== "help"
        ? `${JSON.stringify(response.data, null, 2)}`
        : renderCommandResponse(response, config)
    )

    return 0
  } catch (error) {
    if (error instanceof CliError) {
      stderr(error.message)
      return error.exitCode
    }

    const message = error instanceof Error ? error.message : "Unknown CLI error"
    stderr(message)
    return 1
  }
}
