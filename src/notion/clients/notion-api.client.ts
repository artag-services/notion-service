import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { APIErrorCode, APIResponseError, Client as NotionClient } from '@notionhq/client'

/**
 * Thin wrapper around `@notionhq/client` that adds:
 *   - Explicit timeout (configurable; default 30s)
 *   - Retry with exponential backoff for 429 (rate-limit) and 5xx
 *   - `Retry-After` header respect when Notion returns one
 *
 * The SDK does NOT auto-retry by default. Since Notion rate-limits to
 * 3 req/s per integration, we hit 429s easily under any concurrent load
 * (e.g. scrapping batch fan-out to notion creates).
 */
@Injectable()
export class NotionApiClient implements OnModuleInit {
  private readonly logger = new Logger(NotionApiClient.name)
  private client!: NotionClient
  private maxRetries!: number
  private baseDelayMs!: number

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const token = this.config.getOrThrow<string>('NOTION_INTEGRATION_TOKEN')
    const timeoutMs = Number(this.config.get<string>('NOTION_API_TIMEOUT_MS') ?? 30_000)
    this.maxRetries = Number(this.config.get<string>('NOTION_API_MAX_RETRIES') ?? 3)
    this.baseDelayMs = Number(this.config.get<string>('NOTION_API_RETRY_BASE_MS') ?? 500)

    this.client = new NotionClient({ auth: token, timeoutMs })

    this.logger.log(
      `NotionApiClient ready — timeout=${timeoutMs}ms maxRetries=${this.maxRetries} baseDelay=${this.baseDelayMs}ms`,
    )
  }

  /** Direct access to the underlying SDK (use sparingly — prefer `withRetry`). */
  get sdk(): NotionClient {
    return this.client
  }

  /**
   * Wrap any SDK call with exponential-backoff retry on transient errors.
   *
   * Retries on:
   *   - `rate_limited` (HTTP 429) — respects `Retry-After` if present
   *   - `internal_server_error` / `service_unavailable` (5xx)
   *   - Network-level errors (no `code` on the APIResponseError)
   */
  async withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let lastError: unknown
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn()
      } catch (error) {
        lastError = error
        const retryable = this.isRetryable(error)
        if (!retryable || attempt === this.maxRetries) {
          throw error
        }
        const delay = this.computeDelay(error, attempt)
        this.logger.warn(
          `[${label}] attempt ${attempt + 1}/${this.maxRetries + 1} failed (${this.describe(error)}). ` +
            `Retrying in ${delay}ms`,
        )
        await this.sleep(delay)
      }
    }
    throw lastError
  }

  // ─────────────── helpers ───────────────

  private isRetryable(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    if (error instanceof APIResponseError) {
      return (
        error.code === APIErrorCode.RateLimited ||
        error.code === APIErrorCode.InternalServerError ||
        error.code === APIErrorCode.ServiceUnavailable
      )
    }
    // Network/timeout errors don't have a `code` — retry those too.
    return /timeout|ECONN|ETIMEDOUT|EAI_AGAIN|fetch failed/i.test(error.message)
  }

  private computeDelay(error: unknown, attempt: number): number {
    // Respect Retry-After when present (rate-limit responses).
    if (error instanceof APIResponseError) {
      const headers = (error as APIResponseError & { headers?: Record<string, string> }).headers
      const retryAfter = headers?.['retry-after'] ?? headers?.['Retry-After']
      if (retryAfter) {
        const secs = Number(retryAfter)
        if (!Number.isNaN(secs) && secs > 0) return secs * 1000
      }
    }
    // Otherwise: exponential 1x, 2x, 4x, ... of base
    return this.baseDelayMs * Math.pow(2, attempt)
  }

  private describe(error: unknown): string {
    if (error instanceof APIResponseError) return `${error.code} ${error.message}`
    if (error instanceof Error) return error.message
    return String(error)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
