import type { NextRequest } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Backs the global command palette (components/command-palette.tsx) — a
// resource-based auth check via getTenantContext() (Clerk's own guidance,
// see lib/auth.ts) rather than relying solely on middleware path matching.
export async function GET(req: NextRequest) {
  const { clerkOrgId } = await getTenantContext();
  if (!clerkOrgId) return Response.json({ results: [] });

  const operator = await prisma.operator.findUnique({ where: { clerkOrgId } });
  if (!operator) return Response.json({ results: [] });

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return Response.json({ results: [] });

  const insensitive = { contains: q, mode: "insensitive" as const };

  const [quotes, tripRequests, contacts, aircraft, crew, trips] = await Promise.all([
    prisma.quote.findMany({
      where: {
        operatorId: operator.id,
        OR: [
          { quoteNumber: insensitive },
          { tripRequest: { requestorName: insensitive } },
          { tripRequest: { requestorCompany: insensitive } },
        ],
      },
      include: { tripRequest: true },
      take: 5,
      orderBy: { createdAt: "desc" },
    }),
    prisma.tripRequest.findMany({
      where: {
        operatorId: operator.id,
        OR: [{ requestorName: insensitive }, { requestorCompany: insensitive }, { requestorEmail: insensitive }],
      },
      take: 5,
      orderBy: { createdAt: "desc" },
    }),
    prisma.contact.findMany({
      where: {
        operatorId: operator.id,
        OR: [{ firstName: insensitive }, { lastName: insensitive }, { email: insensitive }, { company: insensitive }],
      },
      take: 5,
    }),
    prisma.aircraft.findMany({
      where: {
        operatorId: operator.id,
        OR: [{ tailNumber: insensitive }, { make: insensitive }, { model: insensitive }],
      },
      take: 5,
    }),
    prisma.crewMember.findMany({
      where: { operatorId: operator.id, name: insensitive },
      take: 5,
    }),
    prisma.trip.findMany({
      where: { operatorId: operator.id, tripNumber: insensitive },
      take: 5,
    }),
  ]);

  const results = [
    ...quotes.map((r) => ({
      type: "quote" as const,
      id: r.id,
      title: r.quoteNumber,
      subtitle: r.tripRequest?.requestorName ?? "",
      href: `/quotes/${r.id}`,
    })),
    ...tripRequests.map((r) => ({
      type: "trip_request" as const,
      id: r.id,
      title: r.requestorName,
      subtitle: r.requestorCompany ?? r.requestorEmail,
      href: `/dashboard?open=${r.id}`,
    })),
    ...contacts.map((r) => ({
      type: "contact" as const,
      id: r.id,
      title: `${r.firstName} ${r.lastName}`,
      subtitle: r.company ?? r.email,
      href: `/contacts/${r.id}`,
    })),
    ...aircraft.map((r) => ({
      type: "aircraft" as const,
      id: r.id,
      title: r.tailNumber,
      subtitle: `${r.make} ${r.model}`,
      href: `/fleet/${r.id}`,
    })),
    ...crew.map((r) => ({
      type: "crew" as const,
      id: r.id,
      title: r.name,
      subtitle: r.role,
      href: `/ops/crew/${r.id}`,
    })),
    ...trips.map((r) => ({
      type: "trip" as const,
      id: r.id,
      title: r.tripNumber,
      subtitle: "",
      href: `/ops/trips/${r.id}`,
    })),
  ];

  return Response.json({ results });
}
