import { PDRPosition } from './PDREngine';
import { LocalCoordinates, CoordinateTransformer } from './CoordinateTransformer';

export interface PathPoint {
  x: number;
  y: number;
  heading: number;
  timestamp: number;
  stepCount: number;
  confidence: number;
  accuracy: number;
}

export interface PathSegment {
  id: string;
  startPoint: PathPoint;
  endPoint: PathPoint;
  distance: number;
  duration: number; // milliseconds
  stepCount: number;
  averageConfidence: number;
  startTime: number;
  endTime: number;
}

export interface PathStatistics {
  totalDistance: number; // meters
  totalSteps: number;
  totalDuration: number; // milliseconds
  averageSpeed: number; // meters per second
  averageStepLength: number; // meters
  averageConfidence: number;
  driftCorrections: number;
  segments: PathSegment[];
}

export class PathTracker {
  private path: PathPoint[] = [];
  private segments: PathSegment[] = [];
  private coordinateTransformer: CoordinateTransformer;
  private driftCorrections = 0;
  private lastCalibrationTime = 0;
  
  constructor(coordinateTransformer: CoordinateTransformer) {
    this.coordinateTransformer = coordinateTransformer;
  }
  
  /**
   * Add a new position to the path
   */
  addPosition(position: PDRPosition): void {
    const pathPoint: PathPoint = {
      x: position.x,
      y: position.y,
      heading: position.heading,
      timestamp: position.timestamp,
      stepCount: position.stepCount,
      confidence: position.confidence,
      accuracy: position.accuracy
    };
    
    this.path.push(pathPoint);
    
    // Create segment if we have at least 2 points
    if (this.path.length >= 2) {
      this.createSegment();
    }
    
    console.log(`Path point added: (${position.x.toFixed(2)}, ${position.y.toFixed(2)})`);
  }
  
  /**
   * Calibrate position and reset drift
   */
  calibratePosition(anchorX: number, anchorY: number, anchorHeading?: number): void {
    if (this.path.length === 0) {
      // Initialize path with anchor position
      const anchorPoint: PathPoint = {
        x: anchorX,
        y: anchorY,
        heading: anchorHeading || 0,
        timestamp: Date.now(),
        stepCount: 0,
        confidence: 1.0,
        accuracy: 1.0
      };
      this.path.push(anchorPoint);
    } else {
      // Adjust all points relative to anchor
      const lastPoint = this.path[this.path.length - 1];
      const offsetX = anchorX - lastPoint.x;
      const offsetY = anchorY - lastPoint.y;
      
      // Apply offset to all points
      this.path = this.path.map(point => ({
        ...point,
        x: point.x + offsetX,
        y: point.y + offsetY
      }));
      
      // Update last point with anchor heading if provided
      if (anchorHeading !== undefined) {
        this.path[this.path.length - 1].heading = anchorHeading;
      }
    }
    
    this.driftCorrections++;
    this.lastCalibrationTime = Date.now();
    
    console.log(`Path calibrated to anchor: (${anchorX}, ${anchorY})`);
  }
  
  /**
   * Get current path as array of points
   */
  getPath(): PathPoint[] {
    return [...this.path];
  }
  
  /**
   * Get path segments
   */
  getSegments(): PathSegment[] {
    return [...this.segments];
  }
  
  /**
   * Get path statistics
   */
  getStatistics(): PathStatistics {
    if (this.path.length < 2) {
      return {
        totalDistance: 0,
        totalSteps: 0,
        totalDuration: 0,
        averageSpeed: 0,
        averageStepLength: 0,
        averageConfidence: 0,
        driftCorrections: this.driftCorrections,
        segments: []
      };
    }
    
    const totalDistance = this.calculateTotalDistance();
    const totalSteps = this.path[this.path.length - 1].stepCount;
    const totalDuration = this.path[this.path.length - 1].timestamp - this.path[0].timestamp;
    const averageSpeed = totalDuration > 0 ? totalDistance / (totalDuration / 1000) : 0;
    const averageStepLength = totalSteps > 0 ? totalDistance / totalSteps : 0;
    const averageConfidence = this.path.reduce((sum, point) => sum + point.confidence, 0) / this.path.length;
    
    return {
      totalDistance,
      totalSteps,
      totalDuration,
      averageSpeed,
      averageStepLength,
      averageConfidence,
      driftCorrections: this.driftCorrections,
      segments: [...this.segments]
    };
  }
  
