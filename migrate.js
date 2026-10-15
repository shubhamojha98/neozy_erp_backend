const { execSync } = require("child_process");

const configs = [
    "prisma/inventory/prisma.config.ts",
    "prisma/project/prisma.config.ts",
    "prisma/lead/prisma.config.ts"

]

configs.forEach((config) => {
    try {
        console.log(`\n▶ migrating schema for: ${config}`);
        execSync(`npx prisma migrate deploy --config=${config}`, { stdio: "inherit" });
    } catch (err) {
        console.error(`❌ Failed to migrate for ${config}:`, err.message);
    }
});

console.log("\n✅ All schemas migrated.");
