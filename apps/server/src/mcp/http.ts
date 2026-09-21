import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import type { LibraryService } from "../library/library.service";
import { pickContinue, pickWatch } from "../library/suggest";
import { handleMcpRequest, type JsonRpcRequest, type McpContext } from "./mcp";
import { readAppSettings } from "../settings/app-settings";
import type { WatchlistService } from "../watchlist/watchlist.service";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export function mountMcp(app: FastifyInstance, library: LibraryService, watchlist: WatchlistService): void {
  const sessions = new Map<string, { raw: NodeJS.WritableStream; ping: NodeJS.Timeout }>();

  const enabled = () => readAppSettings().mcpEnabled;
  const os = () => readAppSettings().tvOs;
  const ctx = (): McpContext => ({
    resolve: (query) => library.resolvePlayback(query),
    continueWatching: async (limit) => {
      const { items } = await library.list({ view: "titles", status: "in_progress", limit: 300 });
      return pickContinue(items, limit);
    },
    suggestWatch: async (kind, limit) => {
      const { items } = await library.list({ view: "titles", status: "unwatched", limit: 200 });
      return pickWatch(watchlist.list(), items, kind, limit);
    },
  });

  function dropSession(sessionId: string): void {
    const session = sessions.get(sessionId);
    if (!session) return;
    clearInterval(session.ping);
    sessions.delete(sessionId);
  }

  app.get("/mcp", async () => ({
    enabled: enabled(),
    os: os(),
    sse: "/mcp/sse",
    resolve: "/mcp/resolve?q=",
  }));

  app.post("/mcp", streamable);
  app.post("/mcp/sse", streamable);

  app.get("/mcp/resolve", async (request, reply) => {
    if (!enabled()) return reply.code(404).send({ error: "MCP is disabled" });
    const query = String((request.query as { q?: string }).q ?? "").trim();
    if (!query) return reply.code(400).send({ error: "q is required" });
    const launch = ctx().resolve(query);
    if (!launch?.tvUrl) return reply.code(404).send({ error: `No library match for "${query}"` });
    return { tvUrl: launch.tvUrl };
  });

  app.get("/mcp/sse", (request: FastifyRequest, reply: FastifyReply) => {
    if (!enabled()) return reply.code(404).send({ error: "MCP is disabled" });

    const sessionId = randomUUID();
    const host = request.headers.host ?? "127.0.0.1:3000";
    const proto = request.protocol === "https" ? "https" : "http";
    const endpoint = `${proto}://${host}/mcp/messages?sessionId=${sessionId}`;

    reply.hijack();
    reply.raw.writeHead(200, SSE_HEADERS);
    reply.raw.write(`event: endpoint\ndata: ${endpoint}\n\n`);
    reply.raw.setTimeout(0);

    const ping = setInterval(() => {
      try {
        reply.raw.write(": ping\n\n");
      } catch {
        dropSession(sessionId);
      }
    }, 15_000);
    ping.unref();
    sessions.set(sessionId, { raw: reply.raw, ping });
    request.raw.on("close", () => dropSession(sessionId));
  });

  app.post("/mcp/messages", async (request: FastifyRequest, reply: FastifyReply) => {
    const sessionId = String((request.query as { sessionId?: string }).sessionId ?? "");
    const session = sessions.get(sessionId);
    if (!session) return reply.code(404).send({ error: "Unknown MCP session" });
    if (!enabled()) return reply.code(404).send({ error: "MCP is disabled" });

    for (const msg of asRpcBatch(request.body)) {
      const response = await handleMcpRequest(msg, ctx(), os());
      if (response) {
        session.raw.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
      }
    }
    return reply.code(202).send();
  });

  async function streamable(request: FastifyRequest, reply: FastifyReply) {
    if (!enabled()) return reply.code(404).send({ error: "MCP is disabled" });
    const responses = [];
    for (const msg of asRpcBatch(request.body)) {
      const response = await handleMcpRequest(msg, ctx(), os());
      if (response) responses.push(response);
    }
    if (responses.length === 0) return reply.code(202).send();
    return responses.length === 1 ? responses[0] : responses;
  }
}

function asRpcBatch(body: unknown): JsonRpcRequest[] {
  if (Array.isArray(body)) return body as JsonRpcRequest[];
  if (body && typeof body === "object") return [body as JsonRpcRequest];
  return [];
}
