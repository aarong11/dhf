/**
 * Inference interface — connects to LLM providers for agent reasoning.
 *
 * Supports multiple backends:
 *   - OpenAI-compatible (OpenAI, Azure, local vLLM, Ollama)
 *   - Anthropic
 *   - Custom HTTP endpoints
 *
 * The interface abstracts over providers so agents don't care which model
 * they're running on. Tool calls and structured output are handled generically.
 */

import { z } from 'zod';

// ─── Types ────────────────────────────────────────────────────────────────

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface InferenceResult {
  content: string;
  toolCalls: ToolCall[];
  usage: { promptTokens: number; completionTokens: number };
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
}

export interface InferenceConfig {
  provider: 'openai' | 'anthropic' | 'custom';
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

const DEFAULT_CONFIG: InferenceConfig = {
  provider: (process.env.INFERENCE_PROVIDER as InferenceConfig['provider']) ?? 'openai',
  baseUrl: process.env.INFERENCE_BASE_URL ?? 'http://localhost:11434/v1',
  apiKey: process.env.INFERENCE_API_KEY ?? '',
  model: process.env.INFERENCE_MODEL ?? 'llama3.1',
  maxTokens: parseInt(process.env.INFERENCE_MAX_TOKENS ?? '4096', 10),
  temperature: parseFloat(process.env.INFERENCE_TEMPERATURE ?? '0.7'),
};

// ─── Client ───────────────────────────────────────────────────────────────

export class InferenceClient {
  private config: InferenceConfig;

  constructor(config?: Partial<InferenceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  get model(): string { return this.config.model; }
  get provider(): string { return this.config.provider; }

  /**
   * Run a chat completion with optional tool definitions.
   */
  async complete(
    messages: Message[],
    tools?: ToolDefinition[],
  ): Promise<InferenceResult> {
    switch (this.config.provider) {
      case 'openai':
      case 'custom':
        return this.openaiComplete(messages, tools);
      case 'anthropic':
        return this.anthropicComplete(messages, tools);
      default:
        throw new Error(`Unknown provider: ${this.config.provider}`);
    }
  }

  /**
   * Simple single-turn completion (no tools, no history).
   */
  async generate(prompt: string, systemPrompt?: string): Promise<string> {
    const messages: Message[] = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });
    const result = await this.complete(messages);
    return result.content;
  }

  // ─── OpenAI-compatible endpoint ──────────────────────────────────────

  private async openaiComplete(messages: Message[], tools?: ToolDefinition[]): Promise<InferenceResult> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
    };

    if (tools && tools.length > 0) {
      body.tools = tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }

    const resp = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Inference failed (${resp.status}): ${text}`);
    }

    const data = await resp.json() as any;
    const choice = data.choices?.[0];
    const msg = choice?.message;

    const toolCalls: ToolCall[] = (msg?.tool_calls ?? []).map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments ?? '{}'),
    }));

    return {
      content: msg?.content ?? '',
      toolCalls,
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
      },
      finishReason: choice?.finish_reason === 'tool_calls' ? 'tool_calls' : (choice?.finish_reason ?? 'stop'),
    };
  }

  // ─── Anthropic endpoint ──────────────────────────────────────────────

  private async anthropicComplete(messages: Message[], tools?: ToolDefinition[]): Promise<InferenceResult> {
    // Extract system message
    const systemMsg = messages.find(m => m.role === 'system')?.content ?? '';
    const chatMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role === 'tool' ? 'user' as const : m.role, content: m.content }));

    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      system: systemMsg,
      messages: chatMessages,
    };

    if (tools && tools.length > 0) {
      body.tools = tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    const resp = await fetch(`${this.config.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Anthropic inference failed (${resp.status}): ${text}`);
    }

    const data = await resp.json() as any;
    const content = data.content
      ?.filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('') ?? '';

    const toolCalls: ToolCall[] = (data.content ?? [])
      .filter((b: any) => b.type === 'tool_use')
      .map((b: any) => ({ id: b.id, name: b.name, arguments: b.input ?? {} }));

    return {
      content,
      toolCalls,
      usage: {
        promptTokens: data.usage?.input_tokens ?? 0,
        completionTokens: data.usage?.output_tokens ?? 0,
      },
      finishReason: toolCalls.length > 0 ? 'tool_calls' : (data.stop_reason ?? 'stop'),
    };
  }
}
