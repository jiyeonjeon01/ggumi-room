import type { ReactNode } from 'react';
import { navigate } from '../app/router';
import { Button, Card } from '../components/ui';

/** Operator contact shown in the policy (set at build time; not stored in the repository). */
const CONTACT = (import.meta.env.VITE_PRIVACY_CONTACT as string | undefined)?.trim();
export const POLICY_DATE = '2026년 11월 7일';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-1.5 text-base text-plum-700">{title}</h3>
      <div className="space-y-1.5 text-sm leading-relaxed text-plum-700/90">{children}</div>
    </section>
  );
}

/**
 * Privacy policy and community rules (/privacy). Plain text that says what this
 * service actually keeps: keep it in step with the code (models, logs, cookies).
 */
export function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-2xl py-4">
      <Card>
        <h2 className="mb-1 text-2xl text-plum-700">개인정보처리방침</h2>
        <p className="mb-5 text-xs text-plum-500">시행일 {POLICY_DATE}</p>

        <Section title="1. 어떤 정보를 받나요">
          <p>
            <b className="font-normal text-plum-900">가입할 때(필수)</b>: 아이디, 닉네임, 비밀번호, 만 14세 이상 확인과 이 방침 동의 시각. 비밀번호는 되돌릴 수 없는 방식(Argon2id)으로만 저장해 운영자도 알 수 없어요. 이메일·전화번호·실명은 받지 않아요.
          </p>
          <p>
            <b className="font-normal text-plum-900">쓰는 동안 생기는 정보</b>: 방 이름·테마·가구 배치, 친구와 친구 요청, 1:1 채팅 내용과 읽음 표시, 방명록 글, 초대·파티룸 참가 기록, 차단·신고 기록. 게임 안 말풍선은 저장하지 않아요.
          </p>
          <p>
            <b className="font-normal text-plum-900">자동으로 생기는 정보</b>: 로그인 유지 쿠키와 보안(CSRF) 쿠키, 접속 기록(IP 주소, 시각, 요청한 페이지 주소, 브라우저 정보). 접속 기록은 웹 서버 로그에 잠시 남고 용량이 차면 오래된 것부터 지워져요(최대 약 30MB). 광고·분석용 쿠키나 추적 도구는 쓰지 않아요.
          </p>
        </Section>

        <Section title="2. 왜 쓰나요">
          <p>회원 확인과 로그인, 방·친구·채팅·방명록·파티룸 기능 제공, 도배·대량 가입 같은 부정 이용 막기, 신고 처리와 이용 규칙 위반 대응에만 써요.</p>
        </Section>

        <Section title="3. 얼마나 보관하나요">
          <p>회원 탈퇴할 때까지 보관하고, 탈퇴하면 바로 지워요(내 방과 가구, 친구, 1:1 채팅(상대 쪽 기록 포함), 내가 쓴 방명록, 내가 연 파티룸, 로그인 기록).</p>
          <p>로그인 유지는 최대 30일이고 로그아웃하면 바로 끝나요. 다른 사람이 나를 신고한 기록은 신고를 처리할 때까지 그때의 닉네임·아이디와 함께 남고, 처리가 끝나면 지워요.</p>
          <p>장애 복구를 위한 데이터베이스 백업에는 탈퇴 전 정보가 남아 있을 수 있어요. 백업은 운영자 컴퓨터에만 보관하고 오래된 백업은 정리해요.</p>
        </Section>

        <Section title="4. 다른 곳에 주나요">
          <p>다른 회사나 사람에게 팔거나 넘기지 않아요. 법에 따른 요청이 있을 때만 예외예요.</p>
          <p>
            사이트 연결(도메인, HTTPS, 접속 경로)은 Cloudflare(미국)를 거쳐요. 접속할 때마다 요청이 Cloudflare 네트워크를 지나가며, 데이터베이스는 운영자가 관리하는 국내 서버에 있어요.
          </p>
        </Section>

        <Section title="5. 만 14세 미만은 가입할 수 없어요">
          <p>가입할 때 만 14세 이상인지 확인해요. 만 14세 미만으로 확인되면 계정과 정보를 지워요.</p>
        </Section>

        <Section title="6. 내 정보는 내가 관리해요">
          <p>내 정보는 언제든 볼 수 있고, 내 정보 → ⚙️ 계정 관리 → 회원 탈퇴로 직접 지울 수 있어요. 닉네임 변경이나 다른 요청은 아래 문의처로 알려 주세요.</p>
        </Section>

        <Section title="7. 어떻게 지키나요">
          <p>HTTPS 암호화 연결, 비밀번호 해시 저장, 스크립트가 읽을 수 없는 로그인 쿠키(HttpOnly·Secure), 요청 위조 방지(CSRF), 요청 횟수 제한을 써요. 데이터베이스는 인터넷에 직접 열려 있지 않아요.</p>
        </Section>

        <Section title="8. 이용 규칙과 신고·차단">
          <p>욕설·괴롭힘, 도배·광고, 성적인 내용, 다른 사람의 개인정보를 올리거나 요구하는 행동은 안 돼요. 이런 일을 겪으면 1:1 채팅 창이나 받은 친구 요청의 🚩 버튼으로 신고하거나 차단해 주세요.</p>
          <p>차단하면 친구가 끊기고 서로 찾거나 친구 요청·채팅·방 방문을 할 수 없어요. 신고는 운영자가 확인하고, 규칙을 어긴 계정은 이용을 멈추거나 지울 수 있어요.</p>
        </Section>

        <Section title="9. 운영자와 문의처">
          <p>꾸미룸은 개인이 운영하는 작은 서비스예요. 개인정보 보호 책임자는 꾸미룸 운영자예요.</p>
          <p>{CONTACT ? <>문의: {CONTACT}</> : <>문의와 신고는 사이트 안의 🚩 신고 기능으로 받아요.</>}</p>
        </Section>

        <Section title="10. 바뀌면 알려 드려요">
          <p>이 방침이 바뀌면 시행 전에 사이트에 알려요.</p>
        </Section>

        <Button variant="soft" onClick={() => (window.history.length > 1 ? window.history.back() : navigate('/'))}>
          돌아가기
        </Button>
      </Card>
    </div>
  );
}
