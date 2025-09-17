import { Alert, Vibration } from 'react-native';
import { POI, AuditRoute } from '../../types';
import { QRAnchor } from '../anchors/QRAnchorService';

// PDR Position interface - moved here to remove PDR dependency
export interface PDRPosition {
  x: number;
  y: number;
  heading: number;
  confidence: number;
  timestamp: number;
  stepCount: number;
  accuracy: number;
}

export interface NavigationState {
  isActive: boolean;
  currentRoute: AuditRoute | null;
  currentPOI: POI | null;
  currentPOIIndex: number;
  totalPOIs: number;
  completedPOIs: number;
  progress: number; // 0-100
  distanceToNextPOI: number;
  estimatedTimeRemaining: number;
  isNearPOI: boolean;
  isOffRoute: boolean;
  lastCalibrationTime: number;
}

export interface NavigationConfig {
  poiProximityThreshold: number; // meters
  offRouteThreshold: number; // meters
  calibrationInterval: number; // milliseconds
  routeTolerance: number; // meters
}

export class NavigationService {
  private state: NavigationState = {
    isActive: false,
    currentRoute: null,
    currentPOI: null,
    currentPOIIndex: 0,
    totalPOIs: 0,
    completedPOIs: 0,
    progress: 0,
    distanceToNextPOI: 0,
    estimatedTimeRemaining: 0,
    isNearPOI: false,
    isOffRoute: false,
    lastCalibrationTime: 0
  };

  private config: NavigationConfig = {
    poiProximityThreshold: 2.0, // 2 meters (reduced from 3)
    offRouteThreshold: 5.0, // 5 meters
    calibrationInterval: 30000, // 30 seconds
    routeTolerance: 5.0 // 5 meters
  };

  private currentPosition: PDRPosition | null = null;
  private routePath: { x: number; y: number }[] = [];
  private completedPOIIds: Set<string> = new Set();
  private lastPOIAlertTime: number = 0;
  private poiAlertCooldown: number = 10000; // 10 seconds cooldown

  // Event callbacks
  private onStateUpdate?: (state: NavigationState) => void;
  private onPOIReached?: (poi: POI) => void;
  private onRouteComplete?: () => void;
  private onCalibrationRequired?: () => void;
  private onOffRoute?: () => void;

  constructor(config?: Partial<NavigationConfig>) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  /**
   * Start navigation with a route
   */
  startRoute(route: AuditRoute, pois: POI[]): void {
    if (!route.pois || route.pois.length === 0) {
      throw new Error('Route has no POIs');
    }

    this.state = {
      isActive: true,
      currentRoute: route,
      currentPOI: route.pois[0],
      currentPOIIndex: 0,
      totalPOIs: route.pois.length,
      completedPOIs: 0,
      progress: 0,
      distanceToNextPOI: 0,
      estimatedTimeRemaining: this.calculateEstimatedTime(route.pois),
      isNearPOI: false,
      isOffRoute: false,
      lastCalibrationTime: Date.now()
    };

    this.routePath = this.generateRoutePath(route.pois);
    this.completedPOIIds.clear();

    this.notifyStateUpdate();
    console.log(`Navigation started: ${route.name} with ${route.pois.length} POIs`);
  }

  /**
   * Stop navigation
   */
  stopRoute(): void {
    this.state.isActive = false;
    this.state.currentRoute = null;
    this.state.currentPOI = null;
    this.currentPosition = null;
    this.routePath = [];
    this.completedPOIIds.clear();

    this.notifyStateUpdate();
    console.log('Navigation stopped');
  }

  /**
   * Update current position from PDR
   */
  updatePosition(position: PDRPosition): void {
    this.currentPosition = position;
    
    if (!this.state.isActive || !this.state.currentRoute) return;

    // Update distance to next POI
    this.updateDistanceToNextPOI();

    // Check if near POI
    this.checkPOIProximity();

    // Check if off route
    this.checkOffRoute();

    // Check if calibration needed
    this.checkCalibrationNeeded();

    this.notifyStateUpdate();
  }

