// ₹ me amount: 125000 → "₹1,25,000"
export const inr = (value: unknown) => `₹${Number(value ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// 2 decimal tak round (paise)
export const round2 = (value: number) => Math.round(value * 100) / 100;
