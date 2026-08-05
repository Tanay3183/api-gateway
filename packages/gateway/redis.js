/**
 * Redis "Shared Brain" Client
 * 
 * Manages the singleton connection to Redis and executes Lua scripts
 * for high-performance, atomic rate limiting (GCRA algorithm).
 */
import Redis from 'ioredis';

const redis = new Redis();

const gcraScript = `
  local rate_limit_key = KEYS[1]
  local burst = tonumber(ARGV[1])
  local emission_interval = tonumber(ARGV[2])
  local current_time = tonumber(ARGV[3])

  local tat = redis.call('GET', rate_limit_key)
  if not tat then
    tat = current_time
  else
    tat = tonumber(tat)
  end

  tat = math.max(tat, current_time)

  local new_tat = tat + emission_interval
  local allow_at = new_tat - (burst * emission_interval)

  if allow_at > current_time then
    local retry_after = math.ceil((allow_at - current_time) / 1000)
    return {0, retry_after}
  end

  redis.call('SET', rate_limit_key, new_tat, 'EX', math.ceil((new_tat - current_time) / 1000) + 1)
  return {1, 0}
`;

redis.defineCommand('gcraRateLimit', {
  numberOfKeys: 1,
  lua: gcraScript,
});

export default redis;