  /**
   * Complete current POI
   */
  completeCurrentPOI(poiId?: string): boolean {
    if (!this.state.isActive || !this.state.currentPOI) return false;

    const targetPOI = poiId ? 
      this.state.currentRoute?.pois?.find(p => p.id === poiId || p.puid === poiId) :
      this.state.currentPOI;

    if (!targetPOI) return false;

    // Mark POI as completed
    this.completedPOIIds.add(targetPOI.id || targetPOI.puid || '');
    this.state.completedPOIs++;

    // Move to next POI
    this.moveToNextPOI();

    this.notifyStateUpdate();
    console.log(`POI completed: ${targetPOI.name || targetPOI.title}`);
    return true;
  }

  /**
   * Skip current POI
   */
  skipCurrentPOI(): boolean {
    if (!this.state.isActive || !this.state.currentPOI) return false;

    console.log(`POI skipped: ${this.state.currentPOI.name || this.state.currentPOI.title}`);
    return this.moveToNextPOI();
  }

  /**
   * Calibrate position using anchor
   */
  calibratePosition(anchor: QRAnchor): void {
    if (!this.currentPosition) return;

    // Update PDR position (this would be done by the PDR service)
    // For now, we'll just update our internal state
    this.state.lastCalibrationTime = Date.now();
    this.state.isOffRoute = false;

    console.log(`Position calibrated using anchor: ${anchor.name}`);
    this.notifyStateUpdate();
  }

  /**
   * Get current navigation state
   */
  getState(): NavigationState {
    return { ...this.state };
  }

  /**
   * Get current position
   */
  getCurrentPosition(): PDRPosition | null {
    return this.currentPosition;
  }

  /**
   * Get route progress
   */
  getRouteProgress(): {
    currentPOI: POI | null;
    completedPOIs: number;
    totalPOIs: number;
    progress: number;
    distanceToNextPOI: number;
  } {
    return {
      currentPOI: this.state.currentPOI,
      completedPOIs: this.state.completedPOIs,
      totalPOIs: this.state.totalPOIs,
      progress: this.state.progress,
      distanceToNextPOI: this.state.distanceToNextPOI
    };
  }

  /**
   * Check if POI is completed
   */
  isPOICompleted(poiId: string): boolean {
    return this.completedPOIIds.has(poiId);
  }

  /**
   * Get remaining POIs
   */
  getRemainingPOIs(): POI[] {
    if (!this.state.currentRoute?.pois) return [];
    
    return this.state.currentRoute.pois.filter(poi => 
      !this.completedPOIIds.has(poi.id || poi.puid || '')
    );
  }

  /**
   * Set event callbacks
   */
  setOnStateUpdate(callback: (state: NavigationState) => void): void {
    this.onStateUpdate = callback;
  }

  setOnPOIReached(callback: (poi: POI) => void): void {
    this.onPOIReached = callback;
  }

  setOnRouteComplete(callback: () => void): void {
    this.onRouteComplete = callback;
  }

  setOnCalibrationRequired(callback: () => void): void {
    this.onCalibrationRequired = callback;
  }

