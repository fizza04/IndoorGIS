import { POI, Building } from '../../types';

export interface LocalCoordinates {
  x: number; // meters
  y: number; // meters
  floor: number;
}

export interface GlobalCoordinates {
  latitude: number;
  longitude: number;
  floor: number;
}

export interface CoordinateBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export class CoordinateTransformer {
  private bounds: CoordinateBounds | null = null;
  private buildingId: string | null = null;
  
  /**
   * Initialize coordinate transformation for a building
   */
  initializeBuilding(building: Building, pois: POI[]): void {
    this.buildingId = building.id || building.bu_code || '';
    
    // Calculate bounds from POIs
    const poiCoordinates = pois
      .map(poi => this.extractPOICoordinates(poi))
      .filter(coord => coord !== null) as GlobalCoordinates[];
    
    if (poiCoordinates.length === 0) {
      throw new Error('No valid POI coordinates found for coordinate transformation');
    }
    
    // Use POI coordinates to create building bounds if building coordinates not available
    if (!building.coordinates) {
      console.log('Building coordinates not available, using POI coordinates for bounds');
    }
    
    // Calculate bounds
    const latitudes = poiCoordinates.map(coord => coord.latitude);
    const longitudes = poiCoordinates.map(coord => coord.longitude);
    
    const minLat = Math.min(...latitudes);
    const maxLat = Math.max(...latitudes);
    const minLng = Math.min(...longitudes);
    const maxLng = Math.max(...longitudes);
    
    // Add some padding
    const latPadding = (maxLat - minLat) * 0.1;
    const lngPadding = (maxLng - minLng) * 0.1;
    
    this.bounds = {
      minLat: minLat - latPadding,
      maxLat: maxLat + latPadding,
      minLng: minLng - lngPadding,
      maxLng: maxLng + lngPadding,
      minX: 0,
      maxX: 100, // Default 100m width
      minY: 0,
      maxY: 100  // Default 100m height
    };
    
  }
  
  /**
   * Convert global coordinates (lat/lng) to local coordinates (x,y in meters)
   */
  globalToLocal(global: GlobalCoordinates): LocalCoordinates {
    if (!this.bounds) {
      throw new Error('Coordinate transformation not initialized');
    }
    
    const { minLat, maxLat, minLng, maxLng, minX, maxX, minY, maxY } = this.bounds;
    
    // Normalize coordinates to 0-1 range
    const normalizedLat = (global.latitude - minLat) / (maxLat - minLat);
    const normalizedLng = (global.longitude - minLng) / (maxLng - minLng);
    
    // Convert to local coordinates
    const x = minX + normalizedLng * (maxX - minX);
    const y = minY + (1 - normalizedLat) * (maxY - minY); // Flip Y axis
    
    return {
      x: Math.round(x * 100) / 100, // Round to 2 decimal places
      y: Math.round(y * 100) / 100,
      floor: global.floor
    };
  }
  
  /**
   * Convert local coordinates (x,y in meters) to global coordinates (lat/lng)
   */
  localToGlobal(local: LocalCoordinates): GlobalCoordinates {
    if (!this.bounds) {
      throw new Error('Coordinate transformation not initialized');
    }
    
    const { minLat, maxLat, minLng, maxLng, minX, maxX, minY, maxY } = this.bounds;
    
    // Normalize local coordinates to 0-1 range
    const normalizedX = (local.x - minX) / (maxX - minX);
    const normalizedY = (local.y - minY) / (maxY - minY);
    
    // Convert to global coordinates
    const latitude = minLat + (1 - normalizedY) * (maxLat - minLat); // Flip Y axis
    const longitude = minLng + normalizedX * (maxLng - minLng);
    
    return {
      latitude: Math.round(latitude * 1000000) / 1000000, // Round to 6 decimal places
      longitude: Math.round(longitude * 1000000) / 1000000,
      floor: local.floor
    };
  }
  
  /**
   * Convert POI to local coordinates
   */
  poiToLocal(poi: POI): LocalCoordinates | null {
    const globalCoords = this.extractPOICoordinates(poi);
    if (!globalCoords) return null;
    
    return this.globalToLocal(globalCoords);
  }
  
  /**
   * Convert multiple POIs to local coordinates
   */
  poisToLocal(pois: POI[]): LocalCoordinates[] {
    return pois
      .map(poi => this.poiToLocal(poi))
      .filter(coord => coord !== null) as LocalCoordinates[];
  }
  
  /**
   * Extract coordinates from POI (handles different coordinate formats)
   */
  private extractPOICoordinates(poi: POI): GlobalCoordinates | null {
    let latitude: number;
    let longitude: number;
    let floor: number;
    
    // Try different coordinate formats
    if (poi.latitude && poi.longitude) {
      latitude = poi.latitude;
      longitude = poi.longitude;
    } else if (poi.coordinates?.latitude && poi.coordinates?.longitude) {
      latitude = poi.coordinates.latitude;
      longitude = poi.coordinates.longitude;
    } else if (poi.coordinates_lat && poi.coordinates_lon) {
      latitude = parseFloat(poi.coordinates_lat.toString());
      longitude = parseFloat(poi.coordinates_lon.toString());
    } else {
      return null;
    }
    
    // Extract floor number
    if (poi.floor_number) {
      floor = parseInt(poi.floor_number.toString());
    } else if (poi.floor) {
      floor = poi.floor;
    } else {
      floor = 1; // Default to floor 1
    }
    
    // Validate coordinates
    if (isNaN(latitude) || isNaN(longitude) || isNaN(floor)) {
      return null;
    }
    
    return { latitude, longitude, floor };
  }
  
  /**
   * Calculate distance between two local coordinates (in meters)
   */
  static calculateDistance(coord1: LocalCoordinates, coord2: LocalCoordinates): number {
    const dx = coord2.x - coord1.x;
    const dy = coord2.y - coord1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  
  /**
   * Calculate bearing between two local coordinates (in degrees)
   */
  static calculateBearing(from: LocalCoordinates, to: LocalCoordinates): number {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const bearing = Math.atan2(dy, dx) * (180 / Math.PI);
    return ((bearing % 360) + 360) % 360;
  }
  
  /**
   * Check if coordinates are within bounds
   */
  isWithinBounds(local: LocalCoordinates): boolean {
    if (!this.bounds) return false;
    
    const { minX, maxX, minY, maxY } = this.bounds;
    return local.x >= minX && local.x <= maxX && local.y >= minY && local.y <= maxY;
  }
  
  /**
   * Get current bounds
   */
  getBounds(): CoordinateBounds | null {
    return this.bounds;
  }
  
  /**
   * Convert local coordinates to lat/lng (alias for localToGlobal)
   */
  localToLatLng(x: number, y: number): { latitude: number; longitude: number } {
    const local: LocalCoordinates = { x, y, floor: 1 };
    const global = this.localToGlobal(local);
    return {
      latitude: global.latitude,
      longitude: global.longitude
    };
  }

  /**
   * Convert lat/lng to local coordinates (alias for globalToLocal)
   */
  latLngToLocal(latitude: number, longitude: number): { x: number; y: number } {
    const global: GlobalCoordinates = { latitude, longitude, floor: 1 };
    const local = this.globalToLocal(global);
    return {
      x: local.x,
      y: local.y
    };
  }

  /**
   * Reset transformation
   */
  reset(): void {
    this.bounds = null;
    this.buildingId = null;
  }
}
