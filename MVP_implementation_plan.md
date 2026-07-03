# Codex PDF/Web Research Reader - Production-Grade Implementation Plan

작성일: 2026-07-03  
대상: 개인용 고완성도 1차 제품  
기본 UI 방향: Rational  
운영 방식: MacBook 상시 실행 + Cloudflare Pages/Access/Tunnel + 다른 디바이스 웹 접속

## 1. 최종 목표

이 계획은 단순 MVP가 아니라, 개인이 실제로 매일 사용할 수 있는 완성도 높은 1차 제품을 한 번에 구현하기 위한 계획이다.

완성본의 핵심 경험:

- 사용자는 iPad, Windows PC, MacBook, 다른 노트북에서 `app.yourdomain.com`에 접속한다.
- Cloudflare Access로 본인만 로그인한다.
- PDF를 업로드하거나 웹페이지 URL을 입력한다.
- 왼쪽에는 PDF 또는 웹페이지 읽기 모드가 열린다.
- 오른쪽에는 Summary, Translation, Terms, Follow-up Questions, Selection Jobs가 표시된다.
- PDF 로딩과 텍스트 추출은 자동으로 수행된다.
- Codex 분석은 사용자가 `Analyze Page`, `Analyze Range`, `Analyze Document`를 눌렀을 때 실행된다.
- 왼쪽 문서에서 텍스트를 드래그하고 마우스를 떼면 커서 근처에 `Explain / Fact-check` 팝업이 뜬다.
- `Explain`은 선택 영역을 쉬운 한국어로 설명한다.
- `Fact-check`는 Codex 웹 검색 기능을 사용해 주장, 수치, 최신 정보, 법/정책/회사 정보를 검증한다.
- 동일 문서와 동일 선택 영역은 캐시를 사용해 다시 빠르게 열린다.
- 실제 Codex CLI/SDK 실행, PDF 저장, 캐시, 작업 큐는 24시간 켜진 MacBook에서 처리된다.

## 2. 핵심 결정

### 제품 형태

```text
프론트엔드:
  Cloudflare Pages에 배포된 웹앱

백엔드:
  MacBook에서 실행되는 로컬 서버

Mac 실행부:
  ★ Codex Reader.app 또는 ★CodexReaderRunner 실행파일

외부 접속:
  Cloudflare Tunnel

인증:
  Cloudflare Access

AI 실행:
  MacBook에 로그인된 Codex CLI 또는 Codex SDK
```

### 왜 이 구조인가

- Cloudflare Workers/Pages Functions에서는 Codex CLI를 직접 실행하지 않는다.
- ChatGPT Pro 계정 기반 Codex 인증 정보는 MacBook 밖으로 내보내지 않는다.
- PDF 원본, 추출 텍스트, 분석 캐시는 Dropbox가 아니라 MacBook 로컬 데이터 폴더에 둔다.
- Dropbox는 소스 코드와 문서 공유용으로만 사용한다.
- 다른 디바이스는 브라우저 UI만 담당하고, 실제 작업은 MacBook이 담당한다.

## 3. 완성도 기준

이 프로젝트의 1차 완성본은 다음을 만족해야 한다.

- MacBook 재부팅 후 자동으로 살아난다.
- 같은 runner를 여러 번 실행해도 서버와 Codex worker가 중복으로 뜨지 않는다.
- 긴 PDF를 열어도 UI가 멈추지 않는다.
- Codex job은 큐에 들어가고 진행 상태가 보인다.
- Fact-check는 반드시 사용자가 클릭했을 때만 실행된다.
- Fact-check 결과에는 출처 URL, 발행일/기준일, 접근일, 신뢰도, caveat가 표시된다.
- Codex 로그인 만료, Tunnel offline, 웹 검색 실패, PDF 추출 실패 같은 상태가 사용자에게 명확히 보인다.
- Dropbox 동기화 때문에 DB, 업로드 파일, 캐시가 깨지지 않는다.
- iPad/Windows PC에서도 읽기와 분석 결과 확인이 가능하다.

