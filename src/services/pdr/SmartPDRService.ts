import { CoordinateTransformer } from './CoordinateTransformer';
import { PathTracker } from './PathTracker';
import { DynamicSensorProcessor, ProcessedData } from './DynamicSensorProcessor';
import { AndroidPermissions } from '../../utils/AndroidPermissions';
import { Platform } from 'react-native';

export interface PDRPosition {
  x: number;
  y: number;
  heading: number;
  confidence: number;
  timestamp: number;
  stepCount: number;
  accuracy: number;
}

export interface PDRConfig {
  stepLength: number; // meters
  updateInterval: number; // milliseconds
  enableDriftCorrection: boolean;
  coordinateSystem: 'local' | 'latlng';
}

export class SmartPDRService {
  private isTracking = false;
  private config: PDRConfig;
  private coordinateTransformer: CoordinateTransformer;
  private pathTracker: PathTracker;
  private sensorProcessor: DynamicSensorProcessor;
  private currentPosition: PDRPosition;
  private stepCount = 0;
  private lastStepTime = 0;
  private heading = 0;
  private processingInterval?: NodeJS.Timeout;
  
  // Callbacks
  private onPositionUpdate?: (position: PDRPosition) => void;
  private onStepDetected?: (stepCount: number) => void;
  private onDriftDetected?: () => void;

  constructor(config: PDRConfig) {
    this.config = config;
    this.coordinateTransformer = new CoordinateTransformer();
    this.pathTracker = new PathTracker(this.coordinateTransformer);
    this.sensorProcessor = new DynamicSensorProcessor(config.updateInterval);
    this.currentPosition = {
      x: 0,
      y: 0,
      heading: 0,
      confidence: 0,
      timestamp: Date.now(),
      stepCount: 0,
      accuracy: 0
    };
  }

  /**
   * Start PDR tracking
   */
  async startTracking(): Promise<void> {
    if (this.isTracking) {
      console.warn('PDR tracking is already running');
      return;
    }

    try {
      // Check Android permissions first
      if (Platform.OS === 'android') {
        const permissionResult = await AndroidPermissions.requestEssentialPermissions();
        if (!permissionResult.granted) {
          console.warn('Essential permissions not granted, but continuing with PDR...');
          console.warn('Permission issue:', permissionResult.message);
        }
      }

      this.sensorProcessor.startProcessing();
      this.startProcessingLoop();
      this.isTracking = true;
      
      // Test coordinate system
      this.testCoordinateSystem();
      
      console.log('SmartPDR tracking started');
    } catch (error) {
      console.error('Failed to start PDR tracking:', error);
      throw error;
    }
  }

  /**
   * Stop PDR tracking
   */
  stopTracking(): void {
    if (!this.isTracking) {
      console.warn('PDR tracking is not running');
      return;
    }

    this.sensorProcessor.stopProcessing();
    this.stopProcessingLoop();
    this.isTracking = false;
    console.log('SmartPDR tracking stopped');
  }

  /**
   * Calibrate position using QR anchor
   */
  calibratePosition(anchorX: number, anchorY: number, anchorHeading?: number): void {
    this.currentPosition.x = anchorX;
    this.currentPosition.y = anchorY;
    if (anchorHeading !== undefined) {
      this.currentPosition.heading = anchorHeading;
      this.heading = anchorHeading;
    }
    this.currentPosition.confidence = 1.0;
    this.currentPosition.timestamp = Date.now();
    
    // Reset path tracking from this new position
    this.pathTracker.calibratePosition(anchorX, anchorY, anchorHeading);
    
    console.log(`Position calibrated to: (${anchorX}, ${anchorY})`);
  }

  /**
   * Get current position
   */
  getCurrentPosition(): PDRPosition {
    return { ...this.currentPosition };
  }

  /**
   * Get path history
   */
  getPathHistory(): Array<{ x: number; y: number; timestamp: number }> {
    return this.pathTracker.getPath();
  }

  /**
   * Set position update callback
   */
  setOnPositionUpdate(callback: (position: PDRPosition) => void): void {
    this.onPositionUpdate = callback;
  }

  /**
   * Set step detected callback
   */
  setOnStepDetected(callback: (stepCount: number) => void): void {
    this.onStepDetected = callback;
  }

  /**
   * Set drift detected callback
   */
  setOnDriftDetected(callback: () => void): void {
    this.onDriftDetected = callback;
  }

  /**
   * Start processing loop
   */
  private startProcessingLoop(): void {
    this.processingInterval = setInterval(() => {
      this.processSensorData();
    }, this.config.updateInterval);
  }

