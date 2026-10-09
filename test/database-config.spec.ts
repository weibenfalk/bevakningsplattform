import { LOCAL_DATABASE_URL, resolveDatabaseUrl } from '../src/config/database';

describe('resolveDatabaseUrl', () => {
  it('använder DATABASE_URL när den är satt', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: 'postgres://u:p@db.example:5432/x', NODE_ENV: 'production' }))
      .toBe('postgres://u:p@db.example:5432/x');
  });

  it('faller tillbaka på den lokala Docker-databasen utanför produktion', () => {
    for (const NODE_ENV of [undefined, 'development', 'test']) {
      expect(resolveDatabaseUrl({ NODE_ENV })).toBe(LOCAL_DATABASE_URL);
    }
    expect(resolveDatabaseUrl({ DATABASE_URL: '  ' })).toBe(LOCAL_DATABASE_URL);
  });

  it('kräver DATABASE_URL i produktion, så att servern aldrig tyst pratar med fel databas', () => {
    expect(() => resolveDatabaseUrl({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
    expect(() => resolveDatabaseUrl({ NODE_ENV: 'production', DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });
});
