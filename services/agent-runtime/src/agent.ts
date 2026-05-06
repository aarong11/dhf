/**
 * Agent execution loop — the core orchestration layer.
 *
 * An agent is a stateful entity that:
 *   1. Receives a task or observation
 *   2. Recalls relevant memories from the distributed store (via semantic prefix)
 *   3. Constructs a prompt with context
 *   4. Sends to the inference model
 *   5. Processes tool calls (including memory storage, recall, and external actions)
 *   6. Loops until the task is complete or budget is exhausted
 *
 * The agent has built-in tools for memory operations:
 *   - remember(grammar, content) → store a memory at its semantic address
 *   - recall(grammar) → retrieve memories by prefix
 *   - reflect(text) → parse natural language into grammar and recall
 *
 * Additional tools can be registered for domain-specific actions.
 */

import { type SemanticGrammar, parseDescription } from '@ecca/semantic-address';
import { MemoryStore, type MemoryEntry, type MemoryQuery } from './memory-store.js';
import { InferenceClient, type Message, type ToolDefinition, type ToolCall, type InferenceResult } from './inference.js';
import pino from 'pino';

const log = pino({ name: 'agent-loop', level: process.env.LOG_LEVEL ?? 'info' });

// ─── Types ────────────────────────────────────────────────────────────────

export interface AgentConfig {
  /** Agent identity. */
  id: string;
  name: string;
  /** System prompt describing the agent's role and capabilities. */
  systemPrompt: string;
  /** Maximum reasoning steps before forced stop. */
  maxSteps: number;
  /** Maximum total tokens (prompt + completion) budget. */
  tokenBudget: number;
  /** External tools the agent can invoke. */
  tools: ToolDefinition[];
  /** Handler for external tool calls. */
  toolHandler: (call: ToolCall) => Promise<string>;
}

export interface AgentState {
  messages: Message[];
  totalTokens: number;
  step: number;
  memories: MemoryEntry[];
  status: 'idle' | 'running' | 'completed' | 'error' | 'budget_exhausted';
}

export interface AgentResult {
  output: string;
  memoriesStored: number;
  memoriesRecalled: number;
  steps: number;
  tokensUsed: number;
  status: AgentState['status'];
}

// ─── Built-in memory tools ────────────────────────────────────────────────

const MEMORY_TOOLS: ToolDefinition[] = [
  {
    name: 'remember',
    description: 'Store a memory in the distributed semantic memory store. Provide a grammar (domain, entity, relation, temporal, qualifier) describing WHAT this memory IS, and the content to store.',
    parameters: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Broad category: reasoning, conversation, perception, action, learning, storage, retrieval, navigation, affect, goal' },
        entity: { type: 'string', description: 'The specific thing/concept this memory is about' },
        relation: { type: 'string', description: 'How this relates: caused-by, contains, depends-on, contradicts, supports, associated-with, precedes, follows' },
        temporal: { type: 'string', description: 'When: immediate, recent, session, prior-session, historical, permanent' },
        qualifier: { type: 'string', description: 'Priority/confidence: high-priority, uncertain, confirmed, private, shared' },
        content: { type: 'string', description: 'The actual memory content to store' },
      },
      required: ['domain', 'content'],
    },
  },
  {
    name: 'recall',
    description: 'Retrieve memories from the distributed store by semantic prefix. Provide as many grammar facets as you know — fewer facets = broader search, more facets = precise lookup.',
    parameters: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        entity: { type: 'string' },
        relation: { type: 'string' },
        temporal: { type: 'string' },
        qualifier: { type: 'string' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
    },
  },
  {
    name: 'reflect',
    description: 'Parse a natural language description and recall related memories. Use when you want to find memories but are unsure of the exact grammar facets.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Natural language description of what you want to recall' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: ['text'],
    },
  },
];

// ─── Agent class ──────────────────────────────────────────────────────────

export class Agent {
  private config: AgentConfig;
  private memory: MemoryStore;
  private inference: InferenceClient;
  private state: AgentState;
  private memoriesStored = 0;
  private memoriesRecalled = 0;

  constructor(
    config: AgentConfig,
    memory: MemoryStore,
    inference: InferenceClient,
  ) {
    this.config = config;
    this.memory = memory;
    this.inference = inference;
    this.state = {
      messages: [{ role: 'system', content: config.systemPrompt }],
      totalTokens: 0,
      step: 0,
      memories: [],
      status: 'idle',
    };
  }

  get status(): AgentState['status'] { return this.state.status; }
  get step(): number { return this.state.step; }

