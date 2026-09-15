import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { logger } from "../logger";
import type { RemoteLoginService } from "./remote-login.service";

const log = logger.child({ component: "remote-login-ws" });

export const REMOTE_LOGIN_WS_PATH = "/remote-login/stream";

/** Messages the browser client may send. Anything else is ignored. */
type ClientMessage =
  | { t: "pointer"; type: "move" | "down" | "up" | "wheel"; x: number; y: number; button?: "left" | "right" | "middle"; deltaX?: number; deltaY?: number }
  | { t: "text"; value: string }
  | { t: "key"; value: string }
  | { t: "navigate"; url: string };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Attaches the frame/input WebSocket to the HTTP server Nest already listens on,
 * so the stream inherits the same bind address (127.0.0.1 by default).
 *
 * The upgrade is refused unless the query carries the session id and the
 * single-use token minted by POST /providers/:provider/login/start.
 */
export function attachRemoteLoginGateway(server: Server, service: RemoteLoginService): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    let url: URL;
    try {
      url = new URL(request.url ?? "", "http://localhost");
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== REMOTE_LOGIN_WS_PATH) {
      return; // not ours — leave it for any other upgrade handler
    }

    const sessionId = url.searchParams.get("session") ?? "";
    const token = url.searchParams.get("token") ?? "";
    if (!service.claim(sessionId, token)) {
      // Never explain which half was wrong.
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws: WebSocket) => {
    log.info("stream client attached");

    const send = (payload: unknown) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    };

    void service
      .attachStream((frame) => {
        send({ t: "frame", data: frame.data, width: frame.width, height: frame.height });
      })
      .then(() => send({ t: "ready", url: service.currentUrl() }))
      .catch((err: unknown) => {
        send({ t: "error", message: err instanceof Error ? err.message : String(err) });
        ws.close();
      });

    // Periodically report the page URL so the client can show where it is.
    const urlTimer = setInterval(() => send({ t: "url", url: service.currentUrl() }), 2000);
    urlTimer.unref();

    ws.on("message", (raw) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        return;
      }
      // Input payloads carry credentials — handle, never log.
      void (async () => {
        try {
          switch (message.t) {
            case "pointer":
              if (isFiniteNumber(message.x) && isFiniteNumber(message.y)) {
                await service.pointer(message.type, message.x, message.y, {
                  button: message.button,
                  deltaX: message.deltaX,
                  deltaY: message.deltaY,
                });
              }
              break;
            case "text":
              if (typeof message.value === "string") {
                await service.keyboard("text", message.value);
              }
              break;
            case "key":
              if (typeof message.value === "string") {
                await service.keyboard("press", message.value);
              }
              break;
            case "navigate":
              if (typeof message.url === "string") {
                await service.navigate(message.url);
              }
              break;
          }
        } catch (err) {
          send({ t: "error", message: err instanceof Error ? err.message : "input failed" });
        }
      })();
    });

    ws.on("close", () => {
      clearInterval(urlTimer);
      service.detachStream();
      log.info("stream client detached");
    });
  });
}
