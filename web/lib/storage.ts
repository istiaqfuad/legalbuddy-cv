import { randomUUID } from "crypto";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let cached: S3Client | null = null;

/** S3-compatible client for Neon Object Storage. Credentials come from the
 * standard AWS env chain; only `forcePathStyle` is Neon-specific. */
export function getStorage(): S3Client {
  if (cached) return cached;
  cached = new S3Client({ forcePathStyle: true });
  return cached;
}

export function bucket(): string {
  const name = process.env.S3_BUCKET;
  if (!name) throw new Error("S3_BUCKET is not set.");
  return name;
}

/** Store a private Sanad scan; returns the object key recorded in Postgres. */
export async function uploadSanad(
  userId: string,
  filename: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "sanad";
  const key = `lawyer-sanads/${userId}/${randomUUID()}-${safe}`;
  await getStorage().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return key;
}

/** Short-lived read URL for review; never expose keys or bucket layout. */
export async function sanadUrl(key: string, expiresIn = 900): Promise<string> {
  return getSignedUrl(
    getStorage(),
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
    { expiresIn },
  );
}
