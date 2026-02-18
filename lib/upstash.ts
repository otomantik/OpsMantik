import { Redis } from '@upstash/redis';
import { logError } from '@/lib/logging/logger';

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  logError('UPSTASH redis credentials missing in environment variables');
}

function missingCredsError(): Error {
  return new Error('upstash_missing_credentials');
}

type FailingPipeline = {
  hincrby: () => FailingPipeline;
  hincrbyfloat: () => FailingPipeline;
  hset: () => FailingPipeline;
  expire: () => FailingPipeline;
  pexpire: () => FailingPipeline;
  incr: () => FailingPipeline;
  exec: () => Promise<never>;
};

function makeFailingPipeline(): FailingPipeline {
  const chain = (): FailingPipeline => self;
  const self: FailingPipeline = {
    hincrby: chain,
    hincrbyfloat: chain,
    hset: chain,
    expire: chain,
    pexpire: chain,
    incr: chain,
    exec: async () => {
      throw missingCredsError();
    },
  };
  return self;
}

// Avoid constructing Upstash client with empty config (it emits noisy warnings).
export const redis: Redis = url && token
  ? new Redis({ url, token })
  : (({
    incr: async () => {
      throw missingCredsError();
    },
    pexpire: async () => {
      throw missingCredsError();
    },
    pttl: async () => {
      throw missingCredsError();
    },
    pipeline: () => makeFailingPipeline(),
  } as unknown) as Redis);
