import { ActionType, PermissionEffect, AbacAttribute } from '../../generated/panel/client';
import { panel as prisma } from "../../lib/globalprimsaclient";
import { SecurityCache } from './SecurityCache';


export interface PermissionContext {
  userId: number;
  ulbId: number;
  action: ActionType;
  menuCode: string; // The code identifying the menu/page
  attributes?: {
    ipAddress?: string;
    currentTime?: Date;
    zoneId?: number;
    wardId?: number;
  };
}

export interface PermissionResult {
  allowed: boolean;
  reason: string;
}

/**
 * Enterprise Permission Resolver
 * Evaluates access using: RBAC -> User Overrides -> ABAC Policies
 */
export class PermissionService {

  /**
   * Resolves if a user has permission to perform an action
   */
  static async resolve(ctx: PermissionContext): Promise<PermissionResult> {
    const { userId, ulbId, action, menuCode, attributes } = ctx;

    // 1. Fetch User and their Type
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { user_type: true, is_active: true }
    });

    if (!user) return { allowed: false, reason: 'User not found' };
    
    if (!user.is_active) {
      return { allowed: false, reason: 'Your account has been deactivated' };
    }

    // Super Admins bypass city-level checks for global infrastructure
    if (user.user_type === 'SUPER_ADMIN') {
      return { allowed: true, reason: 'Super Admin bypass' };
    }

    // 2. Resolve Menu Action ID
    const menuAction = await prisma.menu_action.findFirst({
      where: {
        action: action,
        is_active: true,
        menu: { 
          path: menuCode,
          is_active: true
        }
      }
    });

    if (!menuAction) return { allowed: false, reason: 'Invalid or inactive Action/Menu' };

    // 3. CHECK PERMISSION ENGINE CACHE (Replaces explicit Overrides and Role checks)
    // The SecurityCache resolves both the assigned role actions and any overrides (GRANT/REVOKE),
    // and returns them out of a highly-optimized Redis layer.
    const activeActionIds = await SecurityCache.getActiveActionIds(userId, ulbId);

    if (!activeActionIds.includes(menuAction.id)) {
      return { allowed: false, reason: 'Access denied: Permission missing or explicitly revoked.' };
    }

    // 5. EVALUATE ABAC POLICIES (Contextual Conditions)
    const policies = await prisma.user_abac_policy.findMany({
      where: { user_id: userId, ulb_id: ulbId, is_active: true }
    });

    for (const policy of policies) {
      const isAllowed = await this.evaluateAbac(policy.attribute, policy.value, attributes);
      if (!isAllowed) {
        return { allowed: false, reason: `ABAC Policy Failed: ${policy.attribute}` };
      }
    }

    return { allowed: true, reason: 'Permission granted' };
  }

  /**
   * Evaluates dynamic attributes against a policy
   */
  private static async evaluateAbac(
    attr: AbacAttribute, 
    policyValue: any, 
    current: PermissionContext['attributes']
  ): Promise<boolean> {
    if (!current) return true;

    switch (attr) {
      case 'TIME_RANGE':
        // policyValue: { "start": "09:00", "end": "18:00" }
        const now = current.currentTime || new Date();
        const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        return time >= policyValue.start && time <= policyValue.end;

      case 'IP_WHITELIST':
        // policyValue: ["122.1.1.1", "10.0.0.1"]
        return policyValue.includes(current.ipAddress);

      case 'ZONE_RESTRICT':
        return current.zoneId === policyValue.zoneId;

      default:
        return true;
    }
  }
}
