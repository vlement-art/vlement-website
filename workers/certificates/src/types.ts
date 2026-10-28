export interface Env {
  DB: D1Database;
  CERTIFICATE_FILES: R2Bucket;
  VERIFY_LIMITER: RateLimit;
  ALLOWED_GITHUB_USER_ID?: string;
  ALLOWED_ORIGIN: string;
  ARTWORK_REPOSITORY: string;
}

export interface ArtworkSnapshot {
  slug: string;
  title: string;
  year: number;
  medium: string;
  support?: string;
  dimensions: string;
  editionType?: 'original' | 'limited' | 'open';
  editionSize?: number;
  printDate?: string;
  signed?: boolean;
  image: string;
  altText?: string;
}

export interface IssueRequest {
  artwork: ArtworkSnapshot;
  certificateType: CertificateType;
  editionNumber?: number;
  editionSize?: number;
}

export type CertificateType = 'original' | 'limited_edition' | 'open_edition';
