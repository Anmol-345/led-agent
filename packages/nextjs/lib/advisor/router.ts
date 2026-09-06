import type { AdvisorResearchConfig } from "./config";

/**
 * The 0G Compute Router adapter.
 *
 * One capped request to one pinned model per advisor run. The Router key travels in an
 * Authorization header, the configured provider price caps are declared on every request, and the
 * returned usage is validated before it can meter a customer. A malformed, over-allowance, or
 * wrong-model response is a retryable failure rather than an answer, so a failed run never
 * produces fabricated research.
 */

export type RouterMessage = {
  content: string;
  role: "assistant" | "system" | "user";
};

export type RouterUsage = {
  completionTokens: number;
  promptTokens: number;
};

export type RouterFailureReason = "invalid-response" | "provider-unavailable";

export type RouterResult =
  | { content: string; kind: "completed"; model: string; usage: RouterUsage }
  | { kind: "failed"; reason: RouterFailureReason; retryable: boolean };

type UnknownRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export class RouterAdapter {
  private readonly config: AdvisorResearchConfig;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: { config: AdvisorResearchConfig; fetch?: typeof fetch }) {
    this.config = options.config;
    this.fetchImplementation = options.fetch ?? fetch;
  }

  async complete(input: {
    completionTokenAllowance: number;
    messages: readonly RouterMessage[];
  }): Promise<RouterResult> {
    if (input.messages.length === 0) {
      throw new Error("Advisor Router request requires at least one message.");
    }
    if (
      !Number.isSafeInteger(input.completionTokenAllowance) ||
      input.completionTokenAllowance <= 0 ||
      input.completionTokenAllowance > this.config.pricing.completionTokenAllowance
    ) {
      throw new Error("Advisor Router completion allowance is outside the configured bound.");
    }

    let payload: unknown;
    try {
      const response = await this.fetchImplementation(
        `${this.config.router.baseUrl}/chat/completions`,
        {
          body: JSON.stringify({
            max_tokens: input.completionTokenAllowance,
            messages: input.messages.map(message => ({
              content: message.content,
              role: message.role,
            })),
            model: this.config.router.model,
            stream: false,
          }),
          headers: {
            authorization: `Bearer ${this.config.router.apiKey}`,
            "content-type": "application/json",
            // Router refuses a provider whose price exceeds the quoted rate snapshot.
            "x-max-completion-price":
              this.config.router.maxCompletionPriceMicroUsdcPerMillionTokens.toString(),
            "x-max-prompt-price":
              this.config.router.maxPromptPriceMicroUsdcPerMillionTokens.toString(),
          },
          method: "POST",
          signal: AbortSignal.timeout(this.config.router.timeoutMilliseconds),
        },
      );
      // No canned-response fallback. Returning plausible investment prose when the 0G
      // router is unreachable made a completely disconnected deployment look healthy, and
      // the text was indistinguishable from a real inference result. Failures surface.
      if (!response.ok) {
        return { kind: "failed", reason: "provider-unavailable", retryable: true };
      }
      payload = await response.json();
    } catch {
      return { kind: "failed", reason: "provider-unavailable", retryable: true };
    }

    return this.validated(payload, input.completionTokenAllowance);
  }

  private validated(payload: unknown, completionTokenAllowance: number): RouterResult {
    const invalid: RouterResult = {
      kind: "failed",
      reason: "invalid-response",
      retryable: true,
    };
    if (!isRecord(payload)) return invalid;

    if (payload.model !== this.config.router.model) return invalid;

    const { choices } = payload;
    if (!Array.isArray(choices) || choices.length === 0) return invalid;
    const [choice] = choices;
    if (!isRecord(choice) || !isRecord(choice.message)) return invalid;
    const { content } = choice.message;
    if (typeof content !== "string" || content.length === 0) return invalid;

    if (!isRecord(payload.usage)) return invalid;
    const promptTokens = tokenCount(payload.usage.prompt_tokens);
    const completionTokens = tokenCount(payload.usage.completion_tokens);
    if (promptTokens === null || completionTokens === null) return invalid;
    // Usage beyond what was quoted cannot be metered against the disclosed maximum.
    if (completionTokens > completionTokenAllowance) return invalid;
    if (promptTokens > this.config.pricing.maxPromptTokens) return invalid;

    return {
      content,
      kind: "completed",
      model: this.config.router.model,
      usage: { completionTokens, promptTokens },
    };
  }
}
