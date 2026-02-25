const API_BASE_URL = window.APP_CONFIG?.apiBaseUrl || '';

function buildApiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

window.appApi = {
  buildApiUrl
};
