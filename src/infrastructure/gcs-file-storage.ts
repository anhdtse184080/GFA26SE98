import { Storage, type Bucket } from '@google-cloud/storage';
import type { FileStorage } from '../common/ports/file-storage.js';

/** Mã lỗi HTTP GCS trả về khi object không tồn tại. */
const NOT_FOUND = 404;

/** Google Cloud Storage, bucket private: không cấp URL công khai, mọi lượt tải đi qua API. */
export class GcsFileStorage implements FileStorage {
  private readonly bucket: Bucket;

  /** `credentials`:  (JSON key của service accountđã giải mã từ `GCS_CREDENTIALS_BASE64`). */
  constructor(bucketName: string, credentials: GcsCredentials) {
    this.bucket = new Storage({
      projectId: credentials.project_id,
      credentials,
    }).bucket(bucketName);
  }

  async save(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.bucket.file(key).save(data, {
      contentType,
      resumable: false,
      metadata: { cacheControl: 'private, max-age=0' },
    });
  }

  async read(key: string): Promise<Buffer | null> {
    try {
      const [data] = await this.bucket.file(key).download();
      return data;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.bucket.file(key).delete({ ignoreNotFound: true });
  }
}

export interface GcsCredentials {
  client_email: string;
  private_key: string;
  project_id?: string;
}

/**
 * Giải mã `GCS_CREDENTIALS_BASE64` (JSON key service account mã hóa base64).
 * Sai định dạng → `null` (env validation báo lỗi, không in giá trị bí mật).
 */
export function decodeGcsCredentials(base64: string): GcsCredentials | null {
  try {
    const json: unknown = JSON.parse(
      Buffer.from(base64.trim(), 'base64').toString('utf8'),
    );
    if (typeof json !== 'object' || json === null) return null;
    const { client_email, private_key } = json as Record<string, unknown>;
    if (typeof client_email !== 'string' || typeof private_key !== 'string') {
      return null;
    }
    return json as GcsCredentials;
  } catch {
    return null;
  }
}

function isNotFound(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === NOT_FOUND;
}
