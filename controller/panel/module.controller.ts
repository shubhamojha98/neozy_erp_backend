import { Request, Response } from "express";
import { AuthenticatedRequest } from "../../src/core/types";
import { AuthPayload } from "../../type/common.type";
import { PlatformType } from '../../generated/panel/client'
import { panel } from "../../lib/globalprimsaclient";
import genrateResponse from "../../lib/generateResponse";
import HttpStatus from "../../lib/httpStatus";
import { extractPayload, encryptData } from "../../lib/apiCryptography";
import { handlePrismaError } from "../../lib/prismaErrorHandler";
import { SecurityCache } from "../../src/core/SecurityCache";
import socketService from "../../services/socket-service";




export const createModule = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = extractPayload(req.body);
    const { moduleLabel, moduleCode, icon, description, order, platform } = data;

    // Validate platform against enum; default to ALL for backward compat
    const validPlatforms = Object.values(PlatformType);
    const resolvedPlatform: PlatformType =
      platform && validPlatforms.includes(platform as PlatformType)
        ? (platform as PlatformType)
        : PlatformType.ALL;

    const module = await panel.module.create({
      data: {
        label: moduleLabel,
        code: moduleCode,
        icon: icon,
        description: description,
        order: order ? Number(order) : 0,
        platform: resolvedPlatform,
      }
    });
    genrateResponse(
      res,
      HttpStatus.OK,
      'Module Created successfully',
      encryptData(module)
    )

  } catch (err: any) {
    console.error(`[${new Date().toISOString()}]`, err);
    genrateResponse(
      res,
      err?.status || HttpStatus.BadRequest,
      err?.message as string
    );
  }
}

export const getAllModule = async (req: Request, res: Response) => {
  try {
    const page = Number(req.query.page) || 1
    const limit = Number(req.query.limit) || 10
    const skip = (page - 1) * limit

    const totalCount = await panel.module.count()
    const module = await panel.module.findMany({
      skip,
      take: limit,
      orderBy: { id: "desc" }
    })
    genrateResponse(
      res,
      HttpStatus.OK,
      'Module Fetched sucessfully',
      encryptData({
        data: module,
        pagination: totalCount, page, limit, totalPages: Math.ceil(totalCount / limit)
      })
    )

  } catch (err: any) {
    const error = handlePrismaError(err);
    genrateResponse(res, error.status, error.message);
  }
}

export const getModuleById = async (req: Request, res: Response) => {
  try {
    const data = extractPayload(req.query);

    const module = await panel.module.findUnique({
      where: { id: Number(data?.id) }
    });
    if (!module) {
      return genrateResponse(res, HttpStatus.BadRequest, 'Module not found')
    }
    genrateResponse(
      res,
      HttpStatus.OK,
      'Module Fetched successfully',
      encryptData(module)
    )

  } catch (err: any) {
    const error = handlePrismaError(err);
    genrateResponse(res, error.status, error.message);
  }
}

export const updateModuleById = async (req: Request, res: Response) => {
  try {
    const data = extractPayload(req.body);

    // Validate platform if provided; ignore invalid values silently
    const validPlatforms = Object.values(PlatformType);
    const resolvedPlatform: PlatformType | undefined =
      data.platform && validPlatforms.includes(data.platform as PlatformType)
        ? (data.platform as PlatformType)
        : undefined;

    const moduleUpdate = await panel.module.update({
      where: { id: Number(data.id) },
      data: {
        label: data.moduleLabel,
        code: data.moduleCode,
        icon: data.icon,
        description: data.description,
        order: data.order ? Number(data.order) : undefined,
        ...(resolvedPlatform !== undefined && { platform: resolvedPlatform }),
      }
    })
    genrateResponse(
      res,
      HttpStatus.OK,
      'Module Updated Successfully',
      encryptData(moduleUpdate)
    )

  } catch (err: any) {
    const error = handlePrismaError(err);
    genrateResponse(res, error.status, error.message);
  }
}

export const toggleModule = async (req: Request, res: Response) => {
  try {
    const data = extractPayload(req.body);

    const prevStatus = await panel.module.findUnique({
      where: { id: Number(data?.id) },
      select: { is_active: true },
    });

    if (!prevStatus) {
      return genrateResponse(res, HttpStatus.NotFound, "Not Found")
    }

    const updatedStatus = await panel.module.update({
      where: { id: Number(data?.id) },
      data: { is_active: !prevStatus.is_active }
    })

    // Enterprise Kill-Switch: Invalidate globally
    await SecurityCache.invalidateAllUserPermissions();

    // Live UI Update: Notify all connected clients to refetch menus
    socketService.emitGlobal('permissions_updated', { message: 'Modules updated' });

    genrateResponse(
      res,
      HttpStatus.OK,
      `Module toggled successfully`,
      encryptData(updatedStatus)
    )

  } catch (err: any) {
    const error = handlePrismaError(err);
    genrateResponse(res, error.status, error.message);
  }
}
