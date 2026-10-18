import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';

export const requestContext = new AsyncLocalStorage<{ uid: string; signal: AbortSignal }>();
