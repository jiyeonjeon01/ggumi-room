import { describe, expect, it } from 'vitest';
import { parse, safeNext } from './router';

const ROOM = '/room/0b7a6f2e-4c1d-4e8a-9f3b-2a1c5d6e7f80';
const INVITE = '/invite/abcdefghijklmnopqrstuvwxyz012345';
const PARTY = '/party/abcdefghijklmnopqrstuvwxyz012345';

describe('safeNext', () => {
  it('keeps in-app destinations', () => {
    expect(safeNext('/')).toBe('/');
    expect(safeNext(ROOM)).toBe(ROOM);
    expect(safeNext(INVITE)).toBe(INVITE);
    expect(safeNext(PARTY)).toBe(PARTY);
    expect(safeNext(`${ROOM}?x=1`)).toBe(ROOM);
  });

  it('never redirects off-site or to unknown paths', () => {
    for (const bad of [
      'https://evil.example',
      '//evil.example',
      '/\evil.example',
      'javascript:alert(1)',
      '/login',
      '/room/not-a-uuid',
      '/party/short',
      '',
      null,
      undefined,
    ]) {
      expect(safeNext(bad)).toBe('/');
    }
  });
});

describe('parse', () => {
  it('maps paths to routes', () => {
    expect(parse('/', '')).toEqual({ name: 'home' });
    expect(parse(ROOM, '')).toEqual({ name: 'room', id: ROOM.slice(6) });
    expect(parse(INVITE, '')).toEqual({ name: 'invite', token: INVITE.slice(8) });
    expect(parse('/invite/short', '')).toEqual({ name: 'invite', token: '' });
    expect(parse(PARTY, '')).toEqual({ name: 'party', token: PARTY.slice(7) });
    expect(parse('/privacy', '')).toEqual({ name: 'privacy' });
    expect(parse('/party/short', '')).toEqual({ name: 'party', token: '' });
    expect(parse('/login', `?next=${encodeURIComponent(INVITE)}`)).toEqual({ name: 'login', next: INVITE });
    expect(parse('/signup', '?next=https://evil.example')).toEqual({ name: 'signup', next: '/' });
    expect(parse('/nope', '')).toEqual({ name: 'notFound' });
  });
});
