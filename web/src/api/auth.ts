import { request } from './client';

export interface LoginRequest {
  code: string;
}

export interface LoginResponse {
  ok: boolean;
}

export interface SessionInfo {
  authenticated: boolean;
  expiresAt: number;
}

export const authApi = {
  login: (data: LoginRequest) => request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' },
  }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  session: () => request<SessionInfo>('/auth/session'),
};