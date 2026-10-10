import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthedRequest } from './auth.guard';

/** Släpper bara igenom admin. Körs efter `AuthGuard`, som sätter `req.user` (rollen kommer från ADMIN_USER_IDS). */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!context.switchToHttp().getRequest<AuthedRequest>().user?.isAdmin) throw new ForbiddenException('Bara för admin');
    return true;
  }
}
