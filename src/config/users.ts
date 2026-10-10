import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const USER_DIRECTORY = Symbol('USER_DIRECTORY');

/** Namn och titel ur data/users.json, per användar-id. Omfånget kommer inte härifrån utan från `content_scopes`. */
export function loadUserDirectory(path = join(__dirname, '../../data/users.json')): Map<string, { name: string; role: string }> {
  const users: { id: string; name: string; role: string }[] = JSON.parse(readFileSync(path, 'utf8'));
  return new Map(users.map((u) => [u.id, { name: u.name, role: u.role }]));
}
