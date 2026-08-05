import Redis from 'ioredis';

const redis = new Redis(); // defaults to localhost:6379

// GCRA Lua Script
// KEYS[1]: Rate limit key (e.g., 'rate_limit:ip:127.0.0.1')
// ARGV[1]: Burst capacity
// ARGV[2]: Emission interval in milliseconds
// ARGV[3]: Current time in milliseconds
const GCRA_LUA = `
local key = KEYS[1]
local burst = tonumber(ARGV[1])
local emission_interval = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local tat = redis.call('GET', key)
if not tat then
  tat = now
else
  tat = tonumber(tat)
end

local new_tat = math.max(tat, now) + emission_interval
local allow_at = new_tat - (burst * emission_interval)

if now < allow_at then
  return { 0, tostring(math.ceil((allow_at - now) / 1000)) } -- Rejected, return Retry-After in seconds
end

redis.call('SET', key, new_tat, 'PX', math.max(new_tat - now, emission_interval))
return { 1, "0" } -- Allowed
`;

redis.defineCommand('gcraRateLimit', {
  numberOfKeys: 1,
  lua: GCRA_LUA,
});

export default redis;
