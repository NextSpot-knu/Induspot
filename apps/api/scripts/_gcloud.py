"""gcloud 실행 파일 경로 해석 헬퍼 (Windows 친화, 멱등 프로비저닝 스크립트 공용).

문제: Windows 에서 subprocess 의 list 형식(shell=False)은 PATHEXT 를 적용하지 않으므로
  subprocess.run(["gcloud", ...]) 가 실제 파일 `gcloud.cmd` 를 못 찾고 WinError 2 로 죽는다.
해결: shutil.which 는 PATHEXT 를 적용해 .cmd 전체 경로를 돌려준다. 그 전체 경로를 argv[0] 로 쓰면
  CreateProcess 가 정상 실행한다(실측 확인). 우선순위:
    1) 환경변수 GCLOUD_PATH (deploy.ps1 이 $Gcloud 를 그대로 주입)
    2) PATH 검색(shutil.which — Windows 에서 .CMD 해석)
    3) 알려진 기본 설치 경로
    4) 최후: 맨이름 "gcloud" (비-Windows 또는 shim 존재 시)

각 스크립트는  `from _gcloud import GCLOUD`  후, 명령 리스트의 첫 원소를 "gcloud" 대신 GCLOUD 로 쓴다.
모든 프로비저닝 스크립트가 같은 폴더(scripts/)에 있고 `python scripts/X.py` 로 실행되므로
sys.path[0] = scripts 가 되어 형제 모듈 import 가 동작한다.
"""

import os
import shutil


def resolve_gcloud() -> str:
    p = os.environ.get("GCLOUD_PATH")
    if p and os.path.exists(p):
        return p
    w = shutil.which("gcloud")
    if w:
        return w
    for cand in (
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"),
        os.path.expandvars(r"%ProgramFiles%\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"),
    ):
        if cand and os.path.exists(cand):
            return cand
    return "gcloud"


GCLOUD = resolve_gcloud()
