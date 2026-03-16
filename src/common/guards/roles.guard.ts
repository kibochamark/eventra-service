import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from 'generated/prisma/client';
import { fromNodeHeaders } from '../utils/from-node-headers';
import { getAuth } from 'src/auth';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();

    console.log(fromNodeHeaders(request.headers), "grg")

    const session = await getAuth().api.getSession({
      headers: fromNodeHeaders(request.headers),
    });

    console.log(session, "es")

    if (!session) {
      throw new UnauthorizedException('Authentication required');
    }

    const userRole = (session.user as any).role as Role;

    console.log(session.user)

    if (!requiredRoles.includes(userRole)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    request.user = session.user;
    return true;
  }
}
