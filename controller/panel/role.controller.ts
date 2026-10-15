import { Request, Response } from 'express';
import { AuditAction } from '../../generated/panel/client'
import { panel } from "../../lib/globalprimsaclient";
import genrateResponse from '../../lib/generateResponse';
import HttpStatus from '../../lib/httpStatus';
import { extractPayload, encryptData } from '../../lib/apiCryptography';
import { AuthenticatedRequest } from '../../src/core/types';
import { AuthPayload } from '../../type/common.type';
import { createRole, getRoles, toggleRole } from '../../dal/panel.dal';
import { handlePrismaError } from '../../lib/prismaErrorHandler';
import { SecurityCache } from '../../src/core/SecurityCache';


export const create = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const user = req.user as AuthPayload;
        const data = extractPayload(req.body);
        const { role_name, actionIds, ulb_id } = data;

        if (!Array.isArray(actionIds)) {
            return genrateResponse(res, HttpStatus.BadRequest, "actionIds must be an array of menu_action IDs");
        }

        // Pass actorId for audit logging
        const createdRole = await createRole(role_name, Number(ulb_id), actionIds, user.userId);

        genrateResponse(
            res,
            HttpStatus.OK,
            'Role created successfully',
            encryptData(createdRole)
        )
    } catch (err: any) {
        const error = handlePrismaError(err);
        genrateResponse(res, error.status, error.message);
    }
}

export const getAll = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { role_name, status, page, limit } = req.query

        const roles = await getRoles({ name: role_name as string, recstatus: status as string }, { page: Number(page), limit: Number(limit) } as any);

        genrateResponse(
            res,
            HttpStatus.OK,
            'Roles fetched successfully',
            encryptData({
                data: roles?.data,
                pagination: roles?.pagination
            }),

        )
    } catch (err: any) {
        const error = handlePrismaError(err);
        genrateResponse(res, error.status, error.message);
    }
}

export const getById = async (req: Request, res: Response) => {
    try {
        const { iv, ed } = req.query as any;
        const decryptedData = extractPayload({ ed, iv });

        if (!decryptedData?.id) {
            return genrateResponse(res, HttpStatus.BadRequest, 'Invalid or missing role reference');
        }

        const role = await panel.role.findUnique({
            where: { id: Number(decryptedData.id) },
            include: {
                role_menu_actions: {
                    include: {
                        menu_action: {
                            include: {
                                menu: true
                            }
                        }
                    }
                }
            },
        })

        if (!role) {
            return genrateResponse(res, HttpStatus.NotFound, 'No role found');
        }

        genrateResponse(
            res,
            HttpStatus.OK,
            'Role fetched successfully',
            encryptData(role)
        );
    } catch (err: any) {
        const error = handlePrismaError(err);
        genrateResponse(res, error.status, error.message);
    }
};

export const update = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const user = req.user as AuthPayload;
        const { iv, ed } = req.body;
        const decryptedData = extractPayload({ ed, iv });

        const roleId = Number(decryptedData?.id);
        const newActionIds = decryptedData?.actionIds as number[];
        const ulbId = Number(decryptedData?.ulb_id);

        const result = await panel.$transaction(async (tx) => {
            // 1. Fetch current actions to determine diff (for detailed audit)
            const currentActions = await tx.role_menu_action.findMany({
                where: { role_id: roleId },
                select: { menu_action_id: true }
            });
            const currentActionIds = currentActions.map(a => a.menu_action_id);

            const granted = newActionIds.filter(id => !currentActionIds.includes(id));
            const revoked = currentActionIds.filter(id => !newActionIds.includes(id));

            // 2. Perform the update
            const updatedRole = await tx.role.update({
                where: { id: roleId },
                data: {
                    name: decryptedData?.roleName,
                    ...(decryptedData?.ulb_id && { ulb_id: ulbId }),
                    role_menu_actions: {
                        deleteMany: {},
                        create: newActionIds.map((id: number) => ({
                            menu_action_id: id,
                            ulb_id: ulbId
                        }))
                    }
                }
            });

            // 3. Log Audit Trail
            if (granted.length > 0) {
                await tx.permission_audit_log.createMany({
                    data: granted.map(actionId => ({
                        user_id: user.userId,
                        ulb_id: ulbId,
                        menu_action_id: actionId,
                        action: AuditAction.GRANTED,
                        reason: `Role updated: Granted during edit.`
                    }))
                });
            }
            if (revoked.length > 0) {
                await tx.permission_audit_log.createMany({
                    data: revoked.map(actionId => ({
                        user_id: user.userId,
                        ulb_id: ulbId,
                        menu_action_id: actionId,
                        action: AuditAction.REVOKED,
                        reason: `Role updated: Revoked during edit.`
                    }))
                });
            }

            return updatedRole;
        });

        // 4. Invalidate Cache to broadcast changes
        await SecurityCache.invalidateRole(roleId, ulbId);

        genrateResponse(
            res,
            HttpStatus.OK,
            'Role updated successfully',
            encryptData(result)
        )
    } catch (err: any) {
        const error = handlePrismaError(err);
        genrateResponse(res, error.status, error.message);
    }
}

export const toggle = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { iv, ed } = req.body;
        const decryptedData = extractPayload({ ed, iv });

        const updatedRole = await toggleRole(decryptedData?.id);

        // Broadcast caching invalidation
        if (updatedRole?.id && updatedRole?.ulb_id) {
            await SecurityCache.invalidateRole(updatedRole.id, updatedRole.ulb_id);
        }

        genrateResponse(
            res,
            HttpStatus.OK,
            `Role toggled to ${updatedRole?.recstatus} successfully`,
            encryptData(updatedRole)
        )
    } catch (err: any) {
        const error = handlePrismaError(err);
        genrateResponse(res, error.status, error.message);
    }
}
