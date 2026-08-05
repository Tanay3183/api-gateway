/**
 * Chaos Engineering Test Script
 * 
 * Generates continuous background traffic against the API Gateway to
 * demonstrate load balancing, rate limiting, and circuit breaker resilience.
 */
async function runChaos() {
  console.log("🌪️  Starting Chaos Test...");
  console.log("Sending continuous background traffic (15 reqs/sec)...");

  setInterval(async () => {
    const promises = Array.from({ length: 15 }).map(() => {
      return fetch('http://localhost:3000/data')
        .then(async res => {
          const status = res.status;
          let body = await res.text();
          if (status === 200) {
            try { body = JSON.parse(body).instance; } catch(e) {}
          }
          return { status, body };
        })
        .catch(err => ({ status: 'Error', body: err.message }));
    });

    const results = await Promise.all(promises);
    const success = results.filter(r => r.status === 200).length;
    const rateLimited = results.filter(r => r.status === 429).length;
    const errors = results.filter(r => r.status !== 200 && r.status !== 429).length;
    
    process.stdout.write(`\r✅ ${success} OK | ⛔ ${rateLimited} RL | ❌ ${errors} Err   `);
  }, 1000);
}

runChaos();
