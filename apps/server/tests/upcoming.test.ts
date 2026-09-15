import { describe, expect, it } from "vitest";
import { lastAvailableEpisode, pickUpcomingMovie, pickUpcomingTv, unwrapTvDetails } from "../src/watchlist/upcoming";

const today = "2026-09-14";

describe("pickUpcomingTv", () => {
  it("treats next E1 of season 1 as a series premiere", () => {
    const pick = pickUpcomingTv(
      {
        id: 1,
        name: "New Show",
        poster_path: null,
        next_episode_to_air: {
          air_date: "2026-10-01",
          episode_number: 1,
          season_number: 1,
          name: "Pilot",
        },
        seasons: [],
      },
      today
    );
    expect(pick).toMatchObject({ kind: "series", airDate: "2026-10-01", seasonNumber: 1 });
  });

  it("treats next E1 of later seasons as a new season", () => {
    const pick = pickUpcomingTv(
      {
        id: 2,
        name: "Silo",
        poster_path: null,
        next_episode_to_air: {
          air_date: "2026-11-02",
          episode_number: 1,
          season_number: 4,
          name: "S4E1",
        },
        seasons: [],
      },
      today
    );
    expect(pick).toMatchObject({ kind: "season", subtitle: "Season 4" });
  });

  it("skips mid-season next episodes", () => {
    const pick = pickUpcomingTv(
      {
        id: 3,
        name: "The Bear",
        poster_path: null,
        next_episode_to_air: {
          air_date: "2026-09-20",
          episode_number: 5,
          season_number: 4,
          name: "E5",
        },
        seasons: [{ air_date: "2025-01-01", season_number: 4, name: "Season 4" }],
      },
      today
    );
    expect(pick).toBeNull();
  });

  it("falls back to a future season air date", () => {
    const pick = pickUpcomingTv(
      {
        id: 4,
        name: "Ended-ish",
        poster_path: null,
        next_episode_to_air: null,
        seasons: [
          { air_date: "2024-01-01", season_number: 1, name: "S1" },
          { air_date: "2026-12-01", season_number: 2, name: "S2" },
        ],
      },
      today
    );
    expect(pick).toMatchObject({ kind: "season", airDate: "2026-12-01", seasonNumber: 2 });
  });
});

describe("lastAvailableEpisode", () => {
  it("uses last_episode_to_air when next is still in the future", () => {
    expect(
      lastAvailableEpisode(
        {
          id: 1,
          name: "The Bear",
          poster_path: null,
          last_episode_to_air: {
            air_date: "2026-09-10",
            episode_number: 8,
            season_number: 4,
            name: "E8",
          },
          next_episode_to_air: {
            air_date: "2026-09-20",
            episode_number: 9,
            season_number: 4,
            name: "E9",
          },
          seasons: [],
        },
        today
      )
    ).toEqual({ season: 4, episode: 8 });
  });

  it("advances to next_episode_to_air when that episode has already aired", () => {
    expect(
      lastAvailableEpisode(
        {
          id: 1,
          name: "The Bear",
          poster_path: null,
          last_episode_to_air: {
            air_date: "2026-09-10",
            episode_number: 8,
            season_number: 4,
            name: "E8",
          },
          next_episode_to_air: {
            air_date: "2026-09-14",
            episode_number: 9,
            season_number: 4,
            name: "E9",
          },
          seasons: [],
        },
        today
      )
    ).toEqual({ season: 4, episode: 9 });
  });
});

describe("unwrapTvDetails", () => {
  const raw = {
    id: 125988,
    name: "Silo",
    poster_path: "/x.jpg",
    next_episode_to_air: {
      air_date: "2027-07-08",
      episode_number: 1,
      season_number: 4,
      name: "Episode 1",
    },
    seasons: [{ air_date: "2027-07-08", season_number: 4, name: "Season 4" }],
  };

  it("reads raw TMDB show JSON and the wrapped upcoming cache shape", () => {
    expect(unwrapTvDetails(raw)?.name).toBe("Silo");
    expect(unwrapTvDetails({ title: "Silo", posterPath: "/x.jpg", tv: raw })?.id).toBe(125988);
    expect(pickUpcomingTv(unwrapTvDetails(raw)!, today)).toMatchObject({
      kind: "season",
      airDate: "2027-07-08",
      seasonNumber: 4,
    });
  });
});

describe("pickUpcomingMovie", () => {
  it("keeps unreleased movies", () => {
    expect(
      pickUpcomingMovie({ id: 9, title: "Soon", poster_path: null, release_date: "2026-12-25" }, today)
    ).toMatchObject({ kind: "movie", airDate: "2026-12-25" });
  });

  it("drops already-released movies", () => {
    expect(
      pickUpcomingMovie({ id: 9, title: "Out", poster_path: null, release_date: "2026-01-01" }, today)
    ).toBeNull();
  });
});
