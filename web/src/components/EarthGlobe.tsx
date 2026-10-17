"use client";

import { useEffect, useRef } from "react";
import type { GlobeInstance } from "globe.gl";
import type { Feature } from "geojson";

import type { College } from "@/lib/types";

export interface EarthHandle {
  flyTo: (lat: number, lng: number, altitude?: number, ms?: number) => void;
}

interface Props {
  colleges: College[];
  onPick: (college: College) => void;
  onAddCollege: () => void;
  handleRef: React.RefObject<EarthHandle | null>;
  active: boolean;
}

const INDIA = { lat: 22, lng: 79, altitude: 2.1 };
// Ghost pin sits in open ocean so it never implies a real college.
const GHOST = { lat: -14, lng: 74 };

type Pin = { kind: "college"; college: College; lat: number; lng: number } | { kind: "ghost"; lat: number; lng: number };

function span(className: string, text = ""): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = className;
  s.textContent = text;
  return s;
}

function pinElement(pin: Pin, onPick: Props["onPick"], onAdd: () => void): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.style.pointerEvents = "auto";
  el.style.cursor = "pointer";
  const label = span("atlas-pin-label", pin.kind === "college" ? pin.college.name : "+ Add your college");
  if (pin.kind === "college") {
    el.className = "atlas-pin";
    label.appendChild(span("atlas-pin-city", pin.college.city));
    el.onclick = () => onPick(pin.college);
  } else {
    el.className = "atlas-pin atlas-pin-ghost";
    el.onclick = onAdd;
  }
  el.append(span("atlas-pin-dot"), label);
  return el;
}

export default function EarthGlobe({ colleges, onPick, onAddCollege, handleRef, active }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeInstance | null>(null);
  const collegesRef = useRef(colleges);
  const callbacks = useRef({ onPick, onAddCollege });

  useEffect(() => {
    callbacks.current = { onPick, onAddCollege };
  }, [onPick, onAddCollege]);

  // Create the globe once.
  useEffect(() => {
    let cancelled = false;
    const mount = mountRef.current!;
    (async () => {
      const [{ default: Globe }, THREE, topo, world] = await Promise.all([
        import("globe.gl"),
        import("three"),
        import("topojson-client"),
        import("world-atlas/countries-110m.json"),
      ]);
      if (cancelled) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const countries = (topo.feature(world as any, (world as any).objects.countries) as unknown as { features: Feature[] }).features
        // Antarctica contains the pole, which the hex grid cannot fill.
        .filter((f) => f.id !== "010")
        .map(dropDegeneratePolygons);

      const globe = new Globe(mount, { animateIn: true })
        .backgroundColor("rgba(0,0,0,0)")
        .globeMaterial(new THREE.MeshPhongMaterial({ color: "#15133a", emissive: "#0b0a26", shininess: 6 }))
        .showAtmosphere(true)
        .atmosphereColor("#7657ff")
        .atmosphereAltitude(0.2)
        .hexPolygonsData(countries)
        .hexPolygonResolution(3)
        .hexPolygonMargin(0.35)
        .hexPolygonColor(() => "rgba(196, 181, 253, 0.5)")
        .htmlElement((d) => pinElement(d as Pin, (c) => callbacks.current.onPick(c), () => callbacks.current.onAddCollege()))
        .width(mount.clientWidth)
        .height(mount.clientHeight)
        .pointOfView(INDIA);
      globe.controls().autoRotate = false;
      globe.controls().enableDamping = true;
      globe.controls().enableZoom = false; // the page scrolls; zoom happens by flying to a pin
      globeRef.current = globe;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (process.env.NODE_ENV !== "production") (window as any).__atlasEarth = globe;
      handleRef.current = {
        flyTo: (lat, lng, altitude = 0.9, ms = 1600) => globe.pointOfView({ lat, lng, altitude }, ms),
      };
      // Layers that depend on data are set by the effect below.
      globe.htmlElementsData(pinsFor(collegesRef.current));
    })();

    // the globe lives in a card, so follow the card size (not the window)
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

  // A hidden globe stops rendering (saves the demo laptop's GPU).
  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    if (active) g.resumeAnimation();
    else g.pauseAnimation();
  }, [active]);

  // Update data layers without re-creating the globe.
  useEffect(() => {
    collegesRef.current = colleges;
    globeRef.current?.htmlElementsData(pinsFor(colleges));
  }, [colleges]);

  return <div ref={mountRef} className="absolute inset-0" />;
}

/** world-atlas has a few zero-area slivers (e.g. one in North Korea) that make the hex grid throw. */
function dropDegeneratePolygons(f: Feature): Feature {
  const distinct = (ring: number[][]) => new Set(ring.map((c) => c.join(","))).size;
  const g = f.geometry;
  if (g.type !== "MultiPolygon") return f;
  return { ...f, geometry: { ...g, coordinates: g.coordinates.filter((poly) => distinct(poly[0]) >= 3) } };
}

function pinsFor(colleges: College[]): Pin[] {
  return [
    ...colleges.map((college) => ({ kind: "college" as const, college, lat: college.lat, lng: college.lng })),
    { kind: "ghost" as const, ...GHOST },
  ];
}