## 4. 전체 아키텍처

```text
사용자 브라우저
  |
  | https://app.yourdomain.com
  v
Cloudflare Pages
  - React/Vite 웹앱
  - Rational 기반 UI
  - PDF.js 뷰어
  - Readability 웹페이지 뷰어
  - selection popup
  - SSE job status

Cloudflare Access
  - 본인 이메일만 허용
  - app/API 모두 보호

Cloudflare Tunnel
  - reader-api.yourdomain.com
  - MacBook localhost:3001로 연결
  - 공유기 포트포워딩 없음

MacBook
  ★ Codex Reader.app / ★CodexReaderRunner
    - supervisor
    - API server
    - worker queue
    - Codex CLI/SDK adapter
    - PDF extractor
    - webpage extractor
    - cache manager
    - health monitor

MacBook local data
  ~/Library/Application Support/CodexReader/
    - reader.sqlite
    - uploads/
    - extracted/
    - analysis-cache/
    - logs/
    - run/
```

## 5. 디바이스별 역할

### MacBook

MacBook은 서버이자 작업자다.

- Codex CLI 로그인 유지
- Codex Reader 실행파일 실행
- Cloudflare Tunnel 실행
- PDF 저장
- PDF 텍스트 추출
- 웹페이지 본문 추출
- Codex 분석 job 처리
- Fact-check 웹 검색 실행
- SQLite DB와 캐시 보관
- health/status 제공

### 다른 디바이스

다른 디바이스는 클라이언트다.

- 브라우저로 `app.yourdomain.com` 접속
- Cloudflare Access 로그인
- PDF 업로드
- 문서 읽기
- 분석 버튼 클릭
- selection popup 사용
- 결과 확인

중요: iPad나 Windows PC에서 접속해도 실제 Codex 실행은 MacBook에서 일어난다.

## 6. Dropbox 사용 원칙

Dropbox는 소스 코드 공유용으로만 사용한다.

### Dropbox에 둘 것

```text
Dropbox/CodexReader/
  apps/
    web/
    server/
    mac-runner/
  packages/
    shared/
  infra/
    cloudflare/
    macos/
  docs/
  .env.example
  .gitignore
  package.json
  pnpm-lock.yaml
```

### Dropbox에 두지 않을 것

```text
node_modules/
dist/
.env
.env.local
.codex/
.wrangler/
data/
uploads/
analysis-cache/
*.sqlite
*.sqlite-wal
*.sqlite-shm
*.log
```

### MacBook 로컬 런타임 폴더

```text
~/Library/Application Support/CodexReader/
  data/
    reader.sqlite
    uploads/
    extracted/
    analysis-cache/
    jobs/
  logs/
    server.log
    worker.log
    codex.log
    tunnel.log
  run/
    runner.lock
    runner.pid
    worker.lock
```

운영 실행 파일은 Dropbox 폴더에서 직접 실행하지 않는다.

```text
Dropbox/CodexReader
  -> 개발 소스

~/Apps/CodexReaderRuntime/current
  -> 실제 실행되는 빌드 결과
```

## 7. MacBook 실행파일 설계

완성형 1차 제품에는 MacBook용 실행부가 필요하다.

권장 이름:

```text
★ Codex Reader.app
```

내부 실행 파일:

```text
★CodexReaderRunner
```

### 실행파일의 책임

```text
★CodexReaderRunner
  - single-instance lock 획득
  - runtime directory 생성
  - SQLite migration 실행
  - Node backend 또는 bundled server 시작
  - worker 시작
  - Codex CLI 경로 확인
  - Codex 로그인 상태 확인
  - Codex 웹 검색 상태 확인
  - Cloudflare Tunnel 상태 확인
  - health/status endpoint 노출
  - 로그 파일 관리
```

### 구현 형태

1차 완성본에서는 다음 두 층으로 간다.

