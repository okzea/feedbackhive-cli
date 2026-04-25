import {
  CreateCommentSchema,
  CreateNoteSchema,
  CreateProjectSchema,
  CreateTaskGroupSchema,
  CreateTaskSchema,
  DeleteTaskGroupSchema,
  DeleteTaskSchema,
  GetNoteSchema,
  GetProjectSchema,
  GetTaskSchema,
  ListCommentsSchema,
  ListNotesSchema,
  ListProjectsSchema,
  ListTaskGroupsSchema,
  ListTasksSchema,
  UpdateTaskGroupSchema,
  UpdateTaskSchema,
} from "../schemas"
import {
  normalizeBaseUrl,
  removeCliConfig,
  resolveCliConfig,
  type ResolvedCliConfig,
  writeCliConfig,
} from "./config"
import { CLI_AUTH_VALIDATE_ROUTE, CLI_PRIMARY_COMMAND } from "./constants"
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
  | "task-deleted"
  | "task-detail"
  | "task-group-deleted"
  | "task-group-detail"
  | "task-groups-list"
  | "tasks-list"

type CommandResponse = {
  config?: ResolvedCliConfig
  data: Record<string, unknown>
  kind: OutputKind
}

type CommandValidationSpec = {
  allowedFlags: Set<string>
  maxPositionals: number
  positionalFlagNames?: Array<string | undefined>
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

const GLOBAL_FLAG_NAMES = new Set(["config", "help", "json", "token", "url"])

const COMMAND_VALIDATION_SPECS: Record<
  string,
  Record<string, CommandValidationSpec>
> = {
  auth: {
    login: {
      allowedFlags: new Set(["method"]),
      maxPositionals: 0,
    },
    logout: {
      allowedFlags: new Set(),
      maxPositionals: 0,
    },
    status: {
      allowedFlags: new Set(),
      maxPositionals: 0,
    },
  },
  comments: {
    create: {
      allowedFlags: new Set(["content", "project-id", "task-id"]),
      maxPositionals: 2,
      positionalFlagNames: ["project-id", "task-id"],
    },
    list: {
      allowedFlags: new Set(["limit", "project-id", "task-id"]),
      maxPositionals: 2,
      positionalFlagNames: ["project-id", "task-id"],
    },
  },
  notes: {
    create: {
      allowedFlags: new Set([
        "content",
        "folder-id",
        "pinned",
        "project-id",
        "title",
      ]),
      maxPositionals: 1,
      positionalFlagNames: ["project-id"],
    },
    get: {
      allowedFlags: new Set(["note-id", "project-id"]),
      maxPositionals: 2,
      positionalFlagNames: ["project-id", "note-id"],
    },
    list: {
      allowedFlags: new Set([
        "cursor",
        "include-content",
        "limit",
        "project-id",
      ]),
      maxPositionals: 1,
      positionalFlagNames: ["project-id"],
    },
  },
  projects: {
    create: {
      allowedFlags: new Set([
        "allow-comments",
        "description",
        "require-approval",
        "status",
        "tag",
        "task-pricing-currency",
        "task-pricing-enabled",
        "task-statuses-json",
        "title",
        "visibility",
      ]),
      maxPositionals: 0,
    },
    get: {
      allowedFlags: new Set(["project-id"]),
      maxPositionals: 1,
      positionalFlagNames: ["project-id"],
    },
    list: {
      allowedFlags: new Set(["limit", "status", "tag", "visibility"]),
      maxPositionals: 0,
    },
  },
  "task-groups": {
    create: {
      allowedFlags: new Set([
        "icon",
        "icon-color",
        "name",
        "order",
        "project-id",
      ]),
      maxPositionals: 1,
      positionalFlagNames: ["project-id"],
    },
    delete: {
      allowedFlags: new Set(["group-id", "project-id"]),
      maxPositionals: 2,
      positionalFlagNames: ["project-id", "group-id"],
    },
    list: {
      allowedFlags: new Set(["project-id"]),
      maxPositionals: 1,
      positionalFlagNames: ["project-id"],
    },
    update: {
      allowedFlags: new Set([
        "group-id",
        "icon",
        "icon-color",
        "name",
        "order",
        "project-id",
      ]),
      maxPositionals: 2,
      positionalFlagNames: ["project-id", "group-id"],
    },
  },
  tasks: {
    create: {
      allowedFlags: new Set([
        "assignee-id",
        "description",
        "due-date",
        "price",
        "priority",
        "project-id",
        "status",
        "tag",
        "task-group-id",
        "title",
      ]),
      maxPositionals: 1,
      positionalFlagNames: ["project-id"],
    },
    delete: {
      allowedFlags: new Set(["project-id", "task-id"]),
      maxPositionals: 2,
      positionalFlagNames: ["project-id", "task-id"],
    },
    get: {
      allowedFlags: new Set(["project-id", "task-id"]),
      maxPositionals: 2,
      positionalFlagNames: ["project-id", "task-id"],
    },
    list: {
      allowedFlags: new Set([
        "assignee-id",
        "cursor",
        "limit",
        "project-id",
        "status",
        "updated-since",
      ]),
      maxPositionals: 1,
      positionalFlagNames: ["project-id"],
    },
    update: {
      allowedFlags: new Set([
        "assignee-id",
        "clear-assignee",
        "clear-due-date",
        "clear-price",
        "clear-task-group",
        "description",
        "due-date",
        "price",
        "priority",
        "project-id",
        "status",
        "task-group-id",
        "task-id",
        "title",
      ]),
      maxPositionals: 2,
      positionalFlagNames: ["project-id", "task-id"],
    },
  },
}

function cleanObject<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  ) as T
}

