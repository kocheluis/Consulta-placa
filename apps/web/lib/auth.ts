const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const TOKEN_KEY = 'cp_token';

export interface Account {
  id: string;
  email: string;
  isPro: boolean;
  isActive: boolean;
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function postJson(path: string, body: unknown) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { message?: string }).message ?? `Error ${res.status}`);
  return data;
}

export async function register(email: string, password: string): Promise<Account> {
  return (await postJson('/api/v1/auth/register', { email, password })) as Account;
}

export async function login(email: string, password: string): Promise<Account> {
  const data = (await postJson('/api/v1/auth/login', { email, password })) as {
    token: string;
    user: Account;
  };
  setToken(data.token);
  return data.user;
}

export async function fetchMe(): Promise<Account | null> {
  const token = getToken();
  if (!token) return null;
  const res = await fetch(`${API_URL}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as Account;
}
