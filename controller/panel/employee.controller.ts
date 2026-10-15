import { Request, Response } from "express";
import { AuthenticatedRequest } from "../../src/core/types";
import { AuthPayload } from "../../type/common.type";
import { UserType, PermissionEffect } from '../../generated/panel/client'
import { panel } from "../../lib/globalprimsaclient";
import genrateResponse from "../../lib/generateResponse";
import HttpStatus from "../../lib/httpStatus";
import bcrypt from "bcrypt";
import { extractPayload, encryptData } from "../../lib/apiCryptography";
import path from "path";
import { sizeReducer } from "../../lib/sizeReducer";
import { generateEmpCode } from "../../lib/empCodeGenerator";
import { handlePrismaError } from "../../lib/prismaErrorHandler";


// Helper to normalize array-like inputs from multipart/form-data
const normalizeArray = (val: any, body: any, key: string) => {
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') return [val];
    const indexedKeys = Object.keys(body).filter(k => k.startsWith(`${key}[`));
    if (indexedKeys.length > 0) return indexedKeys.map(k => body[k]);
    return [];
};


export const createEmployeeWithUser = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const currentUser = req.user as AuthPayload;
        const empIp = req.ip;

        const {
            username,
            email,
            phone,
            userType,
            agencyId,
            moduleTypeId,
            emp_FirstName,
            emp_LastName,
            emp_aadharNo,
            emp_Address,
            emp_JoiningDate,
            emp_HolderName,
            emp_accountNo,
            emp_ifscCode,
            emp_bankName,
            emp_jobTitle,
            emp_blockPayment,
            emp_Code,
            reportToUserId,
            ulb_id,
            role_id,
            zone_wards,
            revokedPermissions
        } = req.body;

        // Password Generation
        const now = new Date();
        const day = String(now.getDate()).padStart(2, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const initialPassword = `bira@${day}${month}`;

        //  validation
        if (!phone) {
            return genrateResponse(res, HttpStatus.BadRequest, "Phone number is missing or invalid in payload.");
        }

        const file = req?.file
        if (file?.path) {
            await sizeReducer(file.path);
        }

        let parsedZoneWards: { zone_id: number, wards: number[] }[] = [];
        if (zone_wards) {
            try {
                parsedZoneWards = typeof zone_wards === 'string' ? JSON.parse(zone_wards) : zone_wards;
            } catch (e) {
                console.error("Failed to parse zone_wards", e);
            }
        }

        // Handle revokedPermissions
        let permissionsToRevoke: number[] = [];
        if (revokedPermissions) {
            if (Array.isArray(revokedPermissions)) {
                permissionsToRevoke = revokedPermissions.map(id => Number(id));
            } else if (typeof revokedPermissions === 'string') {
                try {
                    const parsed = JSON.parse(revokedPermissions);
                    permissionsToRevoke = Array.isArray(parsed) ? parsed.map(id => Number(id)) : [Number(parsed)];
                } catch {
                    permissionsToRevoke = [Number(revokedPermissions)];
                }
            }
        }

        // ------------------ UNIQUENESS VALIDATION ------------------
        const existingPhone = await panel.user.findFirst({ where: { phone } });
        if (existingPhone) {
            return genrateResponse(res, HttpStatus.Conflict, `Mobile number ${phone} is already registered.`);
        }

        if (emp_aadharNo) {
            const existingAadhar = await panel.employee.findFirst({ where: { aadharNo: emp_aadharNo } });
            if (existingAadhar) {
                return genrateResponse(res, HttpStatus.Conflict, `Aadhar number ${emp_aadharNo} is already registered.`);
            }
        }

        let finalEmpCode = emp_Code;
        if (!finalEmpCode) {
            finalEmpCode = await generateEmpCode();
        }

        const generateSmartUsername = (firstName: string = "", lastName: string = "", phoneNo: string = "") => {
            const fn = firstName.trim().toLowerCase().replace(/[^a-z]/g, '');
            const ln = lastName.trim().toLowerCase().replace(/[^a-z]/g, '');
            const phoneSuffix = phoneNo.length >= 4 ? phoneNo.slice(-4) : Math.floor(1000 + Math.random() * 9000).toString();
            const baseName = ln.length > 0 ? `${fn}${ln.charAt(0)}` : fn;
            return baseName.length > 0 ? `${baseName}${phoneSuffix}` : `emp${phoneSuffix}`;
        };

        let targetUsername = username || generateSmartUsername(emp_FirstName, emp_LastName, phone);

        // Ensure username is globally unique intelligently
        let usernameExists = await panel.user.findFirst({ where: { username: targetUsername } });
        let lockCounter = 0;
        while (usernameExists && lockCounter < 5) {
            targetUsername = `${targetUsername}${Math.floor(10 + Math.random() * 90)}`;
            usernameExists = await panel.user.findFirst({ where: { username: targetUsername } });
            lockCounter++;
        }

        if (usernameExists) {
            return genrateResponse(res, HttpStatus.Conflict, "Username generation collision. Please try again.");
        }

        const finalUsername = targetUsername;

        const [newUser, newEmployee] = await panel.$transaction(async (tx) => {
            // 1. Create User
            const hashedPassword = await bcrypt.hash(initialPassword, 10);
            const user = await tx.user.create({
                data: {
                    username: finalUsername,
                    password: hashedPassword,
                    email,
                    phone,
                    user_type: (userType || 'ULB_USER') as UserType,
                },
            });

            // 2. Create Initial Workspace Mapping
            if (ulb_id && role_id) {
                await tx.ulb_user_mapping.create({
                    data: {
                        user_id: user.id,
                        ulb_id: Number(ulb_id),
                        role_id: Number(role_id),
                        assigned_by: Number(currentUser.userId)
                    }
                });

                if (parsedZoneWards.length > 0) {
                    const mappingsToCreate = [];
                    for (const zw of parsedZoneWards) {
                        const zId = Number(zw.zone_id);
                        if (!zw.wards || zw.wards.length === 0) {
                            mappingsToCreate.push({
                                user_id: user.id,
                                ulb_id: Number(ulb_id),
                                zone_id: zId,
                                ward_id: null,
                                assigned_by: Number(currentUser.userId)
                            });
                        } else {
                            for (const wId of zw.wards) {
                                mappingsToCreate.push({
                                    user_id: user.id,
                                    ulb_id: Number(ulb_id),
                                    zone_id: zId,
                                    ward_id: Number(wId),
                                    assigned_by: Number(currentUser.userId)
                                });
                            }
                        }
                    }
                    if (mappingsToCreate.length > 0) {
                        await tx.user_zone_ward_mapping.createMany({ data: mappingsToCreate });
                    }
                }
            }

            // 3. Create Employee Profile
            const employee = await tx.employee.create({
                data: {
                    user_id: user.id,
                    ulb_id: Number(ulb_id),
                    empCode: finalEmpCode,
                    agency_id: Number(agencyId),
                    module_id: moduleTypeId ? Number(moduleTypeId) : null,
                    empFirstName: emp_FirstName,
                    empLastName: emp_LastName,
                    empEmail: email,
                    aadharNo: emp_aadharNo,
                    empAddress: emp_Address,
                    joiningDate: emp_JoiningDate,
                    accountHolderName: emp_HolderName,
                    accountNo: emp_accountNo,
                    ifscCode: emp_ifscCode,
                    bankName: emp_bankName,
                    jobTitle: emp_jobTitle,
                    reportToUserId: reportToUserId ? Number(reportToUserId) : null,
                    blockPayment: emp_blockPayment === 'true' || emp_blockPayment === true,
                    contactNo: phone,
                    ...(file?.path && { empImage: file?.path })
                },
            });

            // 4. Create Permission Overrides (Revocations)
            if (ulb_id && permissionsToRevoke.length > 0) {
                await tx.user_permission.createMany({
                    data: permissionsToRevoke.map(menuActionId => ({
                        user_id: user.id,
                        ulb_id: Number(ulb_id),
                        menu_action_id: menuActionId,
                        effect: 'REVOKE',
                        granted_by: Number(currentUser.userId)
                    }))
                });
            }

            return [user, employee];
        });

        const { password: _, ...userWithoutPassword } = newUser;

        genrateResponse(res, HttpStatus.OK, "Employee and User created successfully", encryptData({
            userData: userWithoutPassword,
            employeeData: newEmployee,
            initialPassword: initialPassword // Propagate to frontend for one-time display
        }));

    } catch (err: any) {
        const error = handlePrismaError(err);
        genrateResponse(res, error.status, error.message);
    }
}

