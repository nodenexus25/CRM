import { randomUUID } from 'node:crypto';

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ServiceUnavailableError } from '@/common/errors/domain-errors';
import type { AppConfig } from '@/config/configuration';

export interface UploadObjectInput {
  key: string;
  body: Buffer | Uint8Array | string;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface StoredObject {
  key: string;
  url: string;
  size: number;
}

/**
 * S3-compatible object storage (MinIO locally, S3/R2 in production).
 *
 * The bucket is created on boot when missing, so a fresh `docker compose up`
 * needs no manual provisioning step.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;
  private readonly signedUrlTtl: number;

  constructor(config: ConfigService<AppConfig, true>) {
    const storage = config.get('storage', { infer: true });

    this.bucket = storage.bucket;
    this.publicUrl = storage.publicUrl.replace(/\/$/, '');
    this.signedUrlTtl = storage.signedUrlTtl;

    this.client = new S3Client({
      endpoint: storage.endpoint,
      region: storage.region,
      forcePathStyle: storage.forcePathStyle,
      credentials: {
        accessKeyId: storage.accessKey,
        secretAccessKey: storage.secretKey,
      },
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureBucket();
    } catch (error) {
      // Storage being unreachable must not stop the API from booting — file
      // uploads degrade, the rest of the product keeps working.
      this.logger.error(
        `Object storage is not reachable at boot: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Creates the configured bucket when it does not exist yet. Idempotent. */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Storage bucket "${this.bucket}" is ready`);
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Created storage bucket "${this.bucket}"`);
    }
  }

  /** Namespaced, collision-proof key: `{prefix}/{tenantId}/{uuid}-{name}`. */
  buildKey(prefix: string, tenantId: string, fileName: string): string {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
    return `${prefix}/${tenantId}/${randomUUID()}-${safeName}`;
  }

  async upload(input: UploadObjectInput): Promise<StoredObject> {
    const body = typeof input.body === 'string' ? Buffer.from(input.body, 'utf8') : input.body;

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          Body: body,
          ContentType: input.contentType,
          Metadata: input.metadata,
        }),
      );
    } catch (error) {
      throw new ServiceUnavailableError(
        'File storage is temporarily unavailable. Please try again.',
        error,
      );
    }

    return { key: input.key, url: `${this.publicUrl}/${this.bucket}/${input.key}`, size: body.byteLength };
  }

  async download(key: string): Promise<Buffer> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const stream = response.Body;
    if (!stream) return Buffer.alloc(0);

    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /**
   * Metadata-only probe, used to verify an object that a client uploaded
   * straight to storage with a presigned `PUT`: the API never saw the bytes, so
   * it has to ask storage what actually landed.
   */
  async describeObject(key: string): Promise<{ size: number; contentType?: string }> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: head.ContentLength ?? 0, contentType: head.ContentType };
    } catch (error) {
      throw new ServiceUnavailableError(
        'The uploaded file could not be verified. Please upload it again.',
        error,
      );
    }
  }

  /** Reads the first `bytes` bytes of an object — enough for a magic-byte check. */
  async readPrefix(key: string, bytes: number): Promise<Buffer> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: `bytes=0-${Math.max(bytes, 1) - 1}`,
        }),
      );
      const stream = response.Body;
      if (!stream) return Buffer.alloc(0);

      const chunks: Buffer[] = [];
      for await (const chunk of stream as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch (error) {
      throw new ServiceUnavailableError(
        'The uploaded file could not be verified. Please upload it again.',
        error,
      );
    }
  }

  /** Time-limited download link, used for resumes and attachments. */
  async getSignedUrl(key: string, ttlSeconds = this.signedUrlTtl): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: ttlSeconds,
    });
  }

  /**
   * Time-limited upload link letting a browser `PUT` a file straight into
   * storage without proxying the bytes through the API. The content type is
   * baked into the signature so the object cannot be re-typed after the fact.
   */
  async getSignedPutUrl(
    key: string,
    contentType: string,
    ttlSeconds = this.signedUrlTtl,
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: ttlSeconds },
    );
  }

  /** Name of the configured bucket — used by tests that talk to storage directly. */
  get bucketName(): string {
    return this.bucket;
  }

  /** Public URL — only meaningful when the bucket is public-read. */
  getPublicUrl(key: string): string {
    return `${this.publicUrl}/${this.bucket}/${key}`;
  }
}
