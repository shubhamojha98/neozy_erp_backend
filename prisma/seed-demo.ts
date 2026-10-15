import bcrypt from "bcrypt";
import { RoleScope, UserStatus } from "../generated/panel/client";
import { panel as prisma } from "../lib/globalprimsaclient";

/**
 * Demo data — sirf local testing ke liye: npm run db:seed:demo
 * Pehle `npm run db:seed` chalna chahiye (role masters + modules usi se bante hain).
 * Dobara chalana safe hai. Production me mat chalana.
 */

const DEMO_PASSWORD = "Admin@123";

type CompanyDef = { code: string; name: string; city: string; subs?: { code: string; name: string; city: string }[] };
type UserDef = { username: string; email: string; first_name: string; last_name: string; home: string; access: { company: string; role: string }[] };

const TENANTS: { code: string; name: string; company: CompanyDef }[] = [
  {
    code: "SURYA",
    name: "Surya Power",
    company: {
      code: "SURYA",
      name: "Surya Power Pvt Ltd",
      city: "Lucknow",
      subs: [
        { code: "SURYA-RT", name: "Surya Rooftop", city: "Kanpur" },
        { code: "SURYA-AGRI", name: "Surya Agri Solar", city: "Varanasi" },
      ],
    },
  },
  {
    code: "KIRAN",
    name: "Kiran Solar",
    company: { code: "KIRAN", name: "Kiran Solar Solutions", city: "Noida", subs: [{ code: "KIRAN-WEST", name: "Kiran Solar West", city: "Agra" }] },
  },
  { code: "BRIGHT", name: "Bright Sun Energy", company: { code: "BRIGHT", name: "Bright Sun Energy", city: "Prayagraj" } },
];

const USERS: UserDef[] = [
  // Company admin: Surya Power + dono sub companies (dropdown me 3 company dikhengi)
  {
    username: "rajesh", email: "rajesh@surya.com", first_name: "Rajesh", last_name: "Verma", home: "SURYA",
    access: [{ company: "SURYA", role: "COMPANY_ADMIN" }, { company: "SURYA-RT", role: "COMPANY_ADMIN" }, { company: "SURYA-AGRI", role: "COMPANY_ADMIN" }],
  },
  // Sales executive: sirf Surya Rooftop
  { username: "pooja", email: "pooja@surya.com", first_name: "Pooja", last_name: "Singh", home: "SURYA-RT", access: [{ company: "SURYA-RT", role: "SALES_EXECUTIVE" }] },
  // Company admin: Kiran Solar
  {
    username: "amit", email: "amit@kiransolar.com", first_name: "Amit", last_name: "Sharma", home: "KIRAN",
    access: [{ company: "KIRAN", role: "COMPANY_ADMIN" }, { company: "KIRAN-WEST", role: "COMPANY_ADMIN" }],
  },
  // Company admin: Bright Sun Energy
  { username: "neha", email: "neha@brightsun.com", first_name: "Neha", last_name: "Gupta", home: "BRIGHT", access: [{ company: "BRIGHT", role: "COMPANY_ADMIN" }] },
];

// Company banao (ya update karo) + uske liye roles aur modules
async function upsertCompany(tenantId: number, def: { code: string; name: string; city: string }, parent?: { id: number; hierarchy_path: string; depth: number }) {
  const data = { name: def.name, city: def.city, state: "Uttar Pradesh", status: "ACTIVE" as const };
  const company = await prisma.company.upsert({
    where: { code: def.code },
    update: data,
    create: { ...data, code: def.code, tenant_id: tenantId, parent_company_id: parent?.id ?? null, depth: parent ? parent.depth + 1 : 0 },
  });
  // hierarchy_path id ke baad hi pata chalta hai: "/1/" (main) ya "/1/2/" (sub)
  const hierarchy_path = `${parent?.hierarchy_path ?? "/"}${company.id}/`;
  await prisma.company.update({ where: { id: company.id }, data: { hierarchy_path } });

  // Saare business modules on (core modules waise bhi sabko milte hain)
  const modules = await prisma.module.findMany({ where: { is_platform: false, is_core: false, is_active: true }, select: { id: true } });
  for (const m of modules) {
    await prisma.companyModule.upsert({
      where: { company_id_module_id: { company_id: company.id, module_id: m.id } },
      update: { is_active: true },
      create: { company_id: company.id, module_id: m.id },
    });
  }

  // Role masters se company ke roles (permissions bhi copy)
  const masters = await prisma.roleMaster.findMany({ where: { scope: RoleScope.COMPANY, is_active: true }, include: { permissions: true } });
  for (const rm of masters) {
    const role = await prisma.role.upsert({
      where: { company_id_code: { company_id: company.id, code: rm.code } },
      update: { name: rm.name, data_scope: rm.default_data_scope },
      create: { company_id: company.id, role_master_id: rm.id, code: rm.code, name: rm.name, data_scope: rm.default_data_scope, is_system: rm.code === "COMPANY_ADMIN" },
    });
    await prisma.rolePermission.deleteMany({ where: { role_id: role.id } });
    await prisma.rolePermission.createMany({ data: rm.permissions.map((p) => ({ role_id: role.id, permission_id: p.permission_id })) });
  }

  return { id: company.id, tenant_id: tenantId, hierarchy_path, depth: parent ? parent.depth + 1 : 0 };
}

async function main() {
  const companies = new Map<string, { id: number; tenant_id: number }>();

  for (const t of TENANTS) {
    const tenant = await prisma.tenant.upsert({ where: { code: t.code }, update: { name: t.name }, create: { code: t.code, name: t.name } });
    const main = await upsertCompany(tenant.id, t.company);
    companies.set(t.company.code, main);
    for (const sub of t.company.subs ?? []) companies.set(sub.code, await upsertCompany(tenant.id, sub, main));
  }

  const password_hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  for (const u of USERS) {
    const home = companies.get(u.home)!;
    const user = await prisma.user.upsert({
      where: { username: u.username },
      update: { email: u.email, first_name: u.first_name, last_name: u.last_name },
      create: {
        username: u.username, email: u.email, first_name: u.first_name, last_name: u.last_name, password_hash,
        tenant_id: home.tenant_id, home_company_id: home.id, status: UserStatus.ACTIVE,
      },
    });

    for (const [i, a] of u.access.entries()) {
      const company = companies.get(a.company)!;
      const member = await prisma.companyUser.upsert({
        where: { company_id_user_id: { company_id: company.id, user_id: user.id } },
        update: { is_active: true },
        create: { tenant_id: company.tenant_id, company_id: company.id, user_id: user.id, is_default: i === 0 },
      });
      const role = await prisma.role.findUniqueOrThrow({ where: { company_id_code: { company_id: company.id, code: a.role } } });
      await prisma.companyUserRole.upsert({
        where: { company_user_id_role_id: { company_user_id: member.id, role_id: role.id } },
        update: {},
        create: { company_id: company.id, company_user_id: member.id, role_id: role.id },
      });
    }
  }

  console.log(`Demo data ready: ${TENANTS.length} tenants, ${companies.size} companies, ${USERS.length} users (password: ${DEMO_PASSWORD})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
