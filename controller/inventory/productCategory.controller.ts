import { Request, Response } from "express";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import genrateResponse from "../../lib/generateResponse";
import HttpStatus from "../../lib/httpStatus";
import { extractPayload, encryptData } from "../../lib/apiCryptography";
import { inventory } from "../../lib/globalprimsaclient";

export const createCategory = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const data = extractPayload(req.body);
    const user = req.user!;

    if (!data.companyId || !data.categoryName) {
      return genrateResponse(
        res,
        HttpStatus.BadRequest,
        "Company ID and category name are required.",
      );
    }

    const category = await inventory.productCategory.create({
      data: {
        companyId: Number(data.companyId),
        categoryName: String(data.categoryName).trim(),
        code: data.code || null,
        description: data.description || null,
        isActive: data.isActive ?? true,
        groupId: data.groupId || null,
        createdBy: String(user?.userId || "SYSTEM"),
      },
    });

    return genrateResponse(
      res,
      HttpStatus.OK,
      "Category created successfully.",
      encryptData(category),
    );
  } catch (error: any) {
    return genrateResponse(
      res,
      HttpStatus.BadRequest,
      error.message || "Failed to create category.",
    );
  }
};

export const getCategoryList = async (req: Request, res: Response) => {
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
        categoryName: {
          contains: String(search),
          mode: "insensitive" as const,
        },
      }),
    };

    const [categories, total] = await inventory.$transaction([
      inventory.productCategory.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          createdAt: "desc",
        },
      }),

      inventory.productCategory.count({
        where,
      }),
    ]);

    return genrateResponse(
      res,
      HttpStatus.OK,
      "Categories fetched successfully.",
      encryptData({
        categories,
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
      error.message || "Failed to fetch categories.",
    );
  }
};
export const getCategoryById = async (
  req: Request,
  res: Response
) => {
  try {
    const category = await inventory.productCategory.findUnique({
      where: {
        id: Number(req.params.id),
      },
    });

    if (!category || category.recStatus !== 1) {
      return genrateResponse(
        res,
        HttpStatus.NotFound,
        "Category not found."
      );
    }

    return genrateResponse(
      res,
      HttpStatus.OK,
      "Category fetched successfully.",
      encryptData(category)
    );
  } catch (error: any) {
    return genrateResponse(
      res,
      HttpStatus.BadRequest,
      error.message || "Failed to fetch category."
    );
  }
};
export const updateCategory = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const data = extractPayload(req.body);
    const user = req.user!;

    const category = await inventory.productCategory.update({
      where: {
        id: Number(req.params.id),
      },
      data: {
        ...(data.categoryName !== undefined && {
          categoryName: String(data.categoryName).trim(),
        }),
        ...(data.code !== undefined && {
          code: data.code || null,
        }),
        ...(data.description !== undefined && {
          description: data.description || null,
        }),
        ...(data.isActive !== undefined && {
          isActive: Boolean(data.isActive),
        }),
        ...(data.groupId !== undefined && {
          groupId: data.groupId || null,
        }),
        updatedBy: String(user?.userId || "SYSTEM"),
      },
    });

    return genrateResponse(
      res,
      HttpStatus.OK,
      "Category updated successfully.",
      encryptData(category),
    );
  } catch (error: any) {
    return genrateResponse(
      res,
      HttpStatus.BadRequest,
      error.message || "Failed to update category.",
    );
  }
};
export const deleteCategory = async (req: Request, res: Response) => {
  try {
    const category = await inventory.productCategory.update({
      where: {
        id: Number(req.params.id),
      },
      data: {
        recStatus: 0,
      },
    });

    return genrateResponse(
      res,
      HttpStatus.OK,
      "Category deleted successfully.",
      encryptData(category),
    );
  } catch (error: any) {
    return genrateResponse(
      res,
      HttpStatus.BadRequest,
      error.message || "Failed to delete category.",
    );
  }
};
