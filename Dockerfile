FROM python:3.12.8-alpine3.21 AS base
RUN addgroup -g 1000 keria && adduser -D -u 1000 -G keria keria
WORKDIR /home/keria

FROM base AS builder
RUN apk --no-cache add \
    curl \
    bash \
    alpine-sdk \
    libffi-dev \
    libsodium \
    libsodium-dev

USER keria

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

COPY --from=ghcr.io/astral-sh/uv:0.9.5 --chown=keria:keria /uv /uvx /bin/

COPY pyproject.toml uv.lock README.md ./
RUN uv sync --locked --no-dev --no-editable

COPY --chown=keria:keria src/ src/
RUN uv sync --locked --no-dev

FROM base AS runner
RUN apk --no-cache add \
    bash \
    curl \
    libsodium-dev \
    gcc

COPY --from=builder --chown=keria:keria /home/keria /home/keria

USER keria

ENV PATH="/home/keria/.venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

ENTRYPOINT ["keria"]
CMD ["start"]
