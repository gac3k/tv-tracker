"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export function Overlay({
  variant,
  title,
  children,
}: {
  variant: "modal" | "drawer";
  title: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);

  function close() {
    if (window.history.length > 1) router.back();
    else router.push("/providers");
  }

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (!el.open) el.showModal();
    function onCancel(event: Event) {
      event.preventDefault();
      if (window.history.length > 1) router.back();
      else router.push("/providers");
    }
    el.addEventListener("cancel", onCancel);
    return () => {
      el.removeEventListener("cancel", onCancel);
      if (el.open) el.close();
    };
  }, [router]);

  return (
    <dialog
      ref={dialogRef}
      className={`overlay overlay--${variant}`}
      aria-labelledby="overlay-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="overlay-panel">
        <header className="overlay-head">
          <h2 id="overlay-title" className="overlay-title">
            {title}
          </h2>
          <button type="button" className="overlay-close" onClick={close} aria-label="Close">
            ×
          </button>
        </header>
        <div className="overlay-body">{children}</div>
      </div>
    </dialog>
  );
}
