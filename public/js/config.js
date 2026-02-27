(() => {
  const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  window.APP_CONFIG = window.APP_CONFIG || {
    apiBaseUrl: isLocalHost ? '' : 'https://music-queue-api.noahmathmaster.workers.dev'
  };
})();
