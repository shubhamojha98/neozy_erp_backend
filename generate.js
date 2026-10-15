const { execSync } = require("child_process");

const configs = [
    "prisma.config.ts",
    "prisma/db-log/prisma.config.ts",
    "prisma/inventory/prisma.config.ts",
    "prisma/project/prisma.config.ts",
    "prisma/lead/prisma.config.ts"
];

configs.forEach((config) => {
    try {
        console.log(`\n▶ Generating client for: ${config}`);
        execSync(`npx prisma generate --config=${config}`, { stdio: "inherit" });
    } catch (err) {
        console.error(`❌ Failed to generate for ${config}:`, err.message);
        process.exit(1);
    }
});

console.log("\n✅ All clients generated.");
