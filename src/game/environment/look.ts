import type { SunRay } from '../art/sunlightArt';
import type { RoomTheme } from '../art/themes';
import type { Period } from './timeOfDay';

export type Celestial = 'sun-high' | 'sun-low' | 'sun-rise' | 'moon' | 'none';

/** Everything that changes visually with the time of day. */
export interface EnvLook {
  /** Sky bands from top to bottom (dithered together). */
  sky: readonly number[];
  celestial: Celestial;
  /** Cloud colors; cloudCount 0 hides them. */
  cloud: { light: number; shade: number; outline: number };
  cloudCount: number;
  starCount: number;
  star: number;
  /** Multiply color applied to the whole room (0xffffff = unchanged). */
  ambient: number;
  /** Warm lamp glow strength, 0..1. */
  lamp: number;
  /** Cool glow of screens (the desk monitor), 0..1. No floor light. */
  screen: number;
  /**
   * Natural light through the windows, independent of the lamp. `color` is
   * the light on the glass, in the air and on the floor; `tint` the color of
   * the faint glow on the wall around the window. `glass`, `glow`, `shaft`
   * (light in the air) and `floor` are their ADD strengths; `ray` sets the floor pattern's shape (see SunRay). The
   * window should read as a bright opening, never as a light source.
   */
  sunlight: { color: number; tint: number; glass: number; glow: number; floor: number; shaft: number; ray: SunRay };
}

/**
 * Window light keeps one color and strength in every period, halfway
 * between dawn and sunset. Only where it falls changes, as if following the
 * sun: dawn leans left and long, midday is short and nearly straight, sunset
 * leans right and long, and the moon throws a short slant to the left.
 */
const NATURAL_LIGHT: Omit<EnvLook['sunlight'], 'ray'> = {
  color: 0xf4d9d8,
  tint: 0xf89a9d,
  glass: 0.045,
  glow: 0.11,
  floor: 0.23,
  shaft: 0.155,
};

const RAYS: Record<Period, SunRay> = {
  dawn: { start: 0.3, reach: 0.12, slant: -0.05, spread: 0.45 },
  day: { start: 0.3, reach: 0.085, slant: 0.015, spread: 0.4 },
  sunset: { start: 0.3, reach: 0.125, slant: 0.055, spread: 0.5 },
  night: { start: 0.3, reach: 0.1, slant: -0.025, spread: 0.4 },
};

/**
 * Shared look for all rooms. Themes may override any field per period via
 * `RoomTheme.env`, so a theme can blend in without its own window system.
 */
const BASE: Record<Period, EnvLook> = {
  dawn: {
    sky: [0x9d8fd6, 0xc6aee8, 0xf2c2dc, 0xffe2d6],
    celestial: 'sun-rise',
    cloud: { light: 0xfff0f6, shade: 0xe6c3e0, outline: 0xb08ac8 },
    cloudCount: 1,
    starCount: 2,
    star: 0xfff6e0,
    ambient: 0xe9e0f4,
    lamp: 0.35,
    screen: 0.35,
    sunlight: { ...NATURAL_LIGHT, ray: RAYS.dawn },
  },
  day: {
    sky: [0x7cc4f4, 0x9ed6fa, 0xbfe6ff, 0xdff3ff],
    celestial: 'sun-high',
    cloud: { light: 0xffffff, shade: 0xdcecf8, outline: 0x8fb4d8 },
    cloudCount: 2,
    starCount: 0,
    star: 0xffffff,
    ambient: 0xfffbf4,
    lamp: 0,
    screen: 0.05,
    sunlight: { ...NATURAL_LIGHT, ray: RAYS.day },
  },
  sunset: {
    sky: [0x7a63b8, 0xc77bb5, 0xf59a9a, 0xffc17a],
    celestial: 'sun-low',
    cloud: { light: 0xffd2c4, shade: 0xe39aa6, outline: 0x9a5f8c },
    cloudCount: 2,
    starCount: 0,
    star: 0xffffff,
    ambient: 0xffe2d2,
    lamp: 0.5,
    screen: 0.5,
    sunlight: { ...NATURAL_LIGHT, ray: RAYS.sunset },
  },
  night: {
    sky: [0x1c1a4a, 0x2a2563, 0x3b3078, 0x4e3a8a],
    celestial: 'moon',
    cloud: { light: 0x5a5296, shade: 0x463f80, outline: 0x2a2560 },
    cloudCount: 0,
    starCount: 8,
    star: 0xfff3b0,
    ambient: 0xc9c2e8,
    lamp: 1,
    screen: 1,
    sunlight: { ...NATURAL_LIGHT, ray: RAYS.night },
  },
};

export function lookFor(period: Period, theme: RoomTheme): EnvLook {
  return { ...BASE[period], ...theme.env?.[period] };
}
