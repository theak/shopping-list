# ---- builder: static musl binary (rust:alpine targets musl by default) ----
FROM rust:1-alpine AS builder
# musl-dev provides the C toolchain that rustls' `ring` crypto backend compiles against.
RUN apk add --no-cache musl-dev
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY templates ./templates
COPY static ./static
RUN cargo build --release --locked

# ---- runtime: nothing but the binary (frontend assets are baked into it) ----
FROM scratch
COPY --from=builder /app/target/release/shopping-list /shopping-list
ENV PORT=42780
EXPOSE 42780
HEALTHCHECK --interval=5m --timeout=10s --start-period=1m --retries=3 \
    CMD ["/shopping-list", "healthcheck"]
ENTRYPOINT ["/shopping-list"]
