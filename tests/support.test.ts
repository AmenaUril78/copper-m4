// The Copper Support switchboard, tested with a fake model, so these tests need
// no AI key and cost nothing.
import type { LanguageModelV4StreamPart as ModelStreamPart } from "@ai-sdk/provider";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finalValue } from "@/lib/ai/live";

let model: MockLanguageModelV4;
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => () => model,
}));

const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
};
type StreamPart = Parameters<typeof convertArrayToReadableStream<ModelStreamPart>>[0][number];
const finish = (reason: "stop" | "tool-calls") => ({
  type: "finish" as const,
  finishReason: { unified: reason, raw: undefined },
  usage,
});
const says = (text: string): StreamPart[] => [
  { type: "text-start", id: "t1" },
  ...text
    .split(" ")
    .filter(Boolean)
    .map((word, i): StreamPart => ({
      type: "text-delta",
      id: "t1",
      delta: i === 0 ? word : ` ${word}`,
    })),
  { type: "text-end", id: "t1" },
  finish("stop"),
];
const calls = (toolName: string, input: unknown = {}): StreamPart[] => [
  { type: "tool-input-start", id: "call-1", toolName },
  { type: "tool-input-end", id: "call-1" },
  { type: "tool-call", toolCallId: "call-1", toolName, input: JSON.stringify(input) },
  finish("tool-calls"),
];
/** Each model step (across both agents) streams the next item. */
function modelStreaming(...steps: StreamPart[][]) {
  let step = 0;
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: convertArrayToReadableStream(steps[step++] ?? says("")),
    }),
  });
}
const toolNames = (call: number) =>
  (model.doStreamCalls[call].tools ?? []).map((t) => t.name).sort();
const systemText = (call: number) =>
  JSON.stringify(model.doStreamCalls[call].prompt.find((m) => m.role === "system")?.content);

let logged: Record<string, unknown>[] = [];
beforeEach(() => {
  logged = [];
  vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
    if (args[0] === "[ai_calls]") logged.push(JSON.parse(args[1] as string));
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load() {
  vi.resetModules();
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "AIza-test-key");
  return import("@/lib/copper/assistant/support");
}
const say = (content: string) => [{ role: "user" as const, content }];

describe("askSupport", () => {
  it("shopping mode: Copper answers with the shopping tools plus the hand-off, and the mode stays shopping", async () => {
    model = modelStreaming(says("Copper Home is $149."));
    const { askSupport } = await load();
    const result = await finalValue(
      (await askSupport({ messages: say("How much is Copper Home?"), mode: "shopping" })).progress,
    );
    expect(result).toMatchObject({ mode: "shopping", status: "done", reply: "Copper Home is $149." });
    expect(toolNames(0)).toEqual([
      "calculate_cost",
      "check_availability",
      "get_prices",
      "get_products",
      "hand_off_to_refund_agent",
    ]);
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("RA-7: when Copper calls the hand-off tool, the Refund agent answers the same message", async () => {
    model = modelStreaming(
      calls("hand_off_to_refund_agent"),
      says("A refund specialist is taking over."),
      says("What is your order number?"),
    );
    const { askSupport } = await load();
    const result = await finalValue(
      (await askSupport({ messages: say("I want a refund"), mode: "shopping" })).progress,
    );
    expect(result.mode).toBe("refund");
    expect(result.reply).toContain("A refund specialist is taking over.");
    expect(result.reply).toContain("What is your order number?");
    // The third model call is the Refund agent: its own tools and instructions.
    expect(toolNames(2)).toEqual([
      "check_refund_status",
      "hand_back_to_copper",
      "lookup_order",
      "request_refund",
    ]);
    expect(systemText(2)).toContain("refund specialist");
    expect(result.steps.some((s) => s.type === "tool" && s.name === "hand_off_to_refund_agent")).toBe(true);
  });

  it("RA-7: the code safety net switches to the Refund agent when Copper doesn't hand off", async () => {
    model = modelStreaming(says("Sure, tell me more."), says("What is your order number?"));
    const { askSupport } = await load();
    const result = await finalValue(
      (await askSupport({ messages: say("I want my money back"), mode: "shopping" })).progress,
    );
    expect(result.mode).toBe("refund");
    expect(toolNames(1)).toContain("request_refund");
  });

  it("a normal question never triggers the safety net", async () => {
    model = modelStreaming(says("It is in stock."));
    const { askSupport } = await load();
    const result = await finalValue(
      (await askSupport({ messages: say("Is Night Sky in stock?"), mode: "shopping" })).progress,
    );
    expect(result.mode).toBe("shopping");
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("RA-8: in refund mode every message goes straight to the Refund agent", async () => {
    model = modelStreaming(says("Thanks. Which order?"));
    const { askSupport } = await load();
    const result = await finalValue(
      (await askSupport({ messages: say("Sure, go on"), mode: "refund" })).progress,
    );
    expect(result.mode).toBe("refund");
    expect(model.doStreamCalls).toHaveLength(1);
    expect(toolNames(0)).toContain("lookup_order");
    expect(toolNames(0)).not.toContain("get_prices");
  });

  it("RA-8: an off-topic question makes a silent hand-back, and Copper answers right away", async () => {
    model = modelStreaming(
      calls("hand_back_to_copper"),
      says(""),
      says("Copper Home is $149."),
    );
    const { askSupport } = await load();
    const result = await finalValue(
      (await askSupport({ messages: say("How much is Copper Home?"), mode: "refund" })).progress,
    );
    expect(result.mode).toBe("shopping");
    expect(result.reply).toBe("Copper Home is $149.");
    expect(toolNames(2)).toContain("get_prices");
  });

  it("RA-8: after a refund is settled the Refund agent says goodbye, hands back, and the chat waits", async () => {
    model = modelStreaming(
      calls("hand_back_to_copper"),
      says("All done. Anything else?"),
    );
    const { askSupport } = await load();
    const result = await finalValue(
      (await askSupport({ messages: say("thanks"), mode: "refund" })).progress,
    );
    expect(result.mode).toBe("shopping");
    expect(result.reply).toBe("All done. Anything else?");
    expect(model.doStreamCalls).toHaveLength(2);
  });

  it("RA-18: calls are logged as module 4, with a feature for each agent", async () => {
    model = modelStreaming(says("A specialist will help."), says("Which order?"));
    const { askSupport } = await load();
    await finalValue(
      (await askSupport({ messages: say("refund please"), mode: "shopping" })).progress,
    );
    await vi.waitFor(() => expect(logged).toHaveLength(2));
    expect(logged[0]).toMatchObject({ module: 4, feature: "ask-copper-support", ok: true });
    expect(logged[1]).toMatchObject({ module: 4, feature: "refund-agent", ok: true });
  });

  it("refuses a request with an unknown mode or extra fields", async () => {
    model = modelStreaming(says("hi"));
    const { askSupport } = await load();
    await expect(
      askSupport({ messages: say("hi"), mode: "admin" as never }),
    ).rejects.toThrow();
    await expect(
      askSupport({ messages: say("hi"), mode: "shopping", limit: 99999 } as never),
    ).rejects.toThrow();
    await expect(askSupport({ messages: [], mode: "shopping" })).rejects.toThrow();
  });

  it("gives a polite answer if the model fails", async () => {
    model = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error("boom");
      },
    });
    const { askSupport } = await load();
    const result = await finalValue(
      (await askSupport({ messages: say("hi"), mode: "shopping" })).progress,
    );
    expect(result.status).toBe("error");
    expect(result.reply).toMatch(/sorry/i);
  });
});
