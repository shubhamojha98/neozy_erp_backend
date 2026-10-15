// India time (IST) ke hisaab se din / mahina — server UTC me chale tab bhi sahi

// Aaj ki date "YYYY-MM-DD"
export const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

// Kisi din ki shuruaat aur ant ("2026-10-11" → 11 Oct 00:00 / 23:59:59 IST)
export const dayStartIST = (ymd: string) => new Date(`${ymd}T00:00:00+05:30`);
export const dayEndIST = (ymd: string) => new Date(`${ymd}T23:59:59.999+05:30`);

// Aaj subah 12 baje (isse pehle ka follow-up = overdue)
export const startOfTodayIST = () => dayStartIST(todayIST());

// Is mahine ki 1 tareekh
export const startOfMonthIST = () => dayStartIST(`${todayIST().slice(0, 7)}-01`);
