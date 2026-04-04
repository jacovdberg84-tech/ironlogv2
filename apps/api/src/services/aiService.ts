import OpenAI from "openai";
import { config } from "../config.js";

const client = config.openAiApiKey
  ? new OpenAI({ apiKey: config.openAiApiKey })
  : null;

export async function draftDocument(prompt: string) {
  if (!client) {
    return {
      provider: "mock",
      content: "OpenAI key not configured. This is a placeholder draft document."
    };
  }

  const result = await client.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: "You are Ironmind AI assisting mining operations documentation."
      },
      {
        role: "user",
        content: prompt
      }
    ]
  });

  return {
    provider: "openai",
    content: result.output_text
  };
}

export function detectRecurringFaults(history: Array<{ machineId: string; fault: string }>) {
  const counts = new Map<string, number>();

  for (const row of history) {
    const key = `${row.machineId}::${row.fault}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .filter(([, count]) => count >= 3)
    .map(([key, count]) => {
      const [machineId, fault] = key.split("::");
      return {
        machineId,
        fault,
        count,
        severity: count >= 5 ? "critical" : "warning"
      };
    });
}
