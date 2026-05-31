import type { ThemeName } from '../shared/themes';
export type { ThemeName };

export type ShuffleMode = 'fisher-yates' | 'balanced' | 'random';

// App-wide settings persisted in memory (no disk storage yet)
export interface AppSettings {
  theme: ThemeName;
  accentHue: number;       // 0–360 oklch hue; overrides theme default when 'custom'
  showRightPanel: boolean;
  carouselSize: number;    // px, 120–240
  density: 'compact' | 'normal' | 'relaxed';
  defaultView: 'Tracks' | 'History';
  discordEnabled: boolean;
  commitAuthor: string;
  shuffleMode: ShuffleMode;
}
