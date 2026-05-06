/**
 * Agent Runtime — HTTP server that exposes the inference + memory system.
 *
 * Endpoints:
 *   POST /agents          — Create an agent with a system prompt and config
 *   POST /agents/:id/run  — Run a task on an agent
 *   POST /memory/store    — Directly store a memory
 *   POST /memory/recall   — Query memories by grammar prefix
 *   GET  /memory/:address — Get a specific memory by address
 *   GET  /healthz         — Health check
 */

import { createService, listen, wireShutdown } from '@ecca/service-base';
import { getBus } from '@ecca/bus';
import { z } from 'zod';
import { MemoryStore } from './memory-store.js';
import { InferenceClient } from './inference.js';
import { Agent, type AgentConfig } from './agent.js';

const PORT = parseInt(process.env.AGENT_RUNTIME_PORT ?? '7090', 10);

// ─── Schemas ──────────────────────────────────────────────────────────────

const GrammarSchema = z.object({
  domain: z.string().optional(),
  entity: z.string().optional(),
  relation: z.string().optional(),
  temporal: z.string().optional(),
  qualifier: z.string().optional(),
});

const CreateAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  systemPrompt: z.string().min(1),
  maxSteps: z.number().int().positive().default(20),
  tokenBudget: z.number().int().positive().default(100_000),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
});

const RunTaskSchema = z.object({
  task: z.string().min(1),
});

const StoreMemorySchema = z.object({
  grammar: GrammarSchema,
  content: z.string().min(1),
});

const RecallSchema = z.object({
  grammar: GrammarSchema.optional(),
  text: z.string().optional(),
  limit: z.number().int().positive().default(20),
});

// ─── State ────────────────────────────────────────────────────────────────

const agents = new Map<string, { config: AgentConfig; instance: Agent | null }>();
const memoryStore = new MemoryStore();
const inferenceClient = new InferenceClient();

// ─── Server ───────────────────────────────────────────────────────────────

async function main() {
  const app = await createService({ name: 'agent-runtime', port: PORT });

  // Connect to NATS bus (non-blocking — agent-runtime can operate without it)
  let bus: Awaited<ReturnType<typeof getBus>> | null = null;
  try {
    bus = await getBus();
  } catch {
    app.log.warn('NATS bus unavailable — running in standalone mode');
  }

  // ─── Agent endpoints ──────────────────────────────────────────────────

  app.post('/agents', async (req, reply) => {
    const body = CreateAgentSchema.parse(req.body);

    const config: AgentConfig = {
      id: body.id,
      name: body.name,
      systemPrompt: body.systemPrompt,
      maxSteps: body.maxSteps,
      tokenBudget: body.tokenBudget,
      tools: [],
      toolHandler: async (call) => `Unknown tool: ${call.name}`,
    };

    agents.set(body.id, { config, instance: null });

    return reply.code(201).send({
      id: body.id,
      name: body.name,
      model: inferenceClient.model,
      provider: inferenceClient.provider,
    });
  });

  app.post<{ Params: { id: string } }>('/agents/:id/run', async (req, reply) => {
    const { id } = req.params;
    const agentEntry = agents.get(id);
    if (!agentEntry) return reply.code(404).send({ error: 'Agent not found' });

    const body = RunTaskSchema.parse(req.body);

    // Create a fresh agent instance per task (stateless between runs)
    const client = new InferenceClient();
    const agent = new Agent(agentEntry.config, memoryStore, client);
    agentEntry.instance = agent;

    const result = await agent.run(body.task);

    // Publish completion event to bus if available
    if (bus) {
      try {
        bus.publishLight('ecca.agent.completed', {
          agentId: id, task: body.task, status: result.status, steps: result.steps, ts: Date.now(),
        });
      } catch { /* non-critical */ }
    }

    return reply.send(result);
  });

  app.get<{ Params: { id: string } }>('/agents/:id', async (req, reply) => {
    const { id } = req.params;
    const agentEntry = agents.get(id);
    if (!agentEntry) return reply.code(404).send({ error: 'Agent not found' });
    return {
      id: agentEntry.config.id,
      name: agentEntry.config.name,
      maxSteps: agentEntry.config.maxSteps,
      tokenBudget: agentEntry.config.tokenBudget,
      status: agentEntry.instance?.status ?? 'idle',
    };
  });

  // ─── Direct memory endpoints ──────────────────────────────────────────

  app.post('/memory/store', async (req, reply) => {
    const body = StoreMemorySchema.parse(req.body);
    const entry = await memoryStore.store(body.grammar, body.content);
    return reply.code(201).send(entry);
  });

  app.post('/memory/recall', async (req, reply) => {
    const body = RecallSchema.parse(req.body);
    const entries = await memoryStore.recall({
      grammar: body.grammar,
      text: body.text,
      limit: body.limit,
    });
    return { entries, count: entries.length };
  });

  app.get<{ Params: { address: string } }>('/memory/:address', async (req, reply) => {
    const { address } = req.params;
    if (!/^[0-9a-f]{64}$/i.test(address)) {
      return reply.code(400).send({ error: 'Invalid address — must be 64 hex chars' });
    }
    const entry = await memoryStore.get(address);
    if (!entry) return reply.code(404).send({ error: 'Memory not found' });
    return entry;
  });

  // ─── Info ─────────────────────────────────────────────────────────────

  app.get('/info', async () => ({
    service: 'agent-runtime',
    model: inferenceClient.model,
    provider: inferenceClient.provider,
    agents: agents.size,
    memoryCacheSize: memoryStore.cacheSize,
  }));

  // ─── Start ────────────────────────────────────────────────────────────

  wireShutdown(app, async () => {
    if (bus) await bus.close();
  });
  await listen(app, PORT);
}

main();
