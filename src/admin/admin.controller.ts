import { BadRequestException, Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ArticleAccessService } from '../access/article-access.service';
import { ContentScopeService } from '../access/content-scope.service';
import { AdminGuard } from '../auth/admin.guard';
import { AuthGuard } from '../auth/auth.guard';
import { SOURCE_NAMES, sourceLabel } from '../config/sources';
import { ProfileService } from '../profiles/profile.service';
import { USER_DIRECTORY } from '../config/users';
import { QueryTestService } from './query-test.service';

const MAX_QUERY_LENGTH = 1000;

/**
 * Läs-bara verktyg för admin: visa systemet som en annan användare och se varför en artikel kom med.
 * Inget här skriver. Artiklarna hämtas via åtkomstmodulen med den användarens omfång, utan fulltext.
 */
@Controller('admin')
@UseGuards(AuthGuard, AdminGuard)
export class AdminController {
  constructor(
    private readonly access: ArticleAccessService,
    private readonly scopes: ContentScopeService,
    private readonly queryTest: QueryTestService,
    private readonly profiles: ProfileService,
    @Inject(USER_DIRECTORY) private readonly directory: Map<string, { name: string; role: string }>,
    @Inject(SOURCE_NAMES) private readonly sourceNames: Map<string, string>,
  ) {}

  @Get('users')
  async users() {
    return (await this.scopes.list()).map((s) => this.describe(s.userId, s.spaces));
  }

  /** Användarens profiler: status (giltig eller trasig med fel och position), version och antal träffade artiklar. */
  @Get('users/:userId/profiles')
  async userProfiles(@Param('userId') userId: string) {
    return this.profiles.statusFor(userId);
  }

  @Get('view-as/:userId')
  async viewAs(@Param('userId') userId: string) {
    const articles = await this.access.forUser(userId, { limit: 200 }); // 404 om användaren saknar omfång
    const matches = await this.access.profileMatchesForUser(userId, articles.map((a) => a.id));
    return {
      user: this.describe(userId, (await this.scopes.get(userId)).spaces),
      articles: articles.map((a) => ({
        id: a.id,
        title: a.title,
        url: a.url,
        source: sourceLabel(this.sourceNames, a.source_name),
        relevance: a.relevance,
        scoreBreakdown: a.score_breakdown,
        urgency: a.urgency,
        spaces: a.spaces,
        categories: a.categories,
        profileMatches: matches.get(a.id) ?? [],
      })),
    };
  }

  /** Provar en profilfråga mot arkivet inom användarens omfång. Syntaxfel kommer som `syntaxError` med position. Skriver inget. */
  @Post('query-test')
  async test(@Body() body: { userId?: unknown; query?: unknown }) {
    const { userId, query } = body ?? {};
    if (typeof userId !== 'string' || typeof query !== 'string' || query.length > MAX_QUERY_LENGTH) {
      throw new BadRequestException(`userId och query (högst ${MAX_QUERY_LENGTH} tecken) krävs som text`);
    }
    return this.queryTest.test(userId, query);
  }

  private describe(id: string, spaces: string[]) {
    const known = this.directory.get(id);
    return { id, name: known?.name ?? id, role: known?.role ?? null, spaces };
  }
}
