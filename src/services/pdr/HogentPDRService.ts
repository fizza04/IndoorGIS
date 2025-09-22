import { accelerometer, gyroscope, magnetometer } from 'react-native-sensors';
import { CoordinateTransformer } from './CoordinateTransformer';
// @ts-ignore
import CompassHeading from 'react-native-compass-heading';

// Exact copy from Hogent project
export interface HogentPDRPosition {
  x: number;
  y: number;
  heading: number; // in degrees
  stepCount: number;
  timestamp: number;
  confidence: number;
  accuracy: number;
}

export class HogentPDRService {
  private isInitialized = false;
  private isTracking = false;
  private coordinateTransformer: CoordinateTransformer;
  private currentPosition: HogentPDRPosition;
  private stepCount = 0;
  
  // Compass heading flag
  private useCompassHeading = true;
  private compassFailureCount = 0;
  private maxCompassFailures = 5;
  
  // Logging control
  private lastLogTime = 0;
  private logInterval = 2000; // Log every 2 seconds max
  
  // Sensor data
  private accelerometerData = { x: 0, y: 0, z: 0 };
  private gyroscopeData = { x: 0, y: 0, z: 0 };
  private magnetometerData = { x: 0, y: 0, z: 0 };
  
  // Subscriptions
  private accelerometerSubscription?: any;
  private gyroscopeSubscription?: any;
  private magnetometerSubscription?: any;
  private compassSubscription?: any;
  
  // Callbacks
  private onPositionUpdate?: (position: HogentPDRPosition) => void;
  private onStepDetected?: (stepCount: number) => void;

  // Hogent PDR state
  private heading = 0;
  private lastStepTime = 0;
  private lastProcessTime = 0;
  
  // Hogent step detection state
  private movingWindow: number[] = [];
  private accList: number[] = [];
  private gravity = { x: 0, y: 0, z: 1 };
  private attitude = { pitch: 0, roll: 0, yaw: 0 };

  constructor() {
    this.coordinateTransformer = new CoordinateTransformer();
    this.currentPosition = {
      x: 0,
      y: 0,
      heading: 0,
      stepCount: 0,
      timestamp: Date.now(),
      confidence: 0,
      accuracy: 0
    };
  }

  async initializeBuilding(building: any, pois: any[]): Promise<void> {
    try {
      await this.coordinateTransformer.initializeBuilding(building, pois);
      this.isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize Hogent PDR:', error);
      throw error;
    }
  }

  startTracking(): void {
    if (!this.isInitialized) {
      console.warn('Hogent PDR not initialized. Call initializeBuilding first.');
      return;
    }

    this.isTracking = true;
    this.setupSensors();
  }

  stopTracking(): void {
    this.isTracking = false;
    this.accelerometerSubscription?.unsubscribe();
    this.gyroscopeSubscription?.unsubscribe();
    this.magnetometerSubscription?.unsubscribe();
    if (this.compassSubscription) {
      CompassHeading.stop();
      this.compassSubscription = null;
    }
  }

  private setupSensors(): void {
    // Note: react-native-sensors doesn't have setUpdateInterval on observables
    // The update interval is set when creating the observable

    // Subscribe to accelerometer
    this.accelerometerSubscription = accelerometer.subscribe(({ x, y, z, timestamp }: any) => {
      this.accelerometerData = { x, y, z };
      this.processSensorData();
    });

    // Subscribe to gyroscope
    this.gyroscopeSubscription = gyroscope.subscribe(({ x, y, z, timestamp }: any) => {
      this.gyroscopeData = { x, y, z };
      this.processSensorData();
    });

    // Subscribe to magnetometer or compass heading based on flag
    if (this.useCompassHeading) {
      try {
        CompassHeading.start(10, (heading: number) => {
          // Validate heading value
          if (heading !== null && heading !== undefined && !isNaN(heading) && isFinite(heading)) {
            this.heading = heading;
            this.compassFailureCount = 0; // Reset failure count on success
            this.processSensorData();
          } else {
            this.compassFailureCount++;
            
            // Switch to magnetometer if too many failures
            if (this.compassFailureCount >= this.maxCompassFailures) {
              console.log('🔄 Switching to Magnetometer (Compass failed)');
              this.useCompassHeading = false;
              CompassHeading.stop();
              this.compassSubscription = null;
              this.setupMagnetometer();
            }
          }
        });
        this.compassSubscription = true; // Mark as active
      } catch (error) {
        this.useCompassHeading = false;
        this.setupMagnetometer();
      }
    } else {
      this.setupMagnetometer();
    }
  }

  private setupMagnetometer(): void {
    this.magnetometerSubscription = magnetometer.subscribe(({ x, y, z, timestamp }: any) => {
      this.magnetometerData = { x, y, z };
      this.processSensorData();
    });
  }

