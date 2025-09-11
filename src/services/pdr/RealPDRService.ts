import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import { accelerometer, gyroscope, magnetometer, setUpdateIntervalForType, SensorTypes } from 'react-native-sensors';
import PermissionService from '../PermissionService';

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
  stepLength: number; 
  driftThreshold: number; 
  driftTimeThreshold: number; 
  calibrationInterval: number; 
  stepDetectionThreshold: number; 
  headingSmoothingFactor: number; 
  minStepInterval: number; 
  maxStepInterval: number; 
}

export interface SensorData {
  accelerometer: {
    x: number;
    y: number;
    z: number;
    timestamp: number;
  };
  gyroscope: {
    x: number;
    y: number;
    z: number;
    timestamp: number;
  };
  magnetometer: {
    x: number;
    y: number;
    z: number;
    timestamp: number;
  };
}

export class RealPDRService {
  private position: PDRPosition = {
    x: 0,
    y: 0,
    heading: 0,
    confidence: 1.0,
    timestamp: Date.now(),
    stepCount: 0,
    accuracy: 1.0
  };

  private config: PDRConfig = {
    stepLength: 0.7, 
    driftThreshold: 3.0,
    driftTimeThreshold: 20000, 
    calibrationInterval: 30000, 
    stepDetectionThreshold: 0.3, 
    headingSmoothingFactor: 0.8,
    minStepInterval: 300, 
    maxStepInterval: 2000 
  };

  private isTracking = false;
  private driftStartTime: number | null = null;
  private lastStepTime = 0;
  private lastAcceleration = 0;
  private accelerationHistory: number[] = [];
  private headingHistory: number[] = [];
  private stepDetectionBuffer: number[] = [];
  
  // Sensor data
  private sensorData: SensorData = {
    accelerometer: { x: 0, y: 0, z: 0, timestamp: 0 },
    gyroscope: { x: 0, y: 0, z: 0, timestamp: 0 },
    magnetometer: { x: 0, y: 0, z: 0, timestamp: 0 }
  };

  // Event callbacks
  private onPositionUpdate?: (position: PDRPosition) => void;
  private onDriftDetected?: () => void;
  private onStepDetected?: (stepCount: number) => void;

  // Sensor listeners
  private accelerometerSubscription?: any;
  private gyroscopeSubscription?: any;
  private magnetometerSubscription?: any;

  constructor(config?: Partial<PDRConfig>) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  /**
   * Start PDR tracking with real sensors
   */
  async startTracking(): Promise<void> {
    if (this.isTracking) return;

    try {
      const permissions = await this.requestPermissions();
      console.log('Permission check result:', permissions);
      
      if (!permissions || !permissions.allGranted) {
        console.error('Permissions not granted:', permissions);
        throw new Error('Required permissions not granted');
      }
      
      console.log('All permissions verified, starting sensors...');
    } catch (error) {
      console.error('Permission request failed:', error);
      throw new Error('Required permissions not granted');
    }

    await this.startSensorListeners();

    this.isTracking = true;
    this.position.timestamp = Date.now();

    console.log('Real PDR tracking started with sensors');
  }

  /**
   * Stop PDR tracking
   */
  stopTracking(): void {
    this.isTracking = false;
    
    this.removeSensorListeners();
    
    console.log('Real PDR tracking stopped');
  }

  /**
   * Request necessary permissions
   */
  private async requestPermissions(): Promise<{
    camera: any;
    location: any;
    allGranted: boolean;
  }> {
    try {
      const permissionService = PermissionService.getInstance();
      const permissions = await permissionService.requestAllPermissions();
      
      if (!permissions.allGranted) {
        throw new Error('Required permissions not granted');
      }
      
      console.log('All permissions granted');
      return permissions;
    } catch (error) {
      console.error('Permission request failed:', error);
      throw error;
    }
  }

  /**
   * Start sensor listeners using react-native-sensors
   */
  private async startSensorListeners(): Promise<void> {
    try {
      setUpdateIntervalForType(SensorTypes.accelerometer, 100); 
      setUpdateIntervalForType(SensorTypes.gyroscope, 100);
      setUpdateIntervalForType(SensorTypes.magnetometer, 100);

     
      this.accelerometerSubscription = accelerometer.subscribe(({ x, y, z, timestamp }) => {
        this.handleAccelerometerData({ x, y, z, timestamp });
      });

      
      this.gyroscopeSubscription = gyroscope.subscribe(({ x, y, z, timestamp }) => {
        this.handleGyroscopeData({ x, y, z, timestamp });
      });

      
      this.magnetometerSubscription = magnetometer.subscribe(({ x, y, z, timestamp }) => {
        this.handleMagnetometerData({ x, y, z, timestamp });
      });

      console.log('Real sensors started successfully');
    } catch (error) {
      console.error('Failed to start real sensors:', error);
      throw new Error('Failed to start sensor listeners: ' + error.message);
    }
  }

