'use strict';

/*
  Which shows have free full episodes on YouTube, and where to look.

  Rules that were checked against real data (see the spike):
  - The episode number in the title is the only key. Dates in titles are re-telecast or upload
    dates, not air dates, so they are never used to decide which episode a video is.
  - Official channel, "Episodes" channel and Sony SAB numbers match TMDB exactly from #4000 on.
    Sony PAL numbers (re-runs, #30-#3387) were hand-checked against TMDB on five spread-out episodes.
  - Each channel's uploads list stops at its newest 20,000 videos, so older episodes are read from
    the playlists named per channel (full sync only). Every playlist video still has to pass the title,
    length, embeddable and uploader checks.
  - Lower priority number = preferred when an episode is on several channels.
*/

const SHOWS = {
  8630: {
    tmdbId: 8630,
    season: 1, // TMDB lists every episode in one season, so episode N here is S1E N
    title: 'Taarak Mehta Ka Ooltah Chashmah',
    // "Taarakasura" (another show) must not match, so "taarak" alone is not enough.
    match: /taarak\s*mehta|tmkoc|ool?tah|chash?mah/i,
    maxEpisode: 6000,
    minSeconds: 720, // early episodes (2009-2013) are uploaded at 13-14 minutes
    channels: [
      {
        key: 'official',
        id: 'UCnSFZ-olBoLGLRUS_3RI2Aw',
        label: 'Taarak Mehta Ka Ooltah Chashmah',
        priority: 1,
        playlists: ['PLPbh-P_C0BzSKo8X_EiY0WewaBlNt49g3', 'PLPbh-P_C0BzSxhJ6UCi6tgujD-FsAy0sw', 'PLPbh-P_C0BzS9YiVFrRQTqXbL_0GHMwUH', 'PLFFykHUPUGbw'],
      },
      {
        key: 'episodes',
        id: 'UC54_ux4BnaJwkVFn5M391XQ',
        label: 'Taarak Mehta Ka Ooltah Chashmah Episodes',
        priority: 2,
      },
      {
        key: 'sab',
        id: 'UC6-F5tO8uklgE9Zy8IvbdFw',
        label: 'Sony SAB',
        priority: 3,
        playlists: [
          'PL6Rtnh6YJK7ZFhouqhrvP3Sx0U7qxdzJi',
          'PL6Rtnh6YJK7a9qK5jTtOQBXq2lZrUe7Fe',
          'PL6Rtnh6YJK7aozEKPcoXAY86MgmZtVhLr',
          'PL6Rtnh6YJK7Y_Dj2NYo7jlpqHuFkEVhWN',
          'PL6Rtnh6YJK7bANcM-2xHCa7nMjQul3u_o',
          'PL6Rtnh6YJK7bFJ9ZmLXTorAm7TasgI5U3',
        ],
      },
      {
        key: 'pal',
        id: 'UCw7xjxzbMwgBSmbeYwqYRMg',
        label: 'Sony PAL',
        priority: 4,
        playlists: [
          'PLfyXOEyr93G1DSZ-26hoFNNWQ9Jnu9kZu',
          'PLfyXOEyr93G0tU30XXiIUCO4WxQ1V8EM4',
          'PLfyXOEyr93G1Zb1NhlSmYUjH096WTIyNg',
          'PLfyXOEyr93G2z3c8L5sdG3bMZRqQMXaxi',
        ],
      },
    ],
  },
};

const getShow = (tmdbId) => SHOWS[Number(tmdbId)] || null;
const listShows = () => Object.values(SHOWS);

module.exports = { SHOWS, getShow, listShows };
