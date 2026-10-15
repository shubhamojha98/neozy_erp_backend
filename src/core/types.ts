import { Request } from 'express';
import { UserType } from '../../generated/panel/client';
import { AuthPayload } from '../../type/common.type';

declare global {
  namespace Express {
    interface Request {
      /**
       * Current Authenticated User ID
       */
      userId?: number;

      /**
       * Current Type of User (SUPER_ADMIN, etc.)
       */
      userType?: UserType;

      /**
       * The active ULB (Tenant) ID for this request
       */
      ulbId?: number;

      /**
       * Zone and Ward context if applicable
       */
      zoneId?: number;
      wardId?: number;
    }
  }
}

export interface AuthenticatedRequest extends Request {
  user?: AuthPayload;
}
