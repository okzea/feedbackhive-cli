import { CliError } from "./errors"

// A project page URL looks like https://feedbackhive.app/<locale>/projects/<id>
// and may carry the Tasks sidebar's selected group as `?group=<groupId>` (or
// `uncategorized`). "all" is the sidebar's default and means no group filter.
const ALL_TASK_GROUPS_ID = "all"
const TASK_GROUP_QUERY_PARAM = "group"

export type ProjectUrlRef = {
  projectId: string
  taskGroupId?: string
}

export function isProjectUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

export function parseProjectUrl(value: string): ProjectUrlRef {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new CliError(`Invalid project URL: ${value}`)
  }

  const segments = url.pathname.split("/").filter(Boolean)
  const projectsIndex = segments.indexOf("projects")
  const projectId =
    projectsIndex >= 0 ? segments[projectsIndex + 1] : undefined

  if (!projectId) {
    throw new CliError(
      `Project URL must look like https://<host>/<locale>/projects/<projectId>: ${value}`
    )
  }

  const group = url.searchParams.get(TASK_GROUP_QUERY_PARAM)?.trim()

  return {
    projectId: decodeURIComponent(projectId),
    taskGroupId: group && group !== ALL_TASK_GROUPS_ID ? group : undefined,
  }
}