```text
★ Codex Reader.app
  - macOS 앱 패키지
  - 더블클릭 실행 가능
  - 추후 메뉴바 상태 UI 추가 가능

★CodexReaderRunner
  - 실제 서버/worker를 관리하는 runner
  - launchd에서도 실행 가능
```

초기 구현은 headless runner 중심으로 하고, 메뉴바 UI는 완성도 향상 단계에서 붙인다.

### 자동 실행

macOS `launchd`를 사용한다.

```text
~/Library/LaunchAgents/com.codexreader.runner.plist
```

동작:

- 로그인 시 자동 실행
- 죽으면 자동 재시작
- stdout/stderr를 로그 파일로 저장
- runner가 single-instance lock으로 중복 실행을 막음

## 8. 중복 실행과 병렬 Codex wrapper 제어

MacBook에서 여러 Codex wrapper가 동시에 실행될 수 있다. 따라서 설계는 다음 원칙을 따른다.

### 원칙

```text
API server:
  같은 runtime directory에서는 1개만 실행

worker:
  기본 1개
  추후 설정으로 worker pool 가능

Codex job:
  기본 동시 실행 1개
  사용량과 안정성을 위해 1차 제품에서는 1개 유지

PDF extraction:
  Codex를 쓰지 않으므로 제한된 병렬 처리 가능
```

### 중복 실행 방지

```text
runner.lock:
  ~/Library/Application Support/CodexReader/run/runner.lock

runner.pid:
  ~/Library/Application Support/CodexReader/run/runner.pid

port check:
  127.0.0.1:3001 사용 중이면 새 server를 띄우지 않음

instance_id:
  runner 시작 시 생성
```

두 번째 실행파일이 실행되면:

```text
1. runner.lock 획득 시도
2. 실패하면 기존 PID 확인
3. /health 호출
4. 기존 runner가 살아 있으면 새 서버를 띄우지 않고 status만 표시
5. stale lock이면 정리 후 재시작
```

### SQLite job lease

같은 job을 여러 worker가 동시에 처리하지 않도록 SQLite lease를 둔다.

```text
jobs
  id
  type
  status: queued | running | done | failed | cancelled
  payload_json
  result_json
  locked_by
  lease_expires_at
  heartbeat_at
  attempts
  max_attempts
  created_at
  updated_at
```

job 획득은 transaction으로 처리한다.

```text
BEGIN IMMEDIATE;
  queued job 하나 선택
  status = running
  locked_by = worker_id
  lease_expires_at = now + 5 minutes
COMMIT;
```

worker가 죽으면 lease 만료 후 다른 worker가 가져갈 수 있다. Codex job은 기본적으로 재시도 1회까지만 허용한다.

## 9. UI/UX 설계

기본 UI는 Rational 버전을 채택한다.

### 화면 구성

```text
상단 바
  - 문서명
  - MacBook server status
  - Codex status
  - Tunnel status
  - Queue status
  - Analyze Page
  - Analyze Document

왼쪽 패널
  - PDF viewer 또는 webpage reader
  - page navigation
  - zoom
  - search
  - text selection
  - Explain / Fact-check popup

오른쪽 패널
  - Summary
  - Terms
  - Translation
  - Follow-up Questions
  - Selection Jobs
  - Sources
```

### Professional에서 가져올 요소

Professional 목업의 `Follow-up Questions`를 오른쪽 패널에 추가한다.

예:

```text
Follow-up Questions
  1. 이 문장의 핵심 전제는 무엇인가?
  2. 이 수치의 기준일과 출처는 무엇인가?
  3. 이 용어가 앞 절에서 정의된 의미와 일치하는가?
```

질문은 문서 유형별로 다르게 생성한다.

- 논문: 정의, 방법론, 선행연구, 한계
- 계약서: 동의권, 해지권, 손해배상, 예외 조항
- 리서치: 출처, 기준일, 표본, 반론 가능성
- 정책 문서: 적용 범위, 시행일, 법적 근거

