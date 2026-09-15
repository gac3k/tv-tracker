import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { Plugin, type PluginHttpContext } from "../plugin";
import { handleMcpRequest, type JsonRpcRequest } from "./mcp";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

@Plugin({
  id: "mcp",
  label: "MCP",
  description:
    "Exposes an MCP server so a conversation agent (e.g. Home Assistant Assist) can resolve a title to an LG webOS app id and content link. Add MCP with SSE URL http://<this-host>:3000/mcp/sse, then enable that API on the agent. The agent should turn the TV on and call webostv.command system.launcher/launch with the returned payload.",
  auth: "none",
  fields: [],
})
export class McpPlugin {
  private readonly sessions = new Map<string, { raw: NodeJS.WritableStream; ping: NodeJS.Timeout }>();

  async isAuthenticated() {
    return { authenticated: true };
  }

  mount(app: FastifyInstance, ctx: PluginHttpContext): void {
    const enabled = () => ctx.enabled();
    const resolve = (query: string) => ctx.library.resolvePlayback(query);

    app.get("/mcp", async () => ({
      enabled: enabled(),
      sse: "/mcp/sse",
      resolve: "/mcp/resolve?q=",
    }));

    app.get("/mcp/resolve", async (request, reply) => {
      if (!enabled()) return reply.code(404).send({ error: "MCP plugin is disabled" });
      const query = String((request.query as { q?: string }).q ?? "").trim();
      if (!query) return reply.code(400).send({ error: "q is required" });
      const result = resolve(query);
      if (!result) return reply.code(404).send({ error: `No library match for "${query}"` });
      return result;
    });

    app.get("/mcp/sse", (request: FastifyRequest, reply: FastifyReply) => {
      if (!enabled()) return reply.code(404).send({ error: "MCP plugin is disabled" });

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
          this.dropSession(sessionId);
        }
      }, 15_000);
      ping.unref();
      this.sessions.set(sessionId, { raw: reply.raw, ping });
      request.raw.on("close", () => this.dropSession(sessionId));
    });

    app.post("/mcp/messages", (request: FastifyRequest, reply: FastifyReply) => {
      const sessionId = String((request.query as { sessionId?: string }).sessionId ?? "");
      const session = this.sessions.get(sessionId);
      if (!session) return reply.code(404).send({ error: "Unknown MCP session" });
      if (!enabled()) return reply.code(404).send({ error: "MCP plugin is disabled" });

      for (const msg of asRpcBatch(request.body)) {
        const response = handleMcpRequest(msg, resolve);
        if (response) {
          session.raw.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
        }
      }
      return reply.code(202).send();
    });
  }

  private dropSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    clearInterval(session.ping);
    this.sessions.delete(sessionId);
  }
}

function asRpcBatch(body: unknown): JsonRpcRequest[] {
  if (Array.isArray(body)) return body as JsonRpcRequest[];
  if (body && typeof body === "object") return [body as JsonRpcRequest];
  return [];
}