export const getAllEmployeeWithUser = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { page, limit, search, agencyId, roleId, ulbId } = req.query;
        const p = Number(page) || 1;
        const l = Number(limit) || 10;
        const skip = (p - 1) * l;

        const where: any = {
            AND: [
                { employee: { isNot: null } } // Only users who are employees
            ]
        };

        // 1. Build Search Filter
        if (search) {
            const s = String(search).trim();
            const words = s.split(/\s+/).filter(Boolean);

            const searchConditions: any[] = [
                { username: { contains: s, mode: 'insensitive' } },
                { email: { contains: s, mode: 'insensitive' } },
                { phone: { contains: s, mode: 'insensitive' } },
                {
                    employee: {
                        is: {
                            OR: [
                                { empFirstName: { contains: s, mode: 'insensitive' } },
                                { empLastName: { contains: s, mode: 'insensitive' } },
                                { empEmail: { contains: s, mode: 'insensitive' } },
                                { empCode: { contains: s, mode: 'insensitive' } },
                            ]
                        }
                    }
                }
            ];

            // If there are multiple words, add conditions for individual words to support "First Last" searches
            if (words.length > 1) {
                words.forEach(word => {
                    searchConditions.push({
                        OR: [
                            { username: { contains: word, mode: 'insensitive' } },
                            { employee: { is: { empFirstName: { contains: word, mode: 'insensitive' } } } },
                            { employee: { is: { empLastName: { contains: word, mode: 'insensitive' } } } },
                        ]
                    });
                });
            }

            where.AND.push({ OR: searchConditions });
        }

        // 2. Build Agency Filter
        if (agencyId && agencyId !== 'all') {
            where.AND.push({
                employee: {
                    is: { agency_id: Number(agencyId) }
                }
            });
        }

        // 3. Build Role Filter
        if (roleId && roleId !== 'all') {
            where.AND.push({
                ulb_mappings: {
                    some: { role_id: Number(roleId) }
                }
            });
        }

        // 4. Build ULB Filter
        if (ulbId && ulbId !== 'all') {
            where.AND.push({
                ulb_mappings: {
                    some: { ulb_id: Number(ulbId) }
                }
            });
        }

        const [users, totalCount] = await Promise.all([
            panel.user.findMany({
                where,
                skip,
                take: l,
                orderBy: { id: "desc" },
                include: {
                    employee: {
                        include: { agency: true }
                    },
                    ulb_mappings: {
                        include: {
                            ulb: true,
                            role: true
                        }
                    },
                    zone_ward_scopes: {
                        include: { zone: true, ward: true }
                    }
                },
            }),
            panel.user.count({ where })
        ]);

        const safeUsers = users.map(({ password, ...rest }) => rest);

        genrateResponse(res, HttpStatus.OK, "All Employee with users Fetched Successfully",
            encryptData({
                data: safeUsers,
                pagination: {
                    total: totalCount,
                    page: p,
                    limit: l,
                    totalPages: Math.ceil(totalCount / l),
                }
            }));
    } catch (err: any) {
        const error = handlePrismaError(err);
        genrateResponse(res, error.status, error.message);
    }
};