  /**
   * Run the agent on a task. Returns when the agent produces a final answer
   * or exhausts its budget.
   */
  async run(task: string): Promise<AgentResult> {
    this.state.status = 'running';

    // Seed with relevant memories for this task
    const seedGrammar = parseDescription(task);
    const seedMemories = await this.memory.recall({ grammar: seedGrammar, limit: 5 });
    this.memoriesRecalled += seedMemories.length;

    let contextBlock = '';
    if (seedMemories.length > 0) {
      contextBlock = '\n\n<relevant_memories>\n' +
        seedMemories.map(m => `[${m.address.slice(0, 16)}...] ${m.content}`).join('\n') +
        '\n</relevant_memories>';
    }

    this.state.messages.push({ role: 'user', content: task + contextBlock });

    const allTools = [...MEMORY_TOOLS, ...this.config.tools];

    while (this.state.step < this.config.maxSteps && this.state.totalTokens < this.config.tokenBudget) {
      this.state.step++;
      log.debug({ step: this.state.step, agent: this.config.id }, 'agent step');

      let result: InferenceResult;
      try {
        result = await this.inference.complete(this.state.messages, allTools);
      } catch (err) {
        log.error({ err, agent: this.config.id }, 'inference error');
        this.state.status = 'error';
        return this.buildResult(String(err));
      }

      this.state.totalTokens += result.usage.promptTokens + result.usage.completionTokens;

      // If the model responded with content and no tool calls, we're done
      if (result.finishReason === 'stop' || (result.toolCalls.length === 0 && result.content)) {
        this.state.messages.push({ role: 'assistant', content: result.content });
        this.state.status = 'completed';
        return this.buildResult(result.content);
      }

      // Process tool calls
      if (result.toolCalls.length > 0) {
        // Add assistant message with tool call intent
        this.state.messages.push({ role: 'assistant', content: result.content || '' });

        for (const call of result.toolCalls) {
          const toolResult = await this.handleToolCall(call);
          this.state.messages.push({
            role: 'tool',
            content: toolResult,
            tool_call_id: call.id,
            name: call.name,
          });
        }
        continue;
      }

      // Length finish — model ran out of tokens mid-response
      if (result.finishReason === 'length') {
        this.state.messages.push({ role: 'assistant', content: result.content });
        continue; // Let it continue in next step
      }
    }

    // Exhausted budget or steps
    this.state.status = this.state.totalTokens >= this.config.tokenBudget ? 'budget_exhausted' : 'completed';
    const lastAssistant = this.state.messages.filter(m => m.role === 'assistant').pop();
    return this.buildResult(lastAssistant?.content ?? '(no output — budget exhausted)');
  }

  private async handleToolCall(call: ToolCall): Promise<string> {
    switch (call.name) {
      case 'remember':
        return this.handleRemember(call.arguments);
      case 'recall':
        return this.handleRecall(call.arguments);
      case 'reflect':
        return this.handleReflect(call.arguments);
      default:
        // External tool
        try {
          return await this.config.toolHandler(call);
        } catch (err) {
          return `Error calling ${call.name}: ${String(err)}`;
        }
    }
  }

  private async handleRemember(args: Record<string, unknown>): Promise<string> {
    const grammar: SemanticGrammar = {};
    if (args.domain) grammar.domain = String(args.domain);
    if (args.entity) grammar.entity = String(args.entity);
    if (args.relation) grammar.relation = String(args.relation);
    if (args.temporal) grammar.temporal = String(args.temporal);
    if (args.qualifier) grammar.qualifier = String(args.qualifier);

    const content = String(args.content ?? '');
    if (!content) return 'Error: content is required';

    const entry = await this.memory.store(grammar, content);
    this.memoriesStored++;
    log.info({ address: entry.address.slice(0, 16), agent: this.config.id }, 'memory stored');
    return `Stored at address ${entry.address.slice(0, 16)}... (depth=${Object.keys(grammar).length})`;
  }

  private async handleRecall(args: Record<string, unknown>): Promise<string> {
    const grammar: SemanticGrammar = {};
    if (args.domain) grammar.domain = String(args.domain);
    if (args.entity) grammar.entity = String(args.entity);
    if (args.relation) grammar.relation = String(args.relation);
    if (args.temporal) grammar.temporal = String(args.temporal);
    if (args.qualifier) grammar.qualifier = String(args.qualifier);

    const limit = typeof args.limit === 'number' ? args.limit : 10;
    const entries = await this.memory.recall({ grammar, limit });
    this.memoriesRecalled += entries.length;

    if (entries.length === 0) return 'No memories found for this query.';

    return entries
      .map(e => `[${e.address.slice(0, 16)}...] ${e.content}`)
      .join('\n');
  }

  private async handleReflect(args: Record<string, unknown>): Promise<string> {
    const text = String(args.text ?? '');
    if (!text) return 'Error: text is required';

    const limit = typeof args.limit === 'number' ? args.limit : 10;
    const entries = await this.memory.recall({ text, limit });
    this.memoriesRecalled += entries.length;

    if (entries.length === 0) return 'No memories found for this reflection.';

    return entries
      .map(e => `[${e.address.slice(0, 16)}...] ${e.content}`)
      .join('\n');
  }

  private buildResult(output: string): AgentResult {
    return {
      output,
      memoriesStored: this.memoriesStored,
      memoriesRecalled: this.memoriesRecalled,
      steps: this.state.step,
      tokensUsed: this.state.totalTokens,
      status: this.state.status,
    };
  }
}