function sanitizeConfigForOutput(config: ResolvedCliConfig): Omit<
  ResolvedCliConfig,
  "savedConfig" | "token"
> & {
  savedConfig: Omit<
    NonNullable<ResolvedCliConfig["savedConfig"]>,
    "token"
  > | null
} {
  const { savedConfig, token: _token, ...rest } = config

  return {
    ...rest,
    savedConfig: savedConfig
      ? {
          authMode: savedConfig.authMode,
          url: savedConfig.url,
          version: savedConfig.version,
        }
      : null,
  }
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
    throw new CliError("Authentication required. Run: fbh auth login")
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
  const response = await (fetchImpl ?? fetch)(
    new URL(CLI_AUTH_VALIDATE_ROUTE, `${auth.url}/`).toString(),
    {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${auth.token}`,
      },
    }
  )

  if (response.ok) {
    return { authenticated: true }
  }

  const rawText = await response.text()
  let message = rawText || `Request failed with status ${response.status}`

  if (rawText) {
    try {
      const payload = JSON.parse(rawText) as { error?: string }
      if (payload.error) {
        message = payload.error
      }
    } catch {
      message = rawText
    }
  }

  throw new CliError(message, 1)
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
      const configForOutput = sanitizeConfigForOutput(config)

      if (!config.url || !config.token) {
        return {
          kind: "auth-status",
          config,
          data: {
            config: configForOutput,
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
          config: configForOutput,
          connected: true,
          projectCount: 0,
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
  switch (parsed.action) {
    case "list": {
      const auth = requireAuthConfig(config)
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
      const auth = requireAuthConfig(config)
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
      const auth = requireAuthConfig(config)
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
  switch (parsed.action) {
    case "list": {
      const auth = requireAuthConfig(config)
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
      const auth = requireAuthConfig(config)
      const argumentsInput = GetTaskSchema.parse({
        projectId: getPositionalOrFlag(parsed, 0, "project-id", "Project ID"),
        taskId: getPositionalOrFlag(parsed, 1, "task-id", "Task ID", [
          "project-id",
        ]),
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
      const auth = requireAuthConfig(config)
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
    case "update": {
      const auth = requireAuthConfig(config)
      const projectId = getPositionalOrFlag(
        parsed,
        0,
        "project-id",
        "Project ID"
      )
      const taskId = getPositionalOrFlag(parsed, 1, "task-id", "Task ID", [
        "project-id",
      ])

      const assigneeIdFlag = getStringFlag(parsed.flags, "assignee-id")
      const clearAssignee = getBooleanFlag(parsed.flags, "clear-assignee")
      const dueDateFlag = getStringFlag(parsed.flags, "due-date")
      const clearDueDate = getBooleanFlag(parsed.flags, "clear-due-date")
      const taskGroupIdFlag = getStringFlag(parsed.flags, "task-group-id")
      const clearTaskGroup = getBooleanFlag(parsed.flags, "clear-task-group")
      const priceFlag = getStringFlag(parsed.flags, "price")
      const clearPrice = getBooleanFlag(parsed.flags, "clear-price")

      if (clearAssignee && assigneeIdFlag !== undefined) {
        throw new CliError(
          "Use either --assignee-id or --clear-assignee, not both"
        )
      }
      if (clearDueDate && dueDateFlag !== undefined) {
        throw new CliError(
          "Use either --due-date or --clear-due-date, not both"
        )
      }
      if (clearTaskGroup && taskGroupIdFlag !== undefined) {
        throw new CliError(
          "Use either --task-group-id or --clear-task-group, not both"
        )
      }
      if (clearPrice && priceFlag !== undefined) {
        throw new CliError("Use either --price or --clear-price, not both")
      }

      const assigneeId = clearAssignee ? null : assigneeIdFlag
      const dueDate = clearDueDate ? null : dueDateFlag
      const taskGroupId = clearTaskGroup ? null : taskGroupIdFlag
      const price = clearPrice ? null : priceFlag

      const argumentsInput = UpdateTaskSchema.parse(
        cleanObject({
          assigneeId,
          description: getStringFlag(parsed.flags, "description"),
          dueDate,
          price,
          priority: getStringFlag(parsed.flags, "priority"),
          projectId,
          status: getStringFlag(parsed.flags, "status"),
          taskGroupId,
          taskId,
          title: getStringFlag(parsed.flags, "title"),
        })
      )

      const result = await callMcpTool<Record<string, unknown>>({
        arguments: argumentsInput,
        baseUrl: auth.url,
        fetchImpl,
        token: auth.token,
        tool: "update_task",
      })

      return { kind: "task-detail", data: result }
    }
    case "delete": {
      const auth = requireAuthConfig(config)
      const argumentsInput = DeleteTaskSchema.parse({
        projectId: getPositionalOrFlag(parsed, 0, "project-id", "Project ID"),
        taskId: getPositionalOrFlag(parsed, 1, "task-id", "Task ID", [
          "project-id",
        ]),
      })

      const result = await callMcpTool<Record<string, unknown>>({
        arguments: argumentsInput,
        baseUrl: auth.url,
        fetchImpl,
        token: auth.token,
        tool: "delete_task",
      })

      return { kind: "task-deleted", data: result }
    }
    default:
      throw new CliError(
        "Unknown tasks command. Use list, get, create, update, or delete."
      )
  }
}

async function executeTaskGroupsCommand(
  parsed: ParsedCliArgs,
  config: ResolvedCliConfig,
  fetchImpl?: typeof fetch
): Promise<CommandResponse> {
  switch (parsed.action) {
    case "list": {
      const auth = requireAuthConfig(config)
      const argumentsInput = ListTaskGroupsSchema.parse({
        projectId: getPositionalOrFlag(parsed, 0, "project-id", "Project ID"),
      })

      const result = await callMcpTool<Record<string, unknown>>({
        arguments: argumentsInput,
        baseUrl: auth.url,
        fetchImpl,
        token: auth.token,
        tool: "list_task_groups",
      })

      return { kind: "task-groups-list", data: result }
    }
    case "create": {
      const auth = requireAuthConfig(config)
      const projectId = getPositionalOrFlag(
        parsed,
        0,
        "project-id",
        "Project ID"
      )
      const name = getStringFlag(parsed.flags, "name")
      if (!name) {
        throw new CliError("--name is required for task-groups create")
      }
      const argumentsInput = CreateTaskGroupSchema.parse(
        cleanObject({
          icon: getStringFlag(parsed.flags, "icon"),
          iconColor: getStringFlag(parsed.flags, "icon-color"),
          name,
          order: getNumberFlag(parsed.flags, "order"),
          projectId,
        })
      )

      const result = await callMcpTool<Record<string, unknown>>({
        arguments: argumentsInput,
        baseUrl: auth.url,
        fetchImpl,
        token: auth.token,
        tool: "create_task_group",
      })

      return { kind: "task-group-detail", data: result }
    }
    case "update": {
      const auth = requireAuthConfig(config)
      const argumentsInput = UpdateTaskGroupSchema.parse(
        cleanObject({
          groupId: getPositionalOrFlag(parsed, 1, "group-id", "Task group ID", [
            "project-id",
          ]),
          icon: getStringFlag(parsed.flags, "icon"),
          iconColor: getStringFlag(parsed.flags, "icon-color"),
          name: getStringFlag(parsed.flags, "name"),
          order: getNumberFlag(parsed.flags, "order"),
          projectId: getPositionalOrFlag(parsed, 0, "project-id", "Project ID"),
        })
      )

      const result = await callMcpTool<Record<string, unknown>>({
        arguments: argumentsInput,
        baseUrl: auth.url,
        fetchImpl,
        token: auth.token,
        tool: "update_task_group",
      })

      return { kind: "task-group-detail", data: result }
    }
    case "delete": {
      const auth = requireAuthConfig(config)
      const argumentsInput = DeleteTaskGroupSchema.parse({
        groupId: getPositionalOrFlag(parsed, 1, "group-id", "Task group ID", [
          "project-id",
        ]),
        projectId: getPositionalOrFlag(parsed, 0, "project-id", "Project ID"),
      })

      const result = await callMcpTool<Record<string, unknown>>({
        arguments: argumentsInput,
        baseUrl: auth.url,
        fetchImpl,
        token: auth.token,
        tool: "delete_task_group",
      })

      return { kind: "task-group-deleted", data: result }
    }
    default:
      throw new CliError(
        "Unknown task-groups command. Use list, create, update, or delete."
      )
  }
}

async function executeNotesCommand(
  parsed: ParsedCliArgs,
  config: ResolvedCliConfig,
  fetchImpl?: typeof fetch
): Promise<CommandResponse> {
  switch (parsed.action) {
    case "list": {
      const auth = requireAuthConfig(config)
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
      const auth = requireAuthConfig(config)
      const argumentsInput = GetNoteSchema.parse({
        noteId: getPositionalOrFlag(parsed, 1, "note-id", "Note ID", [
          "project-id",
        ]),
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
      const auth = requireAuthConfig(config)
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
  switch (parsed.action) {
    case "list": {
      const auth = requireAuthConfig(config)
      const argumentsInput = ListCommentsSchema.parse(
        cleanObject({
          limit: getNumberFlag(parsed.flags, "limit"),
          projectId: getPositionalOrFlag(parsed, 0, "project-id", "Project ID"),
          taskId: getPositionalOrFlag(parsed, 1, "task-id", "Task ID", [
            "project-id",
          ]),
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
      const auth = requireAuthConfig(config)
      const argumentsInput = CreateCommentSchema.parse(
        cleanObject({
          content: getStringFlag(parsed.flags, "content"),
          projectId: getPositionalOrFlag(parsed, 0, "project-id", "Project ID"),
          taskId: getPositionalOrFlag(parsed, 1, "task-id", "Task ID", [
            "project-id",
          ]),
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
    case "task-groups":
      return executeTaskGroupsCommand(parsed, config, fetchImpl)
    case "comments":
      return executeCommentsCommand(parsed, config, fetchImpl)
    case "notes":
      return executeNotesCommand(parsed, config, fetchImpl)
    default:
      throw new CliError(
        "Unknown command group. Use auth, projects, tasks, task-groups, comments, or notes."
      )
  }
}

function getJsonOutput(parsed: ParsedCliArgs) {
  return getBooleanFlag(parsed.flags, "json") === true
}

function validateParsedCliArgs(parsed: ParsedCliArgs) {
  const commandSpec =
    parsed.group && parsed.action
      ? COMMAND_VALIDATION_SPECS[parsed.group]?.[parsed.action]
      : undefined

  if (!commandSpec) return

  const allowedFlags = new Set(GLOBAL_FLAG_NAMES)

  for (const flagName of commandSpec.allowedFlags) {
    allowedFlags.add(flagName)
  }

  const unsupportedFlags = Object.keys(parsed.flags).filter(
    (flagName) => !allowedFlags.has(flagName)
  )

  if (unsupportedFlags.length > 0) {
    const context =
      parsed.group && parsed.action
        ? `${parsed.group} ${parsed.action}`
        : "this command"
    const renderedFlags = unsupportedFlags
      .map((flagName) => `--${flagName}`)
      .join(", ")
    throw new CliError(`Unknown flag for ${context}: ${renderedFlags}`)
  }

  const maxAllowedPositionals = getMaxAllowedPositionals(parsed, commandSpec)

  if (parsed.positionals.length > maxAllowedPositionals) {
    const extras = parsed.positionals.slice(maxAllowedPositionals).join(", ")
    throw new CliError(
      `Unexpected positional argument for ${parsed.group} ${parsed.action}: ${extras}`
    )
  }
}

function getMaxAllowedPositionals(
  parsed: ParsedCliArgs,
  commandSpec: CommandValidationSpec
) {
  if (!commandSpec.positionalFlagNames?.length) {
    return commandSpec.maxPositionals
  }

  return commandSpec.positionalFlagNames.filter(
    (flagName) =>
      !flagName || getStringFlag(parsed.flags, flagName) === undefined
  ).length
}

export async function runCli(
  argv: string[],
  options: RunCliOptions = {}
): Promise<number> {
  const stdout = options.stdout ?? console.log
  const stderr = options.stderr ?? console.error

  try {
    const parsed = parseCliArgs(argv)
    const jsonOutput = getJsonOutput(parsed)
    validateParsedCliArgs(parsed)

    if (parsed.helpRequested) {
      stdout(renderCommandResponse({ kind: "help", data: {} }))
      return 0
    }

    const config = await resolveCliConfig(parsed, options.env)
    const response =
      parsed.group === "auth" && parsed.action
        ? await executeAuthCommand(parsed, config, options.fetchImpl, options)
        : await executeCommand(parsed, config, options.fetchImpl)

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
