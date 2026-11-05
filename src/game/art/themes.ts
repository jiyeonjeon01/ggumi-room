import type { EnvLook } from '../environment/look';
import type { Period } from '../environment/timeOfDay';

export type ThemeId = 'pastel' | 'galaxy' | 'plant';

/** Colors used by the procedural placeholder art for one room theme. */
export interface RoomTheme {
  id: ThemeId;
  label: string;
  outline: number;
  floorA: number;
  floorB: number;
  floorSide: number;
  wallLeft: number;
  wallRight: number;
  wallTrim: number;
  wallPattern: number;
  rug: number;
  rugEdge: number;
  wood: number;
  fabric: number;
  fabricAlt: number;
  accent: number;
  windowSky: number;
  /** Page background behind the canvas (CSS). */
  backdrop: number;
  /** Per-period tweaks to the shared time-of-day look (see environment/look.ts). */
  env?: Partial<Record<Period, Partial<EnvLook>>>;
}

export const THEMES: Record<ThemeId, RoomTheme> = {
  pastel: {
    id: 'pastel',
    label: '파스텔룸',
    outline: 0x7a4a68,
    floorA: 0xf6cfd9,
    floorB: 0xefc0cd,
    floorSide: 0xd99ab4,
    wallLeft: 0xfbe0ea,
    wallRight: 0xf6d2e0,
    wallTrim: 0xfff6f9,
    wallPattern: 0xf4c7d8,
    rug: 0xfff3f7,
    rugEdge: 0xf6c4d6,
    wood: 0xe8b48f,
    fabric: 0xf7a8c4,
    fabricAlt: 0xffffff,
    accent: 0xff7fae,
    windowSky: 0xa9dcff,
    backdrop: 0xfdf0f5,
  },
  galaxy: {
    id: 'galaxy',
    label: '갤럭시룸',
    outline: 0x241a4f,
    floorA: 0x5b4a9e,
    floorB: 0x52428f,
    floorSide: 0x3a2d72,
    wallLeft: 0x3d3380,
    wallRight: 0x342a70,
    wallTrim: 0x7d6ad0,
    wallPattern: 0xffe38a,
    rug: 0x8a7ce0,
    rugEdge: 0xb9a9ff,
    wood: 0xb08ad8,
    fabric: 0x6a58d0,
    fabricAlt: 0xffe38a,
    accent: 0xe08aff,
    windowSky: 0x2a2368,
    backdrop: 0x1e1840,
    env: {
      // Already a dark room: darken less at night so it doesn't turn muddy.
      night: { ambient: 0xdcd6f4, star: 0xffe38a, starCount: 10 },
      dawn: { ambient: 0xf0e8fa },
      day: { ambient: 0xfff8ff },
    },
  },
  plant: {
    id: 'plant',
    label: '플랜트룸',
    outline: 0x5a3a24,
    floorA: 0xd9a06a,
    floorB: 0xcf955e,
    floorSide: 0xa8683a,
    wallLeft: 0xfaf1dc,
    wallRight: 0xf1e5c8,
    wallTrim: 0xc58a55,
    wallPattern: 0xe8d9b4,
    rug: 0xa9c97a,
    rugEdge: 0x86ad58,
    wood: 0xb87a46,
    fabric: 0xf2e6c8,
    fabricAlt: 0xa9c97a,
    accent: 0x6fae4a,
    windowSky: 0xbde6ff,
    backdrop: 0xf4f1e4,
    env: {
      day: { ambient: 0xfff6e8 },
      sunset: { ambient: 0xffdcc0 },
    },
  },
};

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];
