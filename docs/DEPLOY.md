# 꾸미룸 배포 가이드 (집 PC Docker + Cloudflare Tunnel)

**대표 URL: https://www.ggumiroom.com** — `http://`·`https://`, `www` 유무 네 가지 주소가 모두 여기로 301 이동합니다 (경로·쿼리 유지).

## 현재 운영 상태 (2026-11-06 확인)

| 항목 | 상태 |
|---|---|
| 네임서버 | `dimitris.ns.cloudflare.com`, `gina.ns.cloudflare.com` (등록 정보·1.1.1.1·8.8.8.8·9.9.9.9·KT DNS 반영), DNSSEC 꺼짐 |
| DNS | `ggumiroom.com`, `www`가 Cloudflare 프록시 IP로만 응답. 집 공인 IP 미노출, MX·TXT 없음 |
| 리디렉션 | `ggumiroom.com` → `https://www.ggumiroom.com` (Cloudflare 리디렉션 규칙), Always Use HTTPS 켜짐 |
| 인증서 | Let's Encrypt(Cloudflare 발급), `ggumiroom.com` + `*.ggumiroom.com`, TLS 1.3 |
| 터널 | `ggumiroom-home`, 연결 4개(서울 icn), 경로 `ggumiroom.com`·`www.ggumiroom.com` → `http://web:8080`, 그 외 404 |
| 캐시 | `/assets/`, `/fonts/`는 Cloudflare 캐시 HIT, HTML은 매번 새로 받음 |

```
방문자 → https://ggumiroom.com → Cloudflare(DNS·HTTPS·WAF) → Cloudflare Tunnel
      → 집 PC의 cloudflared 컨테이너 → web 컨테이너(nginx, 정적 React+Phaser)
```

- 공유기 포트포워딩 없음, 집 공인 IP를 DNS에 올리지 않음 (cloudflared가 바깥으로 연결을 엶)
- Cloudflare에는 소스코드·DB를 올리지 않음. Cloudflare 전용 SDK도 쓰지 않음
- 나중에 `/api/*`, `/ws/*` → FastAPI, PostgreSQL은 Docker 내부 네트워크 전용

## 폰트 (저장소에 포함하지 않음)

UI와 게임 글자는 **오뮤 다예쁨체**(© omyudiary & VoyagerX)를 씁니다. 라이선스는 웹사이트 사용·서버 임베딩을 허용하지만 **폰트 파일의 수정·무단 재배포는 금지**하므로, 폰트 파일은 공개 Git 저장소에 넣지 않습니다 (`.gitignore`의 `public/fonts/`).

- 필요한 파일: `public/fonts/omyu-pretty.woff2` (운영 PC에만 보관, 백업 별도 관리)
- 새로 clone한 환경(예: OCI/AWS 서버)에서는 빌드 전에 이 파일을 직접 복사해 넣습니다. 원본은 오뮤다이어리 공식 배포처에서 받습니다.
- 파일이 없어도 `docker compose build`와 `pnpm build`는 성공합니다. 빌드 로그에 경고가 나오고, 사이트는 시스템 기본 글꼴로 표시되며 브라우저 콘솔에 폰트 404가 보입니다.
- Docker 빌드는 로컬 폴더(빌드 컨텍스트)를 쓰므로, 운영 PC처럼 파일이 있으면 Git과 상관없이 이미지에 포함됩니다.

**확인 필요 (라이선스)**: 현재 파일은 원본 `omyu pretty.ttf`를 글자 손실 없이 **WOFF2로 변환**한 것입니다 (7.6MB → 3.6MB). 라이선스의 "폰트의 수정 없이 배포되는 형태 그대로 사용"에 형식 변환이 포함되는지는 문구만으로 판단할 수 없어 **저작권자(오뮤다이어리)에게 확인이 필요합니다**. 허용되지 않으면 원본 TTF를 수정 없이 서빙하도록 `src/index.css`의 `@font-face`와 `index.html`의 preload 경로만 바꾸면 됩니다.

## 포트 규칙

| 서비스 | 개발 (`pnpm dev` 등) | Docker 운영: Windows 호스트 | Docker 내부 (컨테이너) | Cloudflare Tunnel 대상 |
|---|---|---|---|---|
| 프론트엔드 | 9020 | `127.0.0.1:9021` | `web:8080` (nginx) | `http://web:8080` |
| FastAPI (예정) | 9200 | `127.0.0.1:9201` (필요할 때만) | `api:8000` | 직접 연결하지 않음: `/api`, `/ws`를 web(nginx)이 `api:8000`으로 전달 |
| PostgreSQL (예정) | - | 공개 안 함 | `db:5432` (`backend` 내부 네트워크) | - |

