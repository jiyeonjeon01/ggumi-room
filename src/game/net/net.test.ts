import { describe, expect, it } from 'vitest';
import { LiveConnection, liveUrl } from '../../net/live';
import { INTERP_DELAY_MS, MoveReporter, RemoteMotion, type MoveState } from './motion';

const at = (x: number, y = 0, s: MoveState['s'] = 'walk'): MoveState => ({ x, y, f: 'front-right', s });

describe('MoveReporter', () => {
  it('sends at most every 100 ms while walking and nothing while still', () => {
    const r = new MoveReporter();
    const sent: number[] = [];
    for (let t = 0; t <= 1000; t += 16) if (r.update(t, at(t / 1000))) sent.push(t);
    expect(sent.length).toBeGreaterThanOrEqual(9);
    expect(sent.length).toBeLessThanOrEqual(11);
    for (let i = 1; i < sent.length; i++) expect((sent[i] as number) - (sent[i - 1] as number)).toBeGreaterThanOrEqual(100);
    // Standing still: no traffic at all
    const still = new MoveReporter();
    still.update(0, at(1, 1, 'idle'));
    let more = 0;
    for (let t = 16; t < 5000; t += 16) if (still.update(t, at(1, 1, 'idle'))) more++;
    expect(more).toBe(0);
  });

  it('sends the stop right away, and again after a reset', () => {
    const r = new MoveReporter();
    expect(r.update(0, at(0))).not.toBeNull();
    expect(r.update(20, at(0.05))).toBeNull(); // within 100 ms
    expect(r.update(30, at(0.06, 0, 'idle'))).toEqual(at(0.06, 0, 'idle')); // stop goes out at once
    expect(r.update(40, at(0.06, 0, 'idle'))).toBeNull();
    r.reset();
    expect(r.update(50, at(0.06, 0, 'idle'))).not.toBeNull();
  });
});

describe('RemoteMotion', () => {
  it('draws remote players 120 ms behind, interpolating between updates', () => {
    const m = new RemoteMotion(at(0, 0, 'idle'), 0);
    m.push(at(1), 100);
    m.push(at(2), 200);
    expect(m.sample(100 + INTERP_DELAY_MS).x).toBeCloseTo(1, 5);
    expect(m.sample(150 + INTERP_DELAY_MS).x).toBeCloseTo(1.5, 5);
    expect(m.sample(150 + INTERP_DELAY_MS).s).toBe('walk');
    // Past the newest update: holds there (no overshoot)
    expect(m.sample(900).x).toBe(2);
  });

  it('keeps walking smoothly when updates arrive unevenly', () => {
    const m = new RemoteMotion(at(0), 0);
    // 10 Hz updates of a 2.6 tiles/s walk, arriving with up to 40 ms jitter
    const jitter = [0, 35, 5, 40, 10, 0, 30, 15, 0, 25];
    jitter.forEach((j, i) => m.push(at(0.26 * (i + 1)), 100 * (i + 1) + j));
    let prev = m.sample(120).x;
    let maxStep = 0;
    for (let t = 136; t < 1100; t += 16) {
      const x = m.sample(t).x;
      expect(x).toBeGreaterThanOrEqual(prev - 1e-9); // never goes backwards
      maxStep = Math.max(maxStep, x - prev);
      prev = x;
    }
    expect(maxStep).toBeLessThan(0.2); // no visible teleports between frames
  });

  it('jumps instead of gliding across the room', () => {
    const m = new RemoteMotion(at(1, 1, 'idle'), 0);
    m.push(at(7, 6, 'idle'), 1000);
    expect(m.sample(1000)).toMatchObject({ x: 7, y: 6 });
  });

  it('shows the walk until the stop point is reached', () => {
    const m = new RemoteMotion(at(0), 0);
    m.push(at(0.26, 0, 'idle'), 100);
    expect(m.sample(50 + INTERP_DELAY_MS).s).toBe('walk');
    expect(m.sample(100 + INTERP_DELAY_MS).s).toBe('idle');
  });
});