  /**
   * Get path as coordinates for map visualization
   */
  getPathCoordinates(): { latitude: number; longitude: number }[] {
    return this.path.map(point => {
      const local: LocalCoordinates = {
        x: point.x,
        y: point.y,
        floor: 1 // Default floor
      };
      
      const global = this.coordinateTransformer.localToGlobal(local);
      return {
        latitude: global.latitude,
        longitude: global.longitude
      };
    });
  }
  
  /**
   * Get current position
   */
  getCurrentPosition(): PathPoint | null {
    return this.path.length > 0 ? this.path[this.path.length - 1] : null;
  }
  
  /**
   * Get distance to target POI
   */
  getDistanceToTarget(targetX: number, targetY: number): number {
    const current = this.getCurrentPosition();
    if (!current) return 0;
    
    const dx = targetX - current.x;
    const dy = targetY - current.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  
  /**
   * Get bearing to target POI
   */
  getBearingToTarget(targetX: number, targetY: number): number {
    const current = this.getCurrentPosition();
    if (!current) return 0;
    
    const dx = targetX - current.x;
    const dy = targetY - current.y;
    const bearing = Math.atan2(dy, dx) * (180 / Math.PI);
    return ((bearing % 360) + 360) % 360;
  }
  
  /**
   * Check if user is near target POI
   */
  isNearTarget(targetX: number, targetY: number, threshold: number = 2.0): boolean {
    return this.getDistanceToTarget(targetX, targetY) <= threshold;
  }
  
  /**
   * Export path data as JSON
   */
  exportPath(): string {
    const data = {
      path: this.path,
      segments: this.segments,
      statistics: this.getStatistics(),
      exportTime: new Date().toISOString(),
      coordinateTransformer: this.coordinateTransformer.getBounds()
    };
    
    return JSON.stringify(data, null, 2);
  }
  
  /**
   * Clear path data
   */
  clearPath(): void {
    this.path = [];
    this.segments = [];
    this.driftCorrections = 0;
    this.lastCalibrationTime = 0;
    console.log('Path cleared');
  }
  
  /**
   * Create a new path segment
   */
  private createSegment(): void {
    if (this.path.length < 2) return;
    
    const startPoint = this.path[this.path.length - 2];
    const endPoint = this.path[this.path.length - 1];
    
    const distance = this.calculateDistance(startPoint, endPoint);
    const duration = endPoint.timestamp - startPoint.timestamp;
    const stepCount = endPoint.stepCount - startPoint.stepCount;
    const averageConfidence = (startPoint.confidence + endPoint.confidence) / 2;
    
    const segment: PathSegment = {
      id: `segment_${this.segments.length + 1}`,
      startPoint,
      endPoint,
      distance,
      duration,
      stepCount,
      averageConfidence,
      startTime: startPoint.timestamp,
      endTime: endPoint.timestamp
    };
    
    this.segments.push(segment);
  }
  
  /**
   * Calculate total distance of the path
   */
  private calculateTotalDistance(): number {
    let totalDistance = 0;
    
    for (let i = 1; i < this.path.length; i++) {
      totalDistance += this.calculateDistance(this.path[i - 1], this.path[i]);
    }
    
    return totalDistance;
  }
  
  /**
   * Calculate distance between two points
   */
  private calculateDistance(point1: PathPoint, point2: PathPoint): number {
    const dx = point2.x - point1.x;
    const dy = point2.y - point1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}