export const getEmplyoeeWithUserId = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const data = extractPayload(req.query);

        const user = await panel.user.findUnique({
            where: { id: Number(data?.id) },
            include: {
                employee: true,
                ulb_mappings: {
                    include: {
                        ulb: true,
                        role: {
                            include: {
                                role_menu_actions: {
                                    include: {
                                        menu_action: {
                                            include: { menu: true }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                zone_ward_scopes: {
                    include: { zone: true, ward: true }
                },
                permission_grants: {
                    include: {
                        menu_action: {
                            include: { menu: true }
                        }
                    }
                }
            }
        })

        if (!user) {
            throw new Error('No data found')
        }

        const { password, ...rest } = user;

        genrateResponse(
            res,
            HttpStatus.OK,
            'Employee fetched successfully',
            encryptData(rest)
        )
    } catch (err: any) {
        const error = handlePrismaError(err);
        genrateResponse(res, error.status, error.message);
    }
}


export const updateEmployeeWithUser = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const currentUser = req.user as AuthPayload;
        const empIp = req.ip;

        const {
            userId,
            userEmail,
            userPhone,
            agencyId,
            moduleTypeId,
            emp_FirstName,
            emp_LastName,
            emp_aadharNo,
            emp_Address,
            emp_JoiningDate,
            emp_HolderName,
            emp_accountNo,
            emp_ifscCode,
            emp_bankName,
            emp_jobTitle,
            emp_blockPayment,
            emp_Code,
            reportToUserId,
            ulb_id,
            role_id,
            zone_wards,
            revokedPermissions
        } = req.body;

        const file = req?.file
        if (file?.path) {
            await sizeReducer(file.path);
        }

        let parsedZoneWards: { zone_id: number, wards: number[] }[] = [];
        if (zone_wards) {
            try {
                parsedZoneWards = typeof zone_wards === 'string' ? JSON.parse(zone_wards) : zone_wards;
            } catch (e) {
                console.error("Failed to parse zone_wards", e);
            }
        }

        // Handle revokedPermissions (may come as single value or array from multipart/form-data)
        let permissionsToRevoke: number[] = [];
        if (revokedPermissions) {
            if (Array.isArray(revokedPermissions)) {
                permissionsToRevoke = revokedPermissions.map(id => Number(id));
            } else if (typeof revokedPermissions === 'string') {
                try {
                    // Try parsing as JSON array
                    const parsed = JSON.parse(revokedPermissions);
                    permissionsToRevoke = Array.isArray(parsed) ? parsed.map(id => Number(id)) : [Number(parsed)];
                } catch {
                    // Fallback to single ID
                    permissionsToRevoke = [Number(revokedPermissions)];
                }
            }
        }

        const [updatedUser, updatedEmployee] = await panel.$transaction(async (tx) => {
            const user = await tx.user.update({
                where: { id: Number(userId) },
                data: {
                    email: userEmail,
                    phone: userPhone,
                },
            });

            const employee = await tx.employee.update({
                where: { user_id: user.id },
                data: {
                    agency_id: agencyId ? Number(agencyId) : undefined,
                    module_id: typeof moduleTypeId !== 'undefined' ? (moduleTypeId ? Number(moduleTypeId) : null) : undefined,
                    ulb_id: ulb_id ? Number(ulb_id) : undefined,
                    empFirstName: emp_FirstName,
                    empLastName: emp_LastName,
                    empEmail: userEmail,
                    aadharNo: emp_aadharNo,
                    empAddress: emp_Address,
                    joiningDate: emp_JoiningDate,
                    accountHolderName: emp_HolderName,
                    accountNo: emp_accountNo,
                    ifscCode: emp_ifscCode,
                    bankName: emp_bankName,
                    jobTitle: emp_jobTitle,
                    empCode: emp_Code,
                    reportToUserId: reportToUserId ? Number(reportToUserId) : undefined,
                    blockPayment: typeof emp_blockPayment !== 'undefined' ? (emp_blockPayment === 'true' || emp_blockPayment === true) : undefined,
                    contactNo: userPhone,
                    ...(file?.path && { empImage: file?.path })
                },
            });

            // Upsert workspace mapping if ulb_id + role_id are provided
            if (ulb_id && role_id) {
                await tx.ulb_user_mapping.upsert({
                    where: {
                        user_id_ulb_id: {
                            user_id: Number(userId),
                            ulb_id: Number(ulb_id),
                        }
                    },
                    create: {
                        user_id: Number(userId),
                        ulb_id: Number(ulb_id),
                        role_id: Number(role_id),
                        assigned_by: Number(currentUser.userId),
                    },
                    update: {
                        role_id: Number(role_id),
                    },
                });

                // Wipe existing zone_ward mapping for this ULB and user
                await tx.user_zone_ward_mapping.deleteMany({
                    where: { user_id: Number(userId), ulb_id: Number(ulb_id) }
                });

                if (parsedZoneWards.length > 0) {
                    const mappingsToCreate = [];
                    for (const zw of parsedZoneWards) {
                        const zId = Number(zw.zone_id);
                        if (!zw.wards || zw.wards.length === 0) {
                            mappingsToCreate.push({
                                user_id: Number(userId),
                                ulb_id: Number(ulb_id),
                                zone_id: zId,
                                ward_id: null,
                                assigned_by: Number(currentUser.userId)
                            });
                        } else {
                            for (const wId of zw.wards) {
                                mappingsToCreate.push({
                                    user_id: Number(userId),
                                    ulb_id: Number(ulb_id),
                                    zone_id: zId,
                                    ward_id: Number(wId),
                                    assigned_by: Number(currentUser.userId)
                                });
                            }
                        }
                    }
                    if (mappingsToCreate.length > 0) {
                        await tx.user_zone_ward_mapping.createMany({ data: mappingsToCreate });
                    }
                }
            }

            // 4. Handle Permission Overrides (Revocations)
            // Always wipe existing overrides for this user + ulb context within the same transaction
            if (ulb_id) {
                await tx.user_permission.deleteMany({
                    where: {
                        user_id: Number(userId),
                        ulb_id: Number(ulb_id)
                    }
                });

                if (permissionsToRevoke.length > 0) {
                    await tx.user_permission.createMany({
                        data: permissionsToRevoke.map(menuActionId => ({
                            user_id: Number(userId),
                            ulb_id: Number(ulb_id),
                            menu_action_id: menuActionId,
                            effect: 'REVOKE',
                            granted_by: Number(currentUser.userId)
                        }))
                    });
                }
            }

            return [user, employee];
        });

        const { password, ...userWithoutPassword } = updatedUser;

        genrateResponse(
            res,
            HttpStatus.OK,
            "Employee updated successfully",
            encryptData({ userData: userWithoutPassword, employeeData: updatedEmployee })
        );
    } catch (err: any) {
        const error = handlePrismaError(err);
        genrateResponse(res, error.status, error.message);
    }
};

export const toggleUserStatus = async (req: Request, res: Response) => {
    try {
        const data = extractPayload(req.body);
        const userId = Number(data?.id);

        const result = await panel.$transaction(async (tx) => {
            const user = await tx.user.findUnique({
                where: { id: userId },
                select: { is_active: true },
            });

            if (!user) throw { status: HttpStatus.NotFound, message: "User not found" };

            const updatedUser = await tx.user.update({
                where: { id: userId },
                data: { is_active: !user.is_active },
            });

            return updatedUser;
        });

        genrateResponse(res, HttpStatus.OK, `User status toggled successfully`, encryptData(result));
    } catch (err: any) {
        console.error(`[${new Date().toISOString()}]`, err)
        genrateResponse(res, err?.status || HttpStatus.BadRequest, err?.message as string);
    }
};

export const connectUlb = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const data = extractPayload(req.body);
        const { user_id, ulb_id, role_id, zone_wards } = data; // zone_wards is expected to be an array
        const currentUser = req.user as AuthPayload;

        const result = await panel.$transaction(async (tx) => {
            const mapping = await tx.ulb_user_mapping.upsert({
                where: {
                    user_id_ulb_id: {
                        user_id: Number(user_id),
                        ulb_id: Number(ulb_id)
                    }
                },
                create: {
                    user_id: Number(user_id),
                    ulb_id: Number(ulb_id),
                    role_id: Number(role_id),
                    assigned_by: currentUser?.userId ? Number(currentUser.userId) : null
                },
                update: {
                    role_id: Number(role_id),
                }
            });

            if (Array.isArray(zone_wards)) {
                await tx.user_zone_ward_mapping.deleteMany({
                    where: { user_id: Number(user_id), ulb_id: Number(ulb_id) }
                });

                const mappingsToCreate = [];
                for (const zw of zone_wards) {
                    const zId = Number(zw.zone_id);
                    if (!zw.wards || zw.wards.length === 0) {
                        mappingsToCreate.push({
                            user_id: Number(user_id),
                            ulb_id: Number(ulb_id),
                            zone_id: zId,
                            ward_id: null,
                            assigned_by: currentUser?.userId ? Number(currentUser.userId) : null
                        });
                    } else {
                        for (const wId of zw.wards) {
                            mappingsToCreate.push({
                                user_id: Number(user_id),
                                ulb_id: Number(ulb_id),
                                zone_id: zId,
                                ward_id: Number(wId),
                                assigned_by: currentUser?.userId ? Number(currentUser.userId) : null
                            });
                        }
                    }
                }
                if (mappingsToCreate.length > 0) {
                    await tx.user_zone_ward_mapping.createMany({ data: mappingsToCreate });
                }
            }

            const updatedScopes = await tx.user_zone_ward_mapping.findMany({
                where: { user_id: Number(user_id), ulb_id: Number(ulb_id) }
            });

            // Group into zone_wards format
            const scopeMap = updatedScopes.reduce((acc: any, curr: any) => {
                if (!acc[curr.zone_id]) acc[curr.zone_id] = [];
                if (curr.ward_id) acc[curr.zone_id].push(curr.ward_id);
                return acc;
            }, {});

            const finalZoneWards = Object.entries(scopeMap).map(([zId, wIds]) => ({
                zone_id: Number(zId),
                wards: wIds
            }));

            return {
                ...mapping,
                zone_wards: finalZoneWards
            };
        });

        genrateResponse(res, HttpStatus.OK, `ULB Workspace mapping updated successfully`, encryptData(result));
    } catch (err: any) {
        const error = handlePrismaError(err);
        genrateResponse(res, error.status, error.message);
    }
}

export const disconnectUlb = async (req: Request, res: Response) => {
    try {
        const data = extractPayload(req.body);
        const { user_id, ulb_id } = data;

        await panel.ulb_user_mapping.delete({
            where: {
                user_id_ulb_id: {
                    user_id: Number(user_id),
                    ulb_id: Number(ulb_id)
                }
            }
        });

        genrateResponse(res, HttpStatus.OK, `ULB Workspace mapping removed successfully`);
    } catch (err: any) {
        const error = handlePrismaError(err);
        genrateResponse(res, error.status, error.message);
    }
}

export const mapWardsToUser = async (req: Request, res: Response) => {
    try {
        const data = extractPayload(req.body);
        const { user_id, ulb_id, zone_id, ward_id } = data; // Backward compat note: mapWardsToUser is replaced strictly by connectUlb above

        // To support old route or simple updates:
        if (zone_id) {
            await panel.user_zone_ward_mapping.create({
                data: {
                    user_id: Number(user_id),
                    ulb_id: Number(ulb_id),
                    zone_id: Number(zone_id),
                    ward_id: ward_id ? Number(ward_id) : null,
                }
            });
        }

        genrateResponse(res, HttpStatus.OK, "Ward scope updated successfully");
    } catch (err: any) {
        genrateResponse(res, HttpStatus.BadRequest, err.message);
    }
};

export const mapPermissionToUser = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const data = extractPayload(req.body);
        const { userId, actionId, ulb_id, effect } = data;
        const currentUser = req.user as AuthPayload;

        if (effect === 'NONE') {
            await panel.user_permission.deleteMany({
                where: {
                    user_id: Number(userId),
                    ulb_id: Number(ulb_id),
                    menu_action_id: Number(actionId)
                }
            });
            return genrateResponse(res, HttpStatus.OK, 'Permission override removed successfully');
        }

        const perm = await panel.user_permission.upsert({
            where: {
                user_id_ulb_id_menu_action_id: {
                    user_id: Number(userId),
                    ulb_id: Number(ulb_id),
                    menu_action_id: Number(actionId)
                }
            },
            create: {
                user_id: Number(userId),
                ulb_id: Number(ulb_id),
                menu_action_id: Number(actionId),
                effect: effect as PermissionEffect,
                granted_by: Number(currentUser.userId)
            },
            update: {
                effect: effect as PermissionEffect
            }
        });

        genrateResponse(res, HttpStatus.OK, "User permission override updated", encryptData(perm));
    } catch (err: any) {
        genrateResponse(res, HttpStatus.BadRequest, err.message);
    }
};

