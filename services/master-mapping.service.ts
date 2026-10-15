
import { panel } from "../lib/globalprimsaclient";


function normalizeName(name: string | undefined): string {
  if (!name) return "";
  let normalized = name.replace(/_/g, " ");
  normalized = normalized.replace(/^ward\s+\d+\s+/i, "");

  return normalized.trim();
}

export async function getOrCreateWard(wardName: string) {
  const normalizedValue = normalizeName(wardName);

  // Try exact match first on normalized name
  let ward = await panel.ward_master.findFirst({
    where: {
      name: {
        equals: normalizedValue,
        mode: "insensitive",
      }
    }
  });

  // If not found, try contains on name
  if (!ward) {
    ward = await panel.ward_master.findFirst({
      where: {
        name: {
          contains: normalizedValue,
          mode: "insensitive",
        }
      }
    });
  }

  // Fallback: If the original name had a ward number pattern "Ward_1_", try searching by ward_no
  if (!ward) {
    const wardNumberMatch = wardName.match(/ward_(\d+)/i) || wardName.match(/ward\s+(\d+)/i);
    if (wardNumberMatch && wardNumberMatch[1]) {
      const wardNo = wardNumberMatch[1];
      console.log(`Fallback: Searching for ward_no: ${wardNo}`);
      ward = await panel.ward_master.findFirst({
        where: {
          ward_no: wardNo
        }
      });
    }
  }

  // console.log("ward match result::: ", ward ? { id: ward.id, name: ward.name, ward_no: ward.ward_no } : "null");
  return ward || null;
}


export async function getOrCreateZoneType(name: string) {
  const normalized = normalizeName(name);
  if (!normalized) return null;

  let type = await panel.zone_master.findFirst({
    where: {
      name: {
        contains: normalized,
        mode: "insensitive"
      }
    }
  });
 
  return type || null;  
}

/**
 * Standardizes floor names from Excel to match DB exactly.
 */
function standardizeFloorName(name: string): string {
  const n = name.toLowerCase().trim();
  if (n.includes("ground floor") || n === "gf" || n === "g.f") return "G.F";
  if (n === "base 1") return "Base 1";
  if (n === "base 2") return "Base 2";
  if (n === "base 3") return "Base 3";
  if (n === "base 4") return "Base 4";
  if (n === "base 5") return "Base 5";

  // Handle "1.f", "1.F", "1st floor" etc.
  const floorMatch = n.match(/^(\d+)/);
  if (floorMatch) {
    const num = floorMatch[1];
    // Special cases for user's DB which has mixed case (e.g., 3.f, 1.F)
    if (num === "1" || num === "2") return `${num}.F`;
    if (Number(num) >= 3 && Number(num) <= 7) return `${num}.f`;
    if (Number(num) >= 8) return `${num}.F`;
  }

  return name; // Fallback
}

