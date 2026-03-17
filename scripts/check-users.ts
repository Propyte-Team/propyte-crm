import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const users = await p.user.findMany({
    select: {
      email: true,
      role: true,
      passwordHash: true,
      otpHash: true,
      otpExpiresAt: true,
      isActive: true,
    },
  });

  for (const u of users) {
    console.log(JSON.stringify({
      email: u.email,
      role: u.role,
      hasPassword: u.passwordHash ? true : false,
      hasOtp: u.otpHash ? true : false,
      otpExpires: u.otpExpiresAt,
      active: u.isActive,
    }));
  }
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
