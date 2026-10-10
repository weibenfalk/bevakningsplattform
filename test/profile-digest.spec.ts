import { INestApplicationContext } from '@nestjs/common';
import { ArticleAccessService } from '../src/access/article-access.service';
import { DigestService } from '../src/digest/digest.service';
import { renderDigest } from '../src/digest/render';
import { closeTestingApp, createTestingApp, seedArticles, testKnex } from './helpers';

const artikel = { title: 'Rotavdraget sänks', url: 'https://example.se/a', summary: 'Kort', urgency: 'info', otherSources: [] };

describe('renderDigest: Varför', () => {
  it('visar profilen och termerna under artikeln', () => {
    const html = renderDigest([{ ...artikel, why: [{ profile: 'pf-regler', terms: ['rotavdrag*', 'Arbetsmiljöverket'] }] }]);
    expect(html).toContain('Varför: pf-regler (rotavdrag*, Arbetsmiljöverket)');
  });

  it('flera profiler skiljs åt', () => {
    const html = renderDigest([{ ...artikel, why: [{ profile: 'a', terms: ['x'] }, { profile: 'b', terms: ['y'] }] }]);
    expect(html).toContain('Varför: a (x) · b (y)');
  });

  it('inget Varför när ingen profil träffade', () => {
    expect(renderDigest([artikel])).not.toContain('Varför');
    expect(renderDigest([{ ...artikel, why: [] }])).not.toContain('Varför');
  });

  it('profil och term escapas', () => {
    const html = renderDigest([{ ...artikel, why: [{ profile: '<script>x</script>', terms: ['"a" & <b>'] }] }]);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;a&quot; &amp; &lt;b&gt;');
  });
});

describe('DigestService: profilerna förklarar men filtrerar inte', () => {
  let app: INestApplicationContext;
  beforeEach(async () => {
    app = await createTestingApp();
    await seedArticles([
      { raw_id: 'a1', spaces: ['takvard'], urgency: 'info', relevance: 90, title: 'Rikstak köper' },
      { raw_id: 'a2', spaces: ['takvard', 'fonsterputs'], urgency: 'info', relevance: 80, title: 'Rotavdraget sänks' },
    ]);
  });
  afterEach(closeTestingApp);

  /** Sparar en profil med en version och träffar direkt i tabellerna. */
  async function profil(id: string, owner: string, matches: { raw: string; term: string }[], version = 1, matchVersion = version) {
    const knex = testKnex();
    await knex('users').insert({ id: owner, name: owner, role: 'reader' }).onConflict('id').ignore();
    await knex('profiles').insert({ id, owner_id: owner, spaces: ['takvard'] }).onConflict('id').ignore();
    for (let v = 1; v <= version; v++) {
      await knex('profile_versions').insert({ profile_id: id, version: v, query: 'x' }).onConflict(['profile_id', 'version']).ignore();
    }
    for (const m of matches) {
      const a = await knex('articles').where({ raw_id: m.raw }).first();
      await knex('profile_matches').insert({ profile_id: id, profile_version: matchVersion, article_id: a.id, term: m.term, score: 1 });
    }
  }

  it('Kalle ser Varför under artikeln som hans profil träffade', async () => {
    await profil('pf-konkurrenter-tak', 'u-kalle', [{ raw: 'a1', term: 'Rikstak' }]);
    const html = await app.get(DigestService).compose('u-kalle');
    expect(html).toContain('Varför: pf-konkurrenter-tak (Rikstak)');
  });

  it('profilerna filtrerar inte urvalet: r06 (rotavdraget) kommer med fast ingen av Kalles profiler träffade den', async () => {
    await profil('pf-konkurrenter-tak', 'u-kalle', [{ raw: 'a1', term: 'Rikstak' }]);
    const html = await app.get(DigestService).compose('u-kalle');
    expect(html).toContain('Rikstak köper');
    expect(html).toContain('Rotavdraget sänks');
    expect(html.match(/Varför:/g)).toHaveLength(1);
  });

  it('en användare utan profiler får samma urval, utan Varför', async () => {
    const html = await app.get(DigestService).compose('u-kalle');
    expect(html).toContain('Rotavdraget sänks');
    expect(html).not.toContain('Varför');
  });

  it('visar bara användarens egna profiler: Mikael ser inte Kalles', async () => {
    await profil('pf-konkurrenter-tak', 'u-kalle', [{ raw: 'a1', term: 'Rikstak' }]);
    await profil('pf-koncern', 'u-mikael', [{ raw: 'a2', term: 'börsnotering' }]);
    const mikael = await app.get(DigestService).compose('u-mikael');
    expect(mikael).not.toContain('pf-konkurrenter-tak');
    expect(mikael).not.toContain('Rikstak</');
    expect(mikael).toContain('Varför: pf-koncern (börsnotering)');
    const kalle = await app.get(DigestService).compose('u-kalle');
    expect(kalle).not.toContain('pf-koncern');
  });

  it('visar bara träffar av profilens senaste version', async () => {
    await profil('p1', 'u-kalle', [{ raw: 'a1', term: 'gammal term' }], 2, 1);
    const html = await app.get(DigestService).compose('u-kalle');
    expect(html).not.toContain('gammal term');
    expect(html).not.toContain('Varför');
  });

  it('åtkomstmodulen lämnar bara träffar för användarens egna profiler', async () => {
    await profil('pf-konkurrenter-tak', 'u-kalle', [{ raw: 'a1', term: 'Rikstak' }]);
    const access = app.get(ArticleAccessService);
    const a1 = await testKnex()('articles').where({ raw_id: 'a1' }).first();
    expect([...(await access.profileMatchesForUser('u-kalle', [a1.id])).values()]).toEqual([[{ profileId: 'pf-konkurrenter-tak', terms: ['Rikstak'] }]]);
    expect((await access.profileMatchesForUser('u-anna', [a1.id])).size).toBe(0);
  });
});
