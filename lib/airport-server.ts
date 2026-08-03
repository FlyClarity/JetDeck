"use server";

import tzLookup from "tz-lookup";
import { prisma } from "@/lib/prisma";
import { getTenantContext } from "@/lib/auth";

export type AirportOption = {
  icao: string;
  iata: string | null;
  name: string;
  lat: number;
  lon: number;
  timezone: string | null;
};

// The Airport table has a timezone column, but it's never been backfilled
// (the OurAirports import didn't include it) — compute it on the fly from
// lat/lon instead of blocking on a migration. Only ever called for the
// handful of airports resolved per search/quote, so the lookup cost is
// negligible.
function resolveTimezone(stored: string | null, lat: number, lon: number): string | null {
  if (stored) return stored;
  try {
    return tzLookup(lat, lon);
  } catch {
    return null;
  }
}

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
    timezone: resolveTimezone(a.timezone, a.lat, a.lon),
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
    timezone: resolveTimezone(a.timezone, a.lat, a.lon),
  }));
}
