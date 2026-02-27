const API_BASE_URL = String(window.APP_CONFIG?.apiBaseUrl || '').trim();

function buildApiUrl(path) {
  const normalizedPath = String(path || '').startsWith('/') ? String(path || '') : `/${String(path || '')}`;

  if (!API_BASE_URL) {
    return normalizedPath;
  }

  const base = API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  return `${base}${normalizedPath}`;
}

window.appApi = {
  buildApiUrl
};
