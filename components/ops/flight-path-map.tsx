import { greatCircleDistanceNm } from "@/lib/geo";

type MapAirport = {
  icao: string;
  lat: number;
  lon: number;
  city?: string | null;
  state?: string | null;
};
export type MapLeg = { dep: MapAirport; arr: MapAirport };

function locationLine(a: MapAirport): string {
  return [a.city, a.state].filter(Boolean).join(", ");
}

// A lightweight, dependency-free stand-in for a real map — no coastline
// data or map-tile service involved, just the trip's own airports (lat/lon
// already in the Airport table) projected onto a sectional-chart-style
// backdrop and connected leg by leg. Good enough to show the shape and
// scale of a routing at a glance on a manifest; not meant to be
// geographically precise (straight/arced lines, not true great circles).
export function FlightPathMap({
  legs,
  width = 520,
  height = 260,
}: {
  legs: MapLeg[];
  width?: number;
  height?: number;
}) {
  const points = legs.flatMap((l) => [l.dep, l.arr]);
  if (points.length === 0) return null;

  const margin = 56; // room for airport labels beyond the plotted points
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const latMin = Math.min(...lats);
  const latMax = Math.max(...lats);
  const lonMin = Math.min(...lons);
  const lonMax = Math.max(...lons);
  const latSpan = latMax - latMin || 1;
  const lonSpan = lonMax - lonMin || 1;

  function project(p: MapAirport) {
    const x = margin + ((p.lon - lonMin) / lonSpan) * (width - margin * 2);
    // Latitude increases northward but SVG y increases downward.
    const y = height - margin - ((p.lat - latMin) / latSpan) * (height - margin * 2);
    return { x, y };
  }

  const uniqueAirports = Array.from(new Map(points.map((p) => [p.icao, p])).values());

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="rounded-md border border-border/70"
    >
      <defs>
        <linearGradient id="chart-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fefce8" />
          <stop offset="100%" stopColor="#fef3c7" />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={width} height={height} fill="url(#chart-bg)" />

      {/* Sectional-chart-style graticule with a compass rose — evokes an
          aviation chart rather than a street map, and grid lines give a
          sense of scale even without real coastlines. */}
      {[0.2, 0.4, 0.6, 0.8].map((f) => (
        <line key={`h${f}`} x1={0} y1={height * f} x2={width} y2={height * f} stroke="#d4a72c" strokeWidth={0.5} strokeOpacity={0.35} />
      ))}
      {[0.2, 0.4, 0.6, 0.8].map((f) => (
        <line key={`v${f}`} x1={width * f} y1={0} x2={width * f} y2={height} stroke="#d4a72c" strokeWidth={0.5} strokeOpacity={0.35} />
      ))}
      <g transform={`translate(${width - 28}, 28)`} opacity={0.6}>
        <circle r={14} fill="none" stroke="#78716c" strokeWidth={1} />
        <path d="M 0 -14 L -3 -6 L 0 -9 L 3 -6 Z" fill="#78716c" />
        <text x={0} y={-17} textAnchor="middle" fontSize={8} fontWeight={700} fill="#78716c">N</text>
      </g>

      {legs.map((l, i) => {
        const a = project(l.dep);
        const b = project(l.arr);
        const midX = (a.x + b.x) / 2;
        const midY = Math.min(a.y, b.y) - Math.max(20, Math.abs(a.x - b.x) * 0.15);
        const distanceNm = Math.round(greatCircleDistanceNm(l.dep.lat, l.dep.lon, l.arr.lat, l.arr.lon));
        return (
          <g key={i}>
            <path
              d={`M ${a.x} ${a.y} Q ${midX} ${midY} ${b.x} ${b.y}`}
              fill="none"
              stroke="#78350f"
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
            <text
              x={midX}
              y={midY - 4}
              textAnchor="middle"
              fontSize={10}
              fill="#78350f"
              className="font-medium"
            >
              {distanceNm.toLocaleString()} nm
            </text>
          </g>
        );
      })}

      {uniqueAirports.map((p) => {
        const { x, y } = project(p);
        const location = locationLine(p);
        return (
          <g key={p.icao}>
            <circle cx={x} cy={y} r={4.5} fill="#78350f" stroke="#fefce8" strokeWidth={1.5} />
            <text x={x} y={y - 22} textAnchor="middle" fontSize={12} fontWeight={700} fill="#1c1917">
              {p.icao}
            </text>
            {location && (
              <text x={x} y={y - 10} textAnchor="middle" fontSize={9} fill="#57534e">
                {location}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
