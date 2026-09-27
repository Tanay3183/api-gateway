/**
 * Core API Gateway & Load Balancer
 * 
 * Features:
 * - Adaptive load balancing using real-time latency and in-flight request scoring.
 * - Centralized GCRA rate limiting and idempotent POST deduplication via Redis.
 * - Autonomous circuit breakers with background health ping self-healing.
 * - WebSockets for real-time cluster telemetry broadcasting.
 * - Request validation layer to reject malformed/malicious payloads.
 * - Bull job queue for async processing of POST request bodies.
 * - Redis-backed response caching for GET requests (60s TTL).
 * - Winston file logging for structured audit trails.
 * - Distributed Tracing (W3C Trace Context) injection.
 * - Dynamic Service Discovery & Canary Splitting (Admin APIs).
 * - Optional API Key Auth Layer.
 * - Request/Response Header Transformation (stripping x-powered-by).
 * - Timeout & Retry with Exponential Backoff for safe methods.
 * - Graceful Degradation (Stale Cache Fallback on total failure).
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { randomUUID, randomBytes } from 'crypto';
import { request } from 'undici';
import { Server } from 'socket.io';
import client from 'prom-client';
import redis from './redis.js';
import Queue from 'bull';
import winston from 'winston';
import { mkdir } from 'fs/promises';

// === Distributed Tracing Helper ===
function generateTraceparent() {
  const traceId = randomBytes(16).toString('hex');
  const spanId = randomBytes(8).toString('hex');
  return `00-${traceId}-${spanId}-01`;
}

// === Winston File Logger ===
await mkdir('logs', { recursive: true });
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

// === Bull Job Queue (backed by Redis) ===
const jobQueue = new Queue('gateway-jobs', { redis: { host: '127.0.0.1', port: 6379 } });

jobQueue.process(async (job) => {
  logger.info('Processing queued job', { jobId: job.id, data: job.data });
  // Downstream async processing
});

jobQueue.on('failed', (job, err) => {
  logger.error('Job failed', { jobId: job.id, error: err.message });
});

const fastify = Fastify({ logger: true });

// === Prometheus Metrics Setup ===
client.collectDefaultMetrics({ prefix: 'gateway_' });

const rateLimitCounter = new client.Counter({ name: 'gateway_rate_limits_total', help: 'Blocked requests' });
const idempotencyCounter = new client.Counter({ name: 'gateway_idempotency_rejects_total', help: 'Duplicate POSTs intercepted' });
const requestDurationHistogram = new client.Histogram({
  name: 'gateway_request_duration_seconds', help: 'Latencies', labelNames: ['method', 'status', 'backend'], buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5]
});
const circuitBreakerGauge = new client.Gauge({ name: 'gateway_circuit_breaker_open_total', help: 'OPEN state nodes' });

await fastify.register(cors, { origin: '*' });

// === Dynamic Upstream Service Discovery & Canary ===
let backends = [
  { url: 'http://localhost:3001', latency: 0, requests: 0, totalRequests: 0, status: 'CLOSED', failures: 0, lastFailureTime: 0, weight: 100 },
  { url: 'http://localhost:3002', latency: 0, requests: 0, totalRequests: 0, status: 'CLOSED', failures: 0, lastFailureTime: 0, weight: 100 },
  { url: 'http://localhost:3003', latency: 0, requests: 0, totalRequests: 0, status: 'CLOSED', failures: 0, lastFailureTime: 0, weight: 100 }
];

// Admin API to register/deregister dynamic backends
fastify.post('/admin/backends', async (req, reply) => {
  if (req.headers['x-admin-key'] !== 'supersecret-admin-key') return reply.status(401).send({ error: 'Unauthorized' });
  const { url, weight = 100 } = req.body;
  if (!backends.find(b => b.url === url)) {
    backends.push({ url, latency: 0, requests: 0, totalRequests: 0, status: 'CLOSED', failures: 0, lastFailureTime: 0, weight });
  }
  return { success: true, backends };
});

fastify.delete('/admin/backends', async (req, reply) => {
  if (req.headers['x-admin-key'] !== 'supersecret-admin-key') return reply.status(401).send({ error: 'Unauthorized' });
  const { url } = req.body;
  backends = backends.filter(b => b.url !== url);
  return { success: true, backends };
});

// synthetic Health Pings
setInterval(async () => {
  for (const b of backends) {
    if (b.status === 'OPEN' && Date.now() - b.lastFailureTime > 10000) {
      b.status = 'HALF_OPEN';
      try {
        const res = await fetch(`${b.url}/health`);
        if (res.ok) { b.status = 'CLOSED'; b.failures = 0; }
        else throw new Error('Health ping rejected');
      } catch (err) {
        b.status = 'OPEN'; b.lastFailureTime = Date.now();
      }
    }
  }
}, 5000);

// === Request Tracing & Correlation ===
fastify.addHook('onRequest', (req, reply, done) => {
  req.headers['x-correlation-id'] = randomUUID();
  req.headers['traceparent'] = req.headers['traceparent'] || generateTraceparent();
  done();
});

// === Auth & Rate Limiting ===
fastify.addHook('preHandler', async (req, reply) => {
  // Auth Layer: If x-api-key is present, validate it. (Optional for load-tests)
  if (req.headers['x-api-key'] && req.headers['x-api-key'] !== 'valid-dev-key') {
    return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid API Key' });
  }

  // GCRA rate limiting
  const [allowed, retryAfter] = await redis.gcraRateLimit(`rate_limit:ip:${req.ip}`, 50, 50, Date.now());
  if (allowed === 0) {
    rateLimitCounter.inc();
    reply.header('Retry-After', retryAfter);
    return reply.status(429).send({ error: 'Too Many Requests' });
  }

  // Idempotent POST
  if (req.method === 'POST') {
    const idempotencyKey = req.headers['x-idempotency-key'];
    if (idempotencyKey) {
      const set = await redis.set(`idempotency:${idempotencyKey}`, 'processed', 'EX', 86400, 'NX');
      if (!set) {
        idempotencyCounter.inc();
        reply.header('x-idempotent-replayed', 'true');
        return reply.status(409).send({ error: 'Conflict' });
      }
    }
  }
});

// === Request Validation ===
fastify.addHook('preValidation', (req, reply, done) => {
  if (req.url.startsWith('/admin')) return done(); // Skip validation for admin endpoints

  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  const userAgent = req.headers['user-agent'] || '';

  logger.info('Incoming request', { correlationId: req.headers['x-correlation-id'], method: req.method, url: req.url, ip: req.ip, userAgent });

  if (contentLength > 1_048_576) {
    logger.warn('Payload too large', { url: req.url, ip: req.ip });
    return reply.status(413).send({ error: 'Payload Too Large' });
  }

  if (/(\.\.[/\\]|<script|select.+from|union.+select|exec\s*\()/i.test(req.url)) {
    return reply.status(400).send({ error: 'Bad Request', message: 'Invalid path' });
  }

  done();
});

fastify.get('/metrics', async (req, reply) => {
  reply.header('Content-Type', client.register.contentType);
  return await client.register.metrics();
});

// === Core Proxy Route (Timeout, Retry, Fallback, Caching) ===
fastify.route({
  method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'],
  url: '/*',
  handler: async (req, reply) => {
    // 1. Check Cache for GET requests before picking upstream
    if (req.method === 'GET') {
      const cached = await redis.get(`cache:${req.raw.url}`);
      if (cached) {
        logger.info('Cache hit', { url: req.raw.url });
        reply.header('x-cache', 'HIT');
        return reply.status(200).send(cached);
      }
    }

    // 2. Enqueue POSTs
    if (req.method === 'POST' && req.body) {
      await jobQueue.add({ url: req.raw.url, body: req.body, correlationId: req.headers['x-correlation-id'] });
    }

    // 3. Retry loop for idempotency (GET/HEAD)
    const maxRetries = (req.method === 'GET' || req.method === 'HEAD') ? 2 : 0;
    let attempt = 0;

    while (attempt <= maxRetries) {
      const availableBackends = backends.filter(b => b.status === 'CLOSED' || b.status === 'HALF_OPEN');
      
      // === Graceful Degradation ===
      if (availableBackends.length === 0) {
        const staleCache = await redis.get(`cache:${req.raw.url}`);
        if (staleCache && req.method === 'GET') {
          reply.header('x-cache', 'STALE');
          return reply.status(200).send(staleCache);
        }
        return reply.status(503).send({ error: 'Service Unavailable' });
      }

      // Adaptive Canary Load Balancing
      const upstream = availableBackends.reduce((best, curr) => {
        const currScore = (curr.latency * (curr.requests + 1) + (curr.totalRequests * 0.0001)) / (curr.weight || 1);
        const bestScore = (best.latency * (best.requests + 1) + (best.totalRequests * 0.0001)) / (best.weight || 1);
        return (currScore < bestScore) ? curr : best;
      });

      upstream.requests++;
      upstream.totalRequests++;
      const start = Date.now();
      const endPrometheusTimer = requestDurationHistogram.startTimer();
      const targetUrl = upstream.url + req.raw.url;

      try {
        const { statusCode, headers, body } = await request(targetUrl, {
          method: req.method,
          // === Header Transformation & Injection ===
          headers: { 
            ...req.headers, 
            host: undefined,
            'x-forwarded-for': req.ip,
            'x-gateway-processed': 'true'
          },
          body: req.method !== 'GET' && req.method !== 'HEAD' ? req.raw : undefined,
          bodyTimeout: 5000,
          headersTimeout: 5000, // Timeout protection
        });

        upstream.failures = 0;
        reply.status(statusCode);

        // Strip internal headers
        delete headers['x-powered-by'];
        delete headers['server'];

        for (const [key, value] of Object.entries(headers)) {
          reply.header(key, value);
        }

        endPrometheusTimer({ method: req.method, status: statusCode, backend: upstream.url });

        if (req.method === 'GET' && statusCode === 200) {
          const responseText = await body.text();
          await redis.set(`cache:${req.raw.url}`, responseText, 'EX', 60);
          reply.header('x-cache', 'MISS');
          return reply.send(responseText);
        }

        return reply.send(body);

      } catch (err) {
        upstream.failures++;
        logger.error('Upstream error', { upstream: upstream.url, error: err.message, attempt });
        
        if (upstream.failures >= 3 && upstream.status === 'CLOSED') {
          upstream.status = 'OPEN';
          upstream.lastFailureTime = Date.now();
          circuitBreakerGauge.inc();
        }
        endPrometheusTimer({ method: req.method, status: 502, backend: upstream.url });

        attempt++;
        if (attempt > maxRetries) {
          return reply.status(502).send({ error: 'Bad Gateway', backend: upstream.url });
        }
        // Wait backoff before retry (Exponential)
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 100));

      } finally {
        upstream.requests--;
        upstream.latency = (upstream.latency === 0) ? Date.now() - start : (upstream.latency * 0.8 + (Date.now() - start) * 0.2);
      }
    }
  }
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000 });
    console.log('Gateway running on http://localhost:3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start().then(() => {
  const io = new Server(fastify.server, { cors: { origin: '*' } });
  io.on('connection', (socket) => { fastify.log.info(`Dashboard connected: ${socket.id}`); });
  setInterval(() => {
    io.emit('metrics', backends);
    circuitBreakerGauge.set(backends.filter(b => b.status === 'OPEN').length);
  }, 1000);
});
