import type { VodProvider } from "./provider";

export const CONTENT_PROVIDER_KEY = Symbol.for("vod.content-provider");

export type ProviderFieldType = "url" | "text" | "secret";

export interface ProviderField {
  key: string;
  label: string;
  type: ProviderFieldType;
  required?: boolean;
  placeholder?: string;
  help?: string;
}

export interface ContentProviderMeta {
  id: string;
  label: string;
  description?: string;
  auth: "browser" | "credentials" | "none";
  fields: ProviderField[];
  parserVersion: string;
  /** Start URL for browser login. Required when auth is `browser`. */
  loginUrl?: string;
  /** Hosts whose cookies the browser extension may import (registrable domains). */
  cookieDomains?: string[];
}

interface RegistryEntry {
  ctor: new () => VodProvider;
  meta: ContentProviderMeta;
}

const registry: RegistryEntry[] = [];

/** Registers a VOD adapter. SyncService / the UI discover classes from this list. */
export function ContentProvider(meta: ContentProviderMeta): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(CONTENT_PROVIDER_KEY, meta, target);
    const ctor = target as unknown as new () => VodProvider;
    if (!registry.some((entry) => entry.meta.id === meta.id)) {
      registry.push({ ctor, meta });
    }
  };
}

export function discoverContentProviders(): Array<{ instance: VodProvider; meta: ContentProviderMeta }> {
  return registry.map(({ ctor, meta }) => ({ instance: new ctor(), meta }));
}

/** Test helper — do not use in production. */
export function resetContentProviderRegistry(): void {
  registry.length = 0;
}
