export interface Album {
  id: number;
  title: string;
  artist: string;
  accent: string;
  gradient: string;
}

export interface Track {
  hash: string;
  title: string;
  artist: string;
  album: string;
  albumRef: number;
  length: string;
}

export const ALBUMS: Album[] = [
  { id: 0, title: 'Cozy Mornings', artist: 'Anna Bair', accent: '#c9784a', gradient: 'linear-gradient(135deg, #3a1f0c 0%, #7a3a18 100%)' },
  { id: 1, title: 'Amber Drift',   artist: 'Anna Bair', accent: '#d4803c', gradient: 'linear-gradient(135deg, #2a1508 0%, #8c4a1c 100%)' },
  { id: 2, title: 'Study Beats',   artist: 'Lorun',     accent: '#b87a6a', gradient: 'linear-gradient(135deg, #1e1010 0%, #6a2e24 100%)' },
  { id: 3, title: 'Night Drive',   artist: 'Lorun',     accent: '#7ab0d8', gradient: 'linear-gradient(135deg, #080c12 0%, #1a3a58 100%)' },
  { id: 4, title: 'Deep Workout',  artist: 'Various',   accent: '#a86a4a', gradient: 'linear-gradient(135deg, #1a0e08 0%, #5c2c18 100%)' },
  { id: 5, title: 'Forest Dawn',   artist: 'Lorun',     accent: '#4ead7a', gradient: 'linear-gradient(135deg, #081810 0%, #1e5030 100%)' },
  { id: 6, title: 'Late Pixels',   artist: 'Chipwave',  accent: '#9a78d8', gradient: 'linear-gradient(135deg, #0c0814 0%, #3a2060 100%)' },
  { id: 7, title: 'Iron Skies',    artist: 'Various',   accent: '#8a9ab0', gradient: 'linear-gradient(135deg, #0a0c10 0%, #243040 100%)' },
];

export const TRACKS: Track[] = [
  { hash: 'a1b2c3', title: 'Morning Haze',       artist: 'Anna Bair',  album: 'Cozy Mornings', albumRef: 0, length: '3:12' },
  { hash: 'b2c3d4', title: 'Soft Current',        artist: 'Anna Bair',  album: 'Amber Drift',   albumRef: 1, length: '4:05' },
  { hash: 'c3d4e5', title: 'Lo-Fi Study',         artist: 'Lorun',      album: 'Study Beats',   albumRef: 2, length: '2:48' },
  { hash: 'd4e5f6', title: 'Ember Walk',          artist: 'Anna Bair',  album: 'Amber Drift',   albumRef: 1, length: '3:45' },
  { hash: 'e5f6g7', title: 'Neon Boulevard',      artist: 'Lorun',      album: 'Night Drive',   albumRef: 3, length: '5:10' },
  { hash: 'f6g7h8', title: 'Deep Focus',          artist: 'Lorun',      album: 'Study Beats',   albumRef: 2, length: '3:30' },
  { hash: 'g7h8i9', title: 'Midnight Protocol',   artist: 'Chipwave',   album: 'Late Pixels',   albumRef: 6, length: '4:22' },
  { hash: 'h8i9j0', title: 'Iron Skies',          artist: 'Various',    album: 'Iron Skies',    albumRef: 7, length: '3:58' },
];
