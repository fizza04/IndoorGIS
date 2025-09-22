import { validatePOICoordinates, isValidCoordinate } from '../utils/helpers';

/**
 * Coordinate service for handling coordinate operations
 */
export class CoordinateService {
  /**
   * Get transformed POI coordinates
   */
  static getTransformedPOICoordinates(poi: any): { latitude: number; longitude: number } | null {
    const validation = validatePOICoordinates(poi);
    return validation.isValid ? validation.coordinates! : null;
  }

  /**
   * Navigate to route location with POI coordinates
   */
  static navigateToRouteLocation(
    route: any,
    pois: any[],
    mapRef: any,
    setRegion: (region: any) => void,
    setIsNavigatingToRoute: (value: boolean) => void
  ) {
    const poisToUse = route.pois && route.pois.length > 0 ? route.pois : pois;
    
    if (poisToUse && poisToUse.length > 0) {
      // Collect all valid POI coordinates
      const validCoordinates = [];
      
        for (const poi of poisToUse) {
          const coordinates = this.getTransformedPOICoordinates(poi);
          if (coordinates) {
            validCoordinates.push(coordinates);
          }
        }
      
      if (validCoordinates.length > 0) {
        // Calculate center point and optimal zoom level
        const { center, zoomLevel } = this.calculateOptimalView(validCoordinates);
        
        // Update the map region state with optimal zoom
        setRegion({
          latitude: center.latitude,
          longitude: center.longitude,
          latitudeDelta: zoomLevel,
          longitudeDelta: zoomLevel,
        });
        
        // Animate to the region
        if (mapRef.current) {
          mapRef.current.animateToRegion({
            latitude: center.latitude,
            longitude: center.longitude,
            latitudeDelta: zoomLevel,
            longitudeDelta: zoomLevel,
          }, 1000);
        }
        
        setIsNavigatingToRoute(false);
        return true;
      } else {
        setIsNavigatingToRoute(false);
        return false;
      }
    } else {
      setIsNavigatingToRoute(false);
      return false;
    }
  }

  /**
   * Check if POI has valid coordinates
   */
  static hasValidCoordinates(poi: any): boolean {
    const validation = validatePOICoordinates(poi);
    return validation.isValid;
  }

  /**
   * Get building coordinates for fallback
   */
  static getBuildingCoordinates(building: any): { latitude: number; longitude: number } | null {
    if (!building?.coordinates) return null;
    
    const lat = parseFloat(building.coordinates.latitude?.toString() || '0');
    const lng = parseFloat(building.coordinates.longitude?.toString() || '0');
    
    if (isValidCoordinate(lat, lng)) {
      return { latitude: lat, longitude: lng };
    }
    
    return null;
  }

  /**
   * Calculate optimal view for multiple coordinates
   */
  static calculateOptimalView(coordinates: { latitude: number; longitude: number }[]): {
    center: { latitude: number; longitude: number };
    zoomLevel: number;
  } {
    if (coordinates.length === 0) {
      return {
        center: { latitude: 0, longitude: 0 },
        zoomLevel: 0.01
      };
    }

    if (coordinates.length === 1) {
      return {
        center: coordinates[0],
        zoomLevel: 0.005 // Good zoom for single POI
      };
    }

    // Calculate bounds
    let minLat = coordinates[0].latitude;
    let maxLat = coordinates[0].latitude;
    let minLng = coordinates[0].longitude;
    let maxLng = coordinates[0].longitude;

    for (const coord of coordinates) {
      minLat = Math.min(minLat, coord.latitude);
      maxLat = Math.max(maxLat, coord.latitude);
      minLng = Math.min(minLng, coord.longitude);
      maxLng = Math.max(maxLng, coord.longitude);
    }

    // Calculate center
    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;

    // Calculate span
    const latSpan = maxLat - minLat;
    const lngSpan = maxLng - minLng;

    console.log('🔍 calculateOptimalView debug:', {
      coordinates,
      minLat, maxLat, minLng, maxLng,
      centerLat, centerLng,
      latSpan, lngSpan
    });

    // Calculate optimal zoom level with padding
    const padding = 1.5; // 50% padding around the POIs
    const maxSpan = Math.max(latSpan, lngSpan);
    
    let zoomLevel;
    if (maxSpan < 0.001) {
      zoomLevel = 0.005; // Very close POIs
    } else if (maxSpan < 0.005) {
      zoomLevel = 0.01; // Close POIs
    } else if (maxSpan < 0.01) {
      zoomLevel = 0.02; // Medium distance POIs
    } else if (maxSpan < 0.02) {
      zoomLevel = 0.03; // Far apart POIs
    } else {
      zoomLevel = 0.05; // Very far apart POIs
    }

    // Apply padding
    zoomLevel *= padding;

    const result = {
      center: { latitude: centerLat, longitude: centerLng },
      zoomLevel: Math.max(zoomLevel, 0.002) // Minimum zoom level
    };

    console.log('🔍 calculateOptimalView result:', result);
    return result;
  }

  /**
   * Create default coordinates
   */
  static getDefaultCoordinates() {
    return {
      latitude: 35.1736,
      longitude: 33.3647,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    };
  }
}
