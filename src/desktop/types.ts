import type { ThemeName } from '../shared/themes';
export type { ThemeName };

export type ShuffleMode = 'fisher-yates' | 'smart' | 'weighted' | 'discovery';

export enum LoopMode {
  Off = 'off',
  One = 'one',
  AB  = 'ab',
}

export enum Density {
  Compact = 'compact',
  Normal  = 'normal',
  Relaxed = 'relaxed',
}

export enum DefaultView {
  Tracks  = 'Tracks',
  History = 'History',
}

// App-wide settings persisted in memory (no disk storage yet)
export interface AppSettings {
  theme: ThemeName;
  accentHue: number;       // 0–360 oklch hue; overrides theme default when 'custom'
  showRightPanel: boolean;
  carouselSize: number;    // px, 120–240
  density: Density;
  defaultView: DefaultView;
  discordEnabled: boolean;
  commitAuthor: string;
  shuffleMode: ShuffleMode;
  privacyMode: boolean;
}
