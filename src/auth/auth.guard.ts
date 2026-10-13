import { ConfigService } from '@nestjs/config';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AppConfiguration } from '../config/configuration';

export interface AuthedRequest extends Request {
  user: { id: string; isAdmin: boolean };
}

/**
 * Platshållare för riktig inloggning (se fel 18 i docs/kodgranskning.md).
 * Läser användar-id från headern x-user-id. Endast för lokal körning, inte riktig inloggning.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService<AppConfiguration, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const userId = req.header('x-user-id');
    if (!userId) throw new UnauthorizedException();
    // Rollen kommer från serverns konfiguration och aldrig från anropet. Se beslutsloggen: riktig autentisering saknas.
    const admins = this.config.get('adminUserIds', { infer: true });
    req.user = { id: userId, isAdmin: admins.includes(userId) };
    return true;
  }
}