  /**
   * Remove sensor listeners
   */
  private removeSensorListeners(): void {
    if (this.accelerometerSubscription) {
      this.accelerometerSubscription.unsubscribe();
      this.accelerometerSubscription = undefined;
    }
    if (this.gyroscopeSubscription) {
      this.gyroscopeSubscription.unsubscribe();
      this.gyroscopeSubscription = undefined;
    }
    if (this.magnetometerSubscription) {
      this.magnetometerSubscription.unsubscribe();
      this.magnetometerSubscription = undefined;
    }

    console.log('Real sensors stopped');
  }


  /**
   * Handle accelerometer data
   */
  private handleAccelerometerData(data: any): void {
    this.sensorData.accelerometer = {
      x: data.x,
      y: data.y,
      z: data.z,
      timestamp: data.timestamp || Date.now()
    };

    this.detectStep(data);
  }

  /**
   * Handle gyroscope data
   */
  private handleGyroscopeData(data: any): void {
    this.sensorData.gyroscope = {
      x: data.x,
      y: data.y,
      z: data.z,
      timestamp: data.timestamp || Date.now()
    };

    this.updateHeadingFromGyroscope(data);
  }

  /**
   * Handle magnetometer data
   */
  private handleMagnetometerData(data: any): void {
    this.sensorData.magnetometer = {
      x: data.x,
      y: data.y,
      z: data.z,
      timestamp: data.timestamp || Date.now()
    };

    this.updateHeadingFromMagnetometer(data);
  }

  /**
   * Detect steps from accelerometer data using improved algorithm
   */
  private detectStep(data: any): void {
    const now = Date.now();
    const acceleration = Math.sqrt(data.x * data.x + data.y * data.y + data.z * data.z);
    
    this.stepDetectionBuffer.push(acceleration);
    if (this.stepDetectionBuffer.length > 30) {
      this.stepDetectionBuffer.shift();
    }

    if (this.stepDetectionBuffer.length < 10) return;

    if (now - this.lastStepTime < this.config.minStepInterval) {
      return;
    }

    const recentSamples = this.stepDetectionBuffer.slice(-10);
    const mean = recentSamples.reduce((a, b) => a + b, 0) / recentSamples.length;
    const variance = recentSamples.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recentSamples.length;
    const stdDev = Math.sqrt(variance);
    
    // Dynamic threshold: mean + 2*stdDev, but at least the configured threshold  
    const dynamicThreshold = Math.max(mean + (2 * stdDev), this.config.stepDetectionThreshold);
    
    const minVariance = 0.02; 
    if (variance < minVariance) {
      return;
    }

    if (this.stepDetectionBuffer.length >= 5) {
      const current = this.stepDetectionBuffer[this.stepDetectionBuffer.length - 1];
      const previous = this.stepDetectionBuffer[this.stepDetectionBuffer.length - 3];
      const beforePrevious = this.stepDetectionBuffer[this.stepDetectionBuffer.length - 5];

      // Peak detection: current > previous > beforePrevious
      if (current > previous && previous > beforePrevious && 
          current > dynamicThreshold) {
        this.registerStep(now);
      }
    }
  }

  /**
   * Register a detected step
   */
  private registerStep(timestamp: number): void {
    this.lastStepTime = timestamp;
    this.position.stepCount++;
    
    this.updatePosition();
    
    if (this.onStepDetected) {
      this.onStepDetected(this.position.stepCount);
    }
    
    console.log(`Step detected: ${this.position.stepCount}`);
  }

  /**
   * Update position based on step count and heading
   */
  private updatePosition(): void {
    const radians = this.position.heading * Math.PI / 180;
    const dx = this.config.stepLength * Math.cos(radians);
    const dy = this.config.stepLength * Math.sin(radians);
    
    this.position.x += dx;
    this.position.y += dy;
    this.position.timestamp = Date.now();
    
    const timeSinceStart = this.position.timestamp - (this.position.timestamp - this.position.stepCount * 1000);
    this.position.confidence = Math.max(0.1, 1.0 - (this.position.stepCount * 0.005));
    
    this.position.accuracy = Math.max(0.5, 5.0 - (this.position.stepCount * 0.1));
    
    this.checkDrift();
    
    if (this.onPositionUpdate) {
      this.onPositionUpdate({ ...this.position });
    }
  }

