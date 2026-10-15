import IORedis from "ioredis";
import { panel as prisma } from "../../lib/globalprimsaclient";
import { connection } from "../queue/connection";

const redis = new IORedis(connection);

export class SecurityCache {
  /**
   * Generates the cache key for a user's permissions in a specific ULB.
   */
  static getKey(userId: number, ulbId: number): string {
    return `up_panel:perms:${userId}:${ulbId}`;
  }

  /**
   * Fetches the cached list of active menu_action_ids for the user.
   * If not cached, it calculates them from the Database, caches the result, and returns it.
   */
  static async getActiveActionIds(userId: number, ulbId: number): Promise<number[]> {
    const key = this.getKey(userId, ulbId);
    
    try {
      const cached = await redis.get(key);
      if (cached) {
        return JSON.parse(cached) as number[];
      }
    } catch (err) {
      console.error("[SecurityCache] Redis Get Error:", err);
      // Fallthrough to DB calculation on Redis failure
    }

    // --- DB Calculation Logic (Fallback & Populate) ---
    const mapping = await prisma.ulb_user_mapping.findUnique({
      where: { user_id_ulb_id: { user_id: userId, ulb_id: ulbId } },
      include: { role: { include: { role_menu_actions: true } } }
    });

    const overrides = await prisma.user_permission.findMany({
      where: { user_id: userId, ulb_id: ulbId, is_active: true }
    });

    const activeActionIds = new Set<number>();

    // 1. Role-based Actions
    if (mapping && mapping.role.recstatus === 1) {
      mapping.role.role_menu_actions.forEach(rma => {
        if (rma.is_active) activeActionIds.add(rma.menu_action_id);
      });
    }

    // 2. Overrides (Grants & Revokes)
    overrides.forEach(ov => {
      if (ov.effect === 'GRANT') {
        activeActionIds.add(ov.menu_action_id);
      } else if (ov.effect === 'REVOKE') {
        activeActionIds.delete(ov.menu_action_id);
      }
    });

    const finalArray = Array.from(activeActionIds);

    // Populate Cache (Expires in 24 hours, refreshed on every miss/invalidation)
    try {
      await redis.set(key, JSON.stringify(finalArray), 'EX', 86400);
    } catch (err) {
      console.error("[SecurityCache] Redis Set Error:", err);
    }

    return finalArray;
  }

  /**
   * Invalidates a specific user's permission cache.
   * Used when a direct override is applied to a user.
   */
  static async invalidateUser(userId: number, ulbId: number): Promise<void> {
    const key = this.getKey(userId, ulbId);
    try {
      await redis.del(key);
    } catch (err) {
      console.error("[SecurityCache] Redis Del Error:", err);
    }
  }

  /**
   * Invalidates the cache for ALL users assigned to a specific role.
   * Used when an Admin edits role permissions.
   */
  static async invalidateRole(roleId: number, ulbId: number): Promise<void> {
    try {
      const users = await prisma.ulb_user_mapping.findMany({
        where: { role_id: roleId, ulb_id: ulbId },
        select: { user_id: true }
      });

      if (users.length === 0) return;

      const pipeline = redis.pipeline();
      users.forEach(u => {
        pipeline.del(this.getKey(u.user_id, ulbId));
      });
      await pipeline.exec();
      
      console.log(`[SecurityCache] Invalidated cache for ${users.length} users in Role ${roleId}`);
    } catch (err) {
      console.error("[SecurityCache] Redis Role Invalidation Error:", err);
    }
  }

  /**
   * Invalidates ALL user permissions globally.
   * MUST be called when a global Module is toggled.
   */
  static async invalidateAllUserPermissions(): Promise<void> {
    try {
      const keys = await redis.keys('up_panel:perms:*');
      if (keys.length > 0) {
        await redis.del(...keys);
      }
      console.log(`[SecurityCache] Invalidated all user permissions (${keys.length} keys)`);
    } catch (err) {
      console.error("[SecurityCache] Redis Global Invalidation Error:", err);
    }
  }

  /**
   * Invalidates ALL user permissions for a specific ULB.
   * MUST be called when ULB Modules are synchronized.
   */
  static async invalidateAllUlbUsers(ulbId: number): Promise<void> {
    try {
      const keys = await redis.keys(`up_panel:perms:*:${ulbId}`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
      console.log(`[SecurityCache] Invalidated ${keys.length} user permissions for ULB ${ulbId}`);
    } catch (err) {
      console.error("[SecurityCache] Redis ULB Invalidation Error:", err);
    }
  }

  /**
   * Generates the cache key for a ULB's active status.
   */
  static getUlbStatusKey(ulbId: number): string {
    return `up_panel:ulb_status:${ulbId}`;
  }

  /**
   * Enterprise Kill-Switch: Checks if a ULB is active.
   * Caches the result in Redis to prevent hammering the database on every middleware request.
   */
  static async isUlbActive(ulbId: number): Promise<boolean> {
    const key = this.getUlbStatusKey(ulbId);

    try {
      const cached = await redis.get(key);
      if (cached) {
        return cached === 'true';
      }
    } catch (err) {
      console.error("[SecurityCache] Redis Get ULB Status Error:", err);
    }

    // Fallback to DB
    const ulb = await prisma.ulb_master.findUnique({
      where: { id: ulbId },
      select: { is_active: true }
    });

    const isActive = ulb ? ulb.is_active : false;

    try {
      await redis.set(key, isActive ? 'true' : 'false', 'EX', 86400); // 24hr cache
    } catch (err) {
      console.error("[SecurityCache] Redis Set ULB Status Error:", err);
    }

    return isActive;
  }

  /**
   * Invalidates the ULB active status cache.
   * MUST be called immediately when a Super Admin toggles a ULB.
   */
  static async invalidateUlbStatus(ulbId: number): Promise<void> {
    const key = this.getUlbStatusKey(ulbId);
    try {
      await redis.del(key);
      console.log(`[SecurityCache] Invalidated ULB status for ${ulbId}`);
    } catch (err) {
      console.error("[SecurityCache] Redis Del ULB Status Error:", err);
    }
  }
}
