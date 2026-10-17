// Geometry for the knowledge planet: subjects = continents, units = countries (spherical
// Voronoi cells seeded per subject cluster), topics = city points inside their country.
// Pure and deterministic: the same pack always gives the same planet.

import { geoVoronoi } from "d3-geo-voronoi";
import type { Feature, Polygon } from "geojson";

import type { Pack, Subject, Topic, Unit } from "./types";

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const DEG = 180 / Math.PI;

export interface LatLng {
  lat: number;
  lng: number;
}

interface Site extends LatLng {
  kind: "unit" | "ocean";
  subjectIndex?: number;
  unit?: Unit;
  subject?: Subject;
}

export interface Country {
  feature: Feature<Polygon>;
  unit: Unit;
  subject: Subject;
  subjectIndex: number;
  center: LatLng;
}

export interface City extends LatLng {
  topic: Topic;
  unit: Unit;
  subject: Subject;
  subjectIndex: number;
  heat: "repeat" | "multi" | "once";
}

export interface ContinentLabel extends LatLng {
  subject: Subject;
  subjectIndex: number;
}

export interface Planet {
  countries: Country[];
  cities: City[];
  continents: ContinentLabel[];
}

function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** Move `r` degrees from `c` in direction `angle` (small-offset approximation, fine below ~30°). */
function offset(c: LatLng, r: number, angle: number): LatLng {
  const lat = Math.max(-80, Math.min(80, c.lat + r * Math.cos(angle)));
  return { lat, lng: wrapLng(c.lng + (r * Math.sin(angle)) / Math.cos(lat / DEG)) };
}

function angularDistance(a: LatLng, b: LatLng): number {
  const p1 = a.lat / DEG, p2 = b.lat / DEG, dl = (b.lng - a.lng) / DEG;
  const cos = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
  return Math.acos(Math.max(-1, Math.min(1, cos))) * DEG;
}

function fibonacciSphere(n: number): LatLng[] {
  return Array.from({ length: n }, (_, i) => {
    const y = 1 - ((i + 0.5) / n) * 2;
    return { lat: Math.asin(y) * DEG, lng: wrapLng((i * GOLDEN * DEG) % 360) };
  });
}

/** Continent centres spread around a band, alternating north / south of the equator. */
function continentCentres(n: number): LatLng[] {
  return Array.from({ length: n }, (_, i) => ({
    lat: n === 1 ? 0 : i % 2 === 0 ? 16 : -16,
    lng: wrapLng(-90 + (i * 360) / n),
  }));
}

export function heatOf(t: Topic): City["heat"] {
  if (t.is_repeat) return "repeat";
  if (t.exams_count >= 2) return "multi";
  return "once";
}

export function buildPlanet(pack: Pack): Planet {
  const subjects = pack.subjects;
  const centres = continentCentres(subjects.length);
  const sites: Site[] = [];
  const continents: ContinentLabel[] = [];

  subjects.forEach((subject, si) => {
    const units = subject.units;
    const spread = 7 + 5 * Math.sqrt(units.length);
    continents.push({ ...offset(centres[si], spread + 4, 0), subject, subjectIndex: si });
    units.forEach((unit, k) => {
      const r = units.length === 1 ? 0 : spread * Math.sqrt((k + 0.5) / units.length);
      sites.push({ ...offset(centres[si], r, k * GOLDEN + si), kind: "unit", unit, subject, subjectIndex: si });
    });
  });

  // Ocean seeds keep countries compact: any point far enough from every unit becomes sea.
  const unitSites = sites.slice();
  for (const p of fibonacciSphere(260)) {
    if (unitSites.every((u) => angularDistance(u, p) > 15)) sites.push({ ...p, kind: "ocean" });
  }

  // Accessors must be set before the data is passed in (geoVoronoi(data) would read [lng, lat] arrays).
  const cells = geoVoronoi<Site>()
    .x((d) => d.lng)
    .y((d) => d.lat)
    .polygons(sites);

  const countries: Country[] = [];
  for (const f of cells.features) {
    const s = f.properties.site;
    if (s.kind !== "unit" || !s.unit || !s.subject) continue;
    countries.push({
      feature: f as Feature<Polygon>,
      unit: s.unit,
      subject: s.subject,
      subjectIndex: s.subjectIndex ?? 0,
      center: { lat: s.lat, lng: s.lng },
    });
  }

  const cities: City[] = [];
  for (const c of countries) {
    const topics = c.unit.topics;
    topics.forEach((topic, k) => {
      const r = topics.length === 1 ? 0 : 1.5 + 3.5 * Math.sqrt((k + 0.5) / topics.length);
      cities.push({ ...offset(c.center, r, k * GOLDEN), topic, unit: c.unit, subject: c.subject, subjectIndex: c.subjectIndex, heat: heatOf(topic) });
    });
  }

  return { countries, cities, continents };
}