  setOnOffRoute(callback: () => void): void {
    this.onOffRoute = callback;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<NavigationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Private methods
   */

  private updateDistanceToNextPOI(): void {
    if (!this.currentPosition || !this.state.currentPOI) {
      this.state.distanceToNextPOI = 0;
      return;
    }

    const poiCoords = this.getPOICoordinates(this.state.currentPOI);
    if (!poiCoords) {
      this.state.distanceToNextPOI = 0;
      return;
    }

    const distance = Math.sqrt(
      Math.pow(poiCoords.x - this.currentPosition.x, 2) +
      Math.pow(poiCoords.y - this.currentPosition.y, 2)
    );

    this.state.distanceToNextPOI = distance;
  }

  private checkPOIProximity(): void {
    if (!this.currentPosition || !this.state.currentPOI) return;

    const distance = this.state.distanceToNextPOI;
    const wasNearPOI = this.state.isNearPOI;
    this.state.isNearPOI = distance <= this.config.poiProximityThreshold;

    // Trigger POI reached event when entering proximity (with cooldown)
    if (!wasNearPOI && this.state.isNearPOI) {
      const now = Date.now();
      if (now - this.lastPOIAlertTime > this.poiAlertCooldown) {
        this.lastPOIAlertTime = now;
        
        if (this.onPOIReached) {
          this.onPOIReached(this.state.currentPOI);
        }
        
        // Vibrate when near POI
        Vibration.vibrate(200);
        
        console.log(`POI reached: ${this.state.currentPOI.name || this.state.currentPOI.title} (distance: ${distance.toFixed(2)}m)`);
      }
    }
  }

  private checkOffRoute(): void {
    if (!this.currentPosition || !this.state.currentRoute) return;

    // Check if current position is within route tolerance
    const isOnRoute = this.isPositionOnRoute(this.currentPosition);
    const wasOffRoute = this.state.isOffRoute;
    this.state.isOffRoute = !isOnRoute;

    // Trigger off-route event when going off route
    if (!wasOffRoute && this.state.isOffRoute) {
      if (this.onOffRoute) {
        this.onOffRoute();
      }
    }
  }

  private checkCalibrationNeeded(): void {
    const timeSinceCalibration = Date.now() - this.state.lastCalibrationTime;
    
    if (timeSinceCalibration > this.config.calibrationInterval) {
      if (this.onCalibrationRequired) {
        this.onCalibrationRequired();
      }
    }
  }

  private moveToNextPOI(): boolean {
    if (!this.state.currentRoute?.pois) return false;

    const nextIndex = this.state.currentPOIIndex + 1;
    
    if (nextIndex >= this.state.currentRoute.pois.length) {
      // Route completed
      this.state.isActive = false;
      this.state.currentPOI = null;
      this.state.progress = 100;
      
      if (this.onRouteComplete) {
        this.onRouteComplete();
      }
      
      console.log('Route completed!');
      return false;
    }

    // Move to next POI
    this.state.currentPOIIndex = nextIndex;
    this.state.currentPOI = this.state.currentRoute.pois[nextIndex];
    this.state.progress = (this.state.completedPOIs / this.state.totalPOIs) * 100;
    this.state.isNearPOI = false;

    console.log(`Moved to next POI: ${this.state.currentPOI.name || this.state.currentPOI.title}`);
    return true;
  }

  private getPOICoordinates(poi: POI): { x: number; y: number } | null {
    // Convert POI coordinates to local coordinate system
    // This would need to be implemented based on your coordinate system
    if (poi.coordinates_lat && poi.coordinates_lon) {
      // Convert lat/lng to local x,y coordinates
      // This is a simplified conversion - you'd need proper coordinate transformation
      return {
        x: parseFloat(poi.coordinates_lat.toString()) * 1000, // Rough conversion
        y: parseFloat(poi.coordinates_lon.toString()) * 1000
      };
    }
    
    return null;
  }

  private isPositionOnRoute(position: PDRPosition): boolean {
    // Check if position is within route tolerance
    // This is a simplified check - you'd need proper path following logic
    return true; // Placeholder
  }

  private generateRoutePath(pois: POI[]): { x: number; y: number }[] {
    return pois.map(poi => {
      const coords = this.getPOICoordinates(poi);
      return coords || { x: 0, y: 0 };
    });
  }

  private calculateEstimatedTime(pois: POI[]): number {
    // Estimate time based on number of POIs and average time per POI
    const averageTimePerPOI = 2; // minutes
    return pois.length * averageTimePerPOI;
  }

  private notifyStateUpdate(): void {
    if (this.onStateUpdate) {
      this.onStateUpdate({ ...this.state });
    }
  }
}

export default NavigationService;
