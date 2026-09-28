import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { RegisterResponseSchema } from '@hive/shared';

import { getSetting } from '@/core/db';

/** Anything with a `parse` (every zod schema). Keeps this file independent of which zod build the schema came from. */
export interface Parser<T> {
  parse(data: unknown): T;
}

const IDENTITY_KEY = 'hive_device';
const DEV_PORT = 8787;

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  /** 4xx other than auth/rate limiting: retrying the same payload can never succeed. */
  get permanent() {
    return this.status >= 400 && this.status < 500 && this.status !== 401 && this.status !== 408 && this.status !== 429;
  }
}

/**
 * Backend address. Order: Settings override, EXPO_PUBLIC_API_URL, then in dev builds the machine
 * running Metro (the phone already reaches it), on the backend's port.
 */
export async function getApiBase(): Promise<string> {
  const override = await getSetting('api_base');
  if (override) return override.replace(/\/$/, '');
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL.replace(/\/$/, '');
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${host ?? '10.0.2.2'}:${DEV_PORT}`;
}

// --- device identity: random id + token, no account, name or phone number ---

export interface Identity {
  deviceId: string;
  token: string;
}

export async function getIdentity(): Promise<Identity | null> {
  try {
    const raw = await SecureStore.getItemAsync(IDENTITY_KEY);
    return raw ? (JSON.parse(raw) as Identity) : null;
  } catch {
    return null;
  }
}

export async function clearIdentity() {
  await SecureStore.deleteItemAsync(IDENTITY_KEY).catch(() => undefined);
}

interface RequestOptions<T> {
  body?: unknown;
  schema?: Parser<T>;
  auth?: boolean;
  timeoutMs?: number;
}

async function rawRequest(method: string, path: string, { body, auth = true, timeoutMs = 15_000 }: RequestOptions<unknown>, token?: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${await getApiBase()}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new ApiError(res.status, `${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
    return text ? (JSON.parse(text) as unknown) : undefined;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new NetworkError(e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
}

/** First launch: ask the server for a random device id + token and keep them in SecureStore. */
export async function register(): Promise<Identity> {
  const res = RegisterResponseSchema.parse(await rawRequest('POST', '/v1/devices/register', { auth: false, body: {} }));
  await SecureStore.setItemAsync(IDENTITY_KEY, JSON.stringify(res));
  return res;
}

export async function ensureRegistered(): Promise<Identity> {
  return (await getIdentity()) ?? register();
}

/**
 * Authenticated JSON request with a timeout, response validation, and one transparent
 * re-registration if the server no longer recognises the token (401).
 */
export async function request<T = unknown>(method: string, path: string, opts: RequestOptions<T> = {}): Promise<T> {
  let identity = opts.auth === false ? null : await ensureRegistered();
  for (let attempt = 0; ; attempt++) {
    try {
      const data = await rawRequest(method, path, opts, identity?.token);
      return opts.schema ? opts.schema.parse(data) : (data as T);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && attempt === 0 && opts.auth !== false) {
        await clearIdentity();
        identity = await register();
        continue;
      }
      throw e;
    }
  }
}

/**
 * Deletes a device's server-side data using an explicit identity. "Delete everything" must work after the
 * local database (and the normal registration) is gone, so the deletion job keeps its own copy of the token.
 */
export async function deleteDeviceRemote(identity: Identity) {
  await rawRequest('DELETE', '/v1/devices/me', {}, identity.token);
}

export const api = {
  get: <T>(path: string, schema: Parser<T>) => request<T>('GET', path, { schema }),
  post: <T = unknown>(path: string, body: unknown, schema?: Parser<T>) => request<T>('POST', path, { body, schema }),
  delete: (path: string) => request('DELETE', path),
};
