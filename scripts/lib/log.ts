const started = Date.now();

function elapsed(): string {
  return `${((Date.now() - started) / 1000).toFixed(1)}s`;
}

export const log = {
  info: (message: string, ...rest: unknown[]) =>
    console.log(`[${elapsed()}] ${message}`, ...rest),
  warn: (message: string, ...rest: unknown[]) =>
    console.warn(`[${elapsed()}] WARN ${message}`, ...rest),
  error: (message: string, ...rest: unknown[]) =>
    console.error(`[${elapsed()}] ERROR ${message}`, ...rest),
};

/** Thrown for responses that will never succeed on retry (4xx except 429). */
export class NonRetryableError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

/** Retries with exponential backoff — used for every outbound HTTP call. */
export async function retry<T>(
  fn: () => Promise<T>,
  options: { attempts?: number; baseDelayMs?: number; label?: string } = {},
): Promise<T> {
  const attempts = options.attempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 500;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (error instanceof NonRetryableError || attempt === attempts) break;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      log.warn(`${options.label ?? 'request'} failed (attempt ${attempt}/${attempts}), retrying in ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  return retry(async () => {
    const response = await fetch(url, init);
    if (!response.ok) {
      const message = `GET ${url} -> ${response.status} ${response.statusText}`;
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        throw new NonRetryableError(message, response.status);
      }
      throw new Error(message);
    }
    return (await response.json()) as T;
  }, { label: url });
}
