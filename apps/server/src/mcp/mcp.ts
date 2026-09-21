import type { PlaybackLaunch } from "../library/playback";
import type { SuggestItem, SuggestKind } from "../library/suggest";
import type { TvOs } from "../settings/app-settings";

export function resolveTool(os: TvOs) {
  const description =
    os === "android"
      ? 'Resolve a movie or TV show from the local vod-tracker library into a tvUrl. Pass only the title (e.g. "1670"), not the whole sentence. After this tool returns, turn the TV on if needed, then open tvUrl with the Android system launcher (Home Assistant: remote.turn_on with activity set to tvUrl, or androidtv.adb_command `am start -a android.intent.action.VIEW -d <tvUrl>`). Do not invent ids; if nothing matches, say so.'
      : 'Resolve a movie or TV show from the local vod-tracker library into a tvUrl. Pass only the title (e.g. "1670"), not the whole sentence. After this tool returns, turn the TV on if needed, then call Home Assistant webostv.command with command "system.launcher/launch" and payload tvUrl ({ "id", "contentId" }). Do not invent ids; if nothing matches, say so.';
  return {
    name: "resolve_playback",
    description,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Show or movie title to play" },
      },
      required: ["query"],
    },
  };
}

export const continueTool = {
  name: "suggest_continue",
  description:
    'Propose titles to keep watching. Use when the user asks what to watch next, what to continue, or "co możemy oglądać dalej". Returns in-progress titles first. If every started title is finished, returns Watch Next episodes instead. Present these titles; do not invent ones missing from the result.',
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max titles to return (default 5)" },
    },
  },
};

export const suggestTool = {
  name: "suggest_watch",
  description:
    'Propose a movie or series to start. Use when the user asks for a recommendation, something new to watch, or "zaproponuj mi jakiś film albo serial". Prefers the watchlist, then unwatched library titles. Pass kind to restrict to movie or series. Do not invent titles.',
  inputSchema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["movie", "series"],
        description: "Restrict to movies or series",
      },
      limit: { type: "number", description: "Max titles to return (default 5)" },
    },
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
export type ContinueFn = (limit: number) => SuggestItem[] | Promise<SuggestItem[]>;
export type SuggestFn = (kind: SuggestKind | undefined, limit: number) => SuggestItem[] | Promise<SuggestItem[]>;

export interface McpContext {
  resolve: ResolveFn;
  continueWatching?: ContinueFn;
  suggestWatch?: SuggestFn;
}

function asCtx(resolveOrCtx: ResolveFn | McpContext): McpContext {
  return typeof resolveOrCtx === "function" ? { resolve: resolveOrCtx } : resolveOrCtx;
}

function intArg(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(20, Math.max(1, Math.round(n)));
}

function toolText(id: string | number | null, data: unknown, isError = false): JsonRpcResponse {
  const text = typeof data === "string" ? data : JSON.stringify(data);
  return {
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text }], isError },
  };
}

/** Handle one MCP JSON-RPC message. Notifications return null. */
export async function handleMcpRequest(
  msg: JsonRpcRequest,
  resolveOrCtx: ResolveFn | McpContext,
  os: TvOs = "webos"
): Promise<JsonRpcResponse | null> {
  const ctx = asCtx(resolveOrCtx);
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
      return { jsonrpc: "2.0", id, result: { tools: [resolveTool(os), continueTool, suggestTool] } };
    case "tools/call": {
      const name = String(msg.params?.name ?? "resolve_playback");
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      if (name === "suggest_continue") {
        const items = await (ctx.continueWatching ?? (async () => []))(intArg(args.limit, 5));
        return toolText(id, { items });
      }
      if (name === "suggest_watch") {
        const kind = args.kind === "movie" || args.kind === "series" ? args.kind : undefined;
        const items = await (ctx.suggestWatch ?? (async () => []))(kind, intArg(args.limit, 5));
        return toolText(id, { items });
      }
      if (name !== "resolve_playback") {
        return isNotification
          ? null
          : { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${name}` } };
      }
      const query = String(args.query ?? args.title ?? "").trim();
      if (!query) {
        return toolText(id, "query is required", true);
      }
      const launch = ctx.resolve(query);
      if (!launch?.tvUrl) {
        return toolText(id, `No library match for "${query}"`, true);
      }
      return toolText(id, { tvUrl: launch.tvUrl });
    }
    default:
      return isNotification
        ? null
        : { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}