  private processSensorData(): void {
    if (!this.isTracking) return;

    // Throttle processing to prevent excessive updates
    const now = Date.now();
    if (now - this.lastProcessTime < 100) { // Process max every 100ms
      return;
    }
    this.lastProcessTime = now;

    // Calculate heading based on flag
    if (!this.useCompassHeading) {
      this.calculateHeading();
    }
    
    // Simple step detection (from Hogent)
    this.detectStep();

    // Update current position
    // Validate heading before setting
    if (isNaN(this.heading) || !isFinite(this.heading)) {
      return;
    }
    
    this.currentPosition.heading = this.heading;
    this.currentPosition.timestamp = Date.now();
    this.currentPosition.confidence = 0.8;
    this.currentPosition.accuracy = 2.0;
    this.currentPosition.stepCount = this.stepCount;
    
    // Ensure position heading is normalized
    this.currentPosition.heading = this.currentPosition.heading % 360;
    if (this.currentPosition.heading < 0) {
      this.currentPosition.heading += 360;
    }

    this.onPositionUpdate?.(this.currentPosition);
    
    // Periodic useful logging (every 2 seconds max)
    const currentTime = Date.now();
    if (currentTime - this.lastLogTime >= this.logInterval) {
      const direction = this.getDirectionString(this.heading);
      console.log(`🧭 PDR: ${this.heading.toFixed(1)}° ${direction} | Steps: ${this.stepCount} | Pos: (${this.currentPosition.x.toFixed(1)}, ${this.currentPosition.y.toFixed(1)})`);
      this.lastLogTime = currentTime;
    }
  }

  private getDirectionString(heading: number): string {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(heading / 45) % 8;
    return directions[index];
  }

  private calculateHeading(): void {
    const { x, y, z } = this.magnetometerData;
    
    if (x !== 0 || y !== 0 || z !== 0) {
      // Calculate heading from magnetometer (Hogent method)
      let headingRad = Math.atan2(y, x);
      
      // Convert to degrees
      let headingDeg = headingRad * 180 / Math.PI;
      
      // Normalize to 0-360
      if (headingDeg < 0) headingDeg += 360;
      
      // Apply simple smoothing (Hogent method)
      if (this.heading !== 0) {
        const diff = headingDeg - this.heading;
        if (Math.abs(diff) > 180) {
          if (diff > 0) {
            headingDeg -= 360;
          } else {
            headingDeg += 360;
          }
        }
        this.heading = this.heading * 0.8 + headingDeg * 0.2;
      } else {
        this.heading = headingDeg;
      }
      
      // Ensure heading stays in 0-360 range
      this.heading = this.heading % 360;
      if (this.heading < 0) {
        this.heading += 360;
      }
    }
  }

  private detectStep(): void {
    const { x, y, z } = this.accelerometerData;
    
    // Hogent step detection algorithm
    if (x !== 0 || y !== 0 || z !== 0) {
      // Calculate attitude (simplified)
      this.calculateAttitude();
      
      // Transform accelerometer to GCS (simplified)
      const accGCS = this.toGCS({ x, y, z }, this.attitude);
      
      // Update gravity with low pass filter
      this.gravity.z = this.gravity.z * 0.9 + accGCS.z * 0.1;
      
      // High pass filter
      const accHPF = (accGCS.z - this.gravity.z) * 9.81;
      
      // Add to moving window
      this.movingWindow.push(accHPF);
      
      // Hogent constants
      const W = 3; // Window size
      const N = 6; // Peak detection window
      
      if (this.movingWindow.length === W) {
        // Calculate average
        const accStep = this.movingWindow.reduce((a, b) => a + b) / W;
        
        // Add to acceleration list
        this.accList.push(accStep);
        
        if (this.accList.length === N) {
          // Run peak detection algorithm - this returns accEvent (0 or peak value)
          const accEvent = this.hogentPeakDetection();
          
          // Only process if accEvent is non-zero (actual step detected)
          if (accEvent > 0) {
            const now = Date.now();
            if (now - this.lastStepTime > 500) { // Minimum 500ms between steps
              this.stepCount++;
              this.lastStepTime = now;
              
              console.log(`👣 Step ${this.stepCount} detected! Heading: ${this.heading.toFixed(1)}°`);
              
              // Update position based on step using Hogent formula
              this.updatePositionFromStep();
              
              this.onStepDetected?.(this.stepCount);
            }
          }
          
          // Remove oldest value
          this.accList = this.accList.slice(1);
        }
        
        // Update moving window
        this.movingWindow = this.movingWindow.slice(1);
      }
    }
  }

  private calculateAttitude(): void {
    const { x, y, z } = this.accelerometerData;
    const magnitude = Math.sqrt(x * x + y * y + z * z);
    
    if (magnitude > 0) {
      // Simple attitude calculation
      this.attitude.pitch = Math.atan2(y, Math.sqrt(x * x + z * z));
      this.attitude.roll = Math.atan2(-x, z);
      this.attitude.yaw = 0; // Will be calculated from magnetometer
    }
  }

