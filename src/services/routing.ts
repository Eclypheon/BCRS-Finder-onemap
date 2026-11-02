// Walking Routing Service using Singapore SLA OneMap (routetype=walk)
// Fetches pedestrian path networks across Singapore.

export interface WalkingRouteResult {
  coordinates: [number, number][]; // [lat, lng] array formatted for Leaflet polylines
  distanceMeters: number;
  durationSeconds: number;
  provider?: 'onemap' | 'fallback';
}

const routeCache = new Map<string, WalkingRouteResult>();

/**
 * Decodes Google Encoded Polyline format returned by OneMap API
 * into an array of Leaflet [latitude, longitude] pairs.
 */
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;

  while (index < len) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

/**
 * Gets the configured OneMap API access token
 */
export function getOnemapToken(): string | null {
  try {
    return (
      (window as any).ONEMAP_TOKEN ||
      localStorage.getItem('onemap_token') ||
      import.meta.env.VITE_ONEMAP_TOKEN ||
      null
    );
  } catch {
    return null;
  }
}

/**
 * Sets the OneMap API token in localStorage
 */
export function setOnemapToken(token: string): void {
  try {
    localStorage.setItem('onemap_token', token.trim());
    (window as any).ONEMAP_TOKEN = token.trim();
  } catch {
    // storage unavailable
  }
}

// Expose token setter on window for quick browser console access
if (typeof window !== 'undefined') {
  (window as any).setOnemapToken = setOnemapToken;
  (window as any).getOnemapToken = getOnemapToken;
}

/**
 * Fetches the pedestrian walking route between two coordinates in Singapore
 * using the official SLA OneMap pedestrian routing engine (routeType=walk).
 */
export async function fetchWalkingRoute(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number
): Promise<WalkingRouteResult> {
  const cacheKey = `${startLat.toFixed(5)},${startLng.toFixed(5)}_${endLat.toFixed(5)},${endLng.toFixed(5)}`;
  if (routeCache.has(cacheKey)) {
    return routeCache.get(cacheKey)!;
  }

  // OneMap expects start=lat,lng&end=lat,lng&routeType=walk
  const url = `https://www.onemap.gov.sg/api/public/routingsvc/route?start=${startLat.toFixed(6)},${startLng.toFixed(6)}&end=${endLat.toFixed(6)},${endLng.toFixed(6)}&routeType=walk`;

  const token = getOnemapToken();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (token) {
      headers['Authorization'] = token.startsWith('Bearer ') ? token : token;
    }

    const res = await fetch(url, {
      signal: controller.signal,
      headers,
    });
    clearTimeout(timeoutId);

    if (res.status === 401 || res.status === 403) {
      console.warn(
        'OneMap route returned 401/403 Unauthorized. OneMap requires an access token in the Authorization header. You can set it in localStorage via setOnemapToken("YOUR_TOKEN").'
      );
    }

    if (res.ok) {
      const data = await res.json();
      const geom = data?.route_geometry;
      if (geom && typeof geom === 'string') {
        const decodedCoords = decodePolyline(geom);
        if (decodedCoords.length > 0) {
          const result: WalkingRouteResult = {
            coordinates: decodedCoords,
            distanceMeters: Math.round(data?.route_summary?.total_distance || 0),
            durationSeconds: Math.round(data?.route_summary?.total_time || 0),
            provider: 'onemap',
          };

          if (routeCache.size > 100) {
            const firstKey = routeCache.keys().next().value;
            if (firstKey) routeCache.delete(firstKey);
          }
          routeCache.set(cacheKey, result);
          return result;
        }
      }
    }
  } catch (err: any) {
    console.warn('OneMap walking route lookup failed:', err?.message);
  }

  // Fallback: direct line between start and destination
  return {
    coordinates: [
      [startLat, startLng],
      [endLat, endLng],
    ],
    distanceMeters: 0,
    durationSeconds: 0,
    provider: 'fallback',
  };
}