  /**
   * Stop processing loop
   */
  private stopProcessingLoop(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
    }
  }

  /**
   * Process sensor data using dynamic sensor processor
   */
  private processSensorData(): void {
    if (!this.isTracking) return;

    const processedData = this.sensorProcessor.getProcessedData();
    const currentStepCount = this.sensorProcessor.getStepCount();

    // Update position with processed data
    this.currentPosition.heading = processedData.heading;
    this.currentPosition.timestamp = Date.now();

    // Check for new steps
    if (currentStepCount > this.stepCount) {
      this.stepCount = currentStepCount;
      
      // Use headingStep if available, otherwise use heading
      const headingStep = processedData.headingStep !== undefined ? processedData.headingStep : processedData.heading;
      this.updatePositionFromStep(processedData.stepLength, headingStep);
      
      // Update confidence (decreases over time)
      this.currentPosition.confidence = Math.max(0.1, 1.0 - (this.stepCount * 0.01));
      this.currentPosition.accuracy = this.currentPosition.confidence;
      
      console.log(`Step detected! Total steps: ${this.stepCount}`);
      this.onStepDetected?.(this.stepCount);
    }

    // Update position
    this.currentPosition.stepCount = this.stepCount;
    this.onPositionUpdate?.(this.currentPosition);
  }

  /**
   * Test function to verify coordinate system
   */
  private testCoordinateSystem(): void {
    console.log('=== COORDINATE SYSTEM TEST (EXACT HOGENT IMPLEMENTATION) ===');
    const testHeadings = [0, 90, 180, 270]; // North, East, South, West
    const stepLength = 1.0; // 1 meter for easy calculation
    
    testHeadings.forEach(heading => {
      const radians = (heading * Math.PI) / 180;
      const stepX = stepLength * Math.sin(radians); // East-West movement (Hogent way)
      const stepY = -stepLength * Math.cos(radians); // North-South movement (Hogent way, negated)
      
      console.log(`Heading ${heading}°: X=${stepX.toFixed(3)}m (East-West), Y=${stepY.toFixed(3)}m (North-South)`);
      console.log(`Expected: ${heading === 0 ? 'North' : heading === 90 ? 'East' : heading === 180 ? 'South' : 'West'}`);
    });
    console.log('=== END TEST ===');
  }

  /**
   * Update position based on detected step - EXACT Hogent implementation
   */
  private updatePositionFromStep(stepLength: number, headingStep?: number): void {
    // Use the provided step length or fallback to fixed 0.7m
    const actualStepLength = stepLength || 0.7;
    
    // Use headingStep if provided, otherwise use current heading
    const headingToUse = headingStep !== undefined ? headingStep : this.currentPosition.heading;
    
    // Convert heading from degrees to radians
    const radians = (headingToUse * Math.PI) / 180;
    
    // EXACT Hogent implementation from their locationScreen.tsx:
    // const nx = stepLength ? stepLength * Math.sin(headingStep) * 10 : 0;
    // const ny = stepLength ? stepLength * Math.cos(headingStep) * 10 : 0;
    // setLocation((previous) => ({ x: previous.x + nx, y: previous.y - ny }));
    const stepX = actualStepLength * Math.sin(radians); // East-West movement (Hogent way)
    const stepY = -actualStepLength * Math.cos(radians); // North-South movement (Hogent way, negated)
    
    this.currentPosition.x += stepX;
    this.currentPosition.y += stepY;
    this.currentPosition.timestamp = Date.now();
    
    console.log(`Step ${this.stepCount}: Heading ${headingToUse.toFixed(1)}°, StepLength ${actualStepLength.toFixed(2)}m, Moved (${stepX.toFixed(2)}, ${stepY.toFixed(2)}) to (${this.currentPosition.x.toFixed(2)}, ${this.currentPosition.y.toFixed(2)})`);
    console.log(`Direction Check: Heading ${headingToUse.toFixed(1)}° = ${radians.toFixed(3)} rad`);
    console.log(`Movement: X=${stepX.toFixed(3)}m (East-West), Y=${stepY.toFixed(3)}m (North-South)`);
    
    // Add to path tracker
    this.pathTracker.addPosition(this.currentPosition);
  }

  /**
   * Initialize coordinate transformation with building data
   */
  initializeBuilding(building: any, pois: any[]): void {
    this.coordinateTransformer.initializeBuilding(building, pois);
  }

  /**
   * Convert local coordinates to lat/lng
   */
  toLatLng(x: number, y: number): { latitude: number; longitude: number } {
    try {
      return this.coordinateTransformer.localToLatLng(x, y);
    } catch (error) {
      return { latitude: 0, longitude: 0 };
    }
  }

  /**
   * Convert lat/lng to local coordinates
   */
  toLocal(latitude: number, longitude: number): { x: number; y: number } {
    try {
      return this.coordinateTransformer.latLngToLocal(latitude, longitude);
    } catch (error) {
      return { x: 0, y: 0 };
    }
  }

  /**
   * Export path data
   */
  exportPathData(): string {
    const statistics = this.pathTracker.getStatistics();
    const path = this.pathTracker.getPath();
    const pathData = {
      startTime: path.length > 0 ? path[0].timestamp : Date.now(),
      endTime: Date.now(),
      stepCount: this.stepCount,
      totalDistance: statistics.totalDistance,
      path: path,
      finalPosition: this.currentPosition,
      statistics: statistics
    };
    
    return JSON.stringify(pathData, null, 2);
  }

  /**
   * Reset PDR system
   */
  reset(): void {
    this.stopTracking();
    this.stepCount = 0;
    this.lastStepTime = 0;
    this.currentPosition = {
      x: 0,
      y: 0,
      heading: 0,
      confidence: 0,
      timestamp: Date.now(),
      stepCount: 0,
      accuracy: 0
    };
    this.pathTracker.clearPath();
    this.sensorProcessor.reset();
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stopTracking();
    this.sensorProcessor.destroy();
  }
}