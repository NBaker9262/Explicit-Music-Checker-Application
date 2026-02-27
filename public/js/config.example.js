(() => {
  const host = window.location.hostname;
  const isLocalHost = host === 'localhost' || host === '127.0.0.1';

  window.APP_CONFIG = {
    apiBaseUrl: isLocalHost ? '' : 'https://your-worker-name.your-subdomain.workers.dev'
  };
})();
