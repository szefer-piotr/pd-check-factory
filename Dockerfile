FROM python:3.11-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jre-headless \
    && rm -rf /var/lib/apt/lists/*

ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
ENV PATH="${JAVA_HOME}/bin:${PATH}"

WORKDIR /app

COPY pyproject.toml README.md ./
COPY pdcheck_factory ./pdcheck_factory
COPY schemas ./schemas

# Prefer editable install: schemas/ and pdcheck_factory/data/ resolve via project_root()
RUN pip install --no-cache-dir -U pip \
 && pip install --no-cache-dir -e .

RUN mkdir -p /mnt/output

EXPOSE 8080

CMD ["pdcheck", "ui", "step-api", "--host", "0.0.0.0", "--port", "8080", "--output-dir", "/mnt/output"]