import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"

import { CliError } from "../src/cli/errors"
import { parseProjectUrl } from "../src/cli/projectUrl"
import { runCli } from "../src/cli/run"

describe("parseProjectUrl", () => {
  it("reads the project id and group from a project page URL", () => {
    assert.deepEqual(
      parseProjectUrl(
        "https://feedbackhive.app/en/projects/proj_1?group=grp_1#tasks/t1"
      ),
      { projectId: "proj_1", taskGroupId: "grp_1" }
    )
  })

  it("keeps uncategorized and drops the all-tasks default", () => {
    assert.equal(
      parseProjectUrl(
        "https://feedbackhive.app/fr/projects/proj_1?group=uncategorized"
      ).taskGroupId,
      "uncategorized"
    )
    assert.equal(
      parseProjectUrl("https://feedbackhive.app/en/projects/proj_1?group=all")
        .taskGroupId,
      undefined
    )
    assert.equal(
      parseProjectUrl("http://localhost:3000/en/projects/proj_1/edit")
        .taskGroupId,
      undefined
    )
  })

  it("rejects URLs that are not project pages", () => {
    assert.throws(
      () => parseProjectUrl("https://feedbackhive.app/en/projects"),
      CliError
    )
    assert.throws(() => parseProjectUrl("https://"), CliError)
  })
})

async function listTasks(argv: string[]) {
  const calls: Array<Record<string, unknown>> = []
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)).params.arguments)
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          content: [
            { type: "text", text: JSON.stringify({ tasks: [], nextCursor: null }) },
          ],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )
  }) as typeof fetch
  const errors: string[] = []

  const exitCode = await runCli(["tasks", "list", ...argv, "--json"], {
    env: {
      FBH_CONFIG: path.join(os.tmpdir(), "fbh-test-missing", "config.json"),
      FBH_TOKEN: "fhp_test",
      FBH_URL: "https://feedbackhive.test",
    },
    fetchImpl,
    stderr: (message) => errors.push(message),
    stdout: () => undefined,
  })

  return { arguments: calls[0], errors, exitCode }
}

describe("fbh tasks list group filter", () => {
  it("passes --group as taskGroupId", async () => {
    const result = await listTasks(["proj_1", "--group", "grp_1"])
    assert.equal(result.exitCode, 0, result.errors.join("\n"))
    assert.equal(result.arguments.projectId, "proj_1")
    assert.equal(result.arguments.taskGroupId, "grp_1")
  })

  it("takes the project and group from a pasted project URL", async () => {
    const result = await listTasks([
      "https://feedbackhive.app/en/projects/proj_1?group=uncategorized",
    ])
    assert.equal(result.exitCode, 0, result.errors.join("\n"))
    assert.equal(result.arguments.projectId, "proj_1")
    assert.equal(result.arguments.taskGroupId, "uncategorized")
  })

  it("lets --group override the URL and --group all clear it", async () => {
    const overridden = await listTasks([
      "https://feedbackhive.app/en/projects/proj_1?group=grp_1",
      "--group",
      "grp_2",
    ])
    assert.equal(overridden.arguments.taskGroupId, "grp_2")

    const cleared = await listTasks([
      "https://feedbackhive.app/en/projects/proj_1?group=grp_1",
      "--group",
      "all",
    ])
    assert.equal(cleared.exitCode, 0, cleared.errors.join("\n"))
    assert.equal("taskGroupId" in cleared.arguments, false)
  })

  it("sends no group when none is given", async () => {
    const result = await listTasks(["proj_1"])
    assert.equal("taskGroupId" in result.arguments, false)
  })
})
