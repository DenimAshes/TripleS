import type { NormalizedPlaylist, NormalizedTrack, ServiceKey } from "@/lib/sync/syncTypes";

export const spotifyTracks: NormalizedTrack[] = [
  {
    title: "Blinding Lights",
    artists: ["The Weeknd"],
    album: "After Hours",
    durationMs: 200040,
    isrc: "USUG11904166",
    sourceService: "spotify",
    sourceTrackId: "mock_sp_001",
    url: "https://open.spotify.com/track/mock_sp_001",
  },
  {
    title: "Levitating",
    artists: ["Dua Lipa"],
    album: "Future Nostalgia",
    durationMs: 203064,
    isrc: "GBUM72000196",
    sourceService: "spotify",
    sourceTrackId: "mock_sp_002",
  },
  {
    title: "Save Your Tears",
    artists: ["The Weeknd"],
    album: "After Hours",
    durationMs: 215626,
    isrc: "USUG12100010",
    sourceService: "spotify",
    sourceTrackId: "mock_sp_003",
  },
  {
    title: "As It Was",
    artists: ["Harry Styles"],
    album: "Harry's House",
    durationMs: 167303,
    isrc: "GBUM72200114",
    sourceService: "spotify",
    sourceTrackId: "mock_sp_004",
  },
  {
    title: "Flowers",
    artists: ["Miley Cyrus"],
    album: "Endless Summer Vacation",
    durationMs: 200455,
    isrc: "USRC12201682",
    sourceService: "spotify",
    sourceTrackId: "mock_sp_005",
  },
];

export const youtubeTracks: NormalizedTrack[] = [
  { ...spotifyTracks[0], sourceService: "youtube", sourceTrackId: "mock_yt_001", title: "Blinding Lights (Official Audio)", durationMs: 200100 },
  { ...spotifyTracks[1], sourceService: "youtube", sourceTrackId: "mock_yt_002", title: "Dua Lipa - Levitating", durationMs: 203100 },
  { ...spotifyTracks[2], sourceService: "youtube", sourceTrackId: "mock_yt_003", title: "Save Your Tears (Live)", isrc: undefined, durationMs: 219000 },
  { title: "Anti-Hero", artists: ["Taylor Swift"], album: "Midnights", durationMs: 200690, isrc: "USUG12205736", sourceService: "youtube", sourceTrackId: "mock_yt_004" },
];

export const soundcloudTracks: NormalizedTrack[] = [
  { ...spotifyTracks[0], sourceService: "soundcloud", sourceTrackId: "mock_sc_001", title: "The Weeknd - Blinding Lights", durationMs: 200300 },
  { ...spotifyTracks[4], sourceService: "soundcloud", sourceTrackId: "mock_sc_002", title: "Flowers", durationMs: 200500 },
  { title: "Midnight City", artists: ["M83"], album: "Hurry Up, We're Dreaming", durationMs: 243960, sourceService: "soundcloud", sourceTrackId: "mock_sc_003" },
  { title: "Bad Habit", artists: ["Steve Lacy"], album: "Gemini Rights", durationMs: 232066, sourceService: "soundcloud", sourceTrackId: "mock_sc_004" },
];

export const playlists: Record<ServiceKey, NormalizedPlaylist[]> = {
  spotify: [
    { id: "mock_sp_playlist_favorites", name: "My Favorites", description: "Daily rotation from Spotify", trackCount: 5, isWritable: true },
    { id: "mock_sp_playlist_work", name: "Deep Work", description: "Focus-friendly pop and synth", trackCount: 38, isWritable: true },
    { id: "mock_sp_playlist_drive", name: "Late Night Drive", description: "Neon road music", trackCount: 24, isWritable: true },
    { id: "mock_sp_playlist_new", name: "Fresh Finds", description: "New tracks to review", trackCount: 16, isWritable: true },
  ],
  youtube: [
    { id: "mock_yt_playlist_favorites", name: "YouTube Favorites", description: "Synced music videos", trackCount: 4, isWritable: true },
    { id: "mock_yt_playlist_pop", name: "Pop Videos", description: "Official clips and live cuts", trackCount: 31, isWritable: true },
    { id: "mock_yt_playlist_watch", name: "Watch Later Music", description: "Candidates for cleanup", trackCount: 12, isWritable: true },
  ],
  soundcloud: [
    { id: "mock_sc_playlist_favorites", name: "SoundCloud Favorites", description: "Cloud library mirror", trackCount: 4, isWritable: true },
    { id: "mock_sc_playlist_indie", name: "Indie Uploads", description: "Independent releases", trackCount: 21, isWritable: true },
    { id: "mock_sc_playlist_remixes", name: "Remixes", description: "DJ edits and remixes", trackCount: 44, isWritable: true },
  ],
};

export function tracksFor(service: ServiceKey, playlistId: string) {
  if (service === "spotify" && playlistId.includes("favorites")) return spotifyTracks;
  if (service === "youtube") return youtubeTracks;
  if (service === "soundcloud") return soundcloudTracks;
  return service === "spotify" ? spotifyTracks.slice(0, 3) : service === "youtube" ? youtubeTracks.slice(0, 2) : soundcloudTracks.slice(0, 2);
}
