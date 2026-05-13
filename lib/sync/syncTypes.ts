export type ServiceKey = "spotify" | "youtube" | "soundcloud";

export type ServiceUser = {
  id: string;
  username: string;
};

export type NormalizedPlaylist = {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  trackCount: number;
  isWritable: boolean;
};

export type NormalizedTrack = {
  title: string;
  artists: string[];
  album?: string;
  durationMs?: number;
  isrc?: string;
  sourceService: ServiceKey;
  sourceTrackId: string;
  url?: string;
  imageUrl?: string;
};

export type TrackSearchQuery = {
  query: string;
  isrc?: string;
};

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresAt?: Date;
};

export enum SyncMode {
  ADD_ONLY = "ADD_ONLY",
  ADD_AND_REMOVE = "ADD_AND_REMOVE",
  FULL_MIRROR = "FULL_MIRROR",
}

export enum SyncDirection {
  ONE_WAY = "ONE_WAY",
  TWO_WAY = "TWO_WAY",
}
