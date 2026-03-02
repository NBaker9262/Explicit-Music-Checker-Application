const DJ_TOKEN_KEY = 'dance_dj_token';

function getAdminToken() {
  return localStorage.getItem(DJ_TOKEN_KEY) || '';
}

function setAdminToken(token) {
  if (!token) {
    localStorage.removeItem(DJ_TOKEN_KEY);
    return;
  }
  localStorage.setItem(DJ_TOKEN_KEY, token);
}

function clearAdminToken() {
  localStorage.removeItem(DJ_TOKEN_KEY);
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

window.djAuth = {
  getAdminToken,
  setAdminToken,
  clearAdminToken,
  adminFetch
};

// Backward compatibility for older scripts still referencing adminAuth.
window.adminAuth = window.djAuth;
