import { prisma } from "@/lib/prisma";

export async function generateQuoteNumber(operatorId: string): Promise<string> {
  const year = new Date().getFullYear();
  const yearStart = new Date(`${year}-01-01T00:00:00.000Z`);
  const count = await prisma.quote.count({
    where: { operatorId, createdAt: { gte: yearStart } },
  });
  const sequence = String(count + 1).padStart(4, "0");
  return `Q-${year}-${sequence}`;
}