## 10. PDF 로딩 흐름

PDF 로딩은 자동, Codex 분석은 명시 실행이 기본이다.

```text
1. 사용자가 Upload PDF 클릭 또는 드래그 앤 드롭
2. 브라우저가 PDF.js로 즉시 미리보기 표시
3. 파일을 MacBook backend로 업로드
4. MacBook이 파일 해시 계산
5. 기존 문서인지 확인
6. PDF 원본을 local uploads에 저장
7. 페이지 수와 metadata 추출
8. 페이지별 텍스트 추출
9. PDF.js text layer anchor 준비
10. 오른쪽 패널에 Ready to analyze 표시
11. 캐시된 분석이 있으면 즉시 표시
```

자동 실행되는 작업:

- PDF 미리보기
- PDF 업로드
- hash 계산
- metadata 추출
- 페이지별 텍스트 추출
- 기존 캐시 조회

버튼으로 실행되는 작업:

- `Analyze Page`
- `Analyze Range`
- `Analyze Document`
- `Explain`
- `Fact-check`

긴 문서에서는 기본 버튼을 `Analyze Page`로 둔다. 전체 분석은 실행 전에 예상 페이지 수, 예상 시간, Codex job 수를 보여준다.

## 11. 웹페이지 로딩 흐름

웹페이지는 원본 iframe보다 읽기 모드 중심으로 구현한다.

이유:

- 많은 사이트가 iframe 삽입을 막는다.
- cross-origin iframe 내부 selection을 부모 앱에서 안정적으로 읽기 어렵다.
- Readability DOM은 앱 내부에 있으므로 selection과 anchor 저장이 안정적이다.

흐름:

```text
1. 사용자가 URL 입력
2. backend가 HTML fetch
3. Readability로 본문 추출
4. article title, byline, siteName, textContent 저장
5. 왼쪽에 reader mode 렌더링
6. selection popup 사용 가능
7. Analyze Page와 Fact-check 사용 가능
```

추후 iframe preview는 보기 전용 옵션으로 추가한다.

## 12. Selection Popup

### 동작

```text
사용자 텍스트 드래그
  -> mouseup
  -> selection text 추출
  -> selection rect 계산
  -> popup 표시
  -> Explain 또는 Fact-check 클릭
  -> selection job 생성
  -> 오른쪽 Selection Jobs에 진행 상태 표시
```

### 버튼

```text
Explain
  - 문서 내부 맥락 중심
  - 웹 검색 사용 안 함
  - 쉬운 한국어 설명, 용어, 번역, 후속 질문 반환

Fact-check
  - Codex 웹 검색 사용
  - 출처와 판단 반환
  - 자동 실행 금지
```

### 선택 제한

```text
최소 8자
최대 4,000자
공백만 선택 불가
스캔 PDF는 OCR 전까지 selection 불가
```

### PDF anchor

```json
{
  "source_type": "pdf",
  "document_id": "doc_123",
  "page": 12,
  "selection_text": "selected text",
  "surrounding_text": "paragraph before and after",
  "rects": [
    {
      "page": 12,
      "x": 102.3,
      "y": 241.8,
      "width": 210.4,
      "height": 18.2
    }
  ]
}
```

## 13. Codex 통합

Codex 실행은 adapter 계층으로 감싼다.

```text
CodexAdapter
  - runDocumentAnalysis()
  - runPageAnalysis()
  - runSelectionExplain()
  - runSelectionFactCheck()
  - checkCodexLogin()
  - checkWebSearch()
```

### CLI 경로

MVP의 안정 경로:

```text
codex exec --json --ephemeral --sandbox read-only ...
```

Fact-check:

```text
codex exec --json --ephemeral --sandbox read-only --search ...
```

구현 전 실제 설치 버전에서 확인:

```text
codex --version
codex exec --help
codex exec --json "Return JSON only"
codex exec --search "Search the web and cite sources"
```

### SDK 경로

