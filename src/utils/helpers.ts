/**
 * Utility helper functions for the IndoorGIS app
 */

/**
 * Format walking time in seconds to human-readable format
 * @param seconds - Time in seconds
 * @returns Formatted time string (e.g., "2m 30s", "1h 5m 20s")
 */
export const formatWalkingTime = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
};

/**
 * Get current step indicator text based on session state
 * @param isPDRTracking - Whether PDR is currently tracking
 * @param currentPOIToScan - Current POI to scan
 * @returns Step indicator text
 */
export const getCurrentStepText = (isPDRTracking: boolean, currentPOIToScan: any): string => {
  if (!isPDRTracking) {
    return 'Step 1: Start PDR';
  } else if (!currentPOIToScan) {
    return 'Step 2: Wait for POI';
  } else {
    return 'Step 3: Scan POI';
  }
};

/**
 * Validate POI coordinates
 * @param poi - POI object
 * @returns Object with validation result and coordinates
 */
export const validatePOICoordinates = (poi: any): { isValid: boolean; coordinates?: { latitude: number; longitude: number } } => {
  let poiLat: number = 0;
  let poiLng: number = 0;

  // Try different coordinate formats
  if (poi.coordinates) {
    const coords = poi.coordinates;
    if (coords.lat && coords.lon) {
      poiLat = parseFloat(String(coords.lat));
      poiLng = parseFloat(String(coords.lon));
    } else if (coords.latitude && coords.longitude) {
      poiLat = parseFloat(String(coords.latitude));
      poiLng = parseFloat(String(coords.longitude));
    } else if (Array.isArray(coords) && coords.length >= 2) {
      poiLat = parseFloat(String(coords[0]));
      poiLng = parseFloat(String(coords[1]));
    }
  } else if (poi.coordinates_lat && poi.coordinates_lon) {
    poiLat = parseFloat(String(poi.coordinates_lat));
    poiLng = parseFloat(String(poi.coordinates_lon));
  } else if (poi.latitude && poi.longitude) {
    poiLat = poi.latitude;
    poiLng = poi.longitude;
  }

  // More lenient validation - allow coordinates near 0 but not exactly 0
  if (isNaN(poiLat) || isNaN(poiLng) || (poiLat === 0 && poiLng === 0)) {
    return { isValid: false };
  }

  return {
    isValid: true,
    coordinates: { latitude: poiLat, longitude: poiLng }
  };
};

/**
 * Generate session status text
 * @param sessionProgress - Session progress object
 * @param isSessionComplete - Whether session is complete
 * @returns Status text
 */
export const getSessionStatusText = (sessionProgress: any, isSessionComplete: boolean): string => {
  if (isSessionComplete) {
    return 'All POIs Completed!';
  }
  return sessionProgress ? `${sessionProgress.completed}/${sessionProgress.total}` : '0/0';
};

/**
 * Check if coordinates are valid
 * @param lat - Latitude
 * @param lng - Longitude
 * @returns Whether coordinates are valid
 */
export const isValidCoordinate = (lat: number, lng: number): boolean => {
  return !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0;
};

/**
 * Calculate distance between two coordinates
 * @param lat1 - First latitude
 * @param lng1 - First longitude
 * @param lat2 - Second latitude
 * @param lng2 - Second longitude
 * @returns Distance in meters
 */
export const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
};
