import { Request, Response } from "express"
import genrateResponse from "../../lib/generateResponse"
import { ActionType, PlatformType } from '../../generated/panel/client'
import { panel } from "../../lib/globalprimsaclient";
import HttpStatus from "../../lib/httpStatus"
import { AuthenticatedRequest } from "../../src/core/types"
import { createMenu } from "../../dal/panel.dal"
import { extractPayload, encryptData } from "../../lib/apiCryptography"


export const createMenuPanel = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { label, path, parentId, order, module_id, icon, defaultActions, autoAssignToRole, platform } = req.body;

    if (!module_id) {
      return genrateResponse(res, HttpStatus.BadRequest, "module_id is required");
    }

    // Validate defaultActions against ActionType enum
    if (defaultActions && Array.isArray(defaultActions)) {
      const validActions = Object.values(ActionType);
      const invalidActions = defaultActions.filter(a => !validActions.includes(a as ActionType));
      if (invalidActions.length > 0) {
        return genrateResponse(res, HttpStatus.BadRequest, `Invalid action types: ${invalidActions.join(', ')}`);
      }
    }

    // Validate platform; default ALL
    const validPlatforms = Object.values(PlatformType);
    const resolvedPlatform: PlatformType =
      platform && validPlatforms.includes(platform as PlatformType)
        ? (platform as PlatformType)
        : PlatformType.ALL;

    const newMenu = await createMenu(
      Number(module_id),
      label,
      path,
      parentId ? Number(parentId) : undefined,
      order ? Number(order) : 0,
      defaultActions,
      autoAssignToRole,
      req.ulbId,
      icon,
      resolvedPlatform,
    );

    genrateResponse(
      res,
      HttpStatus.OK,
      "Menu created successfully",
      encryptData(newMenu)
    );
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}]`, err);
    genrateResponse(
      res,
      err?.status || HttpStatus.BadRequest,
      err?.message as string
    );
  }
};


export const getAllMenu = async (req: Request, res: Response) => {
  try {
    const page = Number(req.query.page) || 1
    const limit = Number(req.query.limit) || 10
    const skip = (page - 1) * limit;

    const totalCount = await panel.menu.count()

    const menuData = await panel.menu.findMany({
      skip,
      take: limit,
      orderBy: { id: 'desc' },
      include: {
        actions: true,
        children: true
      }
    })

    genrateResponse(
      res,
      HttpStatus.OK,
      'Menu Fetched Successfully',
      encryptData({
        data: menuData,
        pagination: {
          totalCount,
          page,
          limit,
          totalPages: Math.ceil(totalCount / limit)
        }
      })
    )
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}]`, err);
    genrateResponse(
      res,
      err?.status || HttpStatus.BadRequest,
      err?.message as string
    )
  }
}

export const getMenuById = async (req: Request, res: Response) => {
  try {
    const idObj = extractPayload(req.query);
    const menuId = idObj.id || idObj.menuId || idObj;

    const menu = await panel.menu.findUnique({
      where: { id: Number(menuId) },
      include: {
        actions: true,
        children: true,
        module: true
      }
    })
    if (!menu) {
      return genrateResponse(res, HttpStatus.NotFound, 'Menu not found')
    }

    genrateResponse(
      res,
      HttpStatus.OK,
      'Menu fetched successfully',
      encryptData(menu)
    );

  } catch (err: any) {
    console.error(`[${new Date().toISOString()}]`, err);
    genrateResponse(res, err?.status || HttpStatus.BadRequest, err?.message);
  }
}

export const updateMenuById = async (req: Request, res: Response) => {
  try {
    const data = extractPayload(req.body);

    const activeId = data.id || data.menuId;

    // Validate platform if provided
    const validPlatforms = Object.values(PlatformType);
    const resolvedPlatform: PlatformType | undefined =
      data.platform && validPlatforms.includes(data.platform as PlatformType)
        ? (data.platform as PlatformType)
        : undefined;

    const menuUpdate = await panel.menu.update({
      where: { id: Number(activeId) },
      data: {
        label: data.label,
        path: data.path,
        icon: data.icon,
        parentId: data.parentId ? Number(data.parentId) : null,
        order: data.order ? Number(data.order) : undefined,
        module_id: data.module_id ? Number(data.module_id) : undefined,
        ...(resolvedPlatform !== undefined && { platform: resolvedPlatform }),
      }
    });

    genrateResponse(
      res,
      HttpStatus.OK,
      "Menu Updated Successfully",
      encryptData(menuUpdate)
    );
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}]`, err);
    genrateResponse(res, err?.status || HttpStatus.BadRequest, err?.message);
  }
};

export const toggleMenu = async (req: Request, res: Response) => {
  try {
    const data = extractPayload(req.body);

    const prevStatus = await panel.menu.findUnique({
      where: { id: Number(data?.id) },
      select: { is_active: true },
    });

    if (!prevStatus) {
      return genrateResponse(res, HttpStatus.NotFound, "Not Found")
    }

    const updatedStatus = await panel.menu.update({
      where: { id: Number(data?.id) },
      data: { is_active: !prevStatus.is_active }
    })

    genrateResponse(
      res,
      HttpStatus.OK,
      `Menu toggled successfully`,
      encryptData(updatedStatus)
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