- 호스트 포트는 모두 `127.0.0.1`에만 바인딩합니다 (같은 공유기의 다른 기기·인터넷에서 접속 불가). 공개 접속은 터널로만 들어옵니다.
- 개발 서버(9020)와 운영 컨테이너(9021)는 포트가 달라 동시에 실행할 수 있습니다.
- 호스트 포트는 `.env`의 `WEB_PORT`로 바꿀 수 있습니다 (기본 9021). 터널 대상(`web:8080`)은 호스트 포트와 무관합니다.

## 파일

| 파일 | 역할 |
|---|---|
| `Dockerfile` | 2단계 빌드: node 24에서 `pnpm build` → nginx-unprivileged(비루트)로 `dist`만 제공 |
| `deploy/nginx/default.conf` | SPA fallback, 캐시 정책, `/api`·`/ws` 예약(지금은 404), `/healthz`, 쿼리스트링 없는 접속 로그 |
| `deploy/nginx/security-headers.conf` | 보안 헤더 |
| `docker-compose.yml` | `web`(항상), `cloudflared`(`tunnel` 프로필), 나중의 `api`·`db` 주석 템플릿 |
| `.env.example` | 환경변수 예시. 실제 값은 `.env`에 (Git 제외) |
| `.dockerignore` | 빌드에 `node_modules`, `.git`, `.env` 등 제외 |

## 명령어

```powershell
# 웹만 (로컬 확인: http://127.0.0.1:9021)
docker compose up -d --build

# 웹 + 터널 (.env에 CLOUDFLARE_TUNNEL_TOKEN 필요)
docker compose --profile tunnel up -d --build

docker compose ps                         # 상태 (web은 healthy여야 함)
docker compose logs -f web                # 웹 로그
docker compose --profile tunnel logs -f cloudflared   # 터널 로그
docker compose --profile tunnel down      # 전부 중지 (restart 정책도 해제)

# 코드 수정 후 다시 배포
git pull   # 또는 로컬 수정 후
docker compose --profile tunnel up -d --build
```

- 컨테이너는 `restart: unless-stopped`: Docker가 다시 켜지면 자동으로 다시 뜹니다(직접 `stop`/`down` 한 경우 제외).
- 로그는 컨테이너당 10MB × 3개까지만 보관합니다.

## Cloudflare / 후이즈 설정 (직접 해야 하는 부분)

### 1. DNS 레코드 검토 화면 (`Review your DNS records`)

자동으로 찾은 A 레코드 2개(`@`, `www` → `118.67.131.217`)는 **삭제**합니다.

- 이 IP는 네이버 클라우드(NBP) 대역이고, 접속하면 `whoisdomain.kr/forward/`를 띄우는 **후이즈 기본 주차(파킹) 페이지**만 나옵니다 (2026-11-05 확인).
- MX·TXT 레코드는 없어서 메일 등 다른 서비스와도 무관합니다.
- 남겨 두면 나중에 터널 연결 시 "같은 이름의 레코드가 이미 있음" 오류가 나고, 활성화 직후 사이트가 파킹 페이지로 보입니다.

각 레코드 오른쪽의 **Edit** 또는 체크 후 **Delete** → 두 개 모두 지운 뒤 **Continue to activation**.

### 2. 네임서버 변경 (후이즈)

1. Cloudflare가 보여 주는 **네임서버 2개**(`○○○.ns.cloudflare.com` 형태)를 확인합니다.
2. 후이즈(whois.co.kr) 로그인 → **마이페이지** → **도메인 관리** → `ggumiroom.com` 선택 → **네임서버 변경**
3. "다른 네임서버 사용"(직접 입력)을 고르고 1차·2차에 Cloudflare 네임서버를 입력 → 저장. 기존 `ns1~4.whoisdomain.kr`은 지웁니다.
4. 후이즈에서 **DNSSEC**를 켰다면 먼저 끕니다 (켜져 있으면 Cloudflare 활성화가 실패).
5. Cloudflare 화면에서 **Check nameservers now**. 반영은 보통 수분~수시간, 길게는 24~48시간.

확인 방법 (PowerShell):

```powershell
nslookup -type=NS ggumiroom.com 8.8.8.8
# ○○○.ns.cloudflare.com 이 나오면 반영 완료. Cloudflare 대시보드의 도메인 상태가 "Active"가 되면 끝.
```

### 3. 터널 만들기 (도메인이 Active가 된 뒤)

1. Cloudflare 대시보드 → 왼쪽 **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel**
2. 종류 **Cloudflared** → 이름 `ggumiroom-home` → 저장
3. 설치 환경에서 **Docker**를 고르면 `docker run cloudflare/cloudflared:latest tunnel --no-autoupdate run --token eyJ...` 명령이 나옵니다.
   **이 명령은 실행하지 말고**, `--token` 뒤의 긴 문자열만 복사합니다. (토큰은 비밀번호와 같습니다. 채팅·Git·스크린샷에 올리지 마세요.)