export const bulkMapPermissionsToUser = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const data = extractPayload(req.body);
        const { userId, ulb_id, overrides } = data; // overrides: Array<{ actionId, effect }>
        const currentUser = req.user as AuthPayload;

        if (!Array.isArray(overrides)) {
            return genrateResponse(res, HttpStatus.BadRequest, "Overrides must be an array");
        }

        const results = await panel.$transaction(async (tx) => {
            const out = [];
            for (const item of overrides) {
                const { actionId, effect } = item;
                if (effect === 'NONE') {
                    await tx.user_permission.deleteMany({
                        where: {
                            user_id: Number(userId),
                            ulb_id: Number(ulb_id),
                            menu_action_id: Number(actionId)
                        }
                    });
                } else {
                    const perm = await tx.user_permission.upsert({
                        where: {
                            user_id_ulb_id_menu_action_id: {
                                user_id: Number(userId),
                                ulb_id: Number(ulb_id),
                                menu_action_id: Number(actionId)
                            }
                        },
                        create: {
                            user_id: Number(userId),
                            ulb_id: Number(ulb_id),
                            menu_action_id: Number(actionId),
                            effect: effect as PermissionEffect,
                            granted_by: Number(currentUser.userId)
                        },
                        update: {
                            effect: effect as PermissionEffect
                        }
                    });
                    out.push(perm);
                }
            }
            return out;
        });

        genrateResponse(res, HttpStatus.OK, "Bulk permissions updated successfully", encryptData(results));
    } catch (err: any) {
        const error = handlePrismaError(err);
        genrateResponse(res, error.status, error.message);
    }
}

