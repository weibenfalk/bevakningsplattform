import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

export interface AuthedRequest extends Request {
  user: { id: string };
}

/**
 * Platshållare: autentiseringen saknades i startkoden.
 * Läser användar-id från headern x-user-id. Endast för lokal körning, inte riktig inloggning.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const userId = req.header('x-user-id');
    if (!userId) throw new UnauthorizedException();
    req.user = { id: userId };
    return true;
  }
}
