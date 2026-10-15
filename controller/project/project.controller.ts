import { Request, Response } from "express";
import { AuthenticatedRequest } from "../../middleware/authMiddleware";
import { AuthPayload } from "../../type/common.type";
import genrateResponse from "../../lib/generateResponse";
import HttpStatus from "../../lib/httpStatus";
import {
  extractPayload,
  encryptData,
  decryptData,
} from "../../lib/apiCryptography";
import { project } from "../../lib/globalprimsaclient";
import convertBigIntToString from "../../lib/bigIntConversion";

export const createProject = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const data = extractPayload(req.body);

    const userId = Number.isNaN(Number(req.user?.uid))
      ? 1
      : Number(req.user?.uid);

    const companyId = Number.isNaN(Number(data.companyId))
      ? 1
      : Number(data.companyId);

    const result = await project.$transaction(async (tx) => {
      let customerId: number | null = null;

      if (data.customerId) {
        const parsed = Number(data.customerId);

        if (!Number.isNaN(parsed)) {
          customerId = parsed;
        }
      }

      console.log(data, "ddd");

      // If customerId is not provided, create/reuse customer
      const customerPayload =
        data.customer ||
        (data.customerName && data.customerPhone ? data : null);

      if (!customerId && customerPayload) {
        const phone = String(
          customerPayload.customerPhone || customerPayload.phone || "",
        ).trim();

        const name = String(
          customerPayload.customerName || customerPayload.name || "",
        ).trim();

        const email =
          customerPayload.customerEmail || customerPayload.email || null;

        const type =
          customerPayload.customerType || customerPayload.type || "B2C";

        if (!phone || !name) {
          throw new Error("Customer name and phone number are required.");
        }

        // Check existing customer
        const existingCustomer = await tx.customer.findUnique({
          where: {
            customerPhone: phone,
          },
        });

        if (existingCustomer) {
          customerId = existingCustomer.id;
        } else {
          const customerCode =
            customerPayload.customerCode ||
            `CUST-${Date.now().toString().slice(-6)}`;

          const createdCustomer = await tx.customer.create({
            data: {
              companyId,
              customerCode,
              customerName: name,
              customerPhone: phone,
              customerEmail: email,
              customerType: type,
              createdBy: userId,
              groupId: data.groupId || null,
            },
          });

          customerId = createdCustomer.id;
        }
      }

      if (!customerId) {
        throw new Error(
          "A valid customerId or new customer details (name and phone) must be provided.",
        );
      }

      // ============================================================
      // 2. CREATE PROJECT
      // ============================================================

      const projectCode =
        data.projectCode || `PRJ-${Date.now().toString().slice(-6)}`;

      const newProject = await tx.project.create({
        data: {
          companyId,
          projectCode,
          customerId,

          leadId: data.leadId ? String(data.leadId) : null,

          capacityKw: Number(data.capacityKw) || 0,

          projectType: data.projectType || "Residential",

          stage: data.stage || "QUOTATION",

          status: data.status || "ACTIVE",

          salesOwnerId: data.salesOwnerId ? Number(data.salesOwnerId) : null,

          salesOwnerName: data.salesOwnerName || data.salesOwner || null,

          surveyorId: data.surveyorId ? Number(data.surveyorId) : null,

          surveyorName: data.surveyorName || data.assignedSurveyor || null,

          installerId: data.installerId ? Number(data.installerId) : null,

          installerName: data.installerName || data.assignedInstaller || null,

          managerId: data.managerId ? Number(data.managerId) : null,

          managerName: data.managerName || null,

          addressLine1: data.addressLine1 || null,

          addressLine2: data.addressLine2 || null,

          landmark: data.landmark || null,

          city: data.city || null,

          district: data.district || null,

          state: data.state || null,

          pincode: data.pincode || null,

          country: data.country || "India",

          notes: data.notes || null,

          groupId: data.groupId || null,

          createdBy: userId,
        },
      });

      // ============================================================
      // 3. CREATE SURVEY
      // ============================================================

      const surveyId =
        data.surveyId || `SUR-${Date.now().toString().slice(-6)}`;

      const newSurvey = await tx.survey.create({
        data: {
          companyId,

          surveyId,

          projectId: newProject.id,

          scheduledDate: data.scheduledDate
            ? new Date(data.scheduledDate)
            : null,

          surveyorId: data.surveyorId ? Number(data.surveyorId) : null,

          status: data.surveyStatus || "PENDING",

          notes: data.surveyNotes || null,

          groupId: data.groupId || null,

          createdBy: userId,
        },
      });

      // ============================================================
      // 4. CREATE ENGINEERING DESIGN
      // ============================================================

      const designId =
        data.designId || `ENG-${Date.now().toString().slice(-6)}`;

      const newEngineering = await tx.engineeringDesign.create({
        data: {
          companyId,

          designId,

          surveyId: newSurvey.id,

          capacityKw:
            data.engineeringCapacityKw !== undefined
              ? Number(data.engineeringCapacityKw)
              : Number(data.capacityKw) || null,

          designerId: data.designerId ? Number(data.designerId) : null,

          status: data.engineeringStatus || "PENDING",

          groupId: data.groupId || null,

          createdBy: userId,
        },
      });

      // ============================================================
      // 5. RETURN COMPLETE HIERARCHY
      // ============================================================

      return tx.project.findUnique({
        where: {
          id: newProject.id,
        },
        include: {
          customer: true,

          surveys: {
            include: {
              engineering: true,
            },
          },
        },
      });
    });

    return genrateResponse(
      res,
      HttpStatus.OK,
      "Project, survey and engineering design created successfully.",
      convertBigIntToString(result),
    );
  } catch (error: any) {
    console.error("createProject error:", error);

    return genrateResponse(
      res,
      HttpStatus.BadRequest,
      error.message || "Failed to create project.",
    );
  }
};