export const getModuleByEmployeeId = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const currentUser = req.user as any;
        const userId = currentUser.userId;
        const userType: string = currentUser.userType ?? '';
        const ulb_id = req.query.ulb_id ? Number(req.query.ulb_id) : undefined;

        // 1. Fetch ALL active menus first to avoid multiple queries or shallow depth limits
        const flatMenus = await panel.menu.findMany({
            where: { is_active: true },
            orderBy: { order: 'asc' },
            include: { module: { select: { code: true } } }
        });
        const menuById = new Map(flatMenus.map(m => [m.id, m]));

        const PRIVILEGED_TYPES = ['SUPER_ADMIN', 'PROJECT_MANAGER'];
        const permissions = new Set<string>();
        const allowedMenuIds = new Set<number>();

        if (PRIVILEGED_TYPES.includes(userType)) {
            // ================================================================
            // PRIVILEGED BYPASS — SUPER_ADMIN and PROJECT_MANAGER get ALL active menus
            // ================================================================
            flatMenus.forEach(m => allowedMenuIds.add(m.id));

            // Build wildcard permissions from every active action
            const allActions = await panel.menu_action.findMany({
                where: { is_active: true },
                include: { menu: { include: { module: { select: { code: true } } } } }
            });
            allActions.forEach((ma: any) => {
                const mod = ma.menu.module?.code?.toUpperCase() ?? 'UNKNOWN';
                permissions.add(`${mod}:${ma.action}`);
                permissions.add(`${mod}:*`); // Wildcard grants full module access
            });
        } else {
            // ================================================================
            // STANDARD PATH — resolve actions from assigned role and overrides
            // ================================================================
            const user = await panel.user.findUnique({
                where: { id: userId },
                include: {
                    ulb_mappings: {
                        where: ulb_id ? { ulb_id } : {},
                        include: { role: { include: { role_menu_actions: true } } }
                    },
                    permission_grants: true
                }
            });

            if (!user) return genrateResponse(res, HttpStatus.NotFound, 'User not found');

            const activeActionIds = new Set<number>();

            // Step 1 — Collect inherent role actions
            (user as any).ulb_mappings.forEach((mapping: any) => {
                if (mapping.role && mapping.role.recstatus === 1) {
                    mapping.role.role_menu_actions.forEach((rma: any) => {
                        if (rma.is_active) activeActionIds.add(rma.menu_action_id);
                    });
                }
            });

            // Step 2 — Apply direct user-level overrides (GRANT/REVOKE)
            (user as any).permission_grants.forEach((up: any) => {
                if (up.effect === 'REVOKE') {
                    activeActionIds.delete(up.menu_action_id);
                } else if (up.effect === 'GRANT') {
                    activeActionIds.add(up.menu_action_id);
                }
            });

            // Step 3 — Resolve final labels and menu mappings from the active set
            const finalActions = await panel.menu_action.findMany({
                where: { id: { in: Array.from(activeActionIds) }, is_active: true },
                include: { menu: { include: { module: { select: { code: true } } } } }
            });

            finalActions.forEach(ma => {
                const mod = ma.menu.module?.code?.toUpperCase() ?? 'UNKNOWN';
                permissions.add(`${mod}:${ma.action}`);
                if (ma.menu.is_active) allowedMenuIds.add(ma.menu.id);
            });
        }

        // 2. Resolve final visibility set (allowed menus + all their ancestors)
        const activeAndVisibleIds = new Set<number>();
        allowedMenuIds.forEach(id => {
            let currId: number | null = id;
            while (currId) {
                activeAndVisibleIds.add(currId);
                const menu = menuById.get(currId);
                currId = menu?.parentId ?? null;
            }
        });

        // 3. Reconstruct recursive tree structure (Arbitrary Depth)
        const buildTree = (parentId: number | null = null): any[] => {
            return flatMenus
                .filter(m => m.parentId === parentId && activeAndVisibleIds.has(m.id))
                .map(m => ({
                    ...m,
                    children: buildTree(m.id)
                }));
        };

        const menuTree = buildTree(null);

        return genrateResponse(res, HttpStatus.OK, 'Menus fetched successfully', {
            permissions: Array.from(permissions),
            menus: menuTree,
        });

    } catch (err: any) {
        console.error('[getModuleByEmployeeId]', err);
        return genrateResponse(res, HttpStatus.InternalServerError, 'Something went wrong');
    }
};

