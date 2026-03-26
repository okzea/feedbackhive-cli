import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import type { IncomingMessage } from "node:http"
import { createServer } from "node:http"

import { normalizeBaseUrl } from "./config"
import {
  CLI_DEFAULT_PAT_EXPIRATION_DAYS,
  CLI_DEFAULT_PAT_NAME,
  CLI_WEB_AUTH_CALLBACK_PATH,
  CLI_WEB_AUTH_ROUTE,
} from "./constants"
import { CliError } from "./errors"

type BrowserOpener = (url: string) => Promise<boolean>

type WebLoginResult = {
  authMode: "web"
  token: string
  url: string
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost"
}

function buildWebAuthStartUrl(
  baseUrl: string,
  redirectUri: string,
  state: string
) {
  const url = new URL(CLI_WEB_AUTH_ROUTE, ensureTrailingSlash(baseUrl))
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("state", state)
  url.searchParams.set("name", CLI_DEFAULT_PAT_NAME)
  url.searchParams.set(
    "expires_in_days",
    String(CLI_DEFAULT_PAT_EXPIRATION_DAYS)
  )
  return url.toString()
}

async function collectRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return Buffer.concat(chunks).toString("utf8")
}

async function openBrowserWithSystem(url: string): Promise<boolean> {
  const platform = process.platform

  const command =
    platform === "darwin"
      ? { command: "open", args: [url] }
      : platform === "win32"
        ? { command: "cmd", args: ["/c", "start", "", url] }
        : { command: "xdg-open", args: [url] }

  return new Promise((resolve) => {
    const child = spawn(command.command, command.args, {
      detached: true,
      stdio: "ignore",
    })

    child.once("error", () => resolve(false))
    child.once("spawn", () => {
      child.unref()
      resolve(true)
    })
  })
}

function buildRandomToken(): string {
  return randomBytes(32)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

function renderCallbackPage(title: string, message: string) {
  return `<!doctype html><html><head><title>${escapeHtml(
    title
  )}</title></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(
    message
  )}</p></body></html>`
}

async function createLoopbackTokenListener(state: string): Promise<{
  redirectUri: string
  waitForToken: Promise<string>
}> {
  return new Promise((resolve, reject) => {
    let settled = false
    let server: ReturnType<typeof createServer> | null = null

    const finishWithError = (message: string) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      server?.close()
      reject(new CliError(message))
    }

    const timeout = setTimeout(
      () => {
        finishWithError("Timed out waiting for browser login to complete")
      },
      5 * 60 * 1000
    )

    server = createServer(async (req, res) => {
      const requestUrl = new URL(
        req.url || CLI_WEB_AUTH_CALLBACK_PATH,
        "http://127.0.0.1"
      )

      if (
        !isLoopbackHostname(requestUrl.hostname) &&
        requestUrl.hostname !== "127.0.0.1"
      ) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
        res.end(
          renderCallbackPage("Invalid callback", "Invalid callback host.")
        )
        return
      }

      if (requestUrl.pathname !== CLI_WEB_AUTH_CALLBACK_PATH) {
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" })
        res.end(renderCallbackPage("Not found", "Unknown callback path."))
        return
      }

      const params =
        req.method === "POST"
          ? new URLSearchParams(await collectRequestBody(req))
          : requestUrl.searchParams

      const returnedState = params.get("state")
      const token = params.get("token")
      const error = params.get("error")
      const description =
        params.get("error_description") || "Browser login failed."

      if (returnedState !== state) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
        res.end(
          renderCallbackPage("Login failed", "State verification failed.")
        )
        return
      }

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
        res.end(renderCallbackPage("Login failed", description))
        finishWithError(description)
        return
      }

      if (!token) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
        res.end(renderCallbackPage("Login failed", "Missing CLI token."))
        return
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end(
        renderCallbackPage(
          "Login complete",
          "FeedbackHive CLI is now connected. You can close this tab."
        )
      )

      if (settled) return

      clearTimeout(timeout)
      settled = true
      server?.close()
      tokenResolver(token)
    })

    server.on("error", (error) => {
      finishWithError(
        error instanceof Error
          ? error.message
          : "Failed to start browser login callback server"
      )
    })

    let tokenResolver = (_token: string) => {}
    const waitForToken = new Promise<string>((tokenResolve) => {
      tokenResolver = tokenResolve
    })

    server.listen(0, "127.0.0.1", () => {
      const address = server?.address()
      const port =
        address && typeof address === "object" ? String(address.port) : "0"
      resolve({
        redirectUri: `http://127.0.0.1:${port}${CLI_WEB_AUTH_CALLBACK_PATH}`,
        waitForToken,
      })
    })
  })
}

export async function loginWithBrowser(options: {
  baseUrl: string
  openBrowser?: BrowserOpener
  stdout?: (message: string) => void
}): Promise<WebLoginResult> {
  const stdout = options.stdout ?? console.log
  const openBrowser = options.openBrowser ?? openBrowserWithSystem
  const normalizedUrl = normalizeBaseUrl(options.baseUrl)
  const state = buildRandomToken()
  const callbackListener = await createLoopbackTokenListener(state)
  const authStartUrl = buildWebAuthStartUrl(
    normalizedUrl,
    callbackListener.redirectUri,
    state
  )

  stdout("Opening your browser for FeedbackHive web login...")
  const opened = await openBrowser(authStartUrl)
  if (!opened) {
    stdout("Open this URL in your browser to continue:")
    stdout(authStartUrl)
  }

  const token = await callbackListener.waitForToken

  return {
    authMode: "web",
    token,
    url: normalizedUrl,
  }
}