// export const createProject = async (
//   req: AuthenticatedRequest,
//   res: Response,
// ) => {
//   try {

//     const data = extractPayload(req.body);
//   //  const { iv, encryptedData } = req.body;

//   //   console.log("request Body ", req.body);
//   //   const data = decryptData({
//   //     encryptedData: encryptedData as string,
//   //     iv: iv as string,
//   //   });

//     const userId = Number.isNaN(Number(req.user?.uid)) ? 1 : Number(req.user?.uid);
//     const companyId = Number.isNaN(Number(data.companyId)) ? 1 : Number(data.companyId);
//     const newProject = await project.$transaction(async (tx) => {
//       let customerId: number | null = null;
//       if (data.customerId) {
//         const parsed = Number(data.customerId);
//         if (!Number.isNaN(parsed)) {
//           customerId = parsed;
//         }
//       }

//       // If customerId is not found/given, check for new customer data
//       const customerPayload = data.customer || (data.customerName && data.customerPhone ? data : null);

//       if (!customerId && customerPayload) {
//         const phone = String(customerPayload.customerPhone || customerPayload.phone || '').trim();
//         const name = String(customerPayload.customerName || customerPayload.name || '').trim();
//         const email = customerPayload.customerEmail || customerPayload.email || null;
//         const type = customerPayload.customerType || customerPayload.type || 'B2C';

//         if (!phone || !name) {
//           throw new Error("Customer name and phone number are required.");
//         }

//         // Reuse if phone already exists
//         const existingCustomer = await tx.customer.findUnique({
//           where: { customerPhone: phone },
//         });

//         if (existingCustomer) {
//           customerId = existingCustomer.id;
//         } else {
//           const customerCode = customerPayload.customerCode || `CUST-${Date.now().toString().slice(-6)}`;

//           const createdCustomer = await tx.customer.create({
//             data: {
//               companyId,
//               customerCode,
//               customerName: name,
//               customerPhone: phone,
//               customerEmail: email,
//               customerType: type,
//               createdBy: userId,
//               groupId: data.groupId || null,
//             },
//           });

//           customerId = createdCustomer.id;
//         }
//       }

//       if (!customerId) {
//         throw new Error("A valid customerId or new customer details (name and phone) must be provided.");
//       }

//       const projectCode = data.projectCode || `PRJ-${Date.now().toString().slice(-6)}`;

//       return tx.project.create({
//         data: {
//           companyId,
//           projectCode,
//           customerId,
//           leadId: data.leadId ? String(data.leadId) : null,
//           capacityKw: Number(data.capacityKw) || 0,
//           projectType: data.projectType || 'Residential',
//           stage: data.stage || 'QUOTATION',
//           status: data.status || 'ACTIVE',
//           salesOwnerId: data.salesOwnerId ? Number(data.salesOwnerId) : null,
//           salesOwnerName: data.salesOwnerName || data.salesOwner || null,
//           surveyorId: data.surveyorId ? Number(data.surveyorId) : null,
//           surveyorName: data.surveyorName || data.assignedSurveyor || null,
//           installerId: data.installerId ? Number(data.installerId) : null,
//           installerName: data.installerName || data.assignedInstaller || null,
//           managerId: data.managerId ? Number(data.managerId) : null,
//           managerName: data.managerName || null,
//           addressLine1: data.addressLine1 || null,
//           addressLine2: data.addressLine2 || null,
//           landmark: data.landmark || null,
//           city: data.city || null,
//           district: data.district || null,
//           state: data.state || null,
//           pincode: data.pincode || null,
//           country: data.country || 'India',
//           notes: data.notes || null,
//           groupId: data.groupId || null,
//           createdBy: userId,
//         },
//         include: {
//           customer: true,
//         },
//       });
//     });

