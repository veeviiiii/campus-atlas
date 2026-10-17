declare module "d3-geo-voronoi" {
  import type { FeatureCollection, Polygon } from "geojson";

  interface GeoVoronoi<T> {
    x(fn: (d: T) => number): GeoVoronoi<T>;
    y(fn: (d: T) => number): GeoVoronoi<T>;
    polygons(data?: T[]): FeatureCollection<Polygon, { site: T; sitecoordinates: [number, number]; neighbours: number[] }>;
  }

  export function geoVoronoi<T>(data?: T[]): GeoVoronoi<T>;
}
