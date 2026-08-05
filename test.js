async function run() {
  console.log("Sending 10 concurrent requests to trigger the Load Balancer and Rate Limiter...");
  
  const promises = Array.from({ length: 10 }).map((_, i) => {
    return fetch('http://localhost:3000/data')
      .then(res => res.text().then(text => ({ status: res.status, headers: res.headers, text, id: i })))
      .catch(err => ({ error: err.message, id: i }));
  });

  const results = await Promise.all(promises);
  let success = 0;
  let rateLimited = 0;

  for (const res of results) {
    if (res.status === 200) {
      success++;
      console.log(`[Req ${res.id}] 200 OK -> ${res.text}`);
    } else if (res.status === 429) {
      rateLimited++;
      console.log(`[Req ${res.id}] 429 RATE LIMITED -> Retry-After: ${res.headers.get('retry-after')} seconds`);
    } else {
      console.log(`[Req ${res.id}] Error:`, res);
    }
  }

  console.log(`\nSummary: ${success} Succeeded, ${rateLimited} Rate Limited`);
}

run();
