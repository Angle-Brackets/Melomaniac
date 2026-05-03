// App-wide settings persisted in memory (no disk storage yet)
export interface AppSettings {
  theme: 'warm' | 'cool' | 'forest' | 'violet';
  accentHue: number;       // 0–360 oklch hue
  showRightPanel: boolean;
  carouselSize: number;    // px, 120–240
  density: 'compact' | 'normal' | 'relaxed';
  defaultView: 'Tracks' | 'History';
}
