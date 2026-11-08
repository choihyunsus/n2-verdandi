[쉬운 시작 안내로 돌아가기](../README.ko.md)

# N2 Verdandi

Soul 공통 데이터베이스에서 파일 구조, 의미 연결, 출처가 있는 문서 학습을 관리합니다.

[English guide](reference.md)

베르단디는 아라크네로 프로젝트를 색인하고 관련 파일을 커뮤니티로 묶습니다. 전체 커뮤니티, 커뮤니티 내부 파일, 한 파일의 이웃을 단계별로 탐색할 수 있습니다. 문서 학습은 출처와 검증 상태를 가진 미미르 경험으로 저장합니다.

## 설치

Node.js 20.19 이상을 사용합니다. 배포 파일에 컴파일된 JavaScript와 로컬 그래프 화면이 포함됩니다.

```sh
npm install https://github.com/choihyunsus/n2-verdandi/releases/download/v1.0.0/n2-verdandi-1.0.0.tgz
```

실행 의존성은 Arachne 5.0.0과 Mimir 3.0.3의 고정된 GitHub 배포 파일입니다.

PDF, DOCX, XLSX, PPTX는 아라크네의 제한된 별도 Rust 프로세스로 읽습니다. 의존성 배포 파일에 Windows x64 파서가 포함됩니다. 다른 운영체제에서는 Rust 1.98 이상을 설치하고 사용하는 프로젝트에서 파서를 빌드합니다.

```sh
npm --prefix node_modules/n2-arachne run build:documents
```

별도로 준비한 실행 파일은 `N2_ARACHNE_DOCUMENT_WORKER`로 지정할 수 있습니다. 텍스트와 Markdown은 내장 UTF-8 읽기를 사용합니다.

## 시작하기

DB 경로, 프로젝트 이름, 에이전트 이름, 기존 소스 폴더를 명시합니다. 동일한 프로젝트·에이전트 값이 아라크네 색인, 베르단디 그래프, 미미르 학습 범위를 연결합니다.

```sh
npx n2-verdandi --db ./memory/mimir.db --project demo --agent assistant --root ./source scan
npx n2-verdandi --db ./memory/mimir.db --project demo --agent assistant status
npx n2-verdandi --db ./memory/mimir.db --project demo --agent assistant serve
```

`serve`가 출력하는 로컬 주소를 열면 단계별 탐색, 검색, 노드 이동, 확대·축소, 뒤로 가기, 글자 크기 조절을 사용할 수 있습니다. 화면의 Refresh는 저장된 데이터를 다시 읽습니다. 소스 변경 후에는 `scan`을 다시 실행합니다.

색인이 일부만 완료되면 문제 목록과 `graph: null`을 반환하고 이전 그래프를 보존합니다. 현재 색인으로 그래프를 만들려면 `build`를 명시적으로 실행합니다. 결과에는 색인 범위의 완료 여부가 포함됩니다.

```sh
npx n2-verdandi --db ./memory/mimir.db --project demo --agent assistant build
npx n2-verdandi --db ./memory/mimir.db --project demo --agent assistant list --limit 20
npx n2-verdandi --db ./memory/mimir.db --project demo --agent assistant backlinks src/index.ts
npx n2-verdandi --db ./memory/mimir.db --project demo --agent assistant --root ./source learn docs/design.md
```

## 라이브러리

아래 예제를 `demo.mjs`로 저장해 실행합니다.

```js
import { Verdandi } from 'n2-verdandi';

const graph = new Verdandi({
  dbPath: './memory/mimir.db',
  project: 'demo',
  agent: 'assistant',
  projectRoot: './source',
});

try {
  console.log(await graph.scan());
  console.log(graph.status());
  console.log(graph.communities(20, 0));
  console.log(graph.graph(0));
  console.log(await graph.learn('docs/design.md'));
} finally {
  await graph.close();
}
```

ES module의 named import와 TypeScript 선언을 제공합니다. 파일은 정규화된 프로젝트 상대 경로로 지정합니다. 문서 학습과 소스 색인은 `projectRoot`가 필요합니다. 프로젝트·에이전트마다 하나의 실제 소스 폴더가 연결됩니다. 그래프 읽기는 DB만으로 사용할 수 있습니다.

| 메서드 | 기능 |
| --- | --- |
| `scan({ force, signal })` | 아라크네 색인 후 완료된 결과로 그래프 작성 |
| `build({ force, signal })` | 전체·부분·변경 없음 전략에 따른 그래프 갱신 |
| `semantic({ model, force, signal })` | 기존 벡터의 의미 연결과 제외된 입력 수 확인 |
| `learn(path, { signal, screen, policyId })` | 문서 해시, 수락·거부 청크 수, 경험·통찰 ID 반환 |
| `status()` | 색인 범위, 최신 입력과 저장된 그래프 차이, 의미 연결, 문서, 작업 임대 상태 |
| `communities(limit, offset)` | 커뮤니티 목록 페이지 조회 |
| `community(id)` | 구성 파일과 커뮤니티 사이 연결 조회 |
| `graph(level, id)` | 0 전체, 1 커뮤니티, 2 파일 이웃 조회 |
| `backlinks(path, options)` | 역방향 import, 최신성 가중 의미 이웃, 같은 커뮤니티 파일 조회 |
| `close()` | 진행 중 작업 취소와 정리를 기다린 후 DB 연결 종료 |

