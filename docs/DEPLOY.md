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
| API·DB | 2026-11-06 운영 반영 (테스트 기간). web·api·db·cloudflared 4개 컨테이너, 마이그레이션 `7b1d3e5f9a20`, `SIGNUP_CODE`로 가입 제한 중 |
| 되돌릴 이미지 | `ggumiroom-web:rollback-20261106` (API 반영 전 정적 사이트), `ggumiroom-web:rollback-20261106-1035`·`ggumiroom-api:rollback-20261106-1035` (가구 15종 반영 직전) |
| 최근 반영 | 2026-11-06 10:34 가구 15종·마우스 조작·패널 고정·Esc 키 수정. web·api만 교체(약 6초), 마이그레이션 없음 |
| 백업 | `%USERPROFILE%\ggumiroom-backups\` (저장소 밖), 복원 확인함 |

```
방문자 → https://ggumiroom.com → Cloudflare(DNS·HTTPS·WAF) → Cloudflare Tunnel
      → 집 PC의 cloudflared 컨테이너 → web 컨테이너(nginx, 정적 React+Phaser)
```

- 공유기 포트포워딩 없음, 집 공인 IP를 DNS에 올리지 않음 (cloudflared가 바깥으로 연결을 엶)
- Cloudflare에는 소스코드·DB를 올리지 않음. Cloudflare 전용 SDK도 쓰지 않음
- `/api/*`, `/ws/*` → FastAPI (nginx가 전달), PostgreSQL은 Docker 내부 네트워크 전용

## 폰트 (저장소에 포함하지 않음)

UI와 게임 글자는 **오뮤 다예쁨체**(© omyudiary & VoyagerX)를 씁니다. 라이선스는 웹사이트 사용·서버 임베딩을 허용하지만 **폰트 파일의 수정·무단 재배포는 금지**하므로, 폰트 파일은 공개 Git 저장소에 넣지 않습니다 (`.gitignore`의 `public/fonts/`).

- 필요한 파일: `public/fonts/omyu-pretty.ttf` — 제작사가 배포한 원본 `omyu pretty.ttf`를 **이름만 바꿔 그대로 복사**한 것 (변환·서브셋·압축 없음, 7.6MB). 운영 PC에만 보관하고 백업은 따로 관리합니다.
- 새로 clone한 환경(예: OCI/AWS 서버)에서는 빌드 전에 원본을 이 경로로 복사합니다. 원본은 오뮤다이어리 공식 배포처에서 받습니다.
- **원본 확인**: `deploy/fonts.sha256`에 원본 파일의 SHA-256이 들어 있습니다 (해시만, 폰트 아님). Docker 빌드가 `sha256sum -c`로 비교해서 다른 파일이면 빌드를 멈추고, Vite 빌드 뒤에도 `dist/fonts/`의 파일이 원본과 같은지 `cmp`로 확인합니다. 로컬에서 확인: `sha256sum -c deploy/fonts.sha256`
- `docker-compose.yml`은 `REQUIRE_FONT=1`로 빌드하므로 **파일이 없으면 웹 이미지 빌드가 실패**합니다 (폰트 없이 운영에 나가는 일을 막음). `pnpm build`나 `docker build .`(기본 `REQUIRE_FONT=0`)는 경고만 내고 시스템 글꼴로 빌드합니다.
- 파일은 빌드 컨텍스트(로컬 폴더)에서 이미지로 들어가므로 Git과 상관없습니다. 이미지(`ggumiroom-web`)는 레지스트리에 올리지 않습니다.
- nginx 기본 `mime.types`에 ttf가 없어 `/fonts/`에서 `font/ttf`를 지정하고, 전송 중 gzip(파일 자체는 그대로)을 켰습니다 (7.6MB → 약 4.4MB 전송).

**2026-11-06 변경**: 형식 변환이 라이선스의 "수정 없이 배포되는 형태 그대로 사용"에 맞는지 확인되지 않아, WOFF2 변환본 대신 **원본 TTF를 수정 없이** 쓰도록 바꿨습니다. 변환본은 서비스에서 빼고 저장소 밖(다운로드 폴더 `omyu-pretty-converted.woff2`)으로 옮겼습니다.

### 라이선스 확인 기록 (다시 검토할 때 여기부터)

| 날짜 | 내용 | 결과 |
|---|---|---|
| 2026-11-06 | 라이선스 본문 확인: 웹사이트 사용·서버 임베딩·상업적 이용 허용, 파일 수정·재판매·무단 재배포 금지 | 공개 GitHub에는 폰트 파일을 올리지 않기로 결정 (`public/fonts/` 제외) |
| 2026-11-06 | 오뮤다이어리 문의 시도 | 문의 페이지 오류로 **미접수, 답변 대기** |
| 2026-11-06 | 변환 허용 여부가 불확실하므로 원본 TTF를 수정 없이 서빙하도록 변경 | `public/fonts/omyu-pretty.ttf`, 해시 확인 빌드 |

저작권자에게 물어볼 것:
1. (선택, 성능 개선용) 원본 TTF를 **WOFF2로 형식만 변환**(글자·디자인 변경 없음)해서 자사 웹사이트 서버에서 제공해도 되는지 — 지금은 원본 TTF를 씀
2. 웹폰트로 제공하면 방문자 브라우저가 파일을 내려받는데, 이것이 허용된 "임베딩"에 해당하는지
3. (선택) 폰트 파일 없이 소스코드만 공개 GitHub에 두는 현재 방식에 문제가 없는지

답변을 받으면:
- WOFF2 허용 → 원하면 변환본으로 되돌려 전송량을 줄임 (`src/index.css`, `index.html`, `deploy/fonts.sha256`, Dockerfile 경로)
- 웹 임베딩 자체에 조건이 있으면 그 조건을 이 섹션에 기록하고 적용

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

## 백엔드 (FastAPI + PostgreSQL)

```
브라우저 → web(nginx) ─ /        → React + Phaser 정적 파일
                      └ /api/*   → api:8000 (FastAPI, 경로 그대로 전달)
                                   └ db:5432 (PostgreSQL, backend 내부 네트워크 전용)
```

- `api/`: FastAPI, SQLAlchemy 2, Alembic, Pydantic 2, argon2-cffi. 모든 경로가 `/api`로 시작합니다.
- API 이미지는 **저장소 루트를 빌드 컨텍스트로** 씁니다(`docker-compose.yml`의 `api.build`). 가구 카탈로그 `shared/furniture.json`을 프론트와 함께 쓰기 때문입니다.
- 컨테이너가 시작할 때 `alembic upgrade head`로 마이그레이션을 적용한 뒤 uvicorn(워커 1개)을 띄웁니다. 워커가 1개인 이유: 요청 제한 카운터가 메모리에 있어서(`api/app/ratelimit.py`). 늘리려면 Redis 등으로 옮깁니다.
- nginx는 api를 요청 시점에 찾기 때문에, api가 꺼져 있어도 게임은 뜨고 `/api`만 JSON 503을 돌려줍니다.
- db는 포트를 열지 않고 `backend`(internal) 네트워크에만 붙습니다. 데이터는 `db-data` 볼륨에 남습니다.
- 접속 로그는 nginx만 남기고(쿼리스트링 제외), uvicorn 접속 로그는 끕니다 (아이디가 담긴 쿼리가 남지 않게).
- `/ws/live`: 실시간 WebSocket. nginx가 `Upgrade`를 붙여 `api:8000`으로 넘기고, Origin·세션 검사는 API가 합니다. 이벤트와 제한은 [REALTIME.md](REALTIME.md).

### 개발 환경 (프론트 9020, API 9200)

```powershell
# 1) 개발용 PostgreSQL (한 번만, 로컬 127.0.0.1:55432)
docker run -d --name ggumi-pgdev -e POSTGRES_USER=ggumiroom -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=ggumiroom -p 127.0.0.1:55432:5432 postgres:18.6-alpine

# 2) API (api 폴더에서; 처음엔 uv venv .venv 후 uv pip install -r requirements-dev.txt)
$env:DATABASE_URL="postgresql+psycopg://ggumiroom:devpass@127.0.0.1:55432/ggumiroom"
$env:PUBLIC_BASE_URL="http://localhost:9020"; $env:COOKIE_SECURE="false"; $env:ENABLE_DOCS="true"
.venv\Scripts\alembic upgrade head
.venv\Scripts\uvicorn app.main:app --port 9200 --reload

# 3) 프론트 (프로젝트 루트). Vite가 /api를 localhost:9200으로 프록시
pnpm dev   # http://localhost:9020

# API 테스트: 같은 PostgreSQL에 ggumiroom_test DB를 새로 만들어 씀
.venv\Scripts\python -m pytest
```

### 스테이징 (운영 반영 전 전체 스택 검증)

운영과 같은 이미지·설정을 다른 프로젝트 이름과 포트로 띄웁니다. 터널은 띄우지 않습니다. `.env.staging`(Git 제외)에 `POSTGRES_PASSWORD`가 필요합니다.

```powershell
docker compose -p ggumiroom-staging -f docker-compose.yml -f docker-compose.staging.yml --env-file .env.staging up -d --build
# 사이트 http://localhost:9031, API 문서 http://localhost:9231/api/docs
# 끄기: 같은 명령에서 up -d --build 대신 down (데이터 유지) / down -v (데이터 삭제)
```

### 테스트 기간 가입 제한 (`SIGNUP_CODE`)

`.env`에 `SIGNUP_CODE`를 넣으면 가입할 때 그 코드를 적어야 합니다 (테스트 참가자에게만 따로 알려 줌).

- 서버가 확인하므로 화면을 건너뛰고 API를 직접 불러도 코드가 없으면 거절됩니다 (422, 가입 요청은 IP당 시간당 10회 제한).
- 로그인·기존 계정에는 영향이 없습니다.
- 코드가 켜져 있는 동안 화면에서 가입을 홍보하지 않습니다: 상단 **회원가입** 버튼과 "가입하면 …" 안내가 숨겨지고, 로그인 버튼만 보입니다. 가입 화면(`/signup`)은 로그인 화면의 링크나 초대 링크로만 들어갑니다.
- `robots.txt`가 `/login`, `/signup`, `/invite/`, `/room/`, `/api/`의 검색 노출을 막습니다.
- 정식 공개 때: `.env`에서 `SIGNUP_CODE`를 지우고 `docker compose --profile tunnel up -d api`.
- 코드 바꾸기: `.env` 수정 후 같은 명령. 값은 채팅·Git에 올리지 않습니다.

### 운영 반영 절차

1. 반영 직전 상태를 기록하고 되돌릴 이미지를 남깁니다.
   ```powershell
   git rev-parse HEAD
   docker tag ggumiroom-web:latest ggumiroom-web:rollback-YYYYMMDD   # 빌드가 latest를 덮어쓰기 전에
   ```
2. DB가 이미 있으면 백업합니다 (아래 "DB 백업·복원"). 처음 반영할 때는 DB가 없으므로 백업할 데이터가 없습니다.
3. `.env`에 `POSTGRES_PASSWORD`(긴 무작위 값), 필요하면 `SIGNUP_CODE`를 넣습니다. `API_PORT=9201` 확인.
4. `docker compose --profile tunnel up -d --build`
   - web 컨테이너가 새 이미지로 바뀌는 몇 초 동안 사이트가 잠깐 끊길 수 있습니다.
   - api가 시작할 때 `alembic upgrade head`로 마이그레이션을 적용합니다 (`api/Dockerfile`의 CMD).
5. 확인: `https://www.ggumiroom.com/api/health` → `{"status":"ok","db":"ok"}`, 가입·로그인 후 새로고침해도 로그인 유지(Secure 쿠키), 초대 링크가 `https://www.ggumiroom.com/invite/...`인지, `docker compose logs api web`에 오류가 없는지.
6. 되돌리기
   - 프론트: `docker tag ggumiroom-web:rollback-YYYYMMDD ggumiroom-web:latest` → `docker compose --profile tunnel up -d --no-build web`
   - API·DB 끄기: `docker compose stop api` (이전 프론트는 `/api`를 쓰지 않음, DB 데이터는 `db-data` 볼륨에 남음)
   - 마이그레이션만 되돌리기: 백업 후 `docker compose exec api alembic downgrade <리비전>`

### 마이그레이션 기록

| 리비전 | 내용 |
|---|---|
| `2ac5ad711c49` | 사용자·세션·방·친구·초대 |
| `7b1d3e5f9a20` | `room_items`(가구 배치, 0.25칸 단위 정수 좌표) 추가, `rooms.layout_version` 추가, 쓰지 않던 `rooms.layout` 삭제, **기존 방 전부에 기본 배치 9개를 넣음** (신규 가입과 같은 배치) |
| `ca9664530522` | 1:1 채팅: `conversations`, `messages` **새 테이블만 추가** (기존 데이터 변경 없음, 되돌리면 이 두 테이블만 삭제) |

`7b1d3e5f9a20`은 데이터를 바꾸므로 운영 반영 전에 반드시 백업합니다. 되돌리면(`alembic downgrade 2ac5ad711c49`) 저장된 가구 배치는 사라집니다.

### DB 백업·복원

```powershell
# 백업 (운영 프로젝트)
docker compose exec -T db pg_dump -U ggumiroom -d ggumiroom -Fc > backup-$(Get-Date -Format yyyyMMdd).dump
# 복원
docker compose exec -T db pg_restore -U ggumiroom -d ggumiroom --clean --if-exists < backup-YYYYMMDD.dump
```

- 새 마이그레이션을 적용하기 전에는 반드시 백업합니다. 되돌리기: `docker compose exec api alembic downgrade -1`.
- 백업 파일에는 아이디·닉네임·비밀번호 해시가 들어 있으니 Git이나 공유 폴더에 두지 않습니다.
- 스테이징에서 `pg_dump` → 새 DB에 `pg_restore` 후 사용자·친구 수가 같은 것을 확인했습니다 (2026-11-06).

## OCI / AWS로 옮길 때

- 같은 `Dockerfile`·`docker-compose.yml`을 새 서버에서 그대로 실행합니다 (Docker Engine + Compose만 있으면 됨).
- **터널을 유지하는 경우**: 새 서버의 `.env`에 같은 토큰을 넣고 `--profile tunnel up` → 집 PC의 컨테이너를 내리면 끝. DNS 변경 없음.
- **터널 없이 일반 구조로 가는 경우**: `cloudflared` 대신 80/443을 여는 리버스 프록시(Caddy 등)를 앞에 두고, `web`의 `ports`를 그 프록시로만 연결, DNS를 새 서버 IP(또는 로드밸런서)로 변경.
- DB는 `pg_dump`로 옮기고, 볼륨은 서버에 종속되지 않게 이름 있는 볼륨만 사용합니다.
