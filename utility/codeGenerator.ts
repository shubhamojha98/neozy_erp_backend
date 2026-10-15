// Agla code: nextCode("LD", "LD000041") → "LD000042", pehla record → "LD000001"
export const nextCode = (prefix: string, lastCode: string | null | undefined) => {
  const last = Number(lastCode?.replace(/\D/g, "") || 0);
  return `${prefix}${String(last + 1).padStart(6, "0")}`;
};
