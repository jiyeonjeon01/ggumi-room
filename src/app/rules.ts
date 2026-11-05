/**
 * Client-side copies of the sign-up rules in api/app/validation.py, for
 * instant feedback. The server re-checks everything.
 */
export const LOGIN_ID_RE = /^[a-z0-9_]{4,20}$/;
export const NICKNAME_RE = /^[가-힣A-Za-z0-9]{2,12}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export function nicknameError(raw: string): string | null {
  const v = raw.normalize('NFC').trim();
  return NICKNAME_RE.test(v) ? null : '닉네임은 한글, 영문, 숫자로 2~12자여야 해요.';
}

export function loginIdError(raw: string): string | null {
  return LOGIN_ID_RE.test(raw.trim().toLowerCase()) ? null : '아이디는 영문 소문자, 숫자, 밑줄(_)로 4~20자여야 해요.';
}

export function passwordError(pw: string, loginId: string): string | null {
  if (pw.length < PASSWORD_MIN) return `비밀번호는 ${PASSWORD_MIN}자 이상이어야 해요.`;
  if (pw.length > PASSWORD_MAX) return `비밀번호는 ${PASSWORD_MAX}자 이하여야 해요.`;
  if (new Set(pw).size < 4) return '같은 글자가 너무 많이 반복돼요.';
  const id = loginId.trim().toLowerCase();
  if (id && pw.toLowerCase().includes(id)) return '비밀번호에 아이디를 넣을 수 없어요.';
  return null;
}

export function joinedLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 가입`;
}
