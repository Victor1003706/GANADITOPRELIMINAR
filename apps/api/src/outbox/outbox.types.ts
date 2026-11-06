export type OutboxStatus = 'PENDIENTE' | 'PROCESANDO' | 'PROCESADO' | 'DLQ';

export interface OutboxEventRecord {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: any;
  status: OutboxStatus;
  retry_count: number;
  max_retries: number;
  next_retry_at: string | Date | null;
  lease_worker_id: string | null;
  lease_expires_at: string | Date | null;
  fencing_token: number;
  last_error: string | null;
  created_at: string | Date;
}

export interface OutboxBatchResult {
  totalLeidos: number;
  procesados: number;
  fallidos: number;
  dlq: number;
  fenced: number;
}

export interface RedisPublisherLike {
  publish(channel: string, message: string): Promise<number>;
}
