import { randomUUID } from "node:crypto"
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { env } from "@repo/env/server"

const s3Client = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
})

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_")
}

// One key per version, minted independently of the version number so blob
// upload and version-row commit can't race over naming.
export function artifactBlobKey(
  workspaceId: string,
  artifactId: string,
  filename: string
): string {
  return `artifacts/${workspaceId}/${artifactId}/${randomUUID()}/${sanitizeFilename(filename)}`
}

export function artifactPublicUrl(blobKey: string): string {
  return `${env.S3_PUBLIC_URL}/${blobKey}`
}

export async function putArtifactObject(
  blobKey: string,
  body: Uint8Array,
  contentType: string
): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET_NAME,
      Key: blobKey,
      Body: body,
      ContentType: contentType,
      ContentLength: body.byteLength,
    })
  )
}
