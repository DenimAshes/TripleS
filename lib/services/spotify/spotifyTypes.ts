export type SpotifyImage = {
  url: string;
  height?: number | null;
  width?: number | null;
};

export type SpotifyUser = {
  id: string;
  display_name?: string | null;
  email?: string;
};

export type SpotifyPlaylist = {
  id: string;
  name: string;
  description?: string | null;
  images?: SpotifyImage[];
  tracks?: { total?: number };
  items?: { total?: number; href?: string };
  owner?: { id: string };
  collaborative?: boolean;
  public?: boolean | null;
};

export type SpotifyTrack = {
  id: string;
  uri: string;
  name: string;
  duration_ms?: number;
  external_ids?: { isrc?: string };
  external_urls?: { spotify?: string };
  album?: {
    name?: string;
    images?: SpotifyImage[];
  };
  artists?: {
    name: string;
  }[];
};

export type SpotifyPaged<T> = {
  items: T[];
  next?: string | null;
  total?: number;
};

export type SpotifyPlaylistTrackItem = {
  added_at?: string;
  track?: SpotifyTrack | null;
  item?: SpotifyTrack | null;
};
