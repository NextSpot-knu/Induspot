"""[WP5] Dataflow 워커용 패키징 — congestion_pipeline 모듈을 워커에 설치한다.

launch_dataflow.py 가 `--setup_file` 로 이 파일을 지정하면, Apache Beam 이 이 setup.py 로
sdist 를 만들어 Dataflow 워커에 pip install 한다. 그 결과 워커가 `import congestion_pipeline`
을 할 수 있게 되어, 파이프라인 변환(_parse_event Map / _AddWindowInfo DoFn / SumCount
CombineFn)을 언피클할 때 났던

    ModuleNotFoundError: No module named 'congestion_pipeline'

가 해소된다.

왜 top-level 모듈인가:
  launch_dataflow.py 를 스크립트로 실행하면(권장 실행법) sys.path[0] 가 이 dataflow 디렉터리라
  `from congestion_pipeline import run` 폴백 경로를 타고, 변환들의 __module__ 이 top-level
  `congestion_pipeline` 으로 피클된다. 따라서 워커에도 같은 이름(top-level)으로 깔아야 한다.
  → packages(=dataflow) 가 아니라 py_modules=["congestion_pipeline"] 로 단일 모듈을 배포.

apache-beam[gcp] 는 Dataflow 워커 베이스 이미지에 이미 포함되어 있으므로 install_requires 에
넣지 않는다(중복 설치/버전 충돌 방지). 추가 런타임 의존성이 생기면 여기 install_requires 에 추가.
"""

import setuptools

setuptools.setup(
    name="induspot_dataflow",
    version="0.1.0",
    description="InduSpot congestion windowing Dataflow pipeline module (worker packaging).",
    py_modules=["congestion_pipeline"],
    install_requires=[],
)
