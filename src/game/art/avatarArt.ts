import { PixelCanvas } from './pixelCanvas';

/**
 * Placeholder character sprite sheet, hand-made from palette strings.
 *
 * Sheet layout (one row, FRAME_W x FRAME_H each), named frames:
 *   front-idle, front-blink, front-stepA, front-stepB  (faces down-right)
 *   back-idle,  back-stepA,  back-stepB                 (faces up-right)
 * Left-facing directions reuse these with horizontal flip.
 * Feet touch the floor at (ANCHOR_X, ANCHOR_Y) in every frame.
 * A real sprite sheet only needs to keep these frame names and the anchor.
 */
export const FRAME_W = 16;
export const FRAME_H = 25;
export const ANCHOR_X = 8;
export const ANCHOR_Y = 24;

export const AVATAR_FRAMES = [
  'front-idle',
  'front-blink',
  'front-stepA',
  'front-stepB',
  'back-idle',
  'back-stepA',
  'back-stepB',
] as const;
export type AvatarFrame = (typeof AVATAR_FRAMES)[number];

const HEAD_TOP = [
  '....kkkkkkkk....',
  '...khhhhhhhhk...',
  '..khhHHhhhhhbk..',
  '.khHHhhhhhhhbbk.',
  '.khhhhhhhhhhhhk.',
];

const FACE = [
  '.khhhsshhhsshhk.',
  '.khhssssssssshk.',
  '.khsssessssesh' + 'k.',
  '.khsssessssesh' + 'k.',
  '.khsscssssssch' + 'k.',
  '..khssssSssshk..',
  '...kksssssskk...',
];

const FACE_BLINK_ROW = '.khssssssssssh' + 'k.';

const BACK_HEAD = [
  '.khhhhhhhhhhhhk.',
  '.khhhHhhhhhhhhk.',
  '.khhhhhhhhhhhhk.',
  '.khhhhhhhhHhhhk.',
  '.khhhhhhhhhhhhk.',
  '..khhhhhhhhhhk..',
  '...kkhhhhhhkk...',
];

const BODY_FRONT = [
  '....kppwwppk....',
  '...kppppppppk...',
  '..kPppppppppPk..',
  '..kPppppppppPk..',
  '..ksPPPPPPPPsk..',
  '...kllllllllk...',
  '...kLLLLLLLLk...',
];

const BODY_BACK = ['....kppppppk....', ...BODY_FRONT.slice(1)];

const LEGS_IDLE = [
  '....ksk..ksk....',
  '....ksk..ksk....',
  '....kfk..kfk....',
  '....kkk..kkk....',
];
const LEGS_STEP_A = [
  '....ksk..ksk....',
  '....kfk..ksk....',
  '....kkk..ksk....',
  '.........kfk....',
  '.........kkk....',
];
const LEGS_STEP_B = [
  '....ksk..ksk....',
  '....ksk..kfk....',
  '....ksk..kkk....',
  '....kfk.........',
  '....kkk.........',
];

const PALETTE: Record<string, number> = {
  k: 0x5a3346,
  h: 0x8a5340,
  H: 0xb07458,
  b: 0xff6f9f,
  s: 0xffe0cf,
  S: 0xe9a99a,
  e: 0x3b2333,
  c: 0xffa3b8,
  p: 0xffb3cf,
  P: 0xf08fb5,
  w: 0xffffff,
  l: 0xb9a6f0,
  L: 0x9a86dc,
  f: 0x7a4a68,
};

/** Rows for each frame, and the y offset they're stamped at (walk bob). */
export function avatarFrameRows(frame: AvatarFrame): { rows: string[]; y: number } {
  const face = FACE;
  const blink = [face[0] ?? '', face[1] ?? '', FACE_BLINK_ROW, ...face.slice(3)];
  switch (frame) {
    case 'front-idle':
      return { rows: [...HEAD_TOP, ...face, ...BODY_FRONT, ...LEGS_IDLE], y: 1 };
    case 'front-blink':
      return { rows: [...HEAD_TOP, ...blink, ...BODY_FRONT, ...LEGS_IDLE], y: 1 };
    case 'front-stepA':
      return { rows: [...HEAD_TOP, ...face, ...BODY_FRONT, ...LEGS_STEP_A], y: 0 };
    case 'front-stepB':
      return { rows: [...HEAD_TOP, ...face, ...BODY_FRONT, ...LEGS_STEP_B], y: 0 };
    case 'back-idle':
      return { rows: [...HEAD_TOP, ...BACK_HEAD, ...BODY_BACK, ...LEGS_IDLE], y: 1 };
    case 'back-stepA':
      return { rows: [...HEAD_TOP, ...BACK_HEAD, ...BODY_BACK, ...LEGS_STEP_A], y: 0 };
    case 'back-stepB':
      return { rows: [...HEAD_TOP, ...BACK_HEAD, ...BODY_BACK, ...LEGS_STEP_B], y: 0 };
  }
}

export function drawAvatarSheet(): HTMLCanvasElement {
  const pc = new PixelCanvas(FRAME_W * AVATAR_FRAMES.length, FRAME_H);
  AVATAR_FRAMES.forEach((frame, i) => {
    const { rows, y } = avatarFrameRows(frame);
    pc.stamp(i * FRAME_W, y, rows, PALETTE);
  });
  return pc.toCanvas();
}

/** Soft oval shadow drawn under characters. */
export function drawShadow(): HTMLCanvasElement {
  const w = 14;
  const h = 6;
  const pc = new PixelCanvas(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - w / 2) / (w / 2);
      const dy = (y + 0.5 - h / 2) / (h / 2);
      if (dx * dx + dy * dy <= 1) pc.set(x, y, 0x5a3346, 70);
    }
  }
  return pc.toCanvas();
}
