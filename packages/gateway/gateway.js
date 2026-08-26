/**
 * Core API Gateway & Load Balancer
 * 
 * Features:
 * - Adaptive load balancing using real-time latency and in-flight request scoring.
 * - Centralized GCRA rate limiting and idempotent POST deduplication via Redis.
 * - Autonomous circuit breakers with background health ping self-healing.
 * - WebSockets for real-time cluster telemetry broadcasting.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { randomUUID } from 'crypto';
import { request } from 'undici';
import { Server } from 'socket.io';
import client from 'prom-client';
import redis from './redis.js';

const fastify = Fastify({ logger: true });

// === Prometheus Metrics Setup ===
client.collectDefaultMetrics({ prefix: 'gateway_' });

const rateLimitCounter = new client.Counter({
  name: 'gateway_rate_limits_total',
  help: 'Total number of requests blocked by GCRA rate limiter'
});
rateLimitCounter.inc(0);

const idempotencyCounter = new client.Counter({
  name: 'gateway_idempotency_rejects_total',
  help: 'Total number of duplicate POST requests intercepted'
});
idempotencyCounter.inc(0);

const requestDurationHistogram = new client.Histogram({
  name: 'gateway_request_duration_seconds',
  help: 'Histogram of proxy request latencies in seconds',
  labelNames: ['method', 'status', 'backend'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5]
});

const circuitBreakerGauge = new client.Gauge({
  name: 'gateway_circuit_breaker_open_total',
  help: 'Number of backend nodes currently in OPEN state'
});

await fastify.register(cors, {
  origin: '*'
});

const backends = [
  { url: 'http://localhost:3001', latency: 0, requests: 0, totalRequests: 0, status: 'CLOSED', failures: 0, lastFailureTime: 0 },
  { url: 'http://localhost:3002', latency: 0, requests: 0, totalRequests: 0, status: 'CLOSED', failures: 0, lastFailureTime: 0 },
  { url: 'http://localhost:3003', latency: 0, requests: 0, totalRequests: 0, status: 'CLOSED', failures: 0, lastFailureTime: 0 }
];

//synthetic Health Pings (Circuit Breaker Half-Open State)
setInterval(async () => {
  for (const b of backends) {
    if (b.status === 'OPEN' && Date.now() - b.lastFailureTime > 10000) {
      b.status = 'HALF_OPEN';
      fastify.log.warn(`Circuit to ${b.url} is HALF_OPEN. Pinging /health...`);
      try {
        const res = await fetch(`${b.url}/health`);
        if (res.ok) {
          b.status = 'CLOSED';
          b.failures = 0;
          fastify.log.info(`Circuit to ${b.url} CLOSED. Health restored.`);
        } else {
          throw new Error('Health ping rejected');
        }
      } catch (err) {
        b.status = 'OPEN';
        b.lastFailureTime = Date.now();
        fastify.log.warn(`Circuit to ${b.url} remains OPEN. Ping failed.`);
      }
    }
  }
}, 5000);

fastify.addHook('onRequest', (req, reply, done) => {
  req.headers['x-correlation-id'] = randomUUID();
  done();
});

//GCRA rate limiting & idempotency hook
fastify.addHook('preHandler', async (req, reply) => {
  const burst = 50;
  const emissionInterval = 50;
  const key = `rate_limit:ip:${req.ip}`;

  const [allowed, retryAfter] = await redis.gcraRateLimit(key, burst, emissionInterval, Date.now());

  if (allowed === 0) {
    rateLimitCounter.inc(); // Track Prometheus Metric
    reply.header('Retry-After', retryAfter);
    reply.status(429).send({ error: 'Too Many Requests' });
    return reply;
  }

  //Idempotent POST deduplication (Redis NX lock)
  if (req.method === 'POST') {
    const idempotencyKey = req.headers['x-idempotency-key'];
    if (idempotencyKey) {
      const redisKey = `idempotency:${idempotencyKey}`;
      const set = await redis.set(redisKey, 'processed', 'EX', 86400, 'NX');
      if (!set) {
        idempotencyCounter.inc(); // Track Prometheus Metric
        reply.header('x-idempotent-replayed', 'true');
        reply.status(409).send({ error: 'Conflict', message: 'Duplicate request ignored' });
        return reply;
      }
    }
  }
});

// === Prometheus Scrape Endpoint ===
fastify.get('/metrics', async (req, reply) => {
  reply.header('Content-Type', client.register.contentType);
  return await client.register.metrics();
});

fastify.route({
  method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'],
  url: '/*',
  handler: async (req, reply) => {
    const availableBackends = backends.filter(b => b.status === 'CLOSED' || b.status === 'HALF_OPEN');
    if (availableBackends.length === 0) {
      return reply.status(503).send({ error: 'Service Unavailable', message: 'All backend nodes are currently dead.' });
    }

    //Adaptive scoring
    const upstream = availableBackends.reduce((best, curr) => {
      const currScore = curr.latency * (curr.requests + 1) + (curr.totalRequests * 0.0001);
      const bestScore = best.latency * (best.requests + 1) + (best.totalRequests * 0.0001);
      return (currScore < bestScore) ? curr : best;
    });

    upstream.requests++;
    upstream.totalRequests++;
    const start = Date.now();
    const endPrometheusTimer = requestDurationHistogram.startTimer(); // Start metric timer

    const targetUrl = upstream.url + req.raw.url;
    fastify.log.info(`Routing to ${targetUrl} (latency: ${upstream.latency.toFixed(2)}ms, in-flight: ${upstream.requests})`);

    try {
      const { statusCode, headers, body } = await request(targetUrl, {
        method: req.method,
        headers: { ...req.headers, host: undefined },
        body: req.method !== 'GET' && req.method !== 'HEAD' ? req.raw : undefined
      });

      reply.status(statusCode);
      upstream.failures = 0;

      for (const [key, value] of Object.entries(headers)) {
        reply.header(key, value);
      }

      endPrometheusTimer({ method: req.method, status: statusCode, backend: upstream.url }); // Record successful metric

      return reply.send(body);
    } catch (err) {
      fastify.log.error(`Request to ${upstream.url} failed: ${err.message}`);
      upstream.failures++;

      if (upstream.failures >= 3 && upstream.status === 'CLOSED') {
        upstream.status = 'OPEN';
        upstream.lastFailureTime = Date.now();
        circuitBreakerGauge.inc(); // Track open circuit
        fastify.log.error(`Circuit to ${upstream.url} tripped OPEN after 3 consecutive failures.`);
      }

      endPrometheusTimer({ method: req.method, status: 502, backend: upstream.url }); // Record failed metric
      reply.status(502).send({ error: 'Bad Gateway', backend: upstream.url });
    } finally {
      upstream.requests--;
      const duration = Math.max(1, Date.now() - start);
      upstream.latency = (upstream.latency === 0) ? duration : (upstream.latency * 0.8 + duration * 0.2);
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
  const io = new Server(fastify.server, {
    cors: { origin: '*' }
  });

  io.on('connection', (socket) => {
    fastify.log.info(`Dashboard connected: ${socket.id}`);
  });

  setInterval(() => {
    io.emit('metrics', backends);
    
    // Sync circuit breaker gauge
    const openCircuits = backends.filter(b => b.status === 'OPEN').length;
    circuitBreakerGauge.set(openCircuits);
  }, 1000);
});
