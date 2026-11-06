import { useState } from 'react';
import { api, ApiError } from '../api/client';
import type { InviteArrival } from '../app/inviteArrival';
import { Button, Modal } from './ui';

/**
 * Shown once to someone who entered a room through its owner's invite link:
 * offers to send the owner a friend request (nothing happens without "yes").
 */
export function FriendOfferModal({
  arrival,
  onClose,
  onDone,
}: {
  arrival: InviteArrival;
  onClose: () => void;
  /** After the request went out (or became a friendship): message for a toast. */
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const name = arrival.owner_nickname;

  const yes = async () => {
    setBusy(true);
    try {
      // Same API as the friend search; if they had asked us first, this accepts their request.
      const r = await api<{ status: 'pending' | 'accepted' }>('POST', '/api/friends/requests', { user_id: arrival.owner_id });
      onDone(r.status === 'accepted' ? `${name}님과 친구가 되었어요! 🎉` : '친구 신청을 보냈어요! 💌');
    } catch (e) {
      // Already friends / already asked (changed since entering): say so kindly.
      onDone(e instanceof ApiError ? e.detail.message : '친구 신청을 보내지 못했어요.');
    }
  };

  return (
    <Modal title="💌 친구도 되어 볼까요?" onClose={onClose}>
      <div className="space-y-4 text-center">
        <p className="text-4xl" aria-hidden>
          🏠💕
        </p>
        <p className="text-sm leading-relaxed text-plum-700">
          <b className="font-normal text-blush-500">{name}</b>님의 방에 놀러 왔어요!
          <br />
          {arrival.relation === 'incoming' ? (
            <>
              <b className="font-normal text-blush-500">{name}</b>님도 친구 신청을 보냈어요. 친구가 되어 볼까요?
            </>
          ) : (
            <>
              <b className="font-normal text-blush-500">{name}</b>님에게 친구 신청을 보내볼까요?
            </>
          )}
        </p>
        <div className="flex gap-2">
          <Button variant="soft" className="flex-1" onClick={onClose} disabled={busy}>
            나중에 할게요
          </Button>
          <Button className="flex-1" onClick={() => void yes()} disabled={busy}>
            {busy ? '보내는 중…' : '네, 좋아요!'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
