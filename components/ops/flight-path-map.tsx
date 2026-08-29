type MapAirport = { icao: string; lat: number; lon: number };
export type MapLeg = { dep: MapAirport; arr: MapAirport };

// A lightweight, dependency-free stand-in for a real map — no coastline
// data or map-tile service involved, just the trip's own airports (lat/lon
// already in the Airport table) projected onto a plain equirectangular grid
// and connected leg by leg. Good enough to show the shape of a routing at a
// glance on a print manifest; not meant to be geographically precise.
export function FlightPathMap({
  legs,
  width = 480,
  height = 220,
}: {
  legs: MapLeg[];
  width?: number;
  height?: number;
}) {
  const points = legs.flatMap((l) => [l.dep, l.arr]);
  if (points.length === 0) return null;

  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const latMin = Math.min(...lats);
  const latMax = Math.max(...lats);
  const lonMin = Math.min(...lons);
  const lonMax = Math.max(...lons);
  // Padding scales with the route's own span so a short hop doesn't render
  // as two dots jammed in a corner, and a transcontinental one still fits.
  const latPad = Math.max((latMax - latMin) * 0.3, 1.5);
  const lonPad = Math.max((lonMax - lonMin) * 0.3, 1.5);
  const latSpan = latMax - latMin + latPad * 2 || 1;
  const lonSpan = lonMax - lonMin + lonPad * 2 || 1;

  function project(p: MapAirport) {
    const x = ((p.lon - (lonMin - lonPad)) / lonSpan) * width;
    // Latitude increases northward but SVG y increases downward.
    const y = height - ((p.lat - (latMin - latPad)) / latSpan) * height;
    return { x, y };
  }

  const uniqueAirports = Array.from(new Map(points.map((p) => [p.icao, p])).values());

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="rounded-md border border-border/70"
      style={{ background: "#f8fafc" }}
    >
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={`h${f}`} x1={0} y1={height * f} x2={width} y2={height * f} stroke="#e2e8f0" strokeWidth={1} />
      ))}
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={`v${f}`} x1={width * f} y1={0} x2={width * f} y2={height} stroke="#e2e8f0" strokeWidth={1} />
      ))}
      {legs.map((l, i) => {
        const a = project(l.dep);
        const b = project(l.arr);
        // A slight upward arc reads as a flight path rather than a flat
        // point-to-point line — purely stylistic, not a real great circle.
        const midX = (a.x + b.x) / 2;
        const midY = Math.min(a.y, b.y) - Math.max(20, Math.abs(a.x - b.x) * 0.15);
        return (
          <path
            key={i}
            d={`M ${a.x} ${a.y} Q ${midX} ${midY} ${b.x} ${b.y}`}
            fill="none"
            stroke="#0f172a"
            strokeWidth={1.5}
            strokeDasharray="5 4"
          />
        );
      })}
      {uniqueAirports.map((p) => {
        const { x, y } = project(p);
        return (
          <g key={p.icao}>
            <circle cx={x} cy={y} r={4} fill="#0f172a" />
            <text x={x} y={y - 9} textAnchor="middle" fontSize={11} fontWeight={600} fill="#0f172a">
              {p.icao}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
