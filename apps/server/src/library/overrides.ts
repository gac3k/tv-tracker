import {
  contentIdentityKey,
  titleIdentityKey,
  type LibraryItem,
} from "./aggregate";
import { isTmdbWatched } from "../shows/progress";

export type OverrideAction = "watched" | "hidden";

export function overrideMap(rows: { key: string; action: string }[]): Map<string, OverrideAction> {
  const map = new Map<string, OverrideAction>();
  for (const row of rows) {
    if (row.action === "watched" || row.action === "hidden") {
      map.set(row.key, row.action);
    }
  }
  return map;
}

export function isHidden(item: LibraryItem, overrides: Map<string, OverrideAction>): boolean {
  return (
    overrides.get(contentIdentityKey(item)) === "hidden" ||
    overrides.get(titleIdentityKey(item)) === "hidden"
  );
}

/** Force completed / titleWatched from user actions. Hidden is list membership, not a field. */
export function applyOverride<T extends LibraryItem>(
  item: T,
  overrides: Map<string, OverrideAction>,
  tmdb?: { id: number; type: string } | null
): T {
  const content = overrides.get(contentIdentityKey(item));
  const title = overrides.get(titleIdentityKey(item));
  const fromTmdb = isTmdbWatched(
    tmdb?.id ?? null,
    tmdb?.type ?? null,
    item.seasonNumber,
    item.episodeNumber,
    overrides
  );
  const watched = content === "watched" || title === "watched" || fromTmdb.completed;
  if (!watched) return item;
  return {
    ...item,
    completed: true,
    titleWatched: title === "watched" || fromTmdb.titleWatched,
  };
}
