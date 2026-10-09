import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ArticleAccessService } from '../access/article-access.service';
import { AuthGuard, AuthedRequest } from '../auth/auth.guard';
import { toCsv } from './csv';

@Controller('export')
@UseGuards(AuthGuard)
export class ExportController {
  constructor(private readonly access: ArticleAccessService) {}

  @Get('articles.csv')
  async articles(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Query('userId') userId?: string,
    @Query('sort') sort?: string,
  ) {
    const rows = await this.access.forUser(userId ?? req.user.id, { sort, limit: 5000 });
    res.type('text/csv').send(toCsv(rows, ['id', 'title', 'url', 'relevance']));
  }
}
