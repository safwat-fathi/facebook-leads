// OpenRouter (OpenAI-compatible chat completions with tool calling). The port is an interface so tests can script the model.
import 'server-only';

export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type ChatMsg = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };
export type ToolDef = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } };
export interface LlmPort {
  chat(messages: ChatMsg[], tools: ToolDef[], o?: { signal?: AbortSignal }): Promise<{ message: ChatMsg; costUsd: number }>;
}

export function openRouterLlm(key: string, model: string): LlmPort {
  return {
    async chat(messages, tools, o = {}) {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-title': 'facebook-leads' },
        body: JSON.stringify({ model, messages, tools, max_tokens: 2000 }), // no temperature/top_p: Claude 5.x rejects non-default sampling
        signal: AbortSignal.any([AbortSignal.timeout(90_000), ...(o.signal ? [o.signal] : [])]),
      });
      if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const j = (await res.json()) as { choices: { message: ChatMsg }[]; usage?: { cost?: number } };
      return { message: j.choices[0].message, costUsd: j.usage?.cost ?? 0 };
    },
  };
}