class FakeSocket {
  readyState = 0;
  sent: string[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {}
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
  }
  serverOpen() {
    this.readyState = 1;
    this.onopen?.({});
    this.onmessage?.({ data: JSON.stringify({ t: 'welcome', id: 'c1', user_id: 'u1', nickname: '꾸미' }) });
  }
  serverClose(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

function harness() {
  const sockets: FakeSocket[] = [];
  const timers: { fn: () => void; ms: number; interval: boolean; id: number }[] = [];
  let next = 1;
  const live = new LiveConnection('ws://x/ws/live', {
    createSocket: (u) => {
      const s = new FakeSocket(u);
      sockets.push(s);
      return s;
    },
    setTimeout: (fn, ms) => (timers.push({ fn, ms, interval: false, id: next }), next++),
    clearTimeout: (id) => timers.splice(timers.findIndex((t) => t.id === id) >>> 0, 1),
    setInterval: (fn, ms) => (timers.push({ fn, ms, interval: true, id: next }), next++),
    clearInterval: (id) => timers.splice(timers.findIndex((t) => t.id === id) >>> 0, 1),
    random: () => 1,
  });
  const fireRetry = () => {
    const i = timers.findIndex((t) => !t.interval);
    const t = timers.splice(i, 1)[0];
    t?.fn();
    return t?.ms;
  };
  return { live, sockets, timers, fireRetry };
}

describe('LiveConnection', () => {
  it('builds ws/wss urls from the page', () => {
    expect(liveUrl({ protocol: 'https:', host: 'www.ggumiroom.com' })).toBe('wss://www.ggumiroom.com/ws/live');
    expect(liveUrl({ protocol: 'http:', host: 'localhost:9020' })).toBe('ws://localhost:9020/ws/live');
  });

  it('is "open" only after the server welcomes the session, and pings every 20 s', () => {
    const { live, sockets, timers } = harness();
    const statuses: string[] = [];
    live.onStatus((s) => statuses.push(s));
    live.start();
    expect(live.send({ t: 'ping' })).toBe(false); // not connected yet: dropped
    sockets[0]?.serverOpen();
    expect(statuses).toEqual(['connecting', 'open']);
    expect(live.connId).toBe('c1');
    const ping = timers.find((t) => t.interval);
    expect(ping?.ms).toBe(20000);
    ping?.fn();
    expect(sockets[0]?.sent).toEqual(['{"t":"ping"}']);
  });

  it('reconnects with growing, capped backoff and resets it after a good connection', () => {
    const { live, sockets, fireRetry } = harness();
    live.start();
    const delays: number[] = [];
    for (let i = 0; i < 6; i++) {
      sockets[sockets.length - 1]?.serverClose(1006);
      expect(live.status).toBe('reconnecting');
      delays.push(fireRetry() as number);
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 15000, 15000]);
    sockets[sockets.length - 1]?.serverOpen();
    sockets[sockets.length - 1]?.serverClose(1012); // server restart
    expect(fireRetry()).toBe(1000);
  });

  it('stops retrying when the session is gone', () => {
    const { live, sockets, timers } = harness();
    live.start();
    sockets[0]?.serverOpen();
    sockets[0]?.serverClose(4401);
    expect(live.status).toBe('unauthorized');
    expect(timers.filter((t) => !t.interval)).toHaveLength(0);
  });

  it('stop() closes without reconnecting and routes messages by type', () => {
    const { live, sockets, timers } = harness();
    const got: unknown[] = [];
    live.on('say', (m) => got.push(m.text));
    live.start();
    sockets[0]?.serverOpen();
    sockets[0]?.onmessage?.({ data: '{"t":"say","id":"x","text":"안녕"}' });
    sockets[0]?.onmessage?.({ data: 'not json' });
    expect(got).toEqual(['안녕']);
    live.stop();
    expect(live.status).toBe('closed');
    expect(timers).toHaveLength(0);
  });
});

describe('ActivityTracker', () => {
  it('reports input at most every 30 s and knows how long the user has been idle', async () => {
    const { ActivityTracker } = await import('../../net/activity');
    const a = new ActivityTracker(0);
    expect(a.input(1000)).toBe(true);
    expect(a.input(5000)).toBe(false); // within 30 s of the last report
    expect(a.input(31_000)).toBe(true);
    expect(a.idleMs(91_000)).toBe(60_000);
    a.reported(100_000);
    expect(a.input(110_000)).toBe(false);
  });
});

describe('ActivityTracker interval', () => {
  it('reports often enough for a short away threshold', async () => {
    const { ActivityTracker } = await import('../../net/activity');
    const a = new ActivityTracker(0);
    a.setAwayAfter(8);
    expect(a.input(0)).toBe(true);
    expect(a.input(1000)).toBe(false);
    expect(a.input(2000)).toBe(true); // 8 s / 4
    a.setAwayAfter(300);
    expect(a.input(20_000)).toBe(false);
    expect(a.input(32_000)).toBe(true); // capped at 30 s
  });
});
