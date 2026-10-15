import { Prisma, ActionType, AuditAction, PlatformType } from "../generated/panel/client";
import { panel as prisma } from "../lib/globalprimsaclient";
import { panel } from "../lib/globalprimsaclient";
import { SecurityCache } from "../src/core/SecurityCache";

//*********************************************************************// Menu Action (Permission) DAL Functions *********************************************************************//
export const createMenuAction = async (dataArray: { menu_id: number, action: ActionType, label: string }[]) => {
    return await prisma.menu_action.createMany({
        data: dataArray
    });
}

export const getMenuAction = async (id: number) => {
    return await prisma.menu_action.findUnique({
        where: { id: id }
    });
}

export const getMenuActions = async (filters?: { label?: string }, pagination?: { page?: number; limit?: number }) => {
    const where: Prisma.menu_actionWhereInput = {
        AND: [
            filters?.label ? { label: { contains: filters.label, mode: 'insensitive' } } : {},
        ],
    };

    const page = pagination?.page && pagination.page > 0 ? pagination.page : 1;
    const limit = pagination?.limit && pagination.limit > 0 ? pagination.limit : 10;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
        prisma.menu_action.findMany({
            where,
            orderBy: { id: 'desc' },
            skip,
            take: limit,
        }),
        prisma.menu_action.count({ where }),
    ]);

    return {
        data,
        pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
}

//*********************************************************************// Role Related DAL Functions *********************************************************************//
export const createRole = async (roleName: string, ulb_id: number, actionIds: number[], actorId?: number) => {
    return await prisma.$transaction(async (tx) => {
        // 1. Create the base role
        const role = await tx.role.create({
            data: {
                name: roleName,
                ulb_id: ulb_id,
                role_menu_actions: {
                    create: actionIds.map(id => ({
                        menu_action_id: id,
                        ulb_id: ulb_id
                    }))
                }
            },
        });

        // 2. Log to Permission Audit (Native)
        if (actorId) {
            await tx.permission_audit_log.createMany({
                data: actionIds.map(actionId => ({
                    user_id: actorId,
                    ulb_id: ulb_id,
                    menu_action_id: actionId,
                    action: AuditAction.GRANTED,
                    reason: `Role "${roleName}" created and permissions assigned.`
                }))
            });
        }

        return role;
    });
}

export const getRoles = async (filters?: { name?: string; recstatus?: string }, pagination?: { page?: number; limit?: number }) => {
    const where: Prisma.roleWhereInput = {
        AND: [
            filters?.name ? { name: { contains: filters.name, mode: 'insensitive' } } : {},
            filters?.recstatus ? { recstatus: { equals: Number(filters.recstatus) } } : {}
        ],
    };

    const page = pagination?.page && pagination.page > 0 ? pagination.page : 1;
    const limit = pagination?.limit && pagination.limit > 0 ? pagination.limit : 10;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
        prisma.role.findMany({
            where,
            include: {
                ulb: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            },
            orderBy: { created_at: 'desc' },
            skip,
            take: limit,
        }),
        prisma.role.count({ where }),
    ]);

    return {
        data,
        pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
}

export const toggleRole = async (id: number) => {
    const prevStatus = await prisma.role.findUnique({
        where: { id: id },
        select: { recstatus: true, is_active: true }
    })

    const newStatus = prevStatus?.recstatus === 1 ? 0 : 1;
    const newIsActive = !prevStatus?.is_active;

    return await prisma.role.update({
        where: { id: id },
        data: { 
            recstatus: newStatus,
            is_active: newIsActive
        }
    });
}

/**
 * Enterprise Permission Discovery
 * Resolves exactly which actions are active for a user in a ULB.
 * PRIORITIZES Revokes over Role access.
 */
