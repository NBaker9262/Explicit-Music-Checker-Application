(() => {
  const existingBaseUrl = String(window.APP_CONFIG?.apiBaseUrl || '').trim();
  if (existingBaseUrl) return;

  const host = String(window.location.hostname || '').toLowerCase();
  const isApiWorkerHost = host === 'music-queue-api.noahmathmaster.workers.dev' || host.startsWith('music-queue-api.');
  const useSameOrigin = (
    host === 'localhost'
    || host === '127.0.0.1'
    || host.endsWith('.app.github.dev')
    || host.endsWith('.githubpreview.dev')
    || isApiWorkerHost
  );

  // Use same-origin for local/Codespaces and the API worker host.
  // Frontend-only workers/pages should call the dedicated API worker domain.
  window.APP_CONFIG = {
    ...(window.APP_CONFIG || {}),
    apiBaseUrl: useSameOrigin ? '' : 'https://music-queue-api.noahmathmaster.workers.dev'
  };
})();
