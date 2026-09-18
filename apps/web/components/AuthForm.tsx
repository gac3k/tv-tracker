"use client";

import { useState } from "react";
import Link from "next/link";
import { authClient } from "../lib/auth-client";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const [username, setUsername] = useState(mode === "login" ? "admin" : "");
  const [password, setPassword] = useState(mode === "login" ? "admin" : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result =
      mode === "login"
        ? await authClient.signIn.username({ username, password })
        : await authClient.signUp.email({
            email: `${username}@tv.local`,
            password,
            name: username,
            username,
          });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Authentication failed");
      return;
    }
    window.location.href = "/";
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={onSubmit}>
        <p className="wordmark">
          vod<span>·</span>tracker
        </p>
        <h1 className="shelf-title">{mode === "login" ? "Sign in" : "Create user"}</h1>
        <p className="shelf-lede">
          {mode === "login"
            ? "Default account is admin / admin."
            : "New users start with an empty library. Existing history stays on admin."}
        </p>
        <label className="field">
          Username
          <input
            className="search"
            name="username"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
            minLength={3}
          />
        </label>
        <label className="field">
          Password
          <input
            className="search"
            type="password"
            name="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={5}
          />
        </label>
        {error && (
          <p className="hint" role="alert">
            {error}
          </p>
        )}
        <button className="button" type="submit" disabled={pending}>
          {mode === "login" ? "Sign in" : "Create account"}
        </button>
        <p className="hint">
          {mode === "login" ? (
            <>
              Need another profile? <Link href="/register">Create user</Link>
            </>
          ) : (
            <>
              Already have a user? <Link href="/login">Sign in</Link>
            </>
          )}
        </p>
      </form>
    </main>
  );
}
