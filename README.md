# Resilient API Gateway Architecture

A high-performance, fault-tolerant API Gateway and Distributed Systems testbed built with **Node.js, Fastify, and Redis**. 

This gateway is designed to sit in front of microservice clusters and abstract away the complexities of load balancing, resilience, security, and observability.

## 🚀 Core Architectural Features

### Routing & Load Balancing
- **Adaptive Load Balancing & Canary Splitting**: Routes traffic dynamically by calculating a real-time score based on node latency (EMA) and in-flight request counts. Respects traffic `weights` for canary deployments.
- **Dynamic Service Discovery**: Exposes an internal Admin API (`POST /admin/backends`) to register and deregister upstream services at runtime without restarting the gateway.
- **Header Transformation**: Automatically strips internal metadata headers (e.g., `x-powered-by`) and injects contextual headers (`x-forwarded-for`, `x-gateway-processed`) before proxying downstream.

### Resilience & Fault Tolerance
- **Circuit Breakers & Self-Healing**: Automatically isolates dead backend nodes after 3 consecutive failures. Uses background synthetic health pings to safely test and reintegrate nodes once they recover.
- **Smart Retries & Exponential Backoff**: Safe, idempotent methods (`GET`/`HEAD`) are protected with strict 5000ms timeouts. If a backend drops the connection, the gateway automatically retries on an alternate healthy node using exponential backoff.
- **Graceful Degradation**: If the entire backend cluster goes down (all circuits OPEN), the gateway intercepts the failure and serves a **stale cache** response (if available) to maintain uptime.

### Security & Validation
- **Request Validation Layer**: Intercepts and drops oversized payloads (> 1MB), suspicious URL patterns (path traversal, SQLi probes), and requests missing a `User-Agent`.
- **GCRA Rate Limiting**: Uses a custom Lua script in Redis to implement the Generic Cell Rate Algorithm, providing smooth, distributed traffic shaping.
- **Distributed Idempotency (Mutex)**: Utilizes Redis `SET NX EX` locks to mathematically guarantee that duplicate `POST` requests (using `x-idempotency-key`) are dropped.
- **API Key Auth Layer**: A `preHandler` hook that can validate incoming `x-api-key` headers to lock down specific routes or consumers.

### Performance & Processing
- **Redis Response Caching**: Successfully proxied `GET` responses are cached in Redis with a 60-second TTL. Subsequent requests bypass the network and return immediately with `x-cache: HIT`.
- **Bull Job Queue**: `POST` request bodies are enqueued into a Redis-backed Bull queue (`gateway-jobs`) before being proxied, allowing for heavy async background processing.

### Observability
- **Distributed Tracing (W3C)**: Checks for and generates W3C standard `traceparent` headers, injecting them downstream to correlate requests across microservices.
- **Winston Audit Logging**: Structured JSON logs are written to `logs/combined.log` and `logs/error.log`, capturing incoming requests, cache hits, queued jobs, and upstream failures.
- **Time-Series Telemetry (Prometheus & Grafana)**: Fully instrumented with `prom-client` to export Golden Signals (latencies, rate limits enforced, idempotency rejects, open circuits) to a Dockerized monitoring stack.
- **Real-Time Observability Dashboard**: A React + Vite Admin app using WebSockets that displays live network telemetry at 60 FPS.

---

## 🛠️ Technology Stack
- **Gateway & Backends**: Node.js, Fastify, Undici
- **State, Caching & Queues**: Redis (Dockerized), Bull, Lua Scripting
- **Dashboards**: React, Vite, TailwindCSS
- **Observability**: Prometheus, Grafana, Socket.io, Winston

---

## 💻 How to Run Locally

### 1. Start the Infrastructure (Redis, Prometheus, Grafana)
```bash
docker compose up -d
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Start the Backend Cluster & API Gateway
Run these in two separate terminals:
```bash
npm run start:backends
npm run start:gateway
```

### 4. Start the UIs
Open two more terminals to run the Web Apps:
```bash
npm run dev --workspace=packages/admin-dashboard
npm run dev --workspace=packages/client-app
```

---

## 🧪 Chaos Engineering & Testing

A Chaos script is included to simulate large bursts of traffic, triggering rate limits and random catastrophic node failures.

While everything is running, execute:
```bash
node chaos-test.js
```

## 📊 Viewing Metrics in Grafana
![Grafana Dashboard showing Spikes from Chaos Testing](./grafana-dashboard.png)
1. Open Grafana at [http://localhost:3005](http://localhost:3005) (Login: `admin` / `admin`).
2. Add a **Prometheus** Data Source with the URL `http://prometheus:9090`.
3. Create dashboards using PromQL to query custom metrics:
   - `gateway_request_duration_seconds_bucket`
   - `gateway_rate_limits_total`
   - `gateway_circuit_breaker_open_total`
   - `gateway_idempotency_rejects_total`
