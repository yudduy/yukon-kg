import { chat, OpenRouterError } from "./openrouter.js";

const prompt = process.argv.slice(2).join(" ").trim()
  || "Reply with exactly: yukon-kg is connected";

try {
  const result = await chat({
    messages: [{ role: "user", content: prompt }],
  });
  console.log(result.content);
  console.error(JSON.stringify({ model: result.model, usage: result.usage }));
} catch (error) {
  if (error instanceof OpenRouterError) {
    console.error(error.message);
    if (error.body !== null) console.error(JSON.stringify(error.body));
    process.exit(1);
  }
  throw error;
}
