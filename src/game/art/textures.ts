import type Phaser from 'phaser';
import type { Facing } from '../core/placement';
import type { FurnitureId } from '../room/furniture';
import { AVATAR_FRAMES, drawAvatarSheet, drawShadow, FRAME_H, FRAME_W } from './avatarArt';
import { drawFurniture, furnitureTextureKey } from './furnitureArt';
import { drawFloor, drawWalls, type LayerArt, type WallDecor } from './roomArt';
import type { RoomTheme } from './themes';

/**
 * Registers generated placeholder textures with Phaser. Textures are created
 * once per key and cached by the TextureManager, so switching themes back and
 * forth is cheap. To use real art, load PNGs with the same keys in a Preloader
 * scene and these generators are skipped (the `exists` checks).
 */
export const AVATAR_TEXTURE = 'avatar:default';
export const SHADOW_TEXTURE = 'shadow';

export interface RoomLayerTextures {
  floor: { key: string; art: LayerArt };
  walls: { key: string; art: LayerArt };
}

const layerCache = new Map<string, LayerArt>();

function ensureLayer(scene: Phaser.Scene, key: string, draw: () => LayerArt): { key: string; art: LayerArt } {
  let art = layerCache.get(key);
  if (!art || !scene.textures.exists(key)) {
    art = draw();
    layerCache.set(key, art);
    if (!scene.textures.exists(key)) scene.textures.addCanvas(key, art.canvas);
  }
  return { key, art };
}

export function ensureRoomTextures(scene: Phaser.Scene, w: number, h: number, theme: RoomTheme, decor: WallDecor = 'personal'): RoomLayerTextures {
  return {
    floor: ensureLayer(scene, `floor:${theme.id}:${w}x${h}`, () => drawFloor(w, h, theme)),
    walls: ensureLayer(scene, `walls:${theme.id}:${w}x${h}:${decor}`, () => drawWalls(w, h, theme, decor)),
  };
}

export function ensureFurnitureTexture(scene: Phaser.Scene, id: FurnitureId, theme: RoomTheme, facing: Facing = 0): string {
  const key = furnitureTextureKey(id, theme, facing);
  if (!scene.textures.exists(key)) scene.textures.addCanvas(key, drawFurniture(id, theme, facing));
  return key;
}

export function ensureAvatarTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists(SHADOW_TEXTURE)) scene.textures.addCanvas(SHADOW_TEXTURE, drawShadow());
  if (scene.textures.exists(AVATAR_TEXTURE)) return;
  const tex = scene.textures.addCanvas(AVATAR_TEXTURE, drawAvatarSheet());
  AVATAR_FRAMES.forEach((name, i) => tex?.add(name, 0, i * FRAME_W, 0, FRAME_W, FRAME_H));
}
