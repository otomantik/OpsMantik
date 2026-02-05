import { Redis } from '@upstash/redis';
import { logger } from '@/lib/logging/logger';

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  logger.warn('UPSTASH redis credentials missing in environment variables');
}

function missingCredsError(): Error {
  return new Error('upstash_missing_credentials');
}

function makeFailingPipeline() {
  // Minimal chainable pipeline stub to satisfy typing in build-time checks.
  const self: any = {};
  const chain = () => self;
  self.hincrby = chain;
  self.hincrbyfloat = chain;
  self.hset = chain;
  self.expire = chain;
  self.pexpire = chain;
  self.incr = chain;
  self.exec = async () => {
    throw missingCredsError();
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
