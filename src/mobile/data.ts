export interface Album {
  id: number;
  title: string;
  artist: string;
  accent: string;
  gradient: string;
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