`startGraphViewer(graph, port)`는 `url`, `closed`, 비동기 `close()`를 반환합니다. 화면 서버를 닫은 다음 엔진을 종료합니다.

## MCP 연결

설치된 CLI의 절대 경로와 DB·소유 범위를 MCP 호스트에 지정합니다.

```json
{
  "mcpServers": {
    "verdandi": {
      "command": "node",
      "args": [
        "D:/example/node_modules/n2-verdandi/dist/index.js",
        "--db", "D:/example/memory/mimir.db",
        "--project", "demo",
        "--agent", "assistant",
        "--root", "D:/example/source",
        "mcp"
      ]
    }
  }
}
```

도구 9개는 `verdandi_scan`, `verdandi_build`, `verdandi_semantic`, `verdandi_learn_doc`, `verdandi_status`, `verdandi_list`, `verdandi_read`, `verdandi_backlinks`, `verdandi_graph`입니다. 요청은 연결 시 지정한 프로젝트·에이전트 범위에서 실행합니다. 취소 신호는 색인, 계산 작업, 문서 추출과 선별로 전달됩니다.

## 그래프 갱신

아라크네의 import와 의미 연결을 중복 제거한 무방향 그래프로 결합합니다. 입력 연결의 가중치는 동일하며, 유사도 값은 의미 연결 표에 유지합니다. 코드 커뮤니티에서 `md`, `txt` 언어 노드는 제외합니다.

Louvain 축약 과정에서 내부 연결의 질량과 커뮤니티 사이 연결 개수를 보존합니다. 다음 단계는 원래 그래프의 모듈성을 개선할 때 채택합니다. 커뮤니티 ID는 대표 경로에서 나오며 재분류 후 달라질 수 있습니다.

구조가 같으면 기존 개수를 반환합니다. 부분 갱신은 이전 커뮤니티와 현재 연결 성분 전체를 포함하도록 범위를 확장합니다. 현재·이전 노드가 2,000개 이하이고 전체 연결 수가 같으며 변경 범위가 30% 이내일 때 부분 계산을 사용합니다. 나머지는 전체 계산으로 처리합니다.

계산은 저장 트랜잭션 밖의 작업 스레드에서 수행합니다. 작업 임대와 입력 리비전을 확인한 뒤 그래프, 해시, 변경 확인 처리를 함께 저장합니다. 저장 실패 시 이전 결과를 보존합니다. 계산 중 입력 변경이 세 번 반복되면 명시적인 재시도 오류를 반환합니다.

## 의미 연결

아라크네의 임베딩 기능으로 벡터를 만든 다음 실행합니다.

```sh
npx n2-verdandi --db ./memory/mimir.db --project demo --agent assistant semantic --model nomic-embed-text
npx n2-verdandi --db ./memory/mimir.db --project demo --agent assistant build
```

현재 청크 전체 입력의 해시, 모델, Float32 값, 차원을 확인한 뒤 파일별 평균 벡터를 정규화합니다. 오래되거나 일관성이 깨진 청크가 있으면 해당 파일을 제외하고 결과 개수에 반영합니다. 여러 모델이 저장되어 있으면 하나를 명시적으로 선택합니다. 동일 모델과 동일 차원의 벡터끼리 비교합니다.

코사인 유사도 0.65 이상을 후보로 삼아 가장 강한 10,000개를 유지합니다. 연결은 검토할 유사성 후보를 나타냅니다. 작은 변경은 실제 벡터 해시와 삭제를 반영해 갱신합니다. 기존 결과가 상한에 도달했거나 외부에서 연결이 수정되면 전체 계산을 수행합니다.

시간은 Unix 초로 저장합니다. 역방향 조회는 Skuld의 `code_pattern` 최신성 가중치 `1 / (1 + 0.005 × 경과일)`에 유사도를 곱해 의미 이웃을 정렬합니다.

## 문서 학습과 근거

문서는 출처 경로, 정규화한 텍스트의 SHA-256, 청크 위치와 선별 정책을 가진 `pattern` 경험으로 저장합니다. 최대 100개 출처를 한 그룹으로 묶어 명시적인 미검증 결론을 가진 통찰을 만듭니다. 미미르의 자동 승격 단계에서도 검증 상태를 확인합니다.

