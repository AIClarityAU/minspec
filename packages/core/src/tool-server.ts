// The stdio tool server (SPEC-136 FR-10, FR-11, FR-26): newline-delimited JSON-RPC 2.0 on
// stdin/stdout, hand-written, no dependency, no socket. The tool list and every call come
// from the same OPERATIONS table the command line reads; no operation is defined here.
// Logging goes to stderr only - stdout carries protocol frames and nothing else.
import * as readline from 'readline';
import {
  coreVersion,
  offeredAsTool,
  OPERATIONS,
  refusedResult,
  runOperation,
  toolAnnotations,
  type CoreResult,
  type Operation,
} from './operations';

/** The MCP revision this server answers with. Which revision ZCode speaks is measurement 4 (unverified). */
export const PROTOCOL_VERSION = '2025-06-18';

type Id = string | number | null;
interface Request {
  jsonrpc?: unknown;
  id?: Id;
  method?: unknown;
  params?: unknown;
}

const log = (message: string): void => {
  process.stderr.write(`minspec-core serve: ${message}\n`);
};

/** The tools the model may call: the table less every operation that is not offered as a tool. */
export function listTools(): { name: string; description: string; inputSchema: Operation['input']; annotations: ReturnType<typeof toolAnnotations> }[] {
  return OPERATIONS.filter(offeredAsTool).map((op) => ({
    name: op.name,
    description: op.summary,
    inputSchema: op.input,
    annotations: toolAnnotations(op),
  }));
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Check call arguments against the operation's input schema, as the command line does for flags. */
function checkArguments(op: Operation, args: Record<string, unknown>): string | null {
  for (const key of Object.keys(args)) {
    if (!(key in op.input.properties)) return `unknown argument ${key} for ${op.name}`;
    if (typeof args[key] !== 'string') return `argument ${key} must be a string`;
  }
  for (const req of op.input.required ?? []) {
    if (!(req in args)) return `${op.name} needs ${req}`;
  }
  return null;
}

async function callTool(root: string, params: unknown): Promise<CoreResult> {
  const p = isObject(params) ? params : {};
  const name = typeof p.name === 'string' ? p.name : '';
  const op = OPERATIONS.filter(offeredAsTool).find((o) => o.name === name);
  if (!op) return refusedResult(name, root, 'unknown-operation', `unknown tool ${name}`);
  const args = p.arguments === undefined ? {} : p.arguments;
  if (!isObject(args)) return refusedResult(op.name, root, 'bad-argument', 'arguments must be an object');
  const bad = checkArguments(op, args);
  if (bad) return refusedResult(op.name, root, 'bad-argument', bad);
  return runOperation(op, root, args);
}

/** Answer one parsed request; `undefined` means no response (a notification). */
async function handle(root: string, req: Request): Promise<Record<string, unknown> | undefined> {
  const isNotification = req.id === undefined;
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: req.id ?? null, result });
  switch (req.method) {
    case 'initialize':
      return reply({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'minspec-core', version: coreVersion() },
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: listTools() });
    case 'tools/call': {
      const result = await callTool(root, req.params);
      return reply({ content: [{ type: 'text', text: JSON.stringify(result) }], isError: result.outcome !== 'pass' });
    }
    case 'notifications/initialized':
      return undefined;
    default:
      if (isNotification) return undefined;
      return { jsonrpc: '2.0', id: req.id ?? null, error: { code: -32601, message: `Method not found: ${String(req.method)}` } };
  }
}

/** Serve until stdin closes. The root is fixed here once; no tool can point the core elsewhere. */
export function serve(root: string, input: NodeJS.ReadableStream, output: NodeJS.WritableStream): Promise<void> {
  const rl = readline.createInterface({ input });
  let chain: Promise<void> = Promise.resolve();
  const write = (frame: Record<string, unknown>) => output.write(`${JSON.stringify(frame)}\n`);
  rl.on('line', (line) => {
    if (line.trim() === '') return;
    chain = chain.then(async () => {
      let req: Request;
      try {
        req = JSON.parse(line) as Request;
      } catch {
        write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        return;
      }
      if (!isObject(req)) {
        write({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
        return;
      }
      try {
        const res = await handle(root, req);
        if (res) write(res);
      } catch (e) {
        log(e instanceof Error ? e.message : String(e));
        write({ jsonrpc: '2.0', id: req.id ?? null, error: { code: -32603, message: 'Internal error' } });
      }
    });
  });
  return new Promise((resolve) => {
    rl.on('close', () => {
      void chain.then(resolve);
    });
  });
}
