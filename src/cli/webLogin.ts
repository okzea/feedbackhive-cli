import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"
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
        ? // Not `cmd /c start`: cmd treats each `&` in the query string as a
          // command separator and drops everything after the first one.
          { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] }
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

const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`

const ALERT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 7v6"/><path d="M12 17h.01"/></svg>`

// Same look as the FeedbackHive CLI authorization pages, so the flow ends on
// a page that matches the one it started on.
function renderCallbackPage(options: {
  baseUrl: string
  kind: "success" | "error"
  title: string
  message: string
  hint: string
}) {
  const appUrl = ensureTrailingSlash(options.baseUrl)
  const logoUrl = new URL("fbh.svg", appUrl).toString()
  const icon = options.kind === "success" ? CHECK_ICON : ALERT_ICON

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(options.title)} · FeedbackHive CLI</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f4f5;
        --card: #ffffff;
        --border: #e4e4e7;
        --text: #111827;
        --muted: #52525b;
        --hive: #d97706;
        --icon-bg: rgba(251, 191, 36, 0.16);
        --glow: rgba(251, 191, 36, 0.22);
        --danger: #b91c1c;
        --danger-bg: #fef2f2;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          color-scheme: dark;
          --bg: #0b0c0f;
          --card: #09090b;
          --border: #1f1f23;
          --text: #f8fafc;
          --muted: #a1a1aa;
          --hive: #fbbf24;
          --icon-bg: rgba(251, 191, 36, 0.1);
          --glow: rgba(251, 191, 36, 0.12);
          --danger: #fca5a5;
          --danger-bg: rgba(127, 29, 29, 0.25);
        }
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 28px;
        padding: 32px 16px;
        background:
          radial-gradient(640px circle at 100% 0%, var(--glow), transparent 65%),
          var(--bg);
        color: var(--text);
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
          "Segoe UI", sans-serif;
        font-size: 14px;
        line-height: 1.55;
        -webkit-font-smoothing: antialiased;
      }
      .brand {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        color: var(--text);
        font-size: 18px;
        font-weight: 700;
        letter-spacing: -0.01em;
        text-decoration: none;
      }
      .brand img {
        width: 28px;
        height: 28px;
      }
      .brand .hive {
        color: var(--hive);
      }
      .card {
        width: 100%;
        max-width: 440px;
        padding: 32px;
        border: 1px solid var(--border);
        border-radius: 20px;
        background: var(--card);
        text-align: center;
      }
      .icon {
        width: 52px;
        height: 52px;
        margin: 0 auto;
        display: grid;
        place-items: center;
        border-radius: 50%;
        background: var(--icon-bg);
        color: var(--hive);
      }
      .icon.error {
        background: var(--danger-bg);
        color: var(--danger);
      }
      .icon svg {
        width: 24px;
        height: 24px;
      }
      h1 {
        margin: 20px 0 8px;
        font-size: 22px;
        font-weight: 700;
        line-height: 1.25;
        letter-spacing: -0.015em;
      }
      p {
        margin: 0;
        color: var(--muted);
      }
      .hint {
        margin-top: 20px;
        padding-top: 20px;
        border-top: 1px solid var(--border);
        font-size: 13px;
      }
      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 0.92em;
        color: var(--text);
      }
    </style>
  </head>
  <body>
    <a class="brand" href="${escapeHtml(appUrl)}">
      <img src="${escapeHtml(logoUrl)}" alt="" width="28" height="28" />
      <span>Feedback<span class="hive">Hive</span></span>
    </a>
    <main class="card">
      <div class="icon${options.kind === "error" ? " error" : ""}">${icon}</div>
      <h1>${escapeHtml(options.title)}</h1>
      <p>${escapeHtml(options.message)}</p>
      <p class="hint">${options.hint}</p>
    </main>
  </body>
</html>`
}

async function createLoopbackTokenListener(
  state: string,
  baseUrl: string
): Promise<{
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

    const sendPage = (
      res: ServerResponse,
      status: number,
      title: string,
      message: string
    ) => {
      const success = status === 200
      res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" })
      res.end(
        renderCallbackPage({
          baseUrl,
          kind: success ? "success" : "error",
          title,
          message,
          hint: success
            ? "Back in your terminal, run <code>fbh status</code> to check the connection."
            : "Run <code>fbh auth login</code> in your terminal to try again.",
        })
      )
    }

    server = createServer(async (req, res) => {
      const requestUrl = new URL(
        req.url || CLI_WEB_AUTH_CALLBACK_PATH,
        "http://127.0.0.1"
      )

      if (
        !isLoopbackHostname(requestUrl.hostname) &&
        requestUrl.hostname !== "127.0.0.1"
      ) {
        sendPage(res, 400, "Invalid callback", "Invalid callback host.")
        return
      }

      if (requestUrl.pathname !== CLI_WEB_AUTH_CALLBACK_PATH) {
        sendPage(res, 404, "Not found", "Unknown callback path.")
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
        sendPage(res, 400, "Login failed", "State verification failed.")
        return
      }

      if (error) {
        sendPage(res, 400, "Login failed", description)
        finishWithError(description)
        return
      }

      if (!token) {
        sendPage(res, 400, "Login failed", "Missing CLI token.")
        return
      }

      sendPage(
        res,
        200,
        "Login complete",
        "The FeedbackHive CLI is connected to your account. You can close this tab."
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
  const callbackListener = await createLoopbackTokenListener(
    state,
    normalizedUrl
  )
  const authStartUrl = buildWebAuthStartUrl(
    normalizedUrl,
    callbackListener.redirectUri,
    state
  )

  stdout("Opening your browser for FeedbackHive web login...")
  const opened = await openBrowser(authStartUrl)
  // A successful spawn does not prove the browser got the full URL, so always
  // print it for manual recovery.
  stdout(
    opened
      ? "If the browser did not open, or shows an error, open this URL instead:"
      : "Open this URL in your browser to continue:"
  )
  stdout(authStartUrl)

  const token = await callbackListener.waitForToken

  return {
    authMode: "web",
    token,
    url: normalizedUrl,
  }
}
