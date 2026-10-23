import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@/lib/env";

export interface StoredFile {
  data: Buffer;
  contentType: string;
}

export interface StorageService {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredFile | null>;
}

/** Reject empty keys, absolute paths and `..` segments so tenants cannot escape their prefix. */
export function assertSafeStorageKey(key: string): string {
  const normalized = key.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
  if (!normalized || normalized.endsWith("/")) throw new Error("Invalid storage key");
  const parts = normalized.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) throw new Error("Invalid storage key");
  return normalized;
}

function guessContentType(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

class LocalStorage implements StorageService {
  constructor(private readonly root: string) {}

  private paths(key: string) {
    const safe = assertSafeStorageKey(key);
    const file = path.resolve(this.root, ...safe.split("/"));
    const rootResolved = path.resolve(this.root);
    if (file !== rootResolved && !file.startsWith(rootResolved + path.sep)) {
      throw new Error("Invalid storage key");
    }
    return { file, meta: `${file}.meta.json` };
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    const { file, meta } = this.paths(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
    await writeFile(meta, JSON.stringify({ contentType }), "utf8");
  }

  async get(key: string): Promise<StoredFile | null> {
    const { file, meta } = this.paths(key);
    try {
      const data = await readFile(file);
      let contentType = guessContentType(key);
      try {
        const parsed = JSON.parse(await readFile(meta, "utf8")) as { contentType?: string };
        if (parsed.contentType) contentType = parsed.contentType;
      } catch {
        /* missing sidecar is fine; fall back to extension */
      }
      return { data, contentType };
    } catch {
      return null;
    }
  }
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  const maybe = body as { transformToByteArray?: () => Promise<Uint8Array> };
  if (typeof maybe.transformToByteArray === "function") {
    return Buffer.from(await maybe.transformToByteArray());
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

class S3Storage implements StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const s3 = env.s3;
    if (!s3.bucket) throw new Error("S3_BUCKET must be set when STORAGE_DRIVER=s3");
    this.bucket = s3.bucket;
    this.client = new S3Client({
      region: s3.region || "auto",
      endpoint: s3.endpoint || undefined,
      forcePathStyle: s3.forcePathStyle,
      credentials:
        s3.accessKeyId && s3.secretAccessKey
          ? { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey }
          : undefined,
    });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    const safe = assertSafeStorageKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: safe,
        Body: data,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<StoredFile | null> {
    const safe = assertSafeStorageKey(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: safe }));
      const data = await bodyToBuffer(res.Body);
      return { data, contentType: res.ContentType || guessContentType(safe) };
    } catch (e) {
      const name = (e as { name?: string }).name;
      const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (name === "NoSuchKey" || name === "NotFound" || status === 404) return null;
      throw e;
    }
  }
}

let cached: StorageService | null = null;

/** Local filesystem or S3-compatible object storage. Keys are always business-scoped by callers. */
export function getStorage(): StorageService {
  if (cached) return cached;
  cached = env.storageDriver === "s3" ? new S3Storage() : new LocalStorage(env.storageLocalDir);
  return cached;
}

/** Test helper: drop the process-wide singleton so a later getStorage() re-reads env. */
export function resetStorageCache(): void {
  cached = null;
}
