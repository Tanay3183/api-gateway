async function run() {
  console.log("🚀 Firing 10 concurrent requests at the API Gateway...\n");

  // Fire all 10 requests at the exact same time
  const promises = Array.from({ length: 10 }).map((_, i) => {
    return fetch('http://localhost:3000/data')
      .then(async res => {
        const status = res.status;
        let body = await res.text();

        // Extract the backend instance name for cleaner output
        if (status === 200) {
          try { body = JSON.parse(body).instance; } catch (e) { }
        }

        return { id: i + 1, status, body, retryAfter: res.headers.get('retry-after') };
      })
      .catch(err => ({ id: i + 1, status: 'Error', body: err.message }));
  });

  // Wait for all of them to finish
  const results = await Promise.all(promises);

  let success = 0;
  let rateLimited = 0;

  for (const res of results) {
    if (res.status === 200) {
      success++;
      console.log(`✅ [Req ${res.id < 10 ? '0' + res.id : res.id}] HTTP 200 -> Routed to: ${res.body}`);
    } else if (res.status === 429) {
      rateLimited++;
      console.log(`⛔ [Req ${res.id < 10 ? '0' + res.id : res.id}] HTTP 429 -> Rate Limited! (Retry after ${res.retryAfter}s)`);
    } else {
      console.log(`❌ [Req ${res.id < 10 ? '0' + res.id : res.id}] HTTP ${res.status} -> ${res.body}`);
    }
  }

  console.log(`\n📊 Summary: ${success} Succeeded, ${rateLimited} Rate Limited\n`);
}

run();
