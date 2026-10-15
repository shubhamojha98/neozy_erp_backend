import { AuthenticatedRequest } from "../../src/core/types";
import { AuthPayload } from "../../type/common.type";
import { panel } from "../../lib/globalprimsaclient";
import genrateResponse from "../../lib/generateResponse";
import HttpStatus from "../../lib/httpStatus";
import { extractPayload, encryptData } from "../../lib/apiCryptography";
import { Request, Response } from "express";
import { handlePrismaError } from "../../lib/prismaErrorHandler";


export const createBank = async (req: Request, res: Response) => {
    try {
        const data = extractPayload(req.body);
        const { bankName } = data;

        const bank = await panel.bank.create({
            data: {
                name: bankName
            },
        });
        genrateResponse(
            res,
            HttpStatus.OK,
            'Bank created successfully',
            encryptData(bank)
        )
    } catch (err: any) {
        const error = handlePrismaError(err);
        genrateResponse(res, error.status, error.message);
    }
}

export const getAllBank = async (req: Request, res: Response) => {
    try {
        const page = Number(req.query.page) || 1
        const limit = Number(req.query.limit) || 10
        const skip = (page - 1) * limit

        const totalCount = await panel.bank.count()

        const bank = await panel.bank.findMany({
            skip,
            take: limit,
            orderBy: { id: "desc" }
        })
        genrateResponse(
            res,
            HttpStatus.OK,
            'All Bank fetched successfully',
            encryptData({ data: bank, pagination: totalCount, page, limit, totalPages: Math.ceil(totalCount / limit) })
        )
    } catch (err: any) {
        const error = handlePrismaError(err);
        genrateResponse(res, error.status, error.message);
    }
}

export const getBankById = async (req: Request, res: Response) => {
    try {
        const data = extractPayload(req.query);

        const bank = await panel.bank.findUnique({
            where: { id: Number(data?.id) }
        });
        if (!bank) {
            return genrateResponse(res, HttpStatus.BadRequest, 'Agency not found')
        }
        genrateResponse(
            res,
            HttpStatus.OK,
            'Bank Fetched successfully',
            encryptData(bank)
        )

    } catch (err: any) {
        const error = handlePrismaError(err);
        genrateResponse(res, error.status, error.message);
    }
}

export const updateBankById = async (req: Request, res: Response) => {
    try {
        const data = extractPayload(req.body);

        const bankUpdate = await panel.bank.update({
            where: { id: Number(data.id) },
            data: {
                name: data.bankName

            }
        })
        genrateResponse(
            res,
            HttpStatus.OK,
            'Bank Updated Successfully',
            encryptData(bankUpdate)
        )

    } catch (err: any) {
        const error = handlePrismaError(err);
        genrateResponse(res, error.status, error.message);
    }
}

export const toggleBank = async (req: Request, res: Response) => {
    try {
        const data = extractPayload(req.body);

        const prevStatus = await panel.bank.findUnique({
            where: { id: Number(data?.id) },
            select: { is_active: true },
        });

        if (!prevStatus) {
            return genrateResponse(res, HttpStatus.NotFound, "Not Found")
        }

        const updatedStatus = await panel.bank.update({
            where: { id: Number(data?.id) },
            data: { is_active: !prevStatus.is_active }
        })
        genrateResponse(
            res,
            HttpStatus.OK,
            `Bank toggled successfully`,
            encryptData(updatedStatus)
        )

    } catch (err: any) {
        const error = handlePrismaError(err);
        genrateResponse(res, error.status, error.message);
    }
}
