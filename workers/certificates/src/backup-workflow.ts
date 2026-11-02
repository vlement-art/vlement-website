import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers';

interface BackupEnv {
  ACCOUNT_ID: string;
  DATABASE_ID: string;
  BUCKET: R2Bucket;
  D1_REST_API_TOKEN: string;
}

interface D1ExportResult {
  at_bookmark?: string;
  error?: string;
  result?: {
    filename?: string;
    signed_url?: string;
  };
  status?: 'complete' | 'error';
}

interface D1ExportResponse {
  errors?: Array<{ message?: string }>;
  result?: D1ExportResult;
  success?: boolean;
}

const backupPrefix = 'backups/vlement-certificates-prod-';
const backupKeyPattern = /^backups\/vlement-certificates-prod-(\d{4}-\d{2}-\d{2})\.sql$/;
const d1ExportUrl = (accountId: string, databaseId: string) =>
  `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/export`;

async function requestExport(
  url: string,
  token: string,
  body: { output_format: 'polling'; current_bookmark?: string },
): Promise<D1ExportResult> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  let payload: D1ExportResponse;
  try {
    payload = await response.json() as D1ExportResponse;
  } catch {
    throw new Error(`D1 export API returned invalid JSON (HTTP ${response.status}).`);
  }

  if (!response.ok || payload.success === false) {
    const message = payload.errors?.map(error => error.message).filter(Boolean).join('; ');
    throw new Error(message || `D1 export API request failed (HTTP ${response.status}).`);
  }
  if (!payload.result) throw new Error('D1 export API response did not include a result.');
  if (payload.result.status === 'error') {
    throw new Error(payload.result.error || 'D1 export failed.');
  }
  return payload.result;
}

export class D1BackupWorkflow extends WorkflowEntrypoint<BackupEnv> {
  override async run(event: WorkflowEvent<unknown>, step: WorkflowStep): Promise<{ key: string }> {
    const scheduledAt = event.schedule?.scheduledTime ?? event.timestamp.getTime();
    const date = new Date(scheduledAt).toISOString().slice(0, 10);
    const backupKey = `${backupPrefix}${date}.sql`;
    const exportUrl = d1ExportUrl(this.env.ACCOUNT_ID, this.env.DATABASE_ID);

    const initial = await step.do('Start D1 SQL export', () => requestExport(
      exportUrl,
      this.env.D1_REST_API_TOKEN,
      { output_format: 'polling' },
    ));
    if (!initial.at_bookmark) throw new Error('D1 export API did not return an export bookmark.');

    let exportResult = initial;
    let pollNumber = 0;
    while (!exportResult.result?.signed_url) {
      if (exportResult.status === 'error') {
        throw new Error(exportResult.error || 'D1 export failed.');
      }
      if (exportResult.status === 'complete') {
        throw new Error('D1 export completed without a signed download URL.');
      }
      pollNumber += 1;
      await step.sleep(`Wait before D1 export poll ${pollNumber}`, '10 seconds');
      exportResult = await step.do(`Poll D1 export ${pollNumber}`, () => requestExport(
        exportUrl,
        this.env.D1_REST_API_TOKEN,
        {
          output_format: 'polling',
          current_bookmark: initial.at_bookmark,
        },
      ));
    }

    const signedUrl = exportResult.result.signed_url;
    await step.do('Save SQL dump to R2', async () => {
      const dumpResponse = await fetch(signedUrl);
      if (!dumpResponse.ok) {
        throw new Error(`Could not download D1 SQL export (HTTP ${dumpResponse.status}).`);
      }
      if (!dumpResponse.body) throw new Error('D1 SQL export response did not include a file body.');

      await this.env.BUCKET.put(backupKey, dumpResponse.body, {
        httpMetadata: { contentType: 'application/sql; charset=utf-8' },
        customMetadata: {
          databaseId: this.env.DATABASE_ID,
          exportedAt: new Date(scheduledAt).toISOString(),
          sourceFilename: exportResult.result?.filename || 'D1 export',
        },
      });
    });

    await step.do('Prune backups older than the 30 most recent', async () => {
      const backups: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await this.env.BUCKET.list({
          prefix: backupPrefix,
          limit: 1000,
          ...(cursor ? { cursor } : {}),
        });
        for (const object of page.objects) {
          if (backupKeyPattern.test(object.key)) backups.push(object.key);
        }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);

      backups.sort((left, right) => right.localeCompare(left));
      const expired = backups.slice(30);
      if (expired.length) await this.env.BUCKET.delete(expired);
      return { retained: Math.min(backups.length, 30), deleted: expired.length };
    });

    return { key: backupKey };
  }
}
