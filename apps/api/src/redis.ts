import { Redis, type RedisOptions } from 'ioredis';

let publisherInstance: Redis | null = null;
let subscriberInstance: Redis | null = null;

export interface RedisConfig {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
}

export function getRedisConfig(): RedisConfig {
  if (process.env.REDIS_URL) {
    return {
      url: process.env.REDIS_URL
    };
  }

  if (process.env.NODE_ENV === 'production' && !process.env.REDIS_PASSWORD) {
    throw new Error('En producción se requiere REDIS_URL o REDIS_PASSWORD.');
  }
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || undefined
  };
}

export function createRedisClient(
  configOverride?: RedisConfig,
  extraOptions?: RedisOptions
): Redis {
  const config = configOverride ?? getRedisConfig();
  const defaultOpts: RedisOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
    retryStrategy(times: number) {
      return Math.min(times * 100, 3000);
    },
    ...extraOptions
  };

  const client = config.url
    ? new Redis(config.url, defaultOpts)
    : new Redis({
        host: config.host ?? 'localhost',
        port: config.port ?? 6379,
        password: config.password,
        ...defaultOpts
      });

  client.on('error', (err: Error) => {
    // Registro preventivo de error de red o desconexión en Redis
    console.error('[Redis Client Error]:', err.message);
  });

  return client;
}

export function getRedisPublisher(configOverride?: RedisConfig): Redis {
  if (!publisherInstance) {
    publisherInstance = createRedisClient(configOverride);
  }
  return publisherInstance;
}

export function getRedisSubscriber(configOverride?: RedisConfig): Redis {
  if (!subscriberInstance) {
    subscriberInstance = createRedisClient(configOverride);
  }
  return subscriberInstance;
}

export async function closeRedis(): Promise<void> {
  const promises: Promise<unknown>[] = [];

  if (publisherInstance) {
    const pub = publisherInstance;
    publisherInstance = null;
    promises.push(
      pub.quit().catch(() => {
        pub.disconnect();
      })
    );
  }

  if (subscriberInstance) {
    const sub = subscriberInstance;
    subscriberInstance = null;
    promises.push(
      sub.quit().catch(() => {
        sub.disconnect();
      })
    );
  }

  await Promise.all(promises);
}
