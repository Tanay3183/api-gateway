import Fastify from 'fastify';
import proxy from '@fastify/http-proxy';
import { Agent } from 'undici';

const fastify = Fastify({ logger: true });

const backends = [
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003'
];
let currentIndex = 0;

fastify.register(proxy, {
  upstream: 'http://localhost', // dummy
  undici: new Agent(), // Pass undici directly to proxy options
  replyOptions: {
    getUpstream: (request, base) => {
      const upstream = backends[currentIndex];
      currentIndex = (currentIndex + 1) % backends.length;
      return upstream;
    }
  }
});

fastify.listen({ port: 3004 }).then(() => {
  console.log('Test proxy on 3004');
});
