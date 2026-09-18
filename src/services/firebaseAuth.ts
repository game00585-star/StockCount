const apiKey = 'AIzaSyD193e6G62EHa7nP0w2i-YLCPGe6Z3bOEU';
const storageKey = 'audit-firebase-auth-v1';

type StoredAuth = { idToken: string; refreshToken: string; expiresAt: number };

function readStoredAuth(): StoredAuth | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || 'null') as StoredAuth | null;
    return value?.idToken && value.refreshToken ? value : undefined;
  } catch { return undefined; }
}

function saveAuth(idToken: string, refreshToken: string, expiresIn: string | number) {
  const auth: StoredAuth = {
    idToken,
    refreshToken,
    expiresAt: Date.now() + Math.max(60, Number(expiresIn) - 60) * 1000
  };
  localStorage.setItem(storageKey, JSON.stringify(auth));
  return auth;
}

async function anonymousSignIn() {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({returnSecureToken: true})
  });
  if (!response.ok) throw new Error(`Firebase Auth ${response.status}: ${await response.text()}`);
  const data = await response.json() as {idToken: string;refreshToken: string;expiresIn: string};
  return saveAuth(data.idToken, data.refreshToken, data.expiresIn);
}

async function refreshAuth(refreshToken: string) {
  const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${apiKey}`, {
    method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({grant_type: 'refresh_token', refresh_token: refreshToken})
  });
  if (!response.ok) { localStorage.removeItem(storageKey); return anonymousSignIn(); }
  const data = await response.json() as {id_token: string;refresh_token: string;expires_in: string};
  return saveAuth(data.id_token, data.refresh_token, data.expires_in);
}

let activeAuth: Promise<string> | undefined;

export async function getFirebaseIdToken() {
  if (activeAuth) return activeAuth;
  activeAuth = (async () => {
    const stored = readStoredAuth();
    if (stored && stored.expiresAt > Date.now()) return stored.idToken;
    if (stored) return (await refreshAuth(stored.refreshToken)).idToken;
    return (await anonymousSignIn()).idToken;
  })();
  try { return await activeAuth; } finally { activeAuth = undefined; }
}
