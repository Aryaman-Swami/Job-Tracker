const TOKEN_KEY = 'jobtracker_token';
const EXPIRES_AT_KEY = 'jobtracker_token_expires_at';

export function getToken() {
  const token = localStorage.getItem(TOKEN_KEY);
  const expiresAt = Number(localStorage.getItem(EXPIRES_AT_KEY) || 0);
  if (!token || Date.now() >= expiresAt) return null;
  return token;
}

export function isLoggedIn() {
  return getToken() !== null;
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EXPIRES_AT_KEY);
}

export async function login(username, password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.message || 'Login failed');
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(EXPIRES_AT_KEY, String(Date.now() + data.expiresInMs));
}

export function logout() {
  clearToken();
  window.dispatchEvent(new Event('auth:logout'));
}
