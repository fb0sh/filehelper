import { request } from './client';

export interface ServerInfo {
  name: string;
  version: string;
  instanceId: string;
  cryptoVersion: number;
  maxUploadSize: number;
}

export interface AuthRequest {
  spaceId: string;
  authKey: string;
}

export interface AuthResponse {
  sessionToken: string;
  expiresAt: number;
}

export const authApi = {
  info: () => request<ServerInfo>('/info'),
  login: (spaceId: string, authKey: string) =>
    request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ spaceId, authKey }),
      headers: { 'Content-Type': 'application/json' },
    }),
  create: (spaceId: string, authKey: string) =>
    request<void>('/auth/create', {
      method: 'POST',
      body: JSON.stringify({ spaceId, authKey }),
      headers: { 'Content-Type': 'application/json' },
    }),
};
