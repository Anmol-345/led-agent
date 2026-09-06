import assert from "node:assert/strict";
import test from "node:test";

import { advisorTestConfig } from "./credit.test-support";
import { RouterAdapter, type RouterMessage } from "./router";

const config = advisorTestConfig();
const messages: readonly RouterMessage[] = [
  { content: "You are Leg.", role: "system" },
  { content: "Is EXMP undervalued?", role: "user" },
];

type RecordedRequest = { body: unknown; headers: Record<string, string>; url: string };

function completion(overrides: Record<string, unknown> = {}): unknown {
  return {
    choices: [{ finish_reason: "stop", message: { content: "Cited research.", role: "assistant" } }],
    model: "leg-pinned-model",
    usage: { completion_tokens: 800, prompt_tokens: 12_000, total_tokens: 12_800 },
    ...overrides,
  };
}

function fakeFetch(options: {
  recorded?: RecordedRequest[];
  respond?: () => Response | Promise<Response>;
}): typeof fetch {
  return async (input, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    options.recorded?.push({
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      headers,
      url: typeof input === "string" ? input : input.toString(),
    });
    if (options.respond) return options.respond();
    return new Response(JSON.stringify(completion()), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  };
}

function adapter(fetchImplementation: typeof fetch): RouterAdapter {
  return new RouterAdapter({ config, fetch: fetchImplementation });
}

test("sends one capped request to the pinned model", async () => {
  const recorded: RecordedRequest[] = [];
  const result = await adapter(fakeFetch({ recorded })).complete({
    completionTokenAllowance: 1500,
    messages,
  });

  assert.equal(result.kind, "completed");
  if (result.kind !== "completed") return;
  assert.equal(result.content, "Cited research.");
  assert.equal(result.model, "leg-pinned-model");
  assert.deepEqual(result.usage, { completionTokens: 800, promptTokens: 12_000 });

  assert.equal(recorded.length, 1, "exactly one provider call per run");
  const [request] = recorded;
  assert.match(request.url, /\/chat\/completions$/);
  assert.equal(request.headers.authorization, "Bearer router-api-key");
  assert.doesNotMatch(request.url, /router-api-key/);

  const body = request.body;
  assert.ok(body !== null && typeof body === "object");
  const parsed: Record<string, unknown> = { ...body };
  assert.equal(parsed.model, "leg-pinned-model");
  assert.equal(parsed.max_tokens, 1500);
  assert.equal(parsed.stream, false);
});

test("declares the configured provider price caps on every request", async () => {
  const recorded: RecordedRequest[] = [];
  await adapter(fakeFetch({ recorded })).complete({
    completionTokenAllowance: 1500,
    messages,
  });

  const { headers } = recorded[0];
  assert.equal(headers["x-max-prompt-price"], "3000");
  assert.equal(headers["x-max-completion-price"], "9000");
});

test("an invalid Router response is a retryable failure, never a fabricated answer", async () => {
  const invalidPayloads: readonly unknown[] = [
    { choices: [] },
    { choices: [{ message: { content: "", role: "assistant" } }], usage: { completion_tokens: 1, prompt_tokens: 1 } },
    { choices: [{ message: { role: "assistant" } }], usage: { completion_tokens: 1, prompt_tokens: 1 } },
    completion({ usage: undefined }),
    completion({ usage: { completion_tokens: -1, prompt_tokens: 10 } }),
    completion({ usage: { completion_tokens: 1.5, prompt_tokens: 10 } }),
    completion({ usage: { prompt_tokens: 10 } }),
  ];

  for (const payload of invalidPayloads) {
    const result = await adapter(
      fakeFetch({
        respond: () =>
          new Response(JSON.stringify(payload), {
            headers: { "content-type": "application/json" },
            status: 200,
          }),
      }),
    ).complete({ completionTokenAllowance: 1500, messages });

    assert.equal(result.kind, "failed", JSON.stringify(payload));
    if (result.kind !== "failed") return;
    assert.equal(result.reason, "invalid-response");
    assert.equal(result.retryable, true);
  }
});

test("a provider error is reported without leaking the endpoint or key", async () => {
  for (const respond of [
    () => new Response("upstream down at https://router-api.0g.ai/v1 key=router-api-key", { status: 502 }),
    () => new Response("not json", { headers: { "content-type": "application/json" }, status: 200 }),
    () => {
      throw new Error("connect ECONNREFUSED router-api.0g.ai key router-api-key");
    },
  ]) {
    const result = await adapter(fakeFetch({ respond })).complete({
      completionTokenAllowance: 1500,
      messages,
    });

    assert.equal(result.kind, "failed");
    if (result.kind !== "failed") return;
    assert.equal(result.reason, "provider-unavailable");
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /router-api-key/);
    assert.doesNotMatch(serialized, /0g\.ai/);
    assert.doesNotMatch(serialized, /ECONNREFUSED/);
  }
});

test("reported usage above the requested allowance is refused, not billed", async () => {
  const result = await adapter(
    fakeFetch({
      respond: () =>
        new Response(
          JSON.stringify(completion({ usage: { completion_tokens: 5_000, prompt_tokens: 12_000 } })),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
    }),
  ).complete({ completionTokenAllowance: 1500, messages });

  assert.equal(result.kind, "failed");
  if (result.kind !== "failed") return;
  assert.equal(result.reason, "invalid-response");
});

test("a response from another model is refused", async () => {
  const result = await adapter(
    fakeFetch({
      respond: () =>
        new Response(JSON.stringify(completion({ model: "some-other-model" })), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
    }),
  ).complete({ completionTokenAllowance: 1500, messages });

  assert.equal(result.kind, "failed");
  if (result.kind !== "failed") return;
  assert.equal(result.reason, "invalid-response");
});

test("refuses an empty conversation or an unusable allowance before calling the provider", async () => {
  const recorded: RecordedRequest[] = [];
  const subject = adapter(fakeFetch({ recorded }));

  await assert.rejects(
    () => subject.complete({ completionTokenAllowance: 1500, messages: [] }),
    /message/i,
  );
  for (const completionTokenAllowance of [0, -1, 1.5, 1501]) {
    await assert.rejects(
      () => subject.complete({ completionTokenAllowance, messages }),
      /allowance/i,
      `${completionTokenAllowance}`,
    );
  }
  assert.deepEqual(recorded, []);
});