  /**
   * Update heading from gyroscope data
   */
  private updateHeadingFromGyroscope(data: any): void {
    const deltaTime = (data.timestamp - this.sensorData.gyroscope.timestamp) / 1000;
    if (deltaTime <= 0) return;

    const deltaHeading = data.z * deltaTime * (180 / Math.PI);
    this.position.heading = (this.position.heading + deltaHeading) % 360;
    if (this.position.heading < 0) this.position.heading += 360;
  }

  /**
   * Update heading from magnetometer data
   */
  private updateHeadingFromMagnetometer(data: any): void {
    const heading = Math.atan2(data.y, data.x) * (180 / Math.PI);
    const normalizedHeading = (heading + 360) % 360;

    this.headingHistory.push(normalizedHeading);
    if (this.headingHistory.length > 5) {
      this.headingHistory.shift();
    }

    const smoothedHeading = this.headingHistory.reduce((sum, h) => sum + h, 0) / this.headingHistory.length;
    
    this.position.heading = this.position.heading * this.config.headingSmoothingFactor + 
                           smoothedHeading * (1 - this.config.headingSmoothingFactor);
  }

  /**
   * Check for position drift
   */
  private checkDrift(): void {
    const currentTime = Date.now();
    
    if (this.position.stepCount > 8) {
     
      const distanceFromOrigin = Math.sqrt(this.position.x * this.position.x + this.position.y * this.position.y);
      
      if (distanceFromOrigin > this.config.driftThreshold) {
        if (!this.driftStartTime) {
          this.driftStartTime = currentTime;
        } else if (currentTime - this.driftStartTime > this.config.driftTimeThreshold) {
         
          if (this.onDriftDetected) {
            this.onDriftDetected();
          }
          this.driftStartTime = null; 
        }
      } else {
        this.driftStartTime = null; 
      }
    }
  }

  /**
   * Calibrate position to known anchor point
   */
  calibratePosition(anchorPosition: { x: number; y: number }, anchorHeading?: number): void {
    this.position.x = anchorPosition.x;
    this.position.y = anchorPosition.y;
    
    if (anchorHeading !== undefined) {
      this.position.heading = anchorHeading;
    }
    
    this.position.confidence = 1.0;
    this.position.accuracy = 0.5; 
    this.position.timestamp = Date.now();
    this.driftStartTime = null; 
    
    console.log('Position calibrated to:', anchorPosition);
  }

  /**
   * Get current position
   */
  getPosition(): PDRPosition {
    return { ...this.position };
  }

  /**
   * Get current step count
   */
  getStepCount(): number {
    return this.position.stepCount;
  }

  /**
   * Get current sensor data
   */
  getSensorData(): SensorData {
    return { ...this.sensorData };
  }

  /**
   * Set event callbacks
   */
  setOnPositionUpdate(callback: (position: PDRPosition) => void): void {
    this.onPositionUpdate = callback;
  }

  setOnDriftDetected(callback: () => void): void {
    this.onDriftDetected = callback;
  }

  setOnStepDetected(callback: (stepCount: number) => void): void {
    this.onStepDetected = callback;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<PDRConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Reset position to origin
   */
  resetPosition(): void {
    this.position = {
      x: 0,
      y: 0,
      heading: this.position.heading, 
      confidence: 1.0,
      timestamp: Date.now(),
      stepCount: 0,
      accuracy: 1.0
    };
    this.driftStartTime = null;
    console.log('Position reset to origin');
  }

  /**
   * Simulate turning (for testing)
   */
  simulateTurn(degrees: number): void {
    this.position.heading = (this.position.heading + degrees) % 360;
    if (this.position.heading < 0) this.position.heading += 360;
    console.log(`Turned ${degrees} degrees, new heading: ${this.position.heading}`);
  }

  /**
   * Get drift status
   */
  getDriftStatus(): { isDrifting: boolean; distanceFromOrigin: number; timeDrifting: number } {
    const distanceFromOrigin = Math.sqrt(this.position.x * this.position.x + this.position.y * this.position.y);
    const isDrifting = distanceFromOrigin > this.config.driftThreshold;
    const timeDrifting = this.driftStartTime ? Date.now() - this.driftStartTime : 0;
    
    return {
      isDrifting,
      distanceFromOrigin,
      timeDrifting
    };
  }
}

export default RealPDRService;
