import { z } from "zod";
import { DOCUMENT_CATEGORIES } from "../constants/options";

// Upload form (multipart): file + category
export const uploadDocumentSchema = z.object({
  category: z.enum(DOCUMENT_CATEGORIES, { error: "Select a document type" }),
});

export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;
