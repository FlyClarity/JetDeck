"use server";

import { prisma } from "@/lib/prisma";
import { getTenantContext } from "@/lib/auth";

export type ContactOption = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  company: string | null;
  type: string;
};

export async function searchContacts(query: string): Promise<ContactOption[]> {
  const { clerkOrgId } = await getTenantContext();
  if (!clerkOrgId) return [];

  const q = query.trim();
  if (q.length < 2) return [];

  const operator = await prisma.operator.findUnique({ where: { clerkOrgId } });
  if (!operator) return [];

  const contacts = await prisma.contact.findMany({
    where: {
      operatorId: operator.id,
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { company: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: { firstName: "asc" },
    take: 10,
  });

  return contacts.map((c) => ({
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    phone: c.phone,
    company: c.company,
    type: c.type,
  }));
}