//     return genrateResponse(
//       res,
//       HttpStatus.OK,
//       "Project created successfully.",
//       convertBigIntToString(newProject),
//     );
//   } catch (error: any) {
//     console.error("createProject error:", error);
//     return genrateResponse(
//       res,
//       HttpStatus.BadRequest,
//       error.message || "Failed to create project.",
//     );
//   }
// };

export const getAllProjects = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const companyId = req.query.companyId;
    const projects = await project.project.findMany({
      where: {
        companyId: Number(companyId),
      },
      orderBy: {
        id: "desc",
      },
      include: {
        customer: true,

        surveys: {
          include: {
            engineering: true,
          },
        },
      },
    });

    return genrateResponse(
      res,
      HttpStatus.OK,
      "Projects fetched successfully.",
      convertBigIntToString(projects),
    );
  } catch (error: any) {
    return genrateResponse(
      res,
      HttpStatus.BadRequest,
      error.message || "Failed to fetch projects.",
    );
  }
};

export const updateProject = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  try {
    const data = extractPayload(req.body);

    const projectId = Number(req.params.id);

    if (!projectId || Number.isNaN(projectId)) {
      throw new Error("Valid project ID is required.");
    }

    const userId = Number.isNaN(Number(req.user?.uid))
      ? 1
      : Number(req.user?.uid);

    const companyId = Number.isNaN(Number(data.companyId))
      ? 1
      : Number(data.companyId);

    const result = await project.$transaction(async (tx) => {
      // ============================================================
      // 1. GET EXISTING PROJECT
      // ============================================================

      const existingProject = await tx.project.findUnique({
        where: {
          id: projectId,
        },
        include: {
          customer: true,
          surveys: {
            include: {
              engineering: true,
            },
          },
        },
      });

      if (!existingProject) {
        throw new Error("Project not found.");
      }

      // ============================================================
      // 2. UPDATE CUSTOMER
      // ============================================================

      let customerId = existingProject.customerId;

      const customerPayload =
        data.customer ||
        (data.customerName || data.customerPhone ? data : null);

      if (customerPayload) {
        const phone = String(
          customerPayload.customerPhone ||
            customerPayload.phone ||
            existingProject.customer.customerPhone ||
            "",
        ).trim();

        const name = String(
          customerPayload.customerName ||
            customerPayload.name ||
            existingProject.customer.customerName ||
            "",
        ).trim();

        if (!phone || !name) {
          throw new Error("Customer name and phone number are required.");
        }

        // If phone changed, check whether another customer already has it
        const existingCustomer = await tx.customer.findFirst({
          where: {
            customerPhone: phone,
            NOT: {
              id: existingProject.customerId,
            },
          },
        });

        if (existingCustomer) {
          customerId = existingCustomer.id;
        } else {
          await tx.customer.update({
            where: {
              id: existingProject.customerId,
            },
            data: {
              companyId,

              customerName: name,

              customerPhone: phone,

              customerEmail:
                customerPayload.customerEmail ??
                customerPayload.email ??
                existingProject.customer.customerEmail,

              customerType:
                customerPayload.customerType ??
                customerPayload.type ??
                existingProject.customer.customerType,

              groupId: data.groupId ?? existingProject.customer.groupId,

              updatedBy: userId,
            },
          });
        }
      }

      // ============================================================
      // 3. UPDATE PROJECT
      // ============================================================

      await tx.project.update({
        where: {
          id: projectId,
        },
        data: {
          companyId,

          customerId,

          projectCode: data.projectCode ?? existingProject.projectCode,

          leadId:
            data.leadId !== undefined
              ? String(data.leadId)
              : existingProject.leadId,

          capacityKw:
            data.capacityKw !== undefined
              ? Number(data.capacityKw)
              : existingProject.capacityKw,

          projectType: data.projectType ?? existingProject.projectType,

          stage: data.stage ?? existingProject.stage,

          status: data.status ?? existingProject.status,

          salesOwnerId:
            data.salesOwnerId !== undefined
              ? data.salesOwnerId
                ? Number(data.salesOwnerId)
                : null
              : existingProject.salesOwnerId,

          salesOwnerName:
            data.salesOwnerName ??
            data.salesOwner ??
            existingProject.salesOwnerName,

          surveyorId:
            data.surveyorId !== undefined
              ? data.surveyorId
                ? Number(data.surveyorId)
                : null
              : existingProject.surveyorId,

          surveyorName:
            data.surveyorName ??
            data.assignedSurveyor ??
            existingProject.surveyorName,

          installerId:
            data.installerId !== undefined
              ? data.installerId
                ? Number(data.installerId)
                : null
              : existingProject.installerId,

          installerName:
            data.installerName ??
            data.assignedInstaller ??
            existingProject.installerName,

          managerId:
            data.managerId !== undefined
              ? data.managerId
                ? Number(data.managerId)
                : null
              : existingProject.managerId,

          managerName: data.managerName ?? existingProject.managerName,

          addressLine1: data.addressLine1 ?? existingProject.addressLine1,

          addressLine2: data.addressLine2 ?? existingProject.addressLine2,

          landmark: data.landmark ?? existingProject.landmark,

          city: data.city ?? existingProject.city,

          district: data.district ?? existingProject.district,

          state: data.state ?? existingProject.state,

          pincode: data.pincode ?? existingProject.pincode,

          country: data.country ?? existingProject.country,

          notes: data.notes ?? existingProject.notes,

          groupId: data.groupId ?? existingProject.groupId,

          updatedBy: userId,
        },
      });

      // ============================================================
      // 4. UPDATE / CREATE SURVEY
      // ============================================================

      let survey;

      if (existingProject.surveys.length > 0) {
        const existingSurvey = existingProject.surveys[0];

        survey = await tx.survey.update({
          where: {
            id: existingSurvey.id,
          },
          data: {
            companyId,

            surveyId: data.surveyId ?? existingSurvey.surveyId,

            scheduledDate:
              data.scheduledDate !== undefined
                ? data.scheduledDate
                  ? new Date(data.scheduledDate)
                  : null
                : existingSurvey.scheduledDate,

            surveyorId:
              data.surveyorId !== undefined
                ? data.surveyorId
                  ? Number(data.surveyorId)
                  : null
                : existingSurvey.surveyorId,

            status: data.surveyStatus ?? existingSurvey.status,

            notes: data.surveyNotes ?? existingSurvey.notes,

            groupId: data.groupId ?? existingSurvey.groupId,

            updatedBy: userId,
          },
        });
      } else {
        survey = await tx.survey.create({
          data: {
            companyId,

            surveyId: data.surveyId || `SUR-${Date.now().toString().slice(-6)}`,

            projectId,

            scheduledDate: data.scheduledDate
              ? new Date(data.scheduledDate)
              : null,

            surveyorId: data.surveyorId ? Number(data.surveyorId) : null,

            status: data.surveyStatus || "PENDING",

            notes: data.surveyNotes || null,

            groupId: data.groupId || null,

            createdBy: userId,
          },
        });
      }

      // ============================================================
      // 5. UPDATE / CREATE ENGINEERING DESIGN
      // ============================================================

      const existingEngineering = existingProject.surveys[0]?.engineering;

      if (existingEngineering) {
        await tx.engineeringDesign.update({
          where: {
            id: existingEngineering.id,
          },
          data: {
            companyId,

            designId: data.designId ?? existingEngineering.designId,

            capacityKw:
              data.engineeringCapacityKw !== undefined
                ? Number(data.engineeringCapacityKw)
                : data.capacityKw !== undefined
                  ? Number(data.capacityKw)
                  : existingEngineering.capacityKw,

            designerId:
              data.designerId !== undefined
                ? data.designerId
                  ? Number(data.designerId)
                  : null
                : existingEngineering.designerId,

            status: data.engineeringStatus ?? existingEngineering.status,

            groupId: data.groupId ?? existingEngineering.groupId,

            updatedBy: userId,
          },
        });
      } else {
        await tx.engineeringDesign.create({
          data: {
            companyId,

            designId: data.designId || `ENG-${Date.now().toString().slice(-6)}`,

            surveyId: survey.id,

            capacityKw:
              data.engineeringCapacityKw !== undefined
                ? Number(data.engineeringCapacityKw)
                : Number(data.capacityKw) || null,

            designerId: data.designerId ? Number(data.designerId) : null,

            status: data.engineeringStatus || "PENDING",

            groupId: data.groupId || null,

            createdBy: userId,
          },
        });
      }

      // ============================================================
      // 6. RETURN UPDATED COMPLETE PROJECT
      // ============================================================

      return tx.project.findUnique({
        where: {
          id: projectId,
        },
        include: {
          customer: true,

          surveys: {
            include: {
              engineering: true,
            },
          },
        },
      });
    });

    return genrateResponse(
      res,
      HttpStatus.OK,
      "Project, customer, survey and engineering design updated successfully.",
      convertBigIntToString(result),
    );
  } catch (error: any) {
    console.error("updateProject error:", error);

    return genrateResponse(
      res,
      HttpStatus.BadRequest,
      error.message || "Failed to update project.",
    );
  }
};