영수증은 프로젝트, 에이전트, 실제 상대 경로, 내용 해시와 정책 ID로 구분합니다. 같은 문서를 반복하거나 동시에 읽으면 유효한 기존 ID를 재사용합니다. 원문이 바뀌면 이전 근거를 무효화하고 관련 통찰을 재검토 상태로 돌립니다. 과거 버전을 다시 읽을 때 이미 무효화된 근거는 새 ID로 기록하며, 과거 경험의 출처는 보존합니다.

기본 정책은 문서를 미검증 자료로 받아들입니다. 호스트는 선별 함수와 안정된 정책 버전을 제공할 수 있습니다.

```js
await graph.learn('docs/reference.md', {
  policyId: 'my-screen-v1',
  screen: async (chunk, signal) => {
    signal.throwIfAborted();
    return mySourcePolicy(chunk.text);
  },
});
```

정책을 바꾸면 `policyId`도 갱신합니다. 거부한 청크 수를 반환하며, 전체 거부나 선별 오류 시 학습 저장소를 보존합니다. 선별 제한 시간은 30초입니다. 저장 완료 전에도 파일 지문을 재확인합니다.

## Soul 공통 DB

배포판 Soul과 같은 `mimir.db` 경로를 지정합니다. Mimir가 공통 스키마 버전 2를 초기화하며 기존 경험·통찰 필드를 보존합니다. 베르단디는 버전 1의 `verdandi_*` 테이블을 관리합니다. 의미 연결은 배포된 Skuld의 범위·모델·Unix 시간 계약을 유지합니다.

소유 범위가 있는 기존 Skuld 의미 연결 표를 수용합니다. 초기 대붕이의 범위 없는 테이블은 별도 DB로 소유 관계를 명시해 이관해야 합니다. 더 높은 스키마 버전은 오류로 처리합니다. 과거 데이터 이관 전에 프로젝트와 에이전트 소유 관계를 결정합니다.

## 자원 제한

| 항목 | 제한 |
| --- | --- |
| 엔진 동시 작업 | 8개 |
| 그래프 입력 | 노드 20,000개, 연결 100,000개, 그래프 문자열 합계 32 MiB |
| 계산 스레드 | 30초, JavaScript old-generation 256 MiB·young-generation 32 MiB |
| 의미 입력 | 청크 50,000개, 파일 20,000개, 내용·벡터 합계 64 MiB, 1~8,192차원 |
| 의미 계산 | 시도당 차원 연산 2억 회, 상위 연결 10,000개 |
| 문서 | 입력 10 MiB, 청크 최대 8,192개, 청크당 UTF-16 단위 최대 8,192개 |
| 문서 저장 | 트랜잭션 내 확인하는 15초 시간 예산 |
| 화면 표시 | 노드 800개와 연결 4,000개, 받은 전체 노드는 검색으로 접근 |
| 화면 계산 | 초기 정착 5초, 드래그 시 재시작 |
| HTTP·MCP 응답 | 8 MiB |

문서 파서는 Windows Job 메모리 제한, Linux 주소 공간 제한, macOS의 주기적인 실제 메모리 감시를 사용합니다. macOS는 확인 간격 사이에 임계값을 초과할 수 있습니다. 계산 스레드의 힙 제한과 별도로 입력 크기 제한이 전송할 벡터 데이터를 제한합니다.

화면 서버는 로컬 주소에서 번들 파일과 읽기 API를 제공하며 요청 출처를 확인합니다. 이동 실패 시 기존 그림을 유지하고 저장된 결과의 최신성·부분 색인 상태를 알립니다. 의미 연결의 정확도는 사용하는 임베딩과 프로젝트 내용에 영향을 받습니다.

## 개발과 검증

```sh
npm ci
npm run build:documents
npm test
npm run typecheck
npm audit --omit=dev
npm pack --dry-run
```

검증에는 실제 공통 SQLite, 색인, 부분·전체 그래프 비교, 실패 복구, 재시작, 취소, 작업 임대 복구, 의미 연결, 문서 출처, 바이너리 문서 파싱, CLI, stdio MCP, HTTP와 화면 이동 로직이 포함됩니다. CI는 Node.js 22로 Windows·Linux·macOS에서 실행합니다. Windows에서는 선택적인 Mimir Rust 바인딩도 확인합니다. 실제 브라우저에서 데스크톱과 390px 화면, 세 단계 키보드 이동, 검색, 글자 크기, 이동 오류 복구와 표시 상한을 검증합니다.

## 라이선스

베르단디 코드는 `LICENSE`의 MIT 조건을 따릅니다. 아라크네와 미미르는 `LICENSE-ARACHNE`, `LICENSE-MIMIR`의 기존 비상업·상업 사용 조건과 함께 제공된 `LICENSE-APACHE`를 유지합니다. 번들 D3의 ISC 조건은 `static/LICENSE-D3`에 있습니다. 구성 요소 출처와 재사용한 테스트 자료 생성기는 `THIRD-PARTY-NOTICES`에 정리되어 있습니다.
