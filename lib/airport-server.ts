"use server";

import { prisma } from "@/lib/prisma";
import { getTenantContext } from "@/lib/auth";
import { resolveAirportTimezone } from "@/lib/geo";

export type AirportOption = {
  icao: string;
  iata: string | null;
  name: string;
  lat: number;
  lon: number;
  timezone: string | null;
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
    timezone: resolveAirportTimezone(a.timezone, a.lat, a.lon),
  }));
}

// Accepts either ICAO or IATA codes — AI-extracted legs and copy-pasted
// requests sometimes carry the 3-letter IATA code (e.g. "SAN") instead of
// the 4-letter ICAO code ("KSAN"), and a strict ICAO-only match would
// silently fail to resolve those (see the ICAO normalization note in
// process-inbound-email.ts for where this is meant to get cleaned up at
// the source — this dual lookup is the defensive fallback for anything
// that slips through, plus general resilience for other callers).
export async function getAirportsByIcao(codes: string[]): Promise<AirportOption[]> {
  const unique = [...new Set(codes.filter(Boolean).map((c) => c.toUpperCase()))];
  if (unique.length === 0) return [];

  const airports = await prisma.airport.findMany({
    where: { OR: [{ icao: { in: unique } }, { iata: { in: unique } }] },
  });

  return airports.map((a) => ({
    icao: a.icao,
    iata: a.iata,
    name: a.name,
    lat: a.lat,
    lon: a.lon,
    timezone: resolveAirportTimezone(a.timezone, a.lat, a.lon),
  }));
}

// Maps a batch of ICAO or IATA codes to their canonical ICAO code, for
// normalizing AI-extracted airport codes once at write time. No auth gate
// (unlike the exports above) — Airport is global reference data, not
// tenant-scoped, and this needs to run from background/webhook processing
// where there's no authenticated user session to check.
export async function resolveAirportCodesToIcao(
  codes: (string | null | undefined)[]
): Promise<Record<string, string>> {
  const unique = [...new Set(codes.filter((c): c is string => Boolean(c)).map((c) => c.toUpperCase()))];
  if (unique.length === 0) return {};

  const airports = await prisma.airport.findMany({
    where: { OR: [{ icao: { in: unique } }, { iata: { in: unique } }] },
  });

  const map: Record<string, string> = {};
  for (const a of airports) {
    map[a.icao] = a.icao;
    if (a.iata) map[a.iata] = a.icao;
  }
  return map;
}
