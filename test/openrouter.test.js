import { afterEach, describe, expect, test } from "bun:test";
import { chat, chatCompletion } from "../src/openrouter.js";

const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENROUTER_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalKey;
});

describe("OpenRouter client", () => {
  test("passes bounded generation options and returns ordinary content", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    let request;
    globalThis.fetch = async (_url, init) => {
      request = JSON.parse(init.body);
      return new Response(JSON.stringify({
        id: "response-1",
        model: "provider/model",
        choices: [{ message: { content: "answer" } }],
        usage: { total_tokens: 3, cost: 0.01 },
      }), { status: 200 });
    };
    const result = await chat({
      model: "provider/model",
      messages: [{ role: "user", content: "question" }],
      maxTokens: 128,
      temperature: 0,
      seed: 7,
      reasoning: { effort: "low", exclude: true },
      responseFormat: { type: "json_object" },
    });
    expect(request.max_tokens).toBe(128);
    expect(request.temperature).toBe(0);
    expect(request.seed).toBe(7);
    expect(request.reasoning).toEqual({ effort: "low", exclude: true });
    expect(request.response_format).toEqual({ type: "json_object" });
    expect(result.content).toBe("answer");
    expect(result.contentSource).toBe("content");
  });

  test("uses reasoning text when a provider returns null content", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: null, reasoning: "{\"action_id\":\"a\"}" } }],
      usage: { total_tokens: 4, cost: 0.02 },
    }), { status: 200 });
    const result = await chat({
      model: "provider/reasoning-model",
      messages: [{ role: "user", content: "question" }],
    });
    expect(result.content).toBe('{"action_id":"a"}');
    expect(result.contentSource).toBe("reasoning");
  });

  test("passes function tools through and preserves a tool-call message", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    let request;
    const toolCalls = [{
      id: "call-1",
      type: "function",
      function: { name: "lookup", arguments: '{"query":"needle"}' },
    }];
    globalThis.fetch = async (_url, init) => {
      request = JSON.parse(init.body);
      return new Response(JSON.stringify({
        id: "response-tools",
        model: "provider/model",
        choices: [{
          finish_reason: "tool_calls",
          message: { content: null, reasoning_details: [{ type: "summary", text: "find it" }], tool_calls: toolCalls },
        }],
        usage: { total_tokens: 5, cost: 0.03 },
      }), { status: 200 });
    };
    const tools = [{
      type: "function",
      function: {
        name: "lookup",
        description: "Find a record",
        parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      },
    }];
    const result = await chatCompletion({
      model: "provider/model",
      messages: [{ role: "user", content: "question" }],
      tools,
      toolChoice: "auto",
      parallelToolCalls: false,
    });
    expect(request.tools).toEqual(tools);
    expect(request.tool_choice).toBe("auto");
    expect(request.parallel_tool_calls).toBe(false);
    expect(result.message.tool_calls).toEqual(toolCalls);
    expect(result.message.reasoning_details).toEqual([{ type: "summary", text: "find it" }]);
    expect(result.finishReason).toBe("tool_calls");
  });
});
