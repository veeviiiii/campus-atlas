"use client";

import { useEffect, useRef } from "react";
import type { GlobeInstance } from "globe.gl";

import { HEAT } from "./HeroPlanet";
import type { City, ContinentLabel, Country, Planet } from "@/lib/planet";
import type { Topic } from "@/lib/types";

// Subject colours from the design palette (continents); heat colours are shared with the hero planet.
export const SUBJECT_COLORS = ["#4268ff", "#7657ff", "#54e4ff", "#ff786d", "#ffc24a", "#f08bf0", "#d7ff52"];
export const HEAT_COLORS = HEAT;
const BLIND_SPOT = "#c4b5fd";
const FOG = "#8d89b0";

export interface PlanetHandle {
  flyToSubject: (subjectIndex: number) => void;
  flyToCity: (city: City) => void;
  resetView: () => void;
}

interface Props {
  planet: Planet;
  studied: Set<string>;
  route: City[] | null;
  selectedId: string | null;
  colorBy: "heat" | "subject";
  fog: boolean;
  filter: string | null; // subject id, or null for all
  active: boolean;
  onTopic: (topic: Topic, city: City) => void;
  handleRef: React.RefObject<PlanetHandle | null>;
}

type Ring = { kind: "repeat" | "burst" | "selected"; lat: number; lng: number };
type View = { selectedId: string | null; colorBy: "heat" | "subject"; fog: boolean; filter: string | null };

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function countryLabel(c: Country): string {
  const asked = c.unit.topics.reduce((n, t) => n + t.questions.length, 0);
  return `<div class="atlas-tip">
    <div class="atlas-tip-kicker">${esc(c.subject.name)}</div>
    <div class="atlas-tip-title">${esc(c.unit.name)}</div>
    <div>${c.unit.topics.length} topics · ${asked} questions</div>
    ${c.unit.blind_spot ? `<div class="atlas-tip-blind">Blind spot: never in the MSTs, asked in the End Sem</div>` : ""}
    ${c.unit.from_syllabus ? "" : `<div class="atlas-tip-note">Unit named from the questions</div>`}
  </div>`;
}

function cityLabel(c: City, studied: boolean): string {
  const t = c.topic;
  const heat = t.is_repeat ? "Repeated: MST → End Sem" : t.exams_count >= 2 ? `Asked in ${t.exams_count} exams` : "Asked once";
  return `<div class="atlas-tip">
    <div class="atlas-tip-kicker">${esc(c.subject.name)} / ${esc(c.unit.name)}</div>
    <div class="atlas-tip-title">${esc(t.name)}</div>
    <div style="color:${HEAT[c.heat]}">${heat}</div>
    <div>${t.questions.length} questions · ${t.total_marks} marks</div>
    <div class="atlas-tip-note">${studied ? "Studied ✓" : "Fogged: not studied yet"}</div>
  </div>`;
}

function continentElement(c: ContinentLabel): HTMLElement {
  const el = document.createElement("div");
  el.className = "atlas-continent";
  el.textContent = c.subject.name;
  return el;
}

