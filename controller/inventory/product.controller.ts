import { Request, Response } from "express";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import genrateResponse from "../../lib/generateResponse";
import HttpStatus from "../../lib/httpStatus";
import { extractPayload, encryptData } from "../../lib/apiCryptography";
import { inventory } from "../../lib/globalprimsaclient";
import convertBigIntToString from "../../lib/bigIntConversion";

export const createProduct = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const data = extractPayload(req.body);
    const user = req.user!;

    if (
      !data.companyId ||
      !data.productName ||
      !data.sku ||
      !data.unit ||
      !data.hsn ||
      data.productPrice === undefined ||
      data.gstRate === undefined ||
      !data.categoryId
    ) {
      return genrateResponse(
        res,
        HttpStatus.BadRequest,
        "Required product fields are missing.",
      );
    }

    const product = await inventory.product.create({
      data: {
        companyId: Number(data.companyId),
        productName: String(data.productName).trim(),
        sku: String(data.sku).trim(),
        unit: String(data.unit).trim(),
        hsn: String(data.hsn).trim(),
        productPrice: data.productPrice,
        gstRate: data.gstRate,
        categoryId: Number(data.categoryId),
        description: data.description || null,
        photo: data.photo || null,
        status: data.status || null,
        isActive: data.isActive ?? true,
        groupId: data.groupId || null,
        createdBy: String(user?.userId || "SYSTEM"),
      },
    });

    return genrateResponse(
      res,
      HttpStatus.OK,
      "Product created successfully.",
      encryptData(convertBigIntToString(product)),
    );
  } catch (error: any) {
    return genrateResponse(
      res,
      HttpStatus.BadRequest,
      error.message || "Failed to create product.",
    );
  }
};

export const getProductList = async (req: Request, res: Response) => {
  try {
    const { companyId, categoryId, search } = req.query;

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const where = {
      recStatus: 1,

      ...(companyId && {
        companyId: Number(companyId),
      }),

      ...(categoryId && {
        categoryId: Number(categoryId),
      }),

      ...(search && {
        OR: [
          {
            productName: {
              contains: String(search),
              mode: "insensitive" as const,
            },
          },
          {
            sku: {
              contains: String(search),
              mode: "insensitive" as const,
            },
          },
          {
            hsn: {
              contains: String(search),
              mode: "insensitive" as const,
            },
          },
        ],
      }),
    };

    const [products, total] = await inventory.$transaction([
      inventory.product.findMany({
        where,
        skip,
        take: limit,

        include: {
          categoryMaster: true,
        },

        orderBy: {
          createdAt: "desc",
        },
      }),

      inventory.product.count({
        where,
      }),
    ]);

    return genrateResponse(
      res,
      HttpStatus.OK,
      "Products fetched successfully.",
      encryptData({
        products: convertBigIntToString(products),

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
      error.message || "Failed to fetch products.",
    );
  }
};

export const getProductById = async (req: Request, res: Response) => {
  try {
    const product = await inventory.product.findUnique({
      where: {
        id: BigInt(req.params.id),
      },
      include: {
        categoryMaster: true,
      },
    });

    if (!product || product.recStatus !== 1) {
      return genrateResponse(res, HttpStatus.NotFound, "Product not found.");
    }

    return genrateResponse(
      res,
      HttpStatus.OK,
      "Product fetched successfully.",
      encryptData(convertBigIntToString(product)),
    );
  } catch (error: any) {
    return genrateResponse(
      res,
      HttpStatus.BadRequest,
      error.message || "Failed to fetch product.",
    );
  }
};

export const updateProduct = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const data = extractPayload(req.body);
    const user = req.user!;

    const product = await inventory.product.update({
      where: {
        id: BigInt(req.params.id),
      },

      data: {
        ...(data.productName !== undefined && {
          productName: String(data.productName).trim(),
        }),

        ...(data.sku !== undefined && {
          sku: String(data.sku).trim(),
        }),

        ...(data.unit !== undefined && {
          unit: String(data.unit).trim(),
        }),

        ...(data.hsn !== undefined && {
          hsn: String(data.hsn).trim(),
        }),

        ...(data.productPrice !== undefined && {
          productPrice: data.productPrice,
        }),

        ...(data.gstRate !== undefined && {
          gstRate: data.gstRate,
        }),

        ...(data.categoryId !== undefined && {
          categoryId: Number(data.categoryId),
        }),

        ...(data.description !== undefined && {
          description: data.description || null,
        }),

        ...(data.photo !== undefined && {
          photo: data.photo || null,
        }),

        ...(data.status !== undefined && {
          status: data.status || null,
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
      "Product updated successfully.",
      encryptData(convertBigIntToString(product)),
    );
  } catch (error: any) {
    return genrateResponse(
      res,
      HttpStatus.BadRequest,
      error.message || "Failed to update product.",
    );
  }
};

export const deleteProduct = async (req: Request, res: Response) => {
  try {
    const product = await inventory.product.update({
      where: {
        id: BigInt(req.params.id),
      },
      data: {
        recStatus: 0,
      },
    });

    return genrateResponse(
      res,
      HttpStatus.OK,
      "Product deleted successfully.",
      encryptData(convertBigIntToString(product)),
    );
  } catch (error: any) {
    return genrateResponse(
      res,
      HttpStatus.BadRequest,
      error.message || "Failed to delete product.",
    );
  }
};
