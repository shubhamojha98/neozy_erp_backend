import { Request, Response } from 'express';
import { ActionType } from '../../generated/panel/client'
import { panel } from "../../lib/globalprimsaclient";
import genrateResponse from '../../lib/generateResponse';
import HttpStatus from '../../lib/httpStatus';
import { extractPayload, encryptData } from '../../lib/apiCryptography';
import { createMenuAction, getMenuAction, getMenuActions } from '../../dal/panel.dal';
import { AuthenticatedRequest } from "../../src/core/types";
import { handlePrismaError } from '../../lib/prismaErrorHandler';


export const create = async (req: AuthenticatedRequest, res: Response) => {
    try {
        // const { iv, ed } = req.body;
        // const data = extractPayload({ encryptedData: ed as string, iv: iv as string });
        // const { menu_id, action, label } = data;

        const { menu_id, action, label } = req.body;

        if (!menu_id || !action || !label) {
            return genrateResponse(res, HttpStatus.BadRequest, "menu_id, action, and label are required");
        }

        const createdAction = await panel.menu_action.create({
            data: {
                menu_id: Number(menu_id),
                action: action as ActionType,
                label: label
            }
        });

        genrateResponse(
            res,
            HttpStatus.OK,
            'Menu action created successfully',
            encryptData(createdAction)
        )
    } catch (err: any) {
        const error = handlePrismaError(err);
        genrateResponse(res, error.status, error.message);
    }
}

export const getOne = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const id = extractPayload(req.query);

        const action = await getMenuAction(Number(id))

        if (!action) {
            return genrateResponse(res, HttpStatus.NotFound, "Menu Action not found");
        }

        genrateResponse(
            res,
            HttpStatus.OK,
            'Menu Action fetched successfully',
            encryptData(action)
        )
    } catch (err: any) {
        const error = handlePrismaError(err);
        genrateResponse(res, error.status, error.message);
    }
}

export const getAll = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { label, page, limit } = req.query

        const results = await getMenuActions({ label: label as string }, { page: Number(page), limit: Number(limit) } as any);

        genrateResponse(
            res,
            HttpStatus.OK,
            'Menu Actions fetched successfully',
            encryptData({
                data: results?.data,
                pagination: results?.pagination
            })
        )
    } catch (err: any) {
        const error = handlePrismaError(err);
        genrateResponse(res, error.status, error.message);
    }
}

export const update = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const data = extractPayload(req.body);

        const updated = await panel.menu_action.update({
            where: { id: Number(data.id) },
            data: {
                label: data.label,
                action: data.action as ActionType
            }
        });

        genrateResponse(
            res,
            HttpStatus.OK,
            'Menu Action updated successfully',
            encryptData(updated)
        )
    } catch (err: any) {
        const error = handlePrismaError(err);
        genrateResponse(res, error.status, error.message);
    }
}

export const toggle = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const data = extractPayload(req.body);

        const current = await panel.menu_action.findUnique({ where: { id: Number(data.id) } });
        if (!current) throw new Error("Action not found");

        const updated = await panel.menu_action.update({
            where: { id: Number(data.id) },
            data: { is_active: !current.is_active }
        });

        genrateResponse(
            res,
            HttpStatus.OK,
            `Action toggled successfully`,
            encryptData(updated)
        )
    } catch (err: any) {
        const error = handlePrismaError(err);
        genrateResponse(res, error.status, error.message);
    }
}
