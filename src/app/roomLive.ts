import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameControls } from '../components/GameView';
import type { MoveState, RemoteMember } from '../game/createGame';
import type { ServerMessage } from '../net/live';
import { useLive } from './live';

/**
 * Where this tab stands in the room's realtime session:
 * off (not connected) -> joining -> in; replaced = another tab or device of
 * mine joined this room (only one character per person); denied = no access.
 * Party rooms also: full = no free spot right now (retry by joining again);
 * closed = the party ended.
 */
export type RoomLiveState = 'off' | 'joining' | 'in' | 'replaced' | 'denied' | 'full' | 'closed';

/** People in a party room (including seats kept for a dropped connection). */
export interface HeadCount {
  count: number;
  capacity: number;
}
const headCount = (m: ServerMessage): HeadCount | null =>
  typeof m.count === 'number' && typeof m.capacity === 'number' ? { count: m.count, capacity: m.capacity } : null;

interface Options {
  roomId: string;
  controls: { current: GameControls | null };
  /** The owner saved a new layout (version from the server). */
  onLayout: (items: { type: string; x: number; y: number; facing: number }[], version: number) => void;
  onTheme: (theme: string) => void;
  onNotice: (message: string) => void;
}

const isMember = (m: unknown): m is RemoteMember => {
  const r = m as RemoteMember | null;
  return !!r && typeof r.id === 'string' && typeof r.nickname === 'string' && typeof r.x === 'number' && typeof r.y === 'number';
};
const moveOf = (m: ServerMessage): MoveState => ({ x: m.x as number, y: m.y as number, f: m.f as MoveState['f'], s: m.s as MoveState['s'] });

/** Joins the room over the realtime connection and keeps the game in sync with the others in it. */
export function useRoomLive({ roomId, controls, onLayout, onTheme, onNotice }: Options) {
  const { live, status } = useLive();
  const [state, setState] = useState<RoomLiveState>('off');
  const [others, setOthers] = useState<string[]>([]);
  const [count, setCount] = useState<HeadCount | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const cb = useRef({ onLayout, onTheme, onNotice });
  cb.current = { onLayout, onTheme, onNotice };

  const join = useCallback(() => {
    const p = controls.current?.getPlayer();
    if (live?.send({ t: 'join', room: roomId, ...(p ?? {}) })) setState('joining');
  }, [live, roomId, controls]);

  useEffect(() => {
    if (!live) return;
    const members = new Map<string, string>();
    const show = () => setOthers([...members.values()]);
    const clear = () => {
      members.clear();
      controls.current?.remote.reset([]);
      show();
    };
    const offs = [
      live.on('room.state', (m) => {
        if (m.room !== roomId) return;
        const list = Array.isArray(m.members) ? m.members.filter(isMember) : [];
        members.clear();
        for (const x of list) members.set(x.id, x.nickname);
        controls.current?.remote.reset(list);
        // The server may have moved us off furniture (or to the spawn point).
        const you = m.you;
        const p = controls.current?.getPlayer();
        if (isMember(you) && p && Math.hypot(you.x - p.x, you.y - p.y) > 0.05) controls.current?.fixLocal(you.x, you.y);
        controls.current?.resendPosition();
        setState('in');
        setCount(headCount(m));
        show();
      }),
      live.on('room.join', (m) => {
        if (!isMember(m.member)) return;
        members.set(m.member.id, m.member.nickname);
        controls.current?.remote.join(m.member);
        show();
      }),
      live.on('room.leave', (m) => {
        const id = String(m.id);
        members.delete(id);
        controls.current?.remote.leave(id);
        show();
      }),
      live.on('move', (m) => controls.current?.remote.move(String(m.id), moveOf(m))),
      live.on('say', (m) => controls.current?.remote.say(String(m.id), String(m.text))),
      live.on('move.fix', (m) => controls.current?.fixLocal(m.x as number, m.y as number)),
      live.on('room.layout', (m) => cb.current.onLayout(Array.isArray(m.items) ? m.items : [], Number(m.version))),
      live.on('room.theme', (m) => cb.current.onTheme(String(m.theme))),
      live.on('room.replaced', () => {
        clear();
        setState('replaced');
      }),
      live.on('room.denied', (m) => {
        clear();
        if (m.code === 'full') {
          setCount(headCount(m));
          setState('full');
        } else setState(m.code === 'closed' ? 'closed' : 'denied');
      }),
      live.on('room.count', (m) => setCount(headCount(m))),
      live.on('room.closed', () => {
        clear();
        setState('closed');
      }),
      live.on('error', (m) => {
        if (m.code === 'chat_rate') cb.current.onNotice('말풍선은 조금 천천히 보내 주세요.');
      }),
      live.onStatus((s) => {
        if (s === 'open') {
          // (Re)connected: back into the room, unless another tab holds it (or it's gone).
          if (stateRef.current !== 'replaced' && stateRef.current !== 'denied' && stateRef.current !== 'closed') join();
        } else {
          clear();
          if (stateRef.current === 'in' || stateRef.current === 'joining') setState('off');
        }
      }),
    ];
    if (live.status === 'open') join();
    return () => {
      for (const off of offs) off();
      live.send({ t: 'leave' });
      clear();
      setState('off');
    };
  }, [live, roomId, controls, join]);

  const onLocalMove = useCallback((s: MoveState) => {
    if (stateRef.current === 'in') live?.send({ t: 'move', ...s });
  }, [live]);
  const onLocalSay = useCallback((text: string) => {
    if (stateRef.current === 'in') live?.send({ t: 'say', text });
  }, [live]);

  return { status, state, others, count, rejoin: join, onLocalMove, onLocalSay };
}
