# --- Build Stage ---
FROM python:3.11-slim AS builder

WORKDIR /app

# Poetry 설치를 위한 필수 시스템 패키지 설치
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Poetry 설치
ENV POETRY_VERSION=1.7.1
ENV POETRY_HOME=/opt/poetry
RUN curl -sSL https://install.python-poetry.org | python3 -
ENV PATH="${POETRY_HOME}/bin:${PATH}"

# 설정 파일 복사
COPY pyproject.toml poetry.lock* ./

# Poetry를 사용하여 requirements.txt 생성
RUN poetry export -f requirements.txt --output requirements.txt --without-hashes

# --- Production Stage ---
FROM python:3.11-slim AS runner

WORKDIR /app

# builder에서 생성된 requirements.txt 복사 및 패키지 설치
COPY --from=builder /app/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 애플리케이션 코드 복사
COPY . .

# 실행 환경 변수 기본값 설정 (GCP 표준 포트 반영)
ENV ENV=production
ENV PORT=8080

# 포트 개방 메타데이터 설정
EXPOSE 8080

# 실제 구동 파일 경로인 app.main:app 으로 정밀 매핑 수행
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]