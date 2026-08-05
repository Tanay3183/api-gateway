/**
 * Target Node Backend Server
 * 
 * Simulates a standard microservice endpoint.
 * Contains logic to artificially simulate catastrophic failure under load
 * to demonstrate circuit breaker resilience in the API Gateway.
 */
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const INSTANCE_ID = `backend-${PORT}`;

const processedRequests = new Set();
let isFailing = false;
let requestCount = 0;

app.use((req, res, next) => {
  if (isFailing) {
    return req.socket.destroy();
  }
  next();
});

app.use((req, res, next) => {
  const traceId = req.headers['x-correlation-id'];
  if (traceId) {
    console.log(`[${INSTANCE_ID}] Received request Trace ID: ${traceId}`);
  }
  next();
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', instance: INSTANCE_ID });
});

app.get('/data', (req, res) => {
  requestCount++;

  //Failure simulation
  if (requestCount > 15 && Math.random() < 0.05) {
    console.log(`[${INSTANCE_ID}] 💥 CATASTROPHIC FAILURE! Node is dead for 15 seconds...`);
    isFailing = true;
    requestCount = 0;

    setTimeout(() => {
      console.log(`[${INSTANCE_ID}] 🔧 Auto-recovering... Back online!`);
      isFailing = false;
    }, 15000);

    return req.socket.destroy();
  }

  setTimeout(() => {
    res.status(200).json({ data: 'Sample data from backend', instance: INSTANCE_ID });
  }, Math.random() * 50);
});

//Idempotency key processing
app.post('/data', (req, res) => {
  const idempotencyKey = req.header('Idempotency-Key');

  if (idempotencyKey) {
    if (processedRequests.has(idempotencyKey)) {
      console.log(`[${INSTANCE_ID}] Dropped duplicate request with key: ${idempotencyKey}`);
      return res.status(200).json({
        message: 'Request already processed (Idempotent)',
        instance: INSTANCE_ID
      });
    }
    processedRequests.add(idempotencyKey);
  }

  res.status(201).json({
    message: 'Data created successfully',
    instance: INSTANCE_ID,
  });
});

app.listen(PORT, () => {
  console.log(`[${INSTANCE_ID}] Backend running on port ${PORT}`);
});
