import type { CollisionWorld } from '../core/collision';
import { keyboardDirToWorld, type Vec2 } from '../core/iso';
import type { NavGrid } from '../core/pathfinding';
import type { Avatar } from './Avatar';

/** Walking speed in world tiles per second. */
export const WALK_SPEED = 2.6;
const ARRIVE_EPS = 0.02;

/**
 * Drives the local player's avatar from input. Keyboard and click movement
 * share one code path: both produce a desired world velocity that goes
 * through CollisionWorld.move, so speed, sliding and collision are identical.
 * Pressing a key cancels an active click-to-move path.
 */
export class AvatarController {
  private path: Vec2[] = [];
  private stuckTime = 0;

  constructor(
    private readonly avatar: Avatar,
    private readonly world: CollisionWorld,
    private readonly nav: NavGrid,
    /** Called when the click destination changes (null = none). */
    private readonly onDestination: (dest: Vec2 | null) => void = () => {},
  ) {}

  /** Starts walking toward a world point; blocked targets resolve to the nearest free spot. */
  walkTo(target: Vec2): void {
    this.path = this.nav.findPath(this.avatar.pos, target);
    this.stuckTime = 0;
    this.onDestination(this.path[this.path.length - 1] ?? null);
  }

  stop(): void {
    if (this.path.length) this.onDestination(null);
    this.path = [];
  }

  get destination(): Vec2 | null {
    return this.path[this.path.length - 1] ?? null;
  }

  /**
   * @param dt seconds since last frame (already clamped by the caller)
   * @param keyX keyboard horizontal input (-1, 0, 1), screen-oriented
   * @param keyY keyboard vertical input (-1, 0, 1), screen-oriented
   */
  update(dt: number, keyX: number, keyY: number): void {
    const from = this.avatar.pos;
    let dir: Vec2 = { x: 0, y: 0 };
    let maxStep = WALK_SPEED * dt;

    if (keyX !== 0 || keyY !== 0) {
      this.stop();
      dir = keyboardDirToWorld(keyX, keyY);
    } else {
      // Drop reached waypoints, then head for the next one.
      let next = this.path[0];
      while (next && Math.hypot(next.x - from.x, next.y - from.y) < ARRIVE_EPS) {
        this.path.shift();
        next = this.path[0];
        if (!next) this.onDestination(null); // arrived
      }
      if (next) {
        const dx = next.x - from.x;
        const dy = next.y - from.y;
        const dist = Math.hypot(dx, dy);
        dir = { x: dx / dist, y: dy / dist };
        maxStep = Math.min(maxStep, dist); // don't overshoot the waypoint
      }
    }

    const moved = this.world.move(from, dir.x * maxStep, dir.y * maxStep, this.avatar.radius);
    const vx = dt > 0 ? (moved.x - from.x) / dt : 0;
    const vy = dt > 0 ? (moved.y - from.y) / dt : 0;

    // Give up on a click path if something keeps us from making progress.
    if (this.path.length && Math.hypot(vx, vy) < WALK_SPEED * 0.2) {
      this.stuckTime += dt;
      if (this.stuckTime > 0.25) this.stop();
    } else {
      this.stuckTime = 0;
    }

    this.avatar.pos = moved;
    this.avatar.setMotion(vx, vy);
  }
}