export async function getUserEffectivePermissions(user_id: number, ulb_id: number) {
    // 1. Fetch active Action IDs securely from Redis Cache (or fallback DB calc)
    const activeActionIds = await SecurityCache.getActiveActionIds(user_id, ulb_id);

    // 2. Fetch full action details for the IDs to build strings
    const finalActions = await prisma.menu_action.findMany({
        where: { id: { in: activeActionIds }, is_active: true }
    });

    // Return as "MENU_ID:ACTION" strings for internal menu-building logic
    return finalActions.map(a => `${a.menu_id}:${a.action}`);
}

export async function getAuthorizedMenus(user_id: number, ulb_id: number) {
    const effectivePerms = await getUserEffectivePermissions(user_id, ulb_id);
    const menuIds = new Set(effectivePerms.map(p => parseInt(p.split(':')[0])));

    return await prisma.menu.findMany({
        where: { id: { in: Array.from(menuIds) }, is_active: true },
        include: { children: true }
    });
}

export const createMenu = async (
    module_id: number,
    label: string,
    path: string,
    parent_id?: number,
    order?: number,
    defaultActions?: ActionType[],
    autoAssignToRole?: string,
    ulbId?: number,
    icon?: string,
    platform?: PlatformType,
) => {
    return await prisma.$transaction(async (tx) => {
        // 1. Create the Menu Node
        const menu = await tx.menu.create({
            data: {
                module_id: module_id,
                label: label,
                path: path,
                ...(order && { order: order }),
                ...(parent_id && { parentId: parent_id }),
                ...(icon && { icon: icon }),
                platform: platform ?? PlatformType.ALL,
            },
        });

        // 2. Provision Default Actions (VIEW, ADD, etc.)
        if (defaultActions && defaultActions.length > 0) {
            const actions = await Promise.all(
                defaultActions.map(action =>
                    tx.menu_action.create({
                        data: {
                            menu_id: menu.id,
                            action: action as ActionType,
                            label: `${action} ${label}`,
                            is_active: true
                        }
                    })
                )
            );

            // 3. Auto-Grant to Role (e.g., ULB_ADMIN)
            if (autoAssignToRole && ulbId) {
                const role = await tx.role.findFirst({
                    where: {
                        name: autoAssignToRole,
                        ulb_id: ulbId,
                        recstatus: 1
                    }
                });

                if (role) {
                    await tx.role_menu_action.createMany({
                        data: actions.map(a => ({
                            role_id: role.id,
                            menu_action_id: a.id,
                            ulb_id: ulbId,
                            is_active: true
                        }))
                    });
                }
            }
        }

        return menu;
    });
}


export const getEmployeeNames = async (userIds: number[]) => {
    if (!userIds.length) return {};

    const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: {
            id: true,
            employee: {
                select: {
                    empFirstName: true,
                    empLastName: true,
                },
            },
        },
    });

    const result: Record<number, string | null> = {};

    users.forEach((u) => {
        if (u.employee) {
            result[u.id] = `${u.employee.empFirstName} ${u.employee.empLastName}`;
        } else {
            result[u.id] = null;
        }
    });

    return result;
};


// export const getPaymentModeNames = async (ids: number[]) => {
//     // Remove NaN values
//     const cleanIds = ids.filter((id) => Number.isFinite(id));

//     if (!cleanIds.length) return {};

//     const modes = await saf.payment_master.findMany({
//         where: {
//             id: { in: cleanIds },
//         },
//         select: {
//             id: true,
//             name: true,
//         },
//     });

//     const result: any = {};
//     for (const m of modes) {
//         result[m.id] = m.name;
//     }
//     return result;
// };


export const getUlbName = async (ulbId: number) => {
    console.log(ulbId, ":::ulbId in panel.dal");
    const data = await panel.ulb_master.findFirst({
        where: { id: ulbId },
        select: {
            name: true
        }
    })
    return data?.name;
}

export const getZoneName = async (zoneId: number) => {
    const data = await panel.zone_master.findFirst({
        where: { id: zoneId },
        select: {
            name: true
        }

    })
    return data?.name
}

// ================================================================
// PERMISSION BUILDER — Returns MODULE:ACTION strings for JWT
// ================================================================
/**
 * Resolves the full effective permission set for a user in a ULB.
 * Returns strings in the format: "PROPERTY:VIEW", "WATER:ADD", etc.
 */
