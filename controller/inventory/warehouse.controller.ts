import { Request, Response } from "express";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import genrateResponse from "../../lib/generateResponse";
import HttpStatus from "../../lib/httpStatus";
import { extractPayload, encryptData } from "../../lib/apiCryptography";
import { inventory } from "../../lib/globalprimsaclient";
import convertBigIntToString from "../../lib/bigIntConversion";

// CREATE WAREHOUSE
export const createWarehouse = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const data = extractPayload(req.body);
    const user = req.user!;

    if (
      !data.companyId ||
      !data.warehouseName ||
      !data.warehouseLocation ||
      data.capacity === undefined
    ) {
      return genrateResponse(
        res,
        HttpStatus.BadRequest,
        "Required warehouse fields are missing.",
      );
    }

    const warehouse = await inventory.warehouse.create({
      data: {
        companyId: Number(data.companyId),
        warehouseName: String(data.warehouseName).trim(),
        warehouseLocation: String(data.warehouseLocation).trim(),
        capacity: data.capacity,
        address: data.address || null,
        city: data.city || null,
        state: data.state || null,
        pincode: data.pincode ? String(data.pincode) : null,
        code: data.code ? String(data.code).trim() : null,
        latitude: data.latitude !== undefined ? data.latitude : null,
        longitude: data.longitude !== undefined ? data.longitude : null,
        managerName: data.managerName || null,
        managerPhone: data.managerPhone ? String(data.managerPhone) : null,
        isActive: data.isActive ?? true,
        groupId: data.groupId || null,
        createdBy: String(user?.userId || data.createdBy || "SYSTEM"),
      },
    });

    return genrateResponse(
      res,
      HttpStatus.Created,
      "Warehouse created successfully.",
      encryptData(convertBigIntToString(warehouse)),
    );
  } catch (error: any) {
    return genrateResponse(
      res,
      HttpStatus.BadRequest,
      error.message || "Failed to create warehouse.",
    );
  }
};

// GET WAREHOUSE LIST
export const getWarehouseList = async (req: Request, res: Response) => {
  try {
    const { companyId, search } = req.query;

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const where = {
      recStatus: 1,
      ...(companyId && {
        companyId: Number(companyId),
      }),
      ...(search && {
        OR: [
          {
            warehouseName: {
              contains: String(search),
              mode: "insensitive" as const,
            },
          },
          {
            warehouseLocation: {
              contains: String(search),
              mode: "insensitive" as const,
            },
          },
          {
            code: {
              contains: String(search),
              mode: "insensitive" as const,
            },
          },
        ],
      }),
    };

    const [warehouses, total] = await inventory.$transaction([
      inventory.warehouse.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          createdAt: "desc",
        },
      }),

      inventory.warehouse.count({
        where,
      }),
    ]);

    return genrateResponse(
      res,
      HttpStatus.OK,
      "Warehouses fetched successfully.",
      encryptData({
        warehouses: convertBigIntToString(warehouses),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      }),
    );
  } catch (error: any) {
    return genrateResponse(
      res,
      HttpStatus.BadRequest,
      error.message || "Failed to fetch warehouses.",
    );
  }
};

// GET WAREHOUSE BY ID
export const getWarehouseById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const warehouse = await inventory.warehouse.findFirst({
      where: {
        id: Number(id),
        recStatus: 1,
      },
    });

    if (!warehouse) {
      return genrateResponse(res, HttpStatus.NotFound, "Warehouse not found.");
    }

    return genrateResponse(
      res,
      HttpStatus.OK,
      "Warehouse fetched successfully.",
      encryptData(convertBigIntToString(warehouse)),
    );
  } catch (error: any) {
    return genrateResponse(
      res,
      HttpStatus.BadRequest,
      error.message || "Failed to fetch warehouse.",
    );
  }
};

// UPDATE WAREHOUSE
export const updateWarehouse = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const { id } = req.params;
    const data = extractPayload(req.body);
    const user = req.user!;

    const warehouse = await inventory.warehouse.findFirst({
      where: {
        id: Number(id),
        recStatus: 1,
      },
    });

    if (!warehouse) {
      return genrateResponse(res, HttpStatus.NotFound, "Warehouse not found.");
    }

    const updatedWarehouse = await inventory.warehouse.update({
      where: {
        id: Number(id),
      },
      data: {
        ...(data.warehouseName !== undefined && {
          warehouseName: String(data.warehouseName).trim(),
        }),
        ...(data.warehouseLocation !== undefined && {
          warehouseLocation: String(data.warehouseLocation).trim(),
        }),
        ...(data.capacity !== undefined && {
          capacity: data.capacity,
        }),
        ...(data.address !== undefined && {
          address: data.address || null,
        }),
        ...(data.city !== undefined && {
          city: data.city || null,
        }),
        ...(data.state !== undefined && {
          state: data.state || null,
        }),
        ...(data.pincode !== undefined && {
          pincode: data.pincode ? String(data.pincode) : null,
        }),
        ...(data.code !== undefined && {
          code: data.code ? String(data.code).trim() : null,
        }),
        ...(data.latitude !== undefined && {
          latitude: data.latitude,
        }),
        ...(data.longitude !== undefined && {
          longitude: data.longitude,
        }),
        ...(data.managerName !== undefined && {
          managerName: data.managerName || null,
        }),
        ...(data.managerPhone !== undefined && {
          managerPhone: data.managerPhone ? String(data.managerPhone) : null,
        }),
        ...(data.isActive !== undefined && {
          isActive: Boolean(data.isActive),
        }),
        ...(data.groupId !== undefined && {
          groupId: data.groupId || null,
        }),
        updatedBy: String(user?.userId || data.updatedBy || "SYSTEM"),
      },
    });

    return genrateResponse(
      res,
      HttpStatus.OK,
      "Warehouse updated successfully.",
      encryptData(convertBigIntToString(updatedWarehouse)),
    );
  } catch (error: any) {
    return genrateResponse(
      res,
      HttpStatus.BadRequest,
      error.message || "Failed to update warehouse.",
    );
  }
};

// DELETE WAREHOUSE
export const deleteWarehouse = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const { id } = req.params;
    const data = extractPayload(req.body);
    const user = req.user!;

    const warehouse = await inventory.warehouse.findFirst({
      where: {
        id: Number(id),
        recStatus: 1,
      },
    });

    if (!warehouse) {
      return genrateResponse(res, HttpStatus.NotFound, "Warehouse not found.");
    }

    const updatedWarehouse = await inventory.warehouse.update({
      where: {
        id: Number(id),
      },
      data: {
        recStatus: 0,
        updatedBy: String(user?.userId || data?.updatedBy || "SYSTEM"),
      },
    });

    return genrateResponse(
      res,
      HttpStatus.OK,
      "Warehouse deleted successfully.",
      encryptData(convertBigIntToString(updatedWarehouse)),
    );
  } catch (error: any) {
    return genrateResponse(
      res,
      HttpStatus.BadRequest,
      error.message || "Failed to delete warehouse.",
    );
  }
};
