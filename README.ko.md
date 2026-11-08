# N2 Verdandi

**서로 관련된 프로젝트 파일을 지도처럼 보여주고, 문서 내용을 출처와 함께 저장합니다.**

[![release: 1.0.0](https://img.shields.io/badge/release-1.0.0-2563eb)](https://github.com/choihyunsus/n2-verdandi/releases/tag/v1.0.0) [![runtime: Node.js 22+](https://img.shields.io/badge/runtime-Node.js%2022%2B-334155)](https://github.com/choihyunsus/n2-verdandi/blob/main/docs/reference.ko.md) [![license: terms](https://img.shields.io/badge/license-terms-64748b)](https://github.com/choihyunsus/n2-verdandi/blob/main/LICENSE)

[English](README.md)

![프로젝트 읽기 → 관련 파일 묶기 → 브라우저에서 탐색](https://github.com/choihyunsus/n2-verdandi/raw/refs/heads/main/docs/images/overview.ko.svg)

## 이런 때 사용하세요

처음 보는 프로젝트 구조를 파악하거나, 한 파일과 연결된 주변 파일을 찾아볼 때 활용하세요.

로컬 그래프 화면을 제공합니다. 소스 파일의 연결과, 별도로 준비한 벡터를 이용한 의미 연결을 다룹니다. 문서에서 배운 내용에는 검증 상태를 함께 기록합니다.

## 처음 실행하기

터미널에서 `node --version`을 실행해 Node.js 22 이상인지 확인하세요. 아래 명령은 새 연습 폴더를 만들고 GitHub 배포 파일을 설치합니다. 예제 파일과 DB도 이 폴더에 두면 경로를 따라가기 쉽습니다.

```sh
mkdir n2-verdandi-demo
cd n2-verdandi-demo
npm init -y
npm install https://github.com/choihyunsus/n2-verdandi/releases/download/v1.0.0/n2-verdandi-1.0.0.tgz
```

설치 중 SQLite 빌드 오류가 나오면 운영체제에 맞는 C/C++ 빌드 도구가 필요할 수 있습니다. 자세한 환경 조건은 [설치 참고](https://github.com/choihyunsus/n2-verdandi/blob/main/docs/reference.ko.md)에 있습니다.

검색할 파일이 있는 기존 폴더를 `YOUR_SOURCE_FOLDER` 자리에 넣으세요. 경로에 공백이 있으면 따옴표로 감쌉니다.

```sh
npx --no-install n2-verdandi --db ./demo.db --project demo --agent assistant --root "YOUR_SOURCE_FOLDER" scan
npx --no-install n2-verdandi --db ./demo.db --project demo --agent assistant serve
```

`scan` 결과의 `index.complete`가 `true`인지 확인하세요. `serve`가 표시하는 로컬 주소를 브라우저로 열면 파일 지도를 볼 수 있습니다. 종료는 터미널에서 Ctrl+C를 누릅니다. 문서 파일 파서가 필요한 경우 아래 설치 참고를 확인하세요.

## Soul과 함께 쓰기

여러 N2 모듈을 연결할 때 같은 `mimir.db` 파일을 지정하세요. `project`는 작업 이름, `agent`는 계속 사용할 AI 이름입니다. 같은 작업의 기록을 이어 쓰려면 이 값들을 맞춥니다. 단독 사용도 같은 필드 구조를 사용합니다.

## 다음 단계와 상세 안내

[전체 사용 안내](https://github.com/choihyunsus/n2-verdandi/blob/main/docs/reference.ko.md)에서 실제 앱 연결, API, 지원 범위, 복구 절차와 검증 범위를 확인할 수 있습니다. [배포 파일](https://github.com/choihyunsus/n2-verdandi/releases/tag/v1.0.0)에는 설치할 버전과 변경 설명이 있습니다.

처음 나오는 용어는 이렇게 읽으면 됩니다. **MCP**는 AI 앱의 도구 연결 방식, **DB**는 저장 파일, **호스트**는 이 모듈을 연결해 실행하는 앱입니다.

사용·재배포 조건은 [라이선스](https://github.com/choihyunsus/n2-verdandi/blob/main/LICENSE)를 확인하세요. 의존 모듈에는 별도 조건이 적용될 수 있으며, 상업 이용 조건은 상세 안내에 함께 설명되어 있습니다.