4. 프로젝트 폴더에서 `.env.example`을 `.env`로 복사하고 `CLOUDFLARE_TUNNEL_TOKEN=` 뒤에 붙여 넣고 저장합니다.
5. `docker compose --profile tunnel up -d --build` → 대시보드의 터널 상태가 **HEALTHY**가 되는지 확인
6. **Networking → Tunnels → `ggumiroom-home` → Routes → Published application** (예전 화면: Zero Trust → Networks → Tunnels → 터널 → *Public Hostname* 탭) → **Add**
   - Subdomain: 비움 / Domain: `ggumiroom.com` / Service Type: `HTTP` / URL: `web:8080` → 저장
   - 한 번 더: Subdomain `www` / Domain `ggumiroom.com` / `HTTP` / `web:8080`
   - Cloudflare가 터널용 CNAME 레코드를 자동으로 만듭니다 (공인 IP가 아님).

### 4. 보안 설정 (도메인 → 각 메뉴)

- **SSL/TLS → Edge Certificates**: *Always Use HTTPS* 켜기, *Minimum TLS Version* 1.2
- **SSL/TLS → Overview**: 터널은 Cloudflare↔집 PC 구간을 자체 암호화하므로 기본값으로 충분합니다
- **HSTS**는 사이트가 HTTPS로 안정적으로 열리는 걸 확인한 뒤 켜세요 (켜면 되돌리기 어려움)
- **Security → WAF**: Free 플랜의 *Cloudflare Free Managed Ruleset*이 켜져 있는지 확인
- 선택: **Security → Bots → Bot Fight Mode**
- 선택: **Rules → Redirect Rules**의 템플릿 "Redirect from WWW to root"로 `www` → `ggumiroom.com` 통일

## 집 PC 운영 체크

- **Docker Desktop 자동 실행이 꺼져 있습니다** (2026-11-05 확인). 재부팅 후 서비스가 자동으로 돌아오게 하려면 Docker Desktop → Settings → General → *Start Docker Desktop when you sign in to your computer* 켜기.
  - Docker Desktop은 **Windows에 로그인해야** 시작됩니다. Windows 업데이트로 재부팅되면 로그인 전까지 사이트가 내려가 있습니다.
- 전원: 전원 연결 시 절전·최대 절전이 "사용 안 함"으로 되어 있어 괜찮습니다 (2026-11-05 확인).
- Windows 업데이트 자동 재부팅: 설정 → Windows 업데이트 → 고급 옵션 → *사용 시간*을 넓게 잡아 두면 낮 시간 재부팅을 줄일 수 있습니다.
- 방화벽·포트: 웹은 `127.0.0.1:9021`에만 열려 있어 같은 공유기의 다른 기기에서도 접속되지 않습니다. 공유기 포트포워딩은 필요 없습니다.

## 나중에 API / DB 추가

1. `api/`에 FastAPI + Dockerfile 작성
2. `docker-compose.yml`의 `api`, `db`, `backend` 네트워크, `db-data` 볼륨 주석 해제, `.env`에 DB 값 입력
3. `deploy/nginx/default.conf`에서 `upstream api`와 `/api/`, `/ws/`의 `proxy_*` 줄 주석 해제, `return 404` 줄 삭제
4. 서버는 `CF-Connecting-IP`(프록시가 `X-Forwarded-For`로 전달)를 실제 방문자 IP로 쓰고, 채팅의 `playerId`·`createdAt`은 클라이언트 값 대신 인증 정보와 서버 시각으로 채웁니다
5. DB 백업: `docker compose exec db pg_dump -U <user> <db> > backup.sql`, 복원: `docker compose exec -T db psql -U <user> <db> < backup.sql`

## OCI / AWS로 옮길 때

- 같은 `Dockerfile`·`docker-compose.yml`을 새 서버에서 그대로 실행합니다 (Docker Engine + Compose만 있으면 됨).
- **터널을 유지하는 경우**: 새 서버의 `.env`에 같은 토큰을 넣고 `--profile tunnel up` → 집 PC의 컨테이너를 내리면 끝. DNS 변경 없음.
- **터널 없이 일반 구조로 가는 경우**: `cloudflared` 대신 80/443을 여는 리버스 프록시(Caddy 등)를 앞에 두고, `web`의 `ports`를 그 프록시로만 연결, DNS를 새 서버 IP(또는 로드밸런서)로 변경.
- DB는 `pg_dump`로 옮기고, 볼륨은 서버에 종속되지 않게 이름 있는 볼륨만 사용합니다.