Codex SDK는 장기적으로 더 안정적인 경로로 둔다.

- CLI adapter와 같은 interface를 유지한다.
- SDK에서 웹 검색 제어가 명확하면 Fact-check도 SDK로 전환한다.
- 명확하지 않으면 Fact-check는 CLI `--search` 경로를 유지한다.

### 구조화 출력

모든 Codex job은 schema를 강제한다.

- document-analysis.schema.json
- page-analysis.schema.json
- selection-explain.schema.json
- selection-fact-check.schema.json

schema 검증 실패 시:

```text
1. 원본 출력 저장
2. repair prompt 1회 실행
3. 실패하면 job failed_schema
4. 오른쪽 패널에 재실행 버튼 표시
```

## 14. 웹 검색 정책

웹 검색은 Fact-check에만 기본 사용한다.

```text
Summary:
  웹 검색 사용 안 함

Terms:
  웹 검색 사용 안 함

Translation:
  웹 검색 사용 안 함

Follow-up Questions:
  기본적으로 웹 검색 사용 안 함

Fact-check:
  웹 검색 사용
```

Fact-check 결과 필수 필드:

```json
{
  "claim": "string",
  "verdict": "supported | contradicted | unclear | not_checkable",
  "explanation_ko": "string",
  "sources": [
    {
      "title": "string",
      "url": "string",
      "publisher": "string",
      "published_date": "string",
      "accessed_date": "2026-07-03",
      "relevance": "high | medium | low"
    }
  ],
  "caveats": ["string"],
  "confidence": "high | medium | low"
}
```

검색 결과는 원문 문서를 대체하지 않는다. 오른쪽 패널에서 "외부 근거"로 분리해 보여준다.

## 15. 백엔드 API

```text
GET /health
  runner/server 상태

GET /api/system/status
  Codex, tunnel, queue, worker 상태

POST /api/documents
  PDF 업로드

POST /api/webpages
  URL 등록 및 본문 추출

GET /api/documents/:id
  문서 metadata

GET /api/documents/:id/pages/:page
  페이지 텍스트와 anchor

POST /api/documents/:id/analyze
  page/range/document 분석 job 생성

POST /api/selections
  selection 저장

POST /api/selections/:id/jobs
  explain 또는 fact_check job 생성

GET /api/jobs/:id
  job 상태

GET /api/jobs/:id/events
  SSE stream

GET /api/documents/:id/analysis
  문서 분석 결과

GET /api/documents/:id/selection-jobs
  selection job 목록

DELETE /api/documents/:id
  문서와 캐시 삭제
```

## 16. 데이터 모델

주요 테이블:

```text
documents
  id
  source_type: pdf | webpage
  title
  file_hash
  original_filename
  local_path
  page_count
  status
  created_at
  updated_at

pages
  id
  document_id
  page_number
  text
  text_hash
  extraction_confidence

selections
  id
  document_id
  page_number
  selection_text
  surrounding_text
  rects_json
  created_at

jobs
  id
  document_id
  selection_id
  type
  status
  payload_json
  result_json
  locked_by
  lease_expires_at
  attempts
  created_at
  updated_at

analysis_cache
  id
  cache_key
  document_id
  selection_id
  type
  result_json
  expires_at
  created_at

sources
  id
  job_id
  title
  url
  publisher
  published_date
  accessed_date
  relevance
```

## 17. 캐시 전략

```text
PDF text extraction:
  file_hash 기준 영구 캐시

Page analysis:
  file_hash + page_number + prompt_version + schema_version

Document analysis:
  file_hash + page_range + prompt_version + schema_version

Selection Explain:
  file_hash/url_hash + selection_text_hash + surrounding_text_hash

Selection Fact-check:
  selection_text_hash + search_mode + prompt_version
  TTL 7일
```

캐시 결과는 자동 표시하되, 사용자가 `Re-run`할 수 있게 한다.

## 18. 보안

### Cloudflare

