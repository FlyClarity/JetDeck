"use server";

import { prisma } from "@/lib/prisma";
import { getTenantContext } from "@/lib/auth";

export type AirportOption = {
  icao: string;
  iata: string | null;
  name: string;
  lat: number;
  lon: number;
};

export async function searchAirports(query: string): Promise<AirportOption[]> {
  const { userId } = await getTenantContext();
  if (!userId) return [];

  const q = query.trim();
  if (q.length < 2) return [];

  const airports = await prisma.airport.findMany({
    where: {
      OR: [
        { icao: { startsWith: q.toUpperCase() } },
        { iata: { startsWith: q.toUpperCase() } },
        { name: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: { icao: "asc" },
    take: 10,
  });

  return airports.map((a) => ({
    icao: a.icao,
    iata: a.iata,
    name: a.name,
    lat: a.lat,
    lon: a.lon,
  }));
}

export async function getAirportsByIcao(icaos: string[]): Promise<AirportOption[]> {
  const unique = [...new Set(icaos.filter(Boolean))];
  if (unique.length === 0) return [];

  const airports = await prisma.airport.findMany({
    where: { icao: { in: unique } },
  });

  return airports.map((a) => ({
    icao: a.icao,
    iata: a.iata,
    name: a.name,
    lat: a.lat,
    lon: a.lon,
  }));
}
