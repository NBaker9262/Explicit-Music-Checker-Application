const adminLoginForm = document.getElementById('adminLoginForm');
const adminLoginStatus = document.getElementById('adminLoginStatus');

function setStatus(message, isError = false) {
  adminLoginStatus.textContent = message;
  adminLoginStatus.className = `status-message${isError ? ' error' : ''}`;
}

async function checkExistingSession() {
  const token = window.djAuth.getAdminToken();
  if (!token) return;

  try {
    const response = await window.djAuth.adminFetch('/api/dj/session');
    if (response.ok) {
      window.location.href = '/dj/dashboard.html';
    } else {
      window.djAuth.clearAdminToken();
    }
  } catch {
    window.djAuth.clearAdminToken();
  }
}

adminLoginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const username = document.getElementById('adminUsername').value.trim();
  const password = document.getElementById('adminPassword').value;

  if (!username || !password) {
    setStatus('Username and password are required.', true);
    return;
  }

  setStatus('Signing in...');

  try {
    const response = await fetch(window.appApi.buildApiUrl('/api/dj/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Sign in failed');
    }

    window.djAuth.setAdminToken(payload.token);
    setStatus('DJ sign-in successful. Redirecting...');
    setTimeout(() => {
      window.location.href = '/dj/dashboard.html';
    }, 350);
  } catch (error) {
    setStatus(error.message || 'Sign in failed.', true);
  }
});

checkExistingSession();