- Cloudflare Access로 app/API 모두 보호
- 본인 이메일만 allow
- 가능하면 OTP 또는 Google login 사용
- API subdomain도 Access 보호

### 백엔드

- Access JWT 검증
- CORS allowlist
- 업로드 크기 제한
- PDF MIME 검사
- 파일명 신뢰 금지
- path traversal 방지
- request rate limit
- 내부 API token 선택 적용

### Codex

- Codex auth 파일은 MacBook에만 존재
- `.codex` 폴더는 Dropbox/Git에 절대 포함하지 않음
- Codex job에는 필요한 텍스트만 전달
- Fact-check 검색 query는 민감 정보가 그대로 들어가지 않도록 축약/정제

## 19. Cloudflare 구성

```text
app.yourdomain.com
  -> Cloudflare Pages

reader-api.yourdomain.com
  -> Cloudflare Tunnel
  -> MacBook 127.0.0.1:3001
```

필수 구성:

- Pages project
- Tunnel
- Access application for app
- Access application for API
- DNS route
- CORS policy

MacBook runner는 Tunnel이 offline이면 UI에 표시한다.

## 20. 상태 표시와 관측성

### Health payload

```json
{
  "ok": true,
  "instance_id": "runner_abc123",
  "server_started_at": "2026-07-03T07:20:00Z",
  "codex_cli_available": true,
  "codex_login_ok": true,
  "codex_web_search_ok": true,
  "cloudflare_tunnel_ok": true,
  "queue": {
    "queued": 2,
    "running": 1,
    "failed": 0
  },
  "worker": {
    "enabled": true,
    "max_codex_concurrency": 1,
    "active_codex_jobs": 1
  }
}
```

### UI 상태

```text
MacBook server active
Codex ready
Tunnel online
Queue 1 running
```

### 로그

```text
server.log
worker.log
codex.log
tunnel.log
runner.log
```

로그에는 PDF 전문이나 민감 텍스트를 남기지 않는다.

## 21. 에러 상태

UI에 명확히 보여야 하는 상태:

- MacBook offline
- Tunnel offline
- Codex login required
- Codex CLI not found
- Codex web search unavailable
- PDF extraction failed
- Scanned PDF, OCR required
- Job timeout
- Schema validation failed
- Fact-check source insufficient
- Dropbox conflict detected
- Runner already running
- Stale lock recovered

## 22. 테스트 계획

### 단위 테스트

- cache key 생성
- schema validation
- job lease transaction
- file path sanitization
- selection length validation
- fact-check result normalization

### 통합 테스트

- PDF upload
- PDF extraction
- page analysis job
- selection explain job
- selection fact-check job
- job retry
- stale lease recovery
- cache hit

### E2E 테스트

- PDF 업로드 후 Ready to analyze
- Analyze Page 클릭 후 오른쪽 결과 표시
- 텍스트 드래그 후 popup 표시
- Explain 클릭 후 결과 표시
- Fact-check 클릭 후 source 표시
- MacBook runner 중복 실행 시 기존 instance 감지

### 시각 QA

- desktop 1440px
- laptop 1280px
- tablet 1024px
- mobile 390px
- 긴 한국어 텍스트 overflow 없음
- 오른쪽 패널 스크롤 안정

## 23. 구현 로드맵

### Phase 1: Repository Foundation

- monorepo 생성
- web/server/shared/mac-runner 구조 생성
- TypeScript 설정
- lint/format/test 설정
- schema 파일 정의
- `.env.example` 작성
- `.gitignore` 강화

완료 기준:

- 로컬에서 web/server build 가능
- 테스트 실행 가능
- Dropbox에 동기화하면 안 되는 파일이 gitignore에 포함

### Phase 2: Mac Runner

- `★CodexReaderRunner` 구현
- runtime directory 생성
- single-instance lock 구현
- PID file 구현
- `/health` 제공
- launchd plist 작성
- 중복 실행 테스트

완료 기준:

