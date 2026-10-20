"use client";

import { useEffect, useRef } from "react";
import type { GlobeInstance } from "globe.gl";

import { HEAT } from "./HeroPlanet";
import type { City, ContinentLabel, Country, Planet } from "@/lib/planet";

// Subject colours from the design palette (continents); heat colours are shared with the hero planet.
export const SUBJECT_COLORS = ["#4268ff", "#7657ff", "#54e4ff", "#ff786d", "#ffc24a", "#f08bf0", "#d7ff52"];
export const HEAT_COLORS = HEAT;
const BLIND_SPOT = "#c4b5fd";

interface Props {
  planet: Planet;
  onPick: (city: City) => void;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function countryLabel(c: Country): string {
  const asked = c.unit.topics.reduce((n, t) => n + t.questions.length, 0);
  return `<div class="atlas-tip">
    <div class="atlas-tip-kicker">${esc(c.subject.name)}</div>
    <div class="atlas-tip-title">${esc(c.unit.name)}</div>
    <div>${c.unit.topics.length} topics · ${asked} questions</div>
    ${c.unit.blind_spot ? `<div class="atlas-tip-blind">Never in the mid-sems, asked in the End Sem</div>` : ""}
  </div>`;
}

function cityLabel(c: City): string {
  const t = c.topic;
  const heat = t.is_repeat ? "Came back from a mid-sem in the End Sem" : t.exams_count >= 2 ? `Asked in ${t.exams_count} exams` : "Asked once";
  return `<div class="atlas-tip">
    <div class="atlas-tip-kicker">${esc(c.subject.name)} / ${esc(c.unit.name)}</div>
    <div class="atlas-tip-title">${esc(t.name)}</div>
    <div style="color:${HEAT[c.heat]}">${heat}</div>
    <div>${t.questions.length} questions · ${t.total_marks} marks · click to open</div>
  </div>`;
}

function continentElement(c: ContinentLabel): HTMLElement {
  const el = document.createElement("div");
  el.className = "atlas-continent";
  el.textContent = c.subject.name;
  return el;
}

/** The semester as a planet: subjects = continents, units = countries, topics = cities coloured by how often they were asked. */
export default function PlanetGlobe({ planet, onPick }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const onPickRef = useRef(onPick);

  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    let cancelled = false;
    let globe: GlobeInstance | null = null;
    const mount = mountRef.current!;
    (async () => {
      const [{ default: Globe }, THREE] = await Promise.all([import("globe.gl"), import("three")]);
      if (cancelled) return;
      let hovered: Country | null = null;
      const g = new Globe(mount, { animateIn: false })
        .backgroundColor("rgba(0,0,0,0)")
        .globeMaterial(new THREE.MeshPhongMaterial({ color: "#15133a", emissive: "#0b0a26", shininess: 4 }))
        .showAtmosphere(true)
        .atmosphereColor("#7657ff")
        .atmosphereAltitude(0.2)
        .showGraticules(true)
        // globe.gl types geometry loosely; the GeoJSON Polygon is what it expects at runtime
        .polygonGeoJsonGeometry((d) => (d as Country).feature.geometry as never)
        .polygonCapColor((d) => SUBJECT_COLORS[(d as Country).subjectIndex % SUBJECT_COLORS.length] + "59")
        .polygonSideColor(() => "rgba(19, 18, 26, 0.7)")
        .polygonStrokeColor(() => "rgba(255, 255, 255, 0.14)")
        .polygonAltitude((d) => (d === hovered ? 0.03 : 0.012))
        .polygonLabel((d) => countryLabel(d as Country))
        .polygonsTransitionDuration(300)
        .onPolygonHover((d) => {
          hovered = (d as Country) ?? null;
          g.polygonAltitude(g.polygonAltitude());
          mount.style.cursor = d ? "pointer" : "grab";
        })
        .onPolygonClick((d) => {
          g.controls().autoRotate = false;
          g.pointOfView({ ...(d as Country).center, altitude: 1.3 }, 1000);
        })
        // cities = topics, square "pixels" like the hero planet
        .pointLat((d) => (d as City).lat)
        .pointLng((d) => (d as City).lng)
        .pointResolution(4)
        .pointColor((d) => HEAT[(d as City).heat])
        .pointAltitude(0.05)
        .pointRadius((d) => 0.38 + 0.12 * ((d as City).topic.exams_count + ((d as City).topic.is_repeat ? 1 : 0)))
        .pointLabel((d) => cityLabel(d as City))
        .onPointClick((d) => onPickRef.current(d as City))
        // red pulse = came back from a mid-sem in the End Sem
        .ringLat((d) => (d as City).lat)
        .ringLng((d) => (d as City).lng)
        .ringColor(() => (t: number) => `rgba(255, 59, 78, ${1 - t})`)
        .ringMaxRadius(3.2)
        .ringPropagationSpeed(2.4)
        .ringRepeatPeriod(1100)
        .ringAltitude(0.05)
        // units the mid-sems never tested: a thick lavender border
        .pathPoints((d) => d as number[][])
        .pathPointLat((p) => (p as number[])[1])
        .pathPointLng((p) => (p as number[])[0])
        .pathPointAlt(0.016)
        .pathColor(() => BLIND_SPOT)
        .pathStroke(2.2)
        .htmlElement((d) => continentElement(d as ContinentLabel))
        .htmlAltitude(0.06)
        .width(mount.clientWidth)
        .height(mount.clientHeight);
      g.polygonsData(planet.countries)
        .pointsData(planet.cities)
        .ringsData(planet.cities.filter((c) => c.heat === "repeat"))
        .pathsData(planet.countries.filter((c) => c.unit.blind_spot).map((c) => c.feature.geometry.coordinates[0]))
        .htmlElementsData(planet.continents);

      // the design's tilted orbit ring
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(g.getGlobeRadius() * 1.28, 0.25, 8, 200),
        new THREE.MeshBasicMaterial({ color: "#54e4ff", transparent: true, opacity: 0.35 }),
      );
      ring.rotation.set(Math.PI / 2 - 0.3, 0, -0.35);
      g.scene().add(ring);

      const controls = g.controls();
      controls.enableZoom = false; // the page scrolls; zoom by clicking a country
      controls.enableDamping = true;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.35;
      const first = planet.continents[0];
      g.pointOfView({ lat: (first?.lat ?? 0) - 10, lng: first?.lng ?? 0, altitude: 2.3 });
      globe = g;
    })();

    const ro = new ResizeObserver(() => globe?.width(mount.clientWidth).height(mount.clientHeight));
    ro.observe(mount);
    return () => {
      cancelled = true;
      ro.disconnect();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globe as any)?._destructor?.();
      mount.innerHTML = "";
    };
  }, [planet]);

  return <div ref={mountRef} className="absolute inset-0" />;
}
