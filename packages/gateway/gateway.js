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
import redis from './redis.js';

const fastify = Fastify({ logger: true });

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
        reply.header('x-idempotent-replayed', 'true');
        reply.status(409).send({ error: 'Conflict', message: 'Duplicate request ignored' });
        return reply;
      }
    }
  }
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

      return reply.send(body);
    } catch (err) {
      fastify.log.error(`Request to ${upstream.url} failed: ${err.message}`);
      upstream.failures++;

      if (upstream.failures >= 3 && upstream.status === 'CLOSED') {
        upstream.status = 'OPEN';
        upstream.lastFailureTime = Date.now();
        fastify.log.error(`Circuit to ${upstream.url} tripped OPEN after 3 consecutive failures.`);
      }

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
  }, 1000);
});
