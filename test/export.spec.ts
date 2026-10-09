import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { INestApplicationContext } from '@nestjs/common';
import { toCsv } from '../src/admin/csv';
import { ExportController } from '../src/admin/export.controller';
import { AuthGuard } from '../src/auth/auth.guard';
import { closeTestingApp, createTestingApp, seedArticles } from './helpers';

const contextFor = (headers: Record<string, string>) => {
  const req: Record<string, unknown> = { header: (name: string) => headers[name.toLowerCase()] };
  return { req, ctx: { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext };
};

describe('AuthGuard: roll', () => {
  const OLD = process.env.ADMIN_USER_IDS;
  afterEach(() => { if (OLD === undefined) delete process.env.ADMIN_USER_IDS; else process.env.ADMIN_USER_IDS = OLD; });

  it('avvisar anrop utan användare', () => {
    expect(() => new AuthGuard().canActivate(contextFor({}).ctx)).toThrow(UnauthorizedException);
  });

  it('ingen är admin om inget anges', () => {
    delete process.env.ADMIN_USER_IDS;
    const { req, ctx } = contextFor({ 'x-user-id': 'u-mikael' });
    new AuthGuard().canActivate(ctx);
    expect(req.user).toEqual({ id: 'u-mikael', isAdmin: false });
  });

  it('admin är bara de som står i ADMIN_USER_IDS, och en roll i headern räknas inte', () => {
    process.env.ADMIN_USER_IDS = 'u-admin, u-annan';
    const admin = contextFor({ 'x-user-id': 'u-admin' });
    new AuthGuard().canActivate(admin.ctx);
    expect(admin.req.user).toEqual({ id: 'u-admin', isAdmin: true });

    const fake = contextFor({ 'x-user-id': 'u-anna', 'x-user-role': 'admin', 'x-admin': 'true' });
    new AuthGuard().canActivate(fake.ctx);
    expect(fake.req.user).toEqual({ id: 'u-anna', isAdmin: false });
  });
});

describe('Export: ?userId= är bara för admin', () => {
  let app: INestApplicationContext;
  const send = () => {
    const out = { body: '' };
    const res = { type: () => res, send: (b: string) => { out.body = b; } };
    return { out, res: res as never };
  };
  beforeEach(async () => {
    app = await createTestingApp();
    await seedArticles([
      { raw_id: 't1', spaces: ['takvard'], urgency: 'info', title: 'Takvårdsnyhet' },
      { raw_id: 'f1', spaces: ['fonsterputs'], urgency: 'info', title: 'Fönsternyhet' },
    ]);
  });
  afterEach(closeTestingApp);

  it('en vanlig användare kan inte exportera en annan användares innehåll', async () => {
    const { out, res } = send();
    await expect(
      app.get(ExportController).articles({ user: { id: 'u-anna', isAdmin: false } } as never, res, 'u-kalle', undefined),
    ).rejects.toThrow(ForbiddenException);
    expect(out.body).toBe('');
  });

  it('en vanlig användare får sitt eget innehåll, med eller utan eget id i frågan', async () => {
    for (const userId of [undefined, 'u-anna']) {
      const { out, res } = send();
      await app.get(ExportController).articles({ user: { id: 'u-anna', isAdmin: false } } as never, res, userId, undefined);
      expect(out.body).toContain('Fönsternyhet');
      expect(out.body).not.toContain('Takvårdsnyhet');
    }
  });

  it('en admin kan exportera en annan användares innehåll', async () => {
    const { out, res } = send();
    await app.get(ExportController).articles({ user: { id: 'u-mikael', isAdmin: true } } as never, res, 'u-kalle', undefined);
    expect(out.body).toContain('Takvårdsnyhet');
    expect(out.body).not.toContain('Fönsternyhet');
  });
});

describe('toCsv: skydd mot formelinjektion', () => {
  const cellsOf = (value: unknown) => toCsv([{ a: value }], ['a']).split('\n')[1];

  it.each(['=1+1', '+1+1', '-1+1', '@SUM(A1)', '\tformel', '\rformel'])('%j får ett inledande citattecken', (value) => {
    expect(cellsOf(value)).toBe(`"'${value}"`);
  });

  it('vanlig text och tal lämnas orörda', () => {
    expect(cellsOf('Vanlig rubrik')).toBe('"Vanlig rubrik"');
    expect(cellsOf(-5)).toBe('"-5"');
    expect(cellsOf(null)).toBe('""');
  });

  it('citattecken dubbleras fortfarande', () => {
    expect(cellsOf('säger "hej"')).toBe('"säger ""hej"""');
  });
});
