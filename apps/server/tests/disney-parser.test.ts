import { describe, expect, it } from "vitest";
import {
  buildObservation,
  parseRemainingMinutes,
} from "../src/providers/disney/parser";

const observedAt = new Date("2026-09-04T18:00:00Z");

describe("Disney+ remaining-time parsing", () => {
  it("parses Polish minutes", () => {
    expect(parseRemainingMinutes("11 m do końca")).toBe(11);
  });

  it("parses hours + minutes", () => {
    expect(parseRemainingMinutes("1 h 5 m do końca")).toBe(65);
    expect(parseRemainingMinutes("2 godz. 10 m")).toBe(130);
  });

  it("returns undefined for no time", () => {
    expect(parseRemainingMinutes("Fineasz i Ferb")).toBeUndefined();
    expect(parseRemainingMinutes(undefined)).toBeUndefined();
  });
});

describe("Disney+ observation building (real DOM shapes)", () => {
  it("builds an episode from a Polish tile (S2:O22)", () => {
    const obs = buildObservation(
      {
        id: "e2ae7bca-10cb-4bd3-a6e3-f8faacb33617",
        remainingText: "11 m do końca",
        showText: "Fineasz i Ferb",
        episodeText: "S2:O22 Ferie zimowe Fineasza i Ferba",
        ariaLabel: "Fineasz i Ferb Sezon 2 Odcinek 22 Ferie zimowe Fineasza i Ferba 11 minuty do końca",
      },
      observedAt
    );
    expect(obs.provider).toBe("disney");
    expect(obs.source).toBe("continue_watching");
    expect(obs.mediaType).toBe("episode");
    expect(obs.showTitle).toBe("Fineasz i Ferb");
    expect(obs.title).toBe("Ferie zimowe Fineasza i Ferba");
    expect(obs.seasonNumber).toBe(2);
    expect(obs.episodeNumber).toBe(22);
    expect(obs.positionSeconds).toBe(11 * 60);
    expect(obs.progress).toBeUndefined();
  });

  it("handles the English episode marker (S6:E11)", () => {
    const obs = buildObservation(
      {
        id: "uuid-en",
        remainingText: "22m left",
        showText: "Homeland",
        episodeText: "S6:E11 R for Romeo",
      },
      observedAt
    );
    expect(obs.seasonNumber).toBe(6);
    expect(obs.episodeNumber).toBe(11);
    expect(obs.title).toBe("R for Romeo");
    expect(obs.positionSeconds).toBe(22 * 60);
  });

  it("builds a movie when there is no episode line", () => {
    const obs = buildObservation(
      { id: "uuid-movie", remainingText: "48 m do końca", showText: "Vaiana" },
      observedAt
    );
    expect(obs.mediaType).toBe("movie");
    expect(obs.title).toBe("Vaiana");
    expect(obs.showTitle).toBeUndefined();
    expect(obs.positionSeconds).toBe(48 * 60);
  });
});