- runner 더블클릭 또는 터미널 실행 가능
- 같은 runner 두 번 실행해도 서버 중복 실행 없음
- stale lock 복구 가능

### Phase 3: Backend Core

- Fastify/Express server
- SQLite migration
- documents/pages/jobs/cache tables
- upload API
- webpage API
- SSE job events
- job queue/lease

완료 기준:

- PDF 업로드 가능
- job 생성/조회 가능
- worker가 lease 기반으로 job 처리

### Phase 4: PDF/Web Extraction

- PDF.js 기반 PDF viewer 연동
- server-side text extraction
- page text 저장
- Readability extraction
- extraction status UI

완료 기준:

- PDF 페이지 표시
- 텍스트 추출 성공
- 웹페이지 읽기 모드 표시

### Phase 5: Rational UI

- Rational app shell 구현
- topbar status
- left viewer
- right analysis panel
- Follow-up Questions
- Selection Jobs
- loading/empty/error states

완료 기준:

- 목업 수준이 아니라 실제 데이터와 연결
- desktop/tablet/mobile 주요 레이아웃 안정

### Phase 6: Codex Integration

- Codex CLI adapter
- structured schema output
- page analysis
- document analysis
- selection explain
- selection fact-check with web search
- timeout/cancel/retry

완료 기준:

- `Analyze Page` 결과 표시
- `Explain` 결과 표시
- `Fact-check` 출처 표시
- schema 실패 복구 처리

### Phase 7: Selection UX

- PDF text layer selection
- webpage reader selection
- popup positioning
- keyboard/escape/outside click
- selection highlight
- right panel job insertion

완료 기준:

- 드래그 후 popup 표시
- Explain/Fact-check job 연결
- 결과가 해당 selection과 연결되어 보임

### Phase 8: Cloudflare Deployment

- Pages 배포
- Tunnel 설정
- Access 설정
- API CORS/JWT 검증
- 외부 디바이스 테스트

완료 기준:

- 외부 네트워크에서 본인만 접속 가능
- iPad/Windows PC에서 PDF 업로드와 분석 가능

### Phase 9: Hardening

- rate limit
- upload limit
- logs redaction
- backup/export
- diagnostics bundle
- queue cleanup
- cache cleanup
- error state polish

완료 기준:

- 1주일 상시 실행
- 재부팅 후 자동 복구
- 실패 상태를 사용자가 이해 가능

### Phase 10: Release Package

- Codex Reader.app 패키징
- launchd installer script
- uninstall script
- setup checklist
- update procedure
- user guide

완료 기준:

- 비개발자도 MacBook에서 실행 가능
- 실행 상태 확인 가능
- 중지/재시작 방법 명확

## 24. 최종 완료 정의

완성형 1차 제품은 다음을 만족해야 한다.

- `★ Codex Reader.app` 또는 `★CodexReaderRunner`로 MacBook 서버 실행 가능
- launchd로 자동 실행 가능
- runner 중복 실행 방지
- SQLite job lease로 job 중복 처리 방지
- Cloudflare Access로 본인만 접속
- Cloudflare Tunnel로 외부 접속
- PDF 업로드와 미리보기
- PDF 텍스트 추출
- Ready to analyze 상태 표시
- Analyze Page/Range/Document
- Summary, Terms, Translation, Follow-up Questions 표시
- selection popup
- Explain job
- Fact-check job with web search
- Fact-check source 표시
- cache hit 표시
- Codex login 만료 감지
- Tunnel offline 감지
- MacBook 재부팅 후 자동 복구
- iPad/Windows PC에서 사용 가능

## 25. 구현 전 확인 명령

MacBook에서 구현 전 확인한다.

```text
codex --version
codex exec --help
codex exec --json "Return a tiny JSON object."
codex exec --search "Search the web and cite one official source."
cloudflared --version
node --version
```

실제 설치된 Codex CLI 옵션이 문서와 다르면 adapter 계층에서만 수정한다. UI와 job queue 구조는 바꾸지 않는다.
