(() => {
  const REPOSITORY = 'vlement-art/vlement-website';
  const WORKFLOW = 'backup.yml';
  const POLL_INTERVAL_MS = 10_000;
  const MAX_POLL_DURATION_MS = 20 * 60 * 1000;
  let active = false;
  let downloadUrl = null;

  const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

  function showBackupBanner(message, type = 'info', link = null) {
    showBanner('Backup status', type, 0);
    const banner = document.querySelector('#banner-area .status-banner');
    banner.textContent = message;
    if (link) {
      const anchor = document.createElement('a');
      const safeUrl = trustedRunUrl(link.href);
      if (!safeUrl && !link.download) return;
      anchor.href = safeUrl || link.href;
      anchor.textContent = link.label;
      anchor.style.marginLeft = '8px';
      if (link.download) {
        anchor.download = link.download;
      } else {
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
      }
      banner.append(' ', anchor);
    }
  }

  function trustedRunUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:'
        && url.hostname === 'github.com'
        && /^\/vlement-art\/vlement-website\/actions\/runs\/\d+$/.test(url.pathname)) {
        return url.href;
      }
    } catch {
      return null;
    }
    return null;
  }

  function setProgress(button, status) {
    button.textContent = status === 'queued'
      ? 'Backup queued…'
      : status === 'running'
        ? 'Backup running…'
        : status === 'done'
          ? 'Backup done'
          : status === 'failed'
            ? 'Backup failed'
            : 'Back up everything';
  }

  async function githubRequest(path, token, options = {}) {
    return fetch(`https://api.github.com/repos/${REPOSITORY}${path}`, {
      ...options,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
  }

  async function downloadArtifact(run, token) {
    try {
      const response = await githubRequest(
        `/actions/runs/${run.id}/artifacts`,
        token,
      );
      if (!response.ok) return null;
      const result = await response.json();
      const artifact = result.artifacts?.find(item =>
        item.name.startsWith('vlement-backup-') && !item.expired,
      );
      if (!artifact) return null;
      const archiveUrl = new URL(artifact.archive_download_url);
      if (archiveUrl.protocol !== 'https:'
        || archiveUrl.hostname !== 'api.github.com'
        || !/^\/repos\/vlement-art\/vlement-website\/actions\/artifacts\/\d+\/zip$/.test(archiveUrl.pathname)) {
        return null;
      }

      const archive = await fetch(archiveUrl.href, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!archive.ok) return null;
      const blob = await archive.blob();
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      downloadUrl = URL.createObjectURL(blob);
      return {
        href: downloadUrl,
        label: 'Done, download',
        download: `vlement-backup-artifact-${run.id}.zip`,
      };
    } catch {
      return null;
    }
  }

  async function startBackup(button) {
    if (active) return;
    if (!confirm('Create an encrypted backup of the repository, certificate database, and configured R2 files?')) {
      return;
    }

    const token = window.VlementAdmin?.getToken();
    if (!token) {
      showBackupBanner('Sign in again before starting a backup.', 'error');
      return;
    }

    active = true;
    button.disabled = true;
    setProgress(button, 'queued');
    showBackupBanner('Backup queued. Waiting for GitHub Actions…');
    const clickedAt = Math.floor(Date.now() / 1000) * 1000;

    try {
      let dispatch;
      try {
        dispatch = await githubRequest(`/actions/workflows/${WORKFLOW}/dispatches`, token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ref: 'main' }),
        });
      } catch {
        throw new Error('Could not reach GitHub to start the backup. Check your connection and try again.');
      }

      if (dispatch.status === 401 || dispatch.status === 403) {
        throw new Error('GitHub denied workflow dispatch. Your sign-in token may lack permission, or the workflow file may be missing on main.');
      }
      if (dispatch.status === 404) {
        throw new Error('GitHub could not find backup.yml on main. Merge the backup workflow before starting a backup.');
      }
      if (dispatch.status !== 204) {
        throw new Error(`GitHub could not start the backup (HTTP ${dispatch.status}).`);
      }

      const deadline = Date.now() + MAX_POLL_DURATION_MS;
      let run = null;
      while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);
        const response = await githubRequest(
          `/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=5`,
          token,
        );
        if (response.status === 401 || response.status === 403) {
          throw new Error('GitHub denied access to workflow status. Your sign-in token needs Actions read permission.');
        }
        if (!response.ok) {
          throw new Error(`Could not check the backup status (HTTP ${response.status}).`);
        }
        const result = await response.json();
        run = result.workflow_runs?.find(item =>
          new Date(item.created_at).getTime() >= clickedAt,
        ) || null;

        if (!run) {
          setProgress(button, 'queued');
          showBackupBanner('Backup queued. Waiting for GitHub Actions…');
          continue;
        }

        if (run.status !== 'completed') {
          const queued = ['queued', 'waiting', 'pending'].includes(run.status);
          setProgress(button, queued ? 'queued' : 'running');
          showBackupBanner(queued
            ? 'Backup queued. Waiting for GitHub Actions…'
            : 'Backup running. This can take several minutes…');
          continue;
        }

        if (run.conclusion !== 'success') {
          setProgress(button, 'failed');
          showBackupBanner(`Backup failed (${run.conclusion || 'unknown'}). Open the run to see its logs.`, 'error', {
            href: run.html_url,
            label: 'View run',
          });
          return;
        }

        setProgress(button, 'done');
        const artifactLink = await downloadArtifact(run, token);
        showBackupBanner('Backup completed successfully.', 'info', artifactLink || {
          href: run.html_url,
          label: 'Done, download',
        });
        return;
      }

      setProgress(button, 'failed');
      showBackupBanner('Backup status timed out after 20 minutes. Check the Actions run page.', 'error');
    } catch (error) {
      setProgress(button, 'failed');
      showBackupBanner(error.message, 'error');
    } finally {
      active = false;
      button.disabled = false;
      if (button.textContent !== 'Backup done' && button.textContent !== 'Backup failed') {
        setProgress(button, '');
      }
    }
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('#backup-everything-btn');
    if (button) startBackup(button);
  });
})();
