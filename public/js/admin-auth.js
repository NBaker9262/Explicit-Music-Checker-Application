const ADMIN_TOKEN_KEY = 'dance_admin_token';

function getAdminToken() {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY) || '';
}

function setAdminToken(token) {
  if (!token) {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    return;
  }
  sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
}

function clearAdminToken() {
  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
}

async function adminFetch(path, options = {}) {
  const token = getAdminToken();
  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set('Authorization', `Basic ${token}`);
  }

  return fetch(window.appApi.buildApiUrl(path), {
    ...options,
    headers
  });
}

window.adminAuth = {
  getAdminToken,
  setAdminToken,
  clearAdminToken,
  adminFetch
};
