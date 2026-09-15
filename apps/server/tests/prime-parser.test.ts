import { describe, expect, it } from "vitest";
import {
  buildObservation,
  extractHistoryEntries,
  type PrimeHistoryEntry,
} from "../src/providers/prime/parser";
import { ProviderParseError } from "../src/providers/errors";
import type {
  PrimeEnrichmentsResponse,
  PrimeHistoryResponse,
  PrimeMetadataItem,
} from "../src/providers/prime/types";

const observedAt = new Date("2026-09-04T18:00:00Z");

const historyResponse: PrimeHistoryResponse = {
  widgets: [
    {
      widgetType: "watch-history",
      content: {
        content: {
          nextToken: "tok2",
          titles: [
            {
              date: "September 1, 2026",
              titles: [
                {
                  gti: "amzn1.dv.gti.show1",
                  time: 0,
                  children: [
                    { gti: "amzn1.dv.gti.ep1", time: 1756000000000, children: [] },
                    { gti: "amzn1.dv.gti.ep2", time: 1756100000000, children: [] },
                  ],
                },
                { gti: "amzn1.dv.gti.movie1", time: 1756200000000, children: [] },
              ],
            },
          ],
        },
      },
    },
  ],
};

const enrichments: PrimeEnrichmentsResponse = {
  enrichments: {
    "amzn1.dv.gti.ep1": { progress: { percentage: 73 } },
    "amzn1.dv.gti.movie1": { progress: { percentage: 12 } },
    // ep2 has no enrichment -> defaults to 100
  },
};

const episodeMetadata: PrimeMetadataItem = {
  catalogMetadata: {
    catalog: { entityType: "TV Show", episodeNumber: 4, id: "amzn1.dv.gti.ep1", title: "The Fourth" },
    family: {
      tvAncestors: [{ catalog: { seasonNumber: 2 } }, { catalog: { title: "Test Show [en/eng]" } }],
    },
  },
};

const movieMetadata: PrimeMetadataItem = {
  catalogMetadata: {
    catalog: { entityType: "Movie", id: "amzn1.dv.gti.movie1", title: "Big Movie [en/eng]" },
  },
};

describe("Prime history extraction", () => {
  it("flattens nested episodes and reports nextToken", () => {
    const entries = extractHistoryEntries(historyResponse);
    expect(entries.map((e) => e.gti)).toEqual([
      "amzn1.dv.gti.ep1",
      "amzn1.dv.gti.ep2",
      "amzn1.dv.gti.movie1",
    ]);
    expect(entries[0]!.watchedAt).toEqual(new Date(1756000000000));
  });

  it("returns empty for a message-only widget", () => {
    const empty: PrimeHistoryResponse = {
      widgets: [
        { widgetType: "watch-history", content: { content: { header: "h", message: "none" } } },
      ],
    };
    expect(extractHistoryEntries(empty)).toEqual([]);
  });

  it("throws clearly when the widget is missing", () => {
    expect(() => extractHistoryEntries({ widgets: [] })).toThrow(ProviderParseError);
  });
});

describe("Prime observation building", () => {
  const entry: PrimeHistoryEntry = {
    gti: "amzn1.dv.gti.ep1",
    watchedAt: new Date(1756000000000),
    raw: {},
  };

  it("builds an episode with season/episode and strips version tags", () => {
    const obs = buildObservation(entry, enrichments, episodeMetadata, observedAt);
    expect(obs.provider).toBe("prime");
    expect(obs.mediaType).toBe("episode");
    expect(obs.showTitle).toBe("Test Show");
    expect(obs.title).toBe("The Fourth");
    expect(obs.seasonNumber).toBe(2);
    expect(obs.episodeNumber).toBe(4);
    expect(obs.progress).toBe(73);
  });

  it("builds a movie", () => {
    const movieEntry: PrimeHistoryEntry = {
      gti: "amzn1.dv.gti.movie1",
      watchedAt: new Date(1756200000000),
      raw: {},
    };
    const obs = buildObservation(movieEntry, enrichments, movieMetadata, observedAt);
    expect(obs.mediaType).toBe("movie");
    expect(obs.title).toBe("Big Movie");
    expect(obs.progress).toBe(12);
  });

  it("defaults missing enrichment progress to 100", () => {
    const ep2: PrimeHistoryEntry = { gti: "amzn1.dv.gti.ep2", watchedAt: observedAt, raw: {} };
    expect(buildObservation(ep2, enrichments, null, observedAt).progress).toBe(100);
  });
});