export async function buildUserPermissions(userId: number, ulb_id: number): Promise<string[]> {
    // 1. Fetch active Action IDs securely from Redis Cache (or fallback DB calc)
    const activeActionIds = await SecurityCache.getActiveActionIds(userId, ulb_id);

    // 2. Resolve Action -> Menu -> Module chain to build JWT strings
    const finalActions = await prisma.menu_action.findMany({
        where: { id: { in: activeActionIds }, is_active: true },
        include: {
            menu: {
                include: {
                    module: { select: { code: true } }
                }
            }
        }
    });

    const permsSet = new Set<string>();
    finalActions.forEach(a => {
        const mod = a.menu.module.code.toUpperCase();
        permsSet.add(`${mod}:${a.action}`);
    });

    return Array.from(permsSet);
}

/**
 * Resolves the Enterprise Geographic Boundaries for a user mapped to a ULB.
 * Returns an array of scopes formatting `{ zone_id: 1, wards: [1,2] }`.
 */
export async function buildUserZoneWardScopes(userId: number, ulb_id: number) {
    const rawScopes = await prisma.user_zone_ward_mapping.findMany({
        where: { user_id: userId, ulb_id: ulb_id }
    });

    const scopeMap = rawScopes.reduce((acc: any, curr: any) => {
        if (!acc[curr.zone_id]) acc[curr.zone_id] = [];
        if (curr.ward_id) acc[curr.zone_id].push(curr.ward_id);
        return acc;
    }, {});

    return Object.entries(scopeMap).map(([zId, wIds]) => ({
        zone_id: Number(zId),
        wards: wIds as number[]
    }));
}

// ================================================================
// MENU CATALOG — For the Role Builder UI (checkbox tree)
// ================================================================

/**
 * Returns the full module → menu → actions tree.
 * Used by the frontend to render the permission checkbox builder
 * when an admin creates or edits a role.
 * 
 * @param ulbId - Optional. If provided, filters the catalog to only show modules enabled for this ULB.
 */
export async function getMenuCatalog(ulbId?: number) {
    // 1. Fetch enabled module IDs if ulbId is provided
    let enabledModuleIds: number[] | null = null;
    if (ulbId && !isNaN(ulbId)) {
        const mappings = await prisma.ulb_module_mapping.findMany({
            where: { ulb_id: ulbId, is_active: true },
            select: { module_id: true }
        });
        enabledModuleIds = mappings.map(m => m.module_id);
    }

    // 2. Fetch active modules, menus, and actions in parallel
    const [modules, allMenus, allActions] = await Promise.all([
        prisma.module.findMany({
            where: { 
                is_active: true,
                ...(enabledModuleIds && { id: { in: enabledModuleIds } })
            },
            orderBy: { order: 'asc' }
        }),
        prisma.menu.findMany({
            where: { is_active: true },
            orderBy: { order: 'asc' }
        }),
        prisma.menu_action.findMany({
            where: { is_active: true }
        })
    ]);

    // 3. Map actions to their respective menus
    const actionsByMenu = new Map<number, any[]>();
    allActions.forEach(action => {
        if (!actionsByMenu.has(action.menu_id)) actionsByMenu.set(action.menu_id, []);
        actionsByMenu.get(action.menu_id)!.push(action);
    });

    // 4. Helper to build recursive menu tree for a module
    const buildMenuTree = (moduleId: number, parentId: number | null = null): any[] => {
        return allMenus
            .filter(menu => menu.module_id === moduleId && menu.parentId === parentId)
            .map(menu => ({
                ...menu,
                actions: actionsByMenu.get(menu.id) || [],
                children: buildMenuTree(moduleId, menu.id)
            }));
    };

    // 5. Combine into final Module -> Menu Tree structure
    return modules.map(mod => ({
        ...mod,
        menus: buildMenuTree(mod.id, null)
    }));
}
