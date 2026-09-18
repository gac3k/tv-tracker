import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import type { LibraryService } from "../library/library.service";
import { launcherDeeplink, handleMcpRequest, type JsonRpcRequest } from "./mcp";
import { readAppSettings } from "../settings/app-settings";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export function mountMcp(app: FastifyInstance, library: LibraryService): void {
  const sessions = new Map<string, { raw: NodeJS.WritableStream; ping: NodeJS.Timeout }>();

  const enabled = () => readAppSettings().mcpEnabled;
  const os = () => readAppSettings().tvOs;
  const resolve = (query: string) => library.resolvePlayback(query);

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

  app.get("/mcp/resolve", async (request, reply) => {
    if (!enabled()) return reply.code(404).send({ error: "MCP is disabled" });
    const query = String((request.query as { q?: string }).q ?? "").trim();
    if (!query) return reply.code(400).send({ error: "q is required" });
    const launch = resolve(query);
    const payload = launch ? launcherDeeplink(launch, os()) : null;
    if (!payload) return reply.code(404).send({ error: `No library match for "${query}"` });
    return payload;
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

  app.post("/mcp/messages", (request: FastifyRequest, reply: FastifyReply) => {
    const sessionId = String((request.query as { sessionId?: string }).sessionId ?? "");
    const session = sessions.get(sessionId);
    if (!session) return reply.code(404).send({ error: "Unknown MCP session" });
    if (!enabled()) return reply.code(404).send({ error: "MCP is disabled" });

    for (const msg of asRpcBatch(request.body)) {
      const response = handleMcpRequest(msg, resolve, os());
      if (response) {
        session.raw.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
      }
    }
    return reply.code(202).send();
  });
}

function asRpcBatch(body: unknown): JsonRpcRequest[] {
  if (Array.isArray(body)) return body as JsonRpcRequest[];
  if (body && typeof body === "object") return [body as JsonRpcRequest];
  return [];
}
