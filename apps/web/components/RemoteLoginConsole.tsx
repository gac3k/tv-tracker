"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PROVIDER_LABELS } from "../lib/api";

type Phase = "idle" | "starting" | "live" | "finishing" | "done" | "error";

interface StartResponse {
  sessionId: string;
  token: string;
  width: number;
  height: number;
  streamPath: string;
}

/** Keys we forward as named presses; everything else arrives as literal text. */
const NAMED_KEYS = new Set([
  "Enter",
  "Tab",
  "Backspace",
  "Delete",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

export function RemoteLoginConsole({ provider }: { provider: string }) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const sizeRef = useRef({ width: 1280, height: 800 });

  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [result, setResult] = useState<{ authenticated: boolean | null; profileName: string | null } | null>(
    null
  );

  const label = PROVIDER_LABELS[provider] ?? provider;

  const send = useCallback((payload: unknown) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  }, []);

  /** Map a DOM event onto the streamed viewport's coordinate space. */
  const toViewport = useCallback((event: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = sizeRef.current.width / rect.width;
    const scaleY = sizeRef.current.height / rect.height;
    return {
      x: Math.round((event.clientX - rect.left) * scaleX),
      y: Math.round((event.clientY - rect.top) * scaleY),
    };
  }, []);

  async function start() {
    setPhase("starting");
    setMessage(null);
    setResult(null);
    try {
      const res = await fetch(`/api/providers/${provider}/login/start`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setPhase("error");
        setMessage(body.message ?? body.error ?? `HTTP ${res.status}`);
        return;
      }
      const session = body as StartResponse;
      sizeRef.current = { width: session.width, height: session.height };

      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const url =
        `${proto}://${window.location.host}/api${session.streamPath}` +
        `?session=${encodeURIComponent(session.sessionId)}&token=${encodeURIComponent(session.token)}`;
      const socket = new WebSocket(url);
      socketRef.current = socket;

      socket.onmessage = (event) => {
        const payload = JSON.parse(event.data as string);
        if (payload.t === "frame") {
          const canvas = canvasRef.current;
          if (!canvas) return;
          const image = new Image();
          image.onload = () => {
            canvas.width = payload.width;
            canvas.height = payload.height;
            canvas.getContext("2d")?.drawImage(image, 0, 0);
          };
          image.src = `data:image/jpeg;base64,${payload.data}`;
        } else if (payload.t === "url") {
          setPageUrl(payload.url);
        } else if (payload.t === "ready") {
          setPhase("live");
          setPageUrl(payload.url);
        } else if (payload.t === "error") {
          setMessage(payload.message);
        }
      };
      socket.onerror = () => {
        setPhase("error");
        setMessage("Stream connection failed.");
      };
      socket.onclose = () => {
        socketRef.current = null;
      };
    } catch {
      setPhase("error");
      setMessage("Could not reach the API server.");
    }
  }

  async function finish() {
    setPhase("finishing");
    socketRef.current?.close();
    try {
      const res = await fetch(`/api/providers/${provider}/login/finish`, { method: "POST" });
      const body = await res.json();
      if (res.ok) {
        setResult({ authenticated: body.authenticated, profileName: body.profileName });
        setPhase("done");
        router.refresh();
      } else {
        setPhase("error");
        setMessage(body.message ?? `HTTP ${res.status}`);
      }
    } catch {
      setPhase("error");
      setMessage("Could not reach the API server.");
    }
  }

  // Close the session if the user navigates away mid-login, so the browser
  // profile is never left locked by an abandoned session.
  useEffect(() => {
    return () => {
      socketRef.current?.close();
    };
  }, []);

  const live = phase === "live";

  useEffect(() => {
    if (!live) return;
    function onKeyDown(event: KeyboardEvent) {
      // Only capture while the console has focus.
      if (!canvasRef.current?.contains(document.activeElement)) return;
      if (NAMED_KEYS.has(event.key)) {
        event.preventDefault();
        send({ t: "key", value: event.key });
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        send({ t: "text", value: event.key });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [live, send]);

  return (
    <section className="console">
      <header className="console-head">
        <p className="console-sub">
          {live
            ? (pageUrl ?? "loading…")
            : "The browser runs on the server; only its picture is streamed here."}
        </p>
        <div className="console-actions">
          {phase === "idle" || phase === "error" ? (
            <button className="button" onClick={start}>
              Open login window
            </button>
          ) : null}
          {live && (
            <button className="button" onClick={finish}>
              I&apos;m signed in
            </button>
          )}
          {phase === "starting" && <span className="console-sub">Starting…</span>}
          {phase === "finishing" && <span className="console-sub">Checking…</span>}
        </div>
      </header>

      <p className="hint">
        You are typing into a browser running on the server. Credentials go straight to{" "}
        {label} and are never stored or logged by vod-tracker — but only use this over
        a trusted network, since the stream carries whatever the page shows.
      </p>

      {message && <p className="hint console-error">{message}</p>}

      {phase === "done" && result && (
        <p className="hint">
          {result.authenticated
            ? `Signed in${result.profileName ? ` as ${result.profileName}` : ""}. Session saved — sync will reuse it.`
            : "Session closed, but the provider still looks signed out. Try again, and make sure you pick a profile."}
        </p>
      )}

      <canvas
        ref={canvasRef}
        className="console-screen"
        tabIndex={0}
        aria-label={`${label} login screen`}
        data-live={live ? "true" : "false"}
        onMouseDown={(event) => {
          canvasRef.current?.focus();
          const { x, y } = toViewport(event);
          send({ t: "pointer", type: "down", x, y, button: "left" });
        }}
        onMouseUp={(event) => {
          const { x, y } = toViewport(event);
          send({ t: "pointer", type: "up", x, y, button: "left" });
        }}
        onMouseMove={(event) => {
          const { x, y } = toViewport(event);
          send({ t: "pointer", type: "move", x, y });
        }}
        onWheel={(event) => {
          const { x, y } = toViewport(event);
          send({ t: "pointer", type: "wheel", x, y, deltaX: event.deltaX, deltaY: event.deltaY });
        }}
      />
      {!live && phase !== "starting" && (
        <p className="console-sub">
          Nothing is running. Click “Open login window” to start a session (it closes
          itself after 15 minutes).
        </p>
      )}
    </section>
  );
}