// Fogged topics keep a hint of their heat colour (mixed toward grey), so repeats still read as red.
function mix(hex: string, toward: string, t: number): string {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [from, to] = [rgb(hex), rgb(toward)];
  return "#" + from.map((v, i) => Math.round(v + (to[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

function hexAlpha(a: number): string {
  return Math.round(255 * Math.max(0, Math.min(1, a)))
    .toString(16)
    .padStart(2, "0");
}

export default function PlanetGlobe(props: Props) {
  const { planet, studied, route, selectedId, colorBy, fog, filter, active, onTopic, handleRef } = props;
  const mountRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeInstance | null>(null);
  const hovered = useRef<Country | null>(null);
  const onTopicRef = useRef(onTopic);
  const planetRef = useRef(planet);
  const studiedRef = useRef(studied);
  const routeRef = useRef(route);
  const activeRef = useRef(active);
  const viewRef = useRef<View>({ selectedId, colorBy, fog, filter });
  const bursts = useRef<Ring[]>([]);

  useEffect(() => {
    onTopicRef.current = onTopic;
  }, [onTopic]);

  // Create the globe once.
  useEffect(() => {
    let cancelled = false;
    const mount = mountRef.current!;
    (async () => {
      const [{ default: Globe }, THREE] = await Promise.all([import("globe.gl"), import("three")]);
      if (cancelled) return;
      const v = () => viewRef.current;
      const isStudied = (c: City) => studiedRef.current.has(c.topic.id);
      const inFilter = (subjectId: string) => !v().filter || v().filter === subjectId;
      const cityColor = (c: City) => {
        const base = v().colorBy === "heat" ? HEAT[c.heat] : SUBJECT_COLORS[c.subjectIndex % SUBJECT_COLORS.length];
        const fogged = v().fog && !isStudied(c);
        return (fogged ? mix(base, FOG, 0.6) : base) + (inFilter(c.subject.id) ? "" : "33");
      };

      const globe = new Globe(mount, { animateIn: false })
        .backgroundColor("rgba(0,0,0,0)")
        .globeMaterial(new THREE.MeshPhongMaterial({ color: "#15133a", emissive: "#0b0a26", shininess: 4 }))
        .showAtmosphere(true)
        .atmosphereColor("#7657ff")
        .atmosphereAltitude(0.2)
        .showGraticules(true)
        // countries = units; the fog lifts as their topics are studied
        // globe.gl types geometry loosely; the GeoJSON Polygon is what it expects at runtime
        .polygonGeoJsonGeometry((d) => (d as Country).feature.geometry as never)
        .polygonCapColor((d) => {
          const c = d as Country;
          const topics = c.unit.topics;
          const done = topics.filter((t) => studiedRef.current.has(t.id)).length;
          const lift = v().fog ? (topics.length ? done / topics.length : 1) : 1;
          const a = inFilter(c.subject.id) ? 0.22 + 0.3 * lift : 0.06;
          return SUBJECT_COLORS[c.subjectIndex % SUBJECT_COLORS.length] + hexAlpha(a);
        })
        .polygonSideColor(() => "rgba(19, 18, 26, 0.7)")
        .polygonStrokeColor(() => "rgba(255, 255, 255, 0.14)")
        .polygonAltitude((d) => (d === hovered.current ? 0.03 : 0.012))
        .polygonLabel((d) => countryLabel(d as Country))
        .polygonsTransitionDuration(400)
        .onPolygonHover((d) => {
          hovered.current = (d as Country) ?? null;
          globe.polygonAltitude(globe.polygonAltitude());
          mount.style.cursor = d ? "pointer" : "grab";
        })
        .onPolygonClick((d) => {
          const c = d as Country;
          globe.controls().autoRotate = false;
          globe.pointOfView({ ...c.center, altitude: 1.15 }, 1000);
        })
        // cities = topics, drawn as square "pixels" like the design's 2D planet
        .pointLat((d) => (d as City).lat)
        .pointLng((d) => (d as City).lng)
        .pointResolution(4)
        .pointColor((d) => cityColor(d as City))
        .pointAltitude((d) => {
          const c = d as City;
          return (isStudied(c) || !v().fog ? 0.06 : 0.03) + (c.topic.id === v().selectedId ? 0.03 : 0);
        })
        .pointRadius((d) => {
          const c = d as City;
          return 0.38 + 0.12 * (c.topic.exams_count + (c.topic.is_repeat ? 1 : 0));
        })
        .pointLabel((d) => cityLabel(d as City, isStudied(d as City)))
        .onPointClick((d) => onTopicRef.current((d as City).topic, d as City))
        .pointsTransitionDuration(500)
        // red pulse = repeat; cyan burst = fog cleared; lime = selected topic
        .ringLat((d) => (d as Ring).lat)
        .ringLng((d) => (d as Ring).lng)
        .ringColor((d: object) => {
          const k = (d as Ring).kind;
          if (k === "burst") return (t: number) => `rgba(84, 228, 255, ${1 - t})`;
          if (k === "selected") return (t: number) => `rgba(215, 255, 82, ${1 - t})`;
          return (t: number) => `rgba(255, 59, 78, ${1 - t})`;
        })
        .ringMaxRadius((d) => ({ burst: 7, selected: 2.4, repeat: 3.2 })[(d as Ring).kind])
        .ringPropagationSpeed((d) => ({ burst: 5, selected: 1.2, repeat: 2.4 })[(d as Ring).kind])
        .ringRepeatPeriod((d) => ({ burst: 3000, selected: 900, repeat: 1100 })[(d as Ring).kind])
        .ringAltitude(0.05)
        // blind spots: a thick lavender border (polygon strokes are 1px and get lost)
        .pathPoints((d) => d as number[][])
        .pathPointLat((p) => (p as number[])[1])
        .pathPointLng((p) => (p as number[])[0])
        .pathPointAlt(0.016)
        .pathColor(() => BLIND_SPOT)
        .pathStroke(2.2)
        .pathTransitionDuration(0)
        // "Exam tomorrow" route
        .arcStartLat((d) => (d as { a: City }).a.lat)
        .arcStartLng((d) => (d as { a: City }).a.lng)
        .arcEndLat((d) => (d as { b: City }).b.lat)
        .arcEndLng((d) => (d as { b: City }).b.lng)
        .arcColor(() => ["rgba(215, 255, 82, 0.95)", "rgba(255, 59, 78, 0.95)"])
        .arcStroke(0.7)
        .arcAltitudeAutoScale(0.35)
        .arcDashLength(0.45)
        .arcDashGap(0.15)
        .arcDashAnimateTime(1800)
        .arcsTransitionDuration(500)
        // continent names
        .htmlElement((d) => continentElement(d as ContinentLabel))
        .htmlAltitude(0.06)
        .width(mount.clientWidth)
        .height(mount.clientHeight);

      // The design's tilted orbit ring around the planet.
      const r = globe.getGlobeRadius();
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(r * 1.28, 0.25, 8, 200),
        new THREE.MeshBasicMaterial({ color: "#54e4ff", transparent: true, opacity: 0.35 }),
      );
      ring.rotation.set(Math.PI / 2 - 0.3, 0, -0.35);
      globe.scene().add(ring);

      const controls = globe.controls();
      controls.enableZoom = false; // the page scrolls; zoom happens by clicking a country
      controls.enableDamping = true;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.35;

      globeRef.current = globe;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (process.env.NODE_ENV !== "production") (window as any).__atlasPlanet = globe;
      handleRef.current = {
        flyToSubject: (i) => {
          const c = planetRef.current.continents[i];
          if (!c) return;
          controls.autoRotate = false;
          globe.pointOfView({ lat: c.lat - 8, lng: c.lng, altitude: 1.7 }, 1000);
        },
        flyToCity: (c) => {
          controls.autoRotate = false;
          globe.pointOfView({ lat: c.lat, lng: c.lng, altitude: 1.6 }, 1000);
        },
        resetView: () => {
          const first = planetRef.current.continents[0];
          controls.autoRotate = true;
          globe.pointOfView({ lat: (first?.lat ?? 0) - 10, lng: first?.lng ?? 0, altitude: 2.3 }, 1000);
        },
      };
      applyPlanet(globe, planetRef.current);
      applyRings(globe, planetRef.current, bursts.current, viewRef.current);
      applyRoute(globe, routeRef.current);
      if (!activeRef.current) globe.pauseAnimation();
    })();

    const ro = new ResizeObserver(() => globeRef.current?.width(mount.clientWidth).height(mount.clientHeight));
    ro.observe(mount);
    return () => {
      cancelled = true;
      ro.disconnect();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globeRef.current as any)?._destructor?.();
      globeRef.current = null;
      mount.innerHTML = "";
    };
  }, [handleRef]);

  // New planet (another course) -> new layers, and the planet "forms" with a camera pull-in.
  useEffect(() => {
    planetRef.current = planet;
    if (globeRef.current) {
      applyPlanet(globeRef.current, planet);
      applyRings(globeRef.current, planet, bursts.current, viewRef.current);
    }
  }, [planet]);

  // View options (selection, colours, fog, filter) -> re-run the accessors, no new globe.
  useEffect(() => {
    viewRef.current = { selectedId, colorBy, fog, filter };
    const g = globeRef.current;
    if (!g) return;
    g.pointColor(g.pointColor()).pointAltitude(g.pointAltitude()).polygonCapColor(g.polygonCapColor());
    applyRings(g, planetRef.current, bursts.current, viewRef.current);
    if (selectedId) g.controls().autoRotate = false;
  }, [selectedId, colorBy, fog, filter]);

  // Studied set changed -> lift fog and burst newly cleared topics.
  useEffect(() => {
    const before = studiedRef.current;
    studiedRef.current = studied;
    const g = globeRef.current;
    if (!g) return;
    const cleared = planetRef.current.cities.filter((c) => studied.has(c.topic.id) && !before.has(c.topic.id));
    g.pointColor(g.pointColor()).pointAltitude(g.pointAltitude()).polygonCapColor(g.polygonCapColor());
    if (cleared.length && cleared.length < 6) {
      const newBursts: Ring[] = cleared.map((c) => ({ kind: "burst", lat: c.lat, lng: c.lng }));
      bursts.current = [...bursts.current, ...newBursts];
      applyRings(g, planetRef.current, bursts.current, viewRef.current);
      setTimeout(() => {
        bursts.current = bursts.current.filter((b) => !newBursts.includes(b));
        if (globeRef.current) applyRings(globeRef.current, planetRef.current, bursts.current, viewRef.current);
      }, 1400);
    }
  }, [studied]);

  useEffect(() => {
    routeRef.current = route;
    if (globeRef.current) applyRoute(globeRef.current, route);
  }, [route]);

  // A hidden globe stops rendering (saves the demo laptop's GPU).
  useEffect(() => {
    activeRef.current = active;
    const g = globeRef.current;
    if (!g) return;
    if (active) g.resumeAnimation();
    else g.pauseAnimation();
  }, [active]);

  return <div ref={mountRef} className="absolute inset-0" />;
}

function applyPlanet(globe: GlobeInstance, planet: Planet) {
  globe
    .polygonsData(planet.countries)
    .pointsData(planet.cities)
    .pathsData(planet.countries.filter((c) => c.unit.blind_spot).map((c) => c.feature.geometry.coordinates[0]))
    .htmlElementsData(planet.continents);
  const first = planet.continents[0];
  globe.pointOfView({ lat: first?.lat ?? 0, lng: first?.lng ?? 0, altitude: 6 });
  globe.pointOfView({ lat: (first?.lat ?? 0) - 10, lng: first?.lng ?? 0, altitude: 2.3 }, 1800);
}

function applyRings(globe: GlobeInstance, planet: Planet, bursts: Ring[], view: View) {
  const repeats: Ring[] = planet.cities
    .filter((c) => c.heat === "repeat" && (!view.filter || view.filter === c.subject.id))
    .map((c) => ({ kind: "repeat", lat: c.lat, lng: c.lng }));
  const sel = planet.cities.find((c) => c.topic.id === view.selectedId);
  const selected: Ring[] = sel ? [{ kind: "selected", lat: sel.lat, lng: sel.lng }] : [];
  globe.ringsData([...repeats, ...selected, ...bursts]);
}

function applyRoute(globe: GlobeInstance, route: City[] | null) {
  const legs = route ? route.slice(0, -1).map((a, i) => ({ a, b: route[i + 1] })) : [];
  globe.arcsData(legs);
}
