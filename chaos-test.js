async function runChaos() {
  console.log("🌪️  Starting Chaos Test...");
  console.log("Sending continuous background traffic (15 reqs/sec)...");

  // Send 15 requests every second
  setInterval(async () => {
    const promises = Array.from({ length: 10 }).map(() => {
      return fetch('http://localhost:3000/data')
        .then(async res => {
          const status = res.status;
          let body = await res.text();
          if (status === 200) {
            try { body = JSON.parse(body).instance; } catch (e) { }
          }
          return { status, body };
        })
        .catch(err => ({ status: 'Error', body: err.message }));
    });

    const results = await Promise.all(promises);
    const success = results.filter(r => r.status === 200).length;
    const rateLimited = results.filter(r => r.status === 429).length;
    const errors = results.filter(r => r.status !== 200 && r.status !== 429).length;

    // Clear console and print current status
    process.stdout.write(`\r✅ ${success} OK | ⛔ ${rateLimited} RL | ❌ ${errors} Err   `);
  }, 1000);
}

runChaos();
