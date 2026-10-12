import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';

const dbUrl = process.env.DATABASE_URL ?? 'file:pulsetrack.db';

export const libsqlClient = createClient({
  url: dbUrl,
});

export const db = drizzle(libsqlClient, { schema });
export type Database = typeof db;
