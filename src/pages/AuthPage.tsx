import { useState, type ChangeEvent, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../app/auth';
import { navigate, pendingInvite } from '../app/router';
import { inviteArrival, type InviteArrival } from '../app/inviteArrival';
import { loginIdError, nicknameError, passwordError } from '../app/rules';
import { Button, Card, Field } from '../components/ui';

/**
 * After login/sign-up: if the user came from an invite, accept it and go to
 * that room; otherwise go to `next` (already sanitized by the router).
 */
export async function finishAuth(next: string): Promise<void> {
  const token = pendingInvite.get();
  if (token) {
    try {
      const arrival = await api<InviteArrival>('POST', `/api/invites/${token}/accept`);
      pendingInvite.clear();
      inviteArrival.set(arrival);
      navigate(`/room/${arrival.room_id}`, { replace: true });
      return;
    } catch {
      // Expired/revoked meanwhile: show the invite card, which explains it.
      pendingInvite.clear();
      navigate(`/invite/${token}`, { replace: true });
      return;
    }
  }
  navigate(next, { replace: true });
}

function switchHref(to: 'login' | 'signup', next: string): string {
  return next === '/' ? `/${to}` : `/${to}?next=${encodeURIComponent(next)}`;
}

function InviteHint() {
  return pendingInvite.get() ? (
    <p className="mb-4 rounded-2xl bg-lavender-100 px-3 py-2 text-sm text-plum-700">💌 로그인하면 초대받은 방으로 바로 이동해요.</p>
  ) : null;
}

export function LoginPage({ next }: { next: string }) {
  const { login } = useAuth();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(loginId, password);
      await finishAuth(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail.message : '로그인하지 못했어요.');
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-sm py-6">
      <Card>
        <h2 className="mb-1 text-2xl text-plum-700">다시 만나서 반가워요</h2>
        <p className="mb-4 text-sm text-plum-500">아이디와 비밀번호로 로그인해요.</p>
        <InviteHint />
        <form onSubmit={submit} className="space-y-1" noValidate>
          <Field label="아이디" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={loginId} onChange={(e) => setLoginId(e.target.value)} required />
          <Field label="비밀번호" name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <p role="alert" className="pb-2 text-sm text-blush-500">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy || !loginId || !password}>
            {busy ? '로그인 중…' : '로그인'}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-plum-500">
          처음이에요?{' '}
          <a href={switchHref('signup', next)} onClick={(e) => (e.preventDefault(), navigate(switchHref('signup', next), { replace: true }))} className="text-blush-500 underline underline-offset-2">
            회원가입
          </a>
        </p>
      </Card>
    </div>
  );
}

export function SignupPage({ next }: { next: string }) {
  const { signup, signupCodeRequired } = useAuth();
  const codeRequired = signupCodeRequired === true;
  const [form, setForm] = useState({ nickname: '', login_id: '', password: '', password_confirm: '', signup_code: '' });

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [serverErr, setServerErr] = useState<{ field?: string; message: string } | null>(null);
  const [idCheck, setIdCheck] = useState<{ id: string; available: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [k]: e.target.value });
    if (serverErr?.field === k) setServerErr(null);
  };
  const blur = (k: string) => () => setTouched({ ...touched, [k]: true });

  const normalizedId = form.login_id.trim().toLowerCase();
  const errs = {
    nickname: nicknameError(form.nickname),
    login_id: loginIdError(form.login_id),
    password: passwordError(form.password, form.login_id),
    password_confirm: form.password_confirm === form.password ? null : '비밀번호가 서로 달라요.',
    signup_code: codeRequired && !form.signup_code.trim() ? '가입 코드를 적어 주세요.' : null,
  };
  const shown = (k: keyof typeof errs) =>
    (serverErr?.field === k ? serverErr.message : null) ?? (touched[k] ? errs[k] : null);
  const idChecked = idCheck?.id === normalizedId ? idCheck : null;

  const checkId = async () => {
    setTouched({ ...touched, login_id: true });
    if (errs.login_id) return;
    try {
      const r = await api<{ available: boolean; message: string }>('GET', `/api/auth/check-login-id?login_id=${encodeURIComponent(normalizedId)}`);
      setIdCheck({ id: normalizedId, ...r });
    } catch (err) {
      setIdCheck({ id: normalizedId, available: false, message: err instanceof ApiError ? err.detail.message : '확인하지 못했어요.' });
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched({ nickname: true, login_id: true, password: true, password_confirm: true, signup_code: true });
    if (Object.values(errs).some(Boolean)) return;
    setBusy(true);
    setServerErr(null);
    try {
      await signup({ ...form, login_id: normalizedId });
      await finishAuth(next);
    } catch (err) {
      setServerErr(err instanceof ApiError ? err.detail : { message: '가입하지 못했어요.' });
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-sm py-6">
      <Card>
        <h2 className="mb-1 text-2xl text-plum-700">꾸미룸 시작하기</h2>
        <p className="mb-4 text-sm text-plum-500">네 가지만 적으면 나만의 방이 생겨요.</p>
        <InviteHint />
        <form onSubmit={submit} className="space-y-1" noValidate>
          <Field label="닉네임" name="nickname" autoComplete="nickname" maxLength={12} placeholder="방 이름표에 보여요" value={form.nickname} onChange={set('nickname')} onBlur={blur('nickname')} error={shown('nickname')} hint="한글·영문·숫자 2~12자, 다른 사람과 같아도 괜찮아요" />
          <Field
            label="아이디"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={20}
            value={form.login_id}
            onChange={set('login_id')}
            onBlur={blur('login_id')}
            error={shown('login_id') ?? (idChecked && !idChecked.available ? idChecked.message : null)}
            ok={idChecked?.available ? idChecked.message : null}
            hint="영문 소문자·숫자·밑줄 4~20자, 로그인할 때 써요"
            aside={
              <Button variant="soft" onClick={checkId} className="shrink-0 px-3">
                중복 확인
              </Button>
            }
          />
          <Field label="비밀번호" name="new-password" type="password" autoComplete="new-password" maxLength={128} value={form.password} onChange={set('password')} onBlur={blur('password')} error={shown('password')} hint="8자 이상, 흔한 비밀번호는 쓸 수 없어요" />
          <Field label="비밀번호 확인" name="new-password-confirm" type="password" autoComplete="new-password" maxLength={128} value={form.password_confirm} onChange={set('password_confirm')} onBlur={blur('password_confirm')} error={shown('password_confirm')} />
          {codeRequired && (
            <Field label="가입 코드" name="signup-code" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={128} value={form.signup_code} onChange={set('signup_code')} onBlur={blur('signup_code')} error={shown('signup_code')} hint="지금은 테스트 참가자만 가입할 수 있어요" />
          )}
          <p className="pb-3 text-xs leading-relaxed text-plum-500">
            🔑 꾸미룸은 이메일·전화번호를 받지 않아요. 그래서 <b className="font-normal text-blush-500">비밀번호를 잊으면 되찾기 어려워요</b>. 비밀번호 관리자에 저장해 두세요.
          </p>
          {serverErr && !serverErr.field && <p role="alert" className="pb-2 text-sm text-blush-500">{serverErr.message}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? '방 만드는 중…' : '가입하고 내 방 만들기'}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-plum-500">
          이미 회원이에요?{' '}
          <a href={switchHref('login', next)} onClick={(e) => (e.preventDefault(), navigate(switchHref('login', next), { replace: true }))} className="text-blush-500 underline underline-offset-2">
            로그인
          </a>
        </p>
      </Card>
    </div>
  );
}
