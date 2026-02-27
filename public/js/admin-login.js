const adminLoginForm = document.getElementById('adminLoginForm');
const adminLoginStatus = document.getElementById('adminLoginStatus');

function setStatus(message, isError = false) {
  adminLoginStatus.textContent = message;
  adminLoginStatus.className = `status-message${isError ? ' error' : ''}`;
}

async function checkExistingSession() {
  const token = window.adminAuth.getAdminToken();
  if (!token) return;

  try {
    const response = await window.adminAuth.adminFetch('/api/admin/session');
    if (response.ok) {
      window.location.href = '/admin/dashboard.html';
    } else {
      window.adminAuth.clearAdminToken();
    }
  } catch {
    window.adminAuth.clearAdminToken();
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
    const response = await fetch(window.appApi.buildApiUrl('/api/admin/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Login failed');
    }

    window.adminAuth.setAdminToken(payload.token);
    setStatus('Login successful. Redirecting...');
    setTimeout(() => {
      window.location.href = '/admin/dashboard.html';
    }, 350);
  } catch (error) {
    setStatus(error.message || 'Login failed.', true);
  }
});

checkExistingSession();
