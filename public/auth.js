const AUTH_TOKEN_KEY = 'pharma_auth_token';
const AUTH_USER_KEY = 'pharma_auth_user';

window.authSession = {
  token: localStorage.getItem(AUTH_TOKEN_KEY) || '',
  user: JSON.parse(localStorage.getItem(AUTH_USER_KEY) || 'null')
};

function authHeaders(base = {}) {
  if (window.authSession.token) {
    return { ...base, Authorization: `Bearer ${window.authSession.token}` };
  }
  return base;
}

function saveSession(token, user) {
  window.authSession.token = token;
  window.authSession.user = user;
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
}

function clearSession() {
  window.authSession.token = '';
  window.authSession.user = null;
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
}

async function authRequest(path, options = {}) {
  const response = await fetch(`${window.location.origin}/api${path}`, {
    ...options,
    headers: authHeaders({ 'Content-Type': 'application/json', ...(options.headers || {}) })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || 'Authentication request failed');
  return payload?.data ?? payload;
}

function renderLoginGate() {
  const gate = document.createElement('div');
  gate.id = 'auth-gate';
  gate.style.cssText = 'position:fixed;inset:0;background:#0b1324;z-index:9999;display:flex;align-items:center;justify-content:center;';
  gate.innerHTML = `
    <form id="auth-login-form" style="background:#fff;padding:24px;border-radius:10px;min-width:320px;box-shadow:0 12px 30px rgba(0,0,0,.2);">
      <h3 style="margin:0 0 12px;">Sign In</h3>
      <input id="auth-username" placeholder="Username" required style="width:100%;margin-bottom:10px;padding:10px;">
      <input id="auth-password" placeholder="Password" type="password" required style="width:100%;margin-bottom:10px;padding:10px;">
      <button type="submit" style="width:100%;padding:10px;background:#1e3a8a;color:#fff;border:none;border-radius:6px;">Login</button>
      <p id="auth-error" style="color:#dc2626;margin:10px 0 0;font-size:13px;"></p>
    </form>
  `;
  document.body.appendChild(gate);
  document.getElementById('auth-login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = document.getElementById('auth-username').value.trim();
    const password = document.getElementById('auth-password').value;
    try {
      const data = await authRequest('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      saveSession(data.token, data.user);
      gate.remove();
      window.dispatchEvent(new CustomEvent('auth-ready'));
    } catch (error) {
      document.getElementById('auth-error').textContent = error.message;
    }
  });
}

window.ensureAuth = async function ensureAuth() {
  if (!window.authSession.token) {
    renderLoginGate();
    return false;
  }
  try {
    const me = await authRequest('/auth/me', { method: 'GET' });
    saveSession(window.authSession.token, me.user);
    return true;
  } catch (error) {
    clearSession();
    renderLoginGate();
    return false;
  }
};

window.getAuthHeaders = authHeaders;
window.clearAuthSession = clearSession;
