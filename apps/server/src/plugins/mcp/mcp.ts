import type { PlaybackLaunch } from "../../library/playback";

export const RESOLVE_TOOL = {
  name: "resolve_playback",
  description:
    'Resolve a movie or TV show from the local vod-tracker library into an LG webOS launch payload. Pass only the title (e.g. "1670"), not the whole sentence. After this tool returns, turn the TV on if needed, then call Home Assistant webostv.command with command "system.launcher/launch" and payload { "id": webos.appId, "contentId": webos.contentId }. Do not invent ids; if nothing matches, say so.',
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Show or movie title to play" },
    },
    required: ["query"],
  },
};

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export type ResolveFn = (query: string) => PlaybackLaunch | null;

/** Handle one MCP JSON-RPC message. Notifications return null. */
export function handleMcpRequest(msg: JsonRpcRequest, resolve: ResolveFn): JsonRpcResponse | null {
  const id = msg.id ?? null;
  const isNotification = msg.id === undefined;
  const method = msg.method ?? "";

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "vod-tracker", version: "0.1.0" },
        },
      };
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return isNotification ? null : { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: [RESOLVE_TOOL] } };
    case "tools/call": {
      const name = String(msg.params?.name ?? "resolve_playback");
      if (name !== "resolve_playback") {
        return isNotification
          ? null
          : { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${name}` } };
      }
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      const query = String(args.query ?? args.title ?? "").trim();
      if (!query) {
        return {
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: "query is required" }], isError: true },
        };
      }
      const launch = resolve(query);
      if (!launch) {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: `No library match for "${query}"` }],
            isError: true,
          },
        };
      }
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(launch) }] },
      };
    }
    default:
      return isNotification
        ? null
        : { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}
