import type { ProviderName } from "./provider";

export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderName,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Browser session expired or no profile selected — user must re-run login. */
export class ProviderAuthenticationError extends ProviderError {}

/** Response shape does not match what we expect — the private API likely changed. */
export class ProviderApiChangedError extends ProviderError {}

export class ProviderRateLimitError extends ProviderError {}

export class ProviderNetworkError extends ProviderError {}

/** We got a response but could not parse individual items from it. */
export class ProviderParseError extends ProviderError {}

/** Browser profile directory is locked by another process (interactive login open?). */
export class BrowserProfileBusyError extends ProviderError {}