  private toGCS(acc: { x: number; y: number; z: number }, attitude: { pitch: number; roll: number; yaw: number }): { x: number; y: number; z: number } {
    // Simplified GCS transformation
    const { pitch, roll } = attitude;
    
    const cosPitch = Math.cos(pitch);
    const sinPitch = Math.sin(pitch);
    const cosRoll = Math.cos(roll);
    const sinRoll = Math.sin(roll);
    
    return {
      x: acc.x * cosRoll + acc.y * sinRoll * sinPitch + acc.z * sinRoll * cosPitch,
      y: acc.y * cosPitch - acc.z * sinPitch,
      z: -acc.x * sinRoll + acc.y * cosRoll * sinPitch + acc.z * cosRoll * cosPitch
    };
  }

  private hogentPeakDetection(): number {
    // Original Hogent thresholds
    const acc_peak_th = 0.5;
    const acc_pp_th = 1.0;
    const N = 6;
    const t = N / 2; // Center point
    
    if (this.accList.length < N) return 0;
    
    let cond = { peak: false, pp: false, slope: false };

    // Peak detection - original Hogent logic
    if (this.accList[t] > acc_peak_th) {
      for (let i = -N / 2; i < N / 2; i++) {
        if (i === 0) continue;
        if (this.accList[t] > this.accList[t + i]) {
          cond.peak = true;
          break;
        }
      }
    }

    // Peak-to-peak detection - original Hogent logic
    let diff = { prev: [], next: [] };
    for (let i = 1; i < N / 2; i++) {
      diff.prev.push(this.accList[t] - this.accList[t - i]);
      diff.next.push(this.accList[t] - this.accList[t + i]);
    }
    if (
        Math.max(...diff.prev) > acc_pp_th &&
        Math.max(...diff.next) > acc_pp_th
    ) {
      cond.pp = true;
    }

    // Slope detection - original Hogent logic
    let sum = { pos: 0, neg: 0 };
    for (let i = t - N / 2; i <= t - 1; i++) {
        sum.pos += this.accList[i + 1] - this.accList[i];
    }
    for (let i = t + 1; i < t + N / 2; i++) {
        sum.neg += this.accList[i] - this.accList[i - 1];
    }
    if ((2 / N) * sum.pos > 0 && (2 / N) * sum.neg < 0) {
      cond.slope = true;
    }
    
    // Return accEvent only if ALL conditions are met (original Hogent logic)
    return cond.peak && cond.pp && cond.slope ? this.accList[t] : 0;
  }

  private updatePositionFromStep(): void {
    // Use exact Hogent movement calculation
    const stepLength = 0.7; // Default step length
    const headingRad = this.heading * Math.PI / 180; // Convert to radians
    
    const nx = stepLength * Math.sin(headingRad) * 10;
    const ny = stepLength * Math.cos(headingRad) * 10;
    
    this.currentPosition.x += nx;
    this.currentPosition.y -= ny; // Negate for correct coordinate system
    
  }

  // Public methods
  setOnPositionUpdate(callback: (position: HogentPDRPosition) => void): void {
    this.onPositionUpdate = callback;
  }

  setOnStepDetected(callback: (stepCount: number) => void): void {
    this.onStepDetected = callback;
  }

  // Compass heading control methods
  setUseCompassHeading(useCompass: boolean): void {
    this.useCompassHeading = useCompass;
    this.compassFailureCount = 0; // Reset failure count when manually switching
  }

  isUsingCompassHeading(): boolean {
    return this.useCompassHeading;
  }



  calibratePosition(anchorX: number, anchorY: number, anchorHeading?: number): void {
    this.currentPosition.x = anchorX;
    this.currentPosition.y = anchorY;
    if (anchorHeading !== undefined) {
      this.currentPosition.heading = anchorHeading;
      this.heading = anchorHeading;
    }
    console.log(`🎯 PDR Calibrated: Pos(${anchorX.toFixed(1)}, ${anchorY.toFixed(1)})${anchorHeading !== undefined ? ` Heading: ${anchorHeading.toFixed(1)}°` : ''}`);
  }

  toLatLng(x: number, y: number): { latitude: number; longitude: number } {
    return this.coordinateTransformer.toLatLng(x, y);
  }

  toLocal(latitude: number, longitude: number): { x: number; y: number } {
    return this.coordinateTransformer.toLocal(latitude, longitude);
  }

  reset(): void {
    this.currentPosition = {
      x: 0,
      y: 0,
      heading: 0,
      stepCount: 0,
      timestamp: Date.now(),
      confidence: 0,
      accuracy: 0
    };
    this.stepCount = 0;
  }

  destroy(): void {
    this.stopTracking();
  }
}