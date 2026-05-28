import { DocumentDataType } from '@prisma/client';
import { base64 } from '@scure/base';
import { match } from 'ts-pattern';

export type GetFileOptions = {
  type: DocumentDataType;
  data: string;
};

export const getFile = async ({ type, data }: GetFileOptions) => {
  return await match(type)
    .with(DocumentDataType.BYTES, () => getFileFromBytes(data))
    .with(DocumentDataType.BYTES_64, () => getFileFromBytes64(data))
    .with(DocumentDataType.S3_PATH, async () => getFileFromS3(data))
    .exhaustive();
};

const getFileFromBytes = (data: string) => {
  const encoder = new TextEncoder();

  const binaryData = encoder.encode(data);

  return binaryData;
};

const getFileFromBytes64 = (data: string) => {
  const binaryData = base64.decode(data);

  return binaryData;
};

const getPresignedUrlForS3 = async (key: string): Promise<string> => {
  const getPresignedUrlResponse = await fetch(`/api/files/presigned-get-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      key,
    }),
  });

  if (!getPresignedUrlResponse.ok) {
    throw new Error(
      `Failed to get presigned url with key "${key}", failed with status code ${getPresignedUrlResponse.status}`,
    );
  }

  const { url } = await getPresignedUrlResponse.json();

  return url;
};

const getFileFromS3 = async (key: string) => {
  const url = await getPresignedUrlForS3(key);

  const response = await fetch(url, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`Failed to get file "${key}", failed with status code ${response.status}`);
  }

  const buffer = await response.arrayBuffer();

  const binaryData = new Uint8Array(buffer);

  return binaryData;
};

export type FileSource = { kind: 'bytes'; bytes: Uint8Array } | { kind: 'url'; url: string };

// Like getFile, but for S3-backed documents returns the presigned URL instead of
// downloading the whole file. Lets pdfjs stream via HTTP Range, which is required
// to keep iOS Safari iframes under the per-iframe memory cap for large PDFs.
export const getFileSource = async ({ type, data }: GetFileOptions): Promise<FileSource> => {
  return await match(type)
    .with(DocumentDataType.BYTES, () => ({ kind: 'bytes' as const, bytes: getFileFromBytes(data) }))
    .with(DocumentDataType.BYTES_64, () => ({
      kind: 'bytes' as const,
      bytes: getFileFromBytes64(data),
    }))
    .with(DocumentDataType.S3_PATH, async () => ({
      kind: 'url' as const,
      url: await getPresignedUrlForS3(data),
    }))
    .exhaustive();
};
