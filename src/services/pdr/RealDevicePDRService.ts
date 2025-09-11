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
  velocity: number; 
  stepLength: number; 
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

export class RealDevicePDRService {
  private position: PDRPosition = {
    x: 0,
    y: 0,
    heading: 0,
    confidence: 1.0,
    timestamp: Date.now(),
    stepCount: 0,
    accuracy: 1.0,
    velocity: 0,
    stepLength: 0.7
  };

  private config: PDRConfig = {
    stepLength: 0.7, 
    driftThreshold: 3.0,
    driftTimeThreshold: 20000, 
    calibrationInterval: 30000, 
    stepDetectionThreshold: 1.2, 
    headingSmoothingFactor: 0.8,
    minStepInterval: 400, 
    maxStepInterval: 2000 
  };

  private isTracking = false;
  private driftStartTime: number | null = null;
  private lastStepTime = 0;
  private lastCalibrationTime = 0;
  private isWalking = false; 
  private walkingStartTime = 0;
  
  private sensorData: SensorData = {
    accelerometer: { x: 0, y: 0, z: 0, timestamp: 0 },
    gyroscope: { x: 0, y: 0, z: 0, timestamp: 0 },
    magnetometer: { x: 0, y: 0, z: 0, timestamp: 0 }
  };

  private accelerationBuffer: number[] = [];
  private gyroscopeBuffer: { x: number; y: number; z: number; timestamp: number }[] = [];
  private magnetometerBuffer: { x: number; y: number; z: number; timestamp: number }[] = [];
  private stepHistory: { timestamp: number; stepLength: number; velocity: number }[] = [];
  private headingHistory: number[] = [];
  
  private sensorCalibration = {
    accelerometerBias: { x: 0, y: 0, z: 0 },
    gyroscopeBias: { x: 0, y: 0, z: 0 },
    magnetometerBias: { x: 0, y: 0, z: 0 },
    magneticDeclination: 0
  };

  
  private onPositionUpdate?: (position: PDRPosition) => void;
  private onDriftDetected?: () => void;
  private onStepDetected?: (stepCount: number) => void;

  private accelerometerSubscription?: any;
  private gyroscopeSubscription?: any;
  private magnetometerSubscription?: any;

  constructor(config?: Partial<PDRConfig>) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
    this.initializeCalibration();
  }

  /**
   * Initialize sensor calibration
   */
  private initializeCalibration(): void {
    this.sensorCalibration.magneticDeclination = 0; 
    
    this.position.stepLength = this.config.stepLength;
  }

  /**
   * Start PDR tracking with real device sensors
   */
  async startTracking(): Promise<void> {
    if (this.isTracking) return;

    try {
      const permissions = await this.requestPermissions();
      if (!permissions || !permissions.allGranted) {
        throw new Error('Required permissions not granted');
      }
    } catch (error) {
      console.error('Permission request failed:', error);
      throw new Error('Required permissions not granted');
    }

    
    await this.startSensorListeners();

    this.isTracking = true;
    this.position.timestamp = Date.now();
    this.lastCalibrationTime = Date.now();

    console.log('Real Device PDR tracking started');
  }

  /**
   * Stop PDR tracking
   */
  stopTracking(): void {
    this.isTracking = false;
    this.removeSensorListeners();
    console.log('Real Device PDR tracking stopped');
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
      
      return permissions;
    } catch (error) {
      console.error('Permission request failed:', error);
      throw error;
    }
  }

  /**
   * Start sensor listeners with real device data
   */
  private async startSensorListeners(): Promise<void> {
    try {
      setUpdateIntervalForType(SensorTypes.accelerometer, 50); // 50ms = 20Hz
      setUpdateIntervalForType(SensorTypes.gyroscope, 50);
      setUpdateIntervalForType(SensorTypes.magnetometer, 50);

      
      this.accelerometerSubscription = accelerometer.subscribe(({ x, y, z, timestamp }) => {
        this.handleAccelerometerData({ x, y, z, timestamp });
      });

      this.gyroscopeSubscription = gyroscope.subscribe(({ x, y, z, timestamp }) => {
        this.handleGyroscopeData({ x, y, z, timestamp });
      });

      this.magnetometerSubscription = magnetometer.subscribe(({ x, y, z, timestamp }) => {
        this.handleMagnetometerData({ x, y, z, timestamp });
      });

      console.log('Real device sensors started successfully');
    } catch (error:any) {
      console.error('Failed to start real device sensors:', error);
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
  }

  /**
   * Handle real accelerometer data
   */
  private handleAccelerometerData(data: any): void {
    this.sensorData.accelerometer = {
      x: data.x || 0,
      y: data.y || 0,
      z: data.z || 0,
      timestamp: data.timestamp || Date.now()
    };

    const acceleration = Math.sqrt(
      this.sensorData.accelerometer.x * this.sensorData.accelerometer.x +
      this.sensorData.accelerometer.y * this.sensorData.accelerometer.y +
      this.sensorData.accelerometer.z * this.sensorData.accelerometer.z
    );
    
    this.accelerationBuffer.push(acceleration);
    if (this.accelerationBuffer.length > 20) {
      this.accelerationBuffer.shift();
    }

    this.detectWalkingState(acceleration);
    
    if (this.isWalking) {
      this.detectStepReal(acceleration);
    }
  }

  /**
   * Handle real gyroscope data
   */
  private handleGyroscopeData(data: any): void {
    this.sensorData.gyroscope = {
      x: data.x || 0,
      y: data.y || 0,
      z: data.z || 0,
      timestamp: data.timestamp || Date.now()
    };

    this.gyroscopeBuffer.push(this.sensorData.gyroscope);
    if (this.gyroscopeBuffer.length > 10) {
      this.gyroscopeBuffer.shift();
    }

    
    this.updateHeadingFromGyroscope();
  }

  /**
   * Handle real magnetometer data
   */
  private handleMagnetometerData(data: any): void {
    
    this.sensorData.magnetometer = {
      x: data.x || 0,
      y: data.y || 0,
      z: data.z || 0,
      timestamp: data.timestamp || Date.now()
    };

    // Add to buffer
    this.magnetometerBuffer.push(this.sensorData.magnetometer);
    if (this.magnetometerBuffer.length > 10) {
      this.magnetometerBuffer.shift();
    }

    this.updateHeadingFromMagnetometer();
  }

  /**
   * Detect if user is actually walking (not just moving device)
   */
  private detectWalkingState(acceleration: number): void {
    const now = Date.now();
    
    if (this.accelerationBuffer.length < 15) return;
    
    const recentSamples = this.accelerationBuffer.slice(-15);
    const mean = recentSamples.reduce((a, b) => a + b, 0) / recentSamples.length;
    const variance = recentSamples.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recentSamples.length;
    const stdDev = Math.sqrt(variance);
    
    // Walking criteria (adjusted for better detection):
    // 1. Moderate variance (walking movement pattern)
    // 2. Acceleration above walking threshold
    // 3. Consistent rhythm over time
    const isWalkingPattern = variance > 0.3 && // Lower variance threshold for walking
                            acceleration > (mean + 1.0 * stdDev) && // Lower std dev requirement
                            acceleration > 9.2; // Lower acceleration threshold
    
    if (isWalkingPattern) {
      if (!this.isWalking) {
        this.isWalking = true;
        this.walkingStartTime = now;
        console.log('Walking detected - step detection enabled');
      }
    } else {
      // Stop walking if no pattern for 3 seconds
      if (this.isWalking && (now - this.walkingStartTime) > 3000) {
        this.isWalking = false;
        console.log('Walking stopped - step detection disabled');
      }
    }
  }

  /**
   * Real step detection using actual sensor data - STRICT for walking only
   */
  private detectStepReal(acceleration: number): void {
    const now = Date.now();
    
    // Check if enough time has passed since last step
    if (now - this.lastStepTime < this.config.minStepInterval) return;

    // Need at least 10 samples for reliable detection
    if (this.accelerationBuffer.length < 10) return;

    // Calculate walking-specific metrics
    const recentSamples = this.accelerationBuffer.slice(-10);
    const mean = recentSamples.reduce((a, b) => a + b, 0) / recentSamples.length;
    const variance = recentSamples.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recentSamples.length;
    const stdDev = Math.sqrt(variance);
    
    // Adjusted walking detection criteria for better accuracy:
    // 1. Moderate acceleration threshold (walking creates acceleration)
    const walkingThreshold = Math.max(mean + (1.5 * stdDev), this.config.stepDetectionThreshold);
    
    // 2. Moderate variance (walking has rhythm)
    const minWalkingVariance = 0.2; // Lower variance required for walking
    if (variance < minWalkingVariance) {
      return;
    }
    
    // 3. Check for walking rhythm pattern (more samples needed)
    if (this.accelerationBuffer.length >= 7) {
      const samples = this.accelerationBuffer.slice(-7);
      const current = samples[samples.length - 1];
      const previous = samples[samples.length - 3];
      const beforePrevious = samples[samples.length - 5];
      const beforeBeforePrevious = samples[samples.length - 7];

      
      // AND current must be above threshold
      const isWalkingPattern = current > previous && 
                              previous > beforePrevious && 
                              beforePrevious > beforeBeforePrevious &&
                              current > walkingThreshold &&
                              (current - mean) > (1.0 * stdDev); // Must be 1 std dev above mean
      
      if (isWalkingPattern) {
        this.registerStepReal(now, acceleration);
      }
    }
  }

  /**
   * Register a detected step with real data
   */
  private registerStepReal(timestamp: number, acceleration: number): void {
    this.lastStepTime = timestamp;
    this.position.stepCount++;
    
    // Estimate step length based on acceleration magnitude
    const stepLengthMultiplier = Math.min(1.5, Math.max(0.5, acceleration / 10.0));
    const estimatedStepLength = this.config.stepLength * stepLengthMultiplier;
    this.position.stepLength = estimatedStepLength;
    
    // Update position with real calculations
    this.updatePositionReal();
    
    // Notify step detection
    if (this.onStepDetected) {
      this.onStepDetected(this.position.stepCount);
    }
    
    console.log(`Real step detected: ${this.position.stepCount}, acceleration: ${acceleration.toFixed(3)}, heading: ${this.position.heading.toFixed(1)}°`);
  }

  /**
   * Update position with real calculations
   */
  private updatePositionReal(): void {
    const radians = this.position.heading * Math.PI / 180;
    const dx = this.position.stepLength * Math.cos(radians);
    const dy = this.position.stepLength * Math.sin(radians);
    
    this.position.x += dx;
    this.position.y += dy;
    this.position.timestamp = Date.now();
    
    // Update confidence based on real data quality
    this.updateConfidenceReal();
    
    // Update accuracy based on real data quality
    this.updateAccuracyReal();
    
    // Check for drift
    this.checkDriftReal();
    
    // Notify listeners
    if (this.onPositionUpdate) {
      this.onPositionUpdate({ ...this.position });
    }
  }

  /**
   * Update confidence based on real data quality
   */
  private updateConfidenceReal(): void {
    let confidence = 1.0;
    
    // Reduce confidence based on step count (but not as aggressively)
    const stepCountFactor = Math.max(0.3, 1.0 - (this.position.stepCount * 0.002));
    
    // Reduce confidence based on time since last calibration
    const timeSinceCalibration = Date.now() - this.lastCalibrationTime;
    const timeFactor = Math.max(0.5, 1.0 - (timeSinceCalibration / (this.config.calibrationInterval * 2)));
    
    // Reduce confidence based on step consistency
    let consistencyFactor = 1.0;
    if (this.stepHistory.length >= 3) {
      const recentSteps = this.stepHistory.slice(-3);
      const stepLengths = recentSteps.map(s => s.stepLength);
      const meanStepLength = stepLengths.reduce((a, b) => a + b, 0) / stepLengths.length;
      const variance = stepLengths.reduce((a, b) => a + Math.pow(b - meanStepLength, 2), 0) / stepLengths.length;
      const coefficientOfVariation = Math.sqrt(variance) / meanStepLength;
      consistencyFactor = Math.max(0.3, 1.0 - coefficientOfVariation);
    }
    
    confidence = stepCountFactor * timeFactor * consistencyFactor;
    this.position.confidence = Math.max(0.1, Math.min(1.0, confidence));
  }

  /**
   * Update accuracy based on real data quality
   */
  private updateAccuracyReal(): void {
    let accuracy = 1.0;
    
    // Base accuracy on confidence and step count
    const baseAccuracy = 0.5 + (this.position.confidence * 2.0);
    
    // Reduce accuracy over time
    const timeFactor = Math.max(0.3, 1.0 - (this.position.stepCount * 0.01));
    
    // Reduce accuracy based on step consistency
    let consistencyFactor = 1.0;
    if (this.stepHistory.length >= 3) {
      const recentSteps = this.stepHistory.slice(-3);
      const stepLengths = recentSteps.map(s => s.stepLength);
      const meanStepLength = stepLengths.reduce((a, b) => a + b, 0) / stepLengths.length;
      const variance = stepLengths.reduce((a, b) => a + Math.pow(b - meanStepLength, 2), 0) / stepLengths.length;
      const stdDev = Math.sqrt(variance);
      consistencyFactor = Math.max(0.5, 1.0 - (stdDev / meanStepLength));
    }
    
    accuracy = baseAccuracy * timeFactor * consistencyFactor;
    this.position.accuracy = Math.max(0.2, Math.min(5.0, accuracy));
  }

  /**
   * Update heading from real gyroscope data with improved accuracy
   */
  private updateHeadingFromGyroscope(): void {
    if (this.gyroscopeBuffer.length < 2) return;
    
    const current = this.gyroscopeBuffer[this.gyroscopeBuffer.length - 1];
    const previous = this.gyroscopeBuffer[this.gyroscopeBuffer.length - 2];
    
    const deltaTime = (current.timestamp - previous.timestamp) / 1000;
    if (deltaTime <= 0 || deltaTime > 1.0) return; // Skip if time gap too large
    
    // Use Z-axis for heading change with improved calculation
    const deltaHeading = current.z * deltaTime * (180 / Math.PI);
    
    // Check for valid values and reasonable rotation speed
    if (isNaN(deltaHeading) || !isFinite(deltaHeading) || Math.abs(deltaHeading) > 180) {
      return;
    }
    
    // Apply gyroscope bias correction (simple drift compensation)
    const biasCorrection = 0.01; // Small bias correction per second
    const correctedDeltaHeading = deltaHeading - (biasCorrection * deltaTime);
    
    this.position.heading = (this.position.heading + correctedDeltaHeading) % 360;
    if (this.position.heading < 0) this.position.heading += 360;
  }

  /**
   * Update heading from real magnetometer data with improved accuracy
   */
  private updateHeadingFromMagnetometer(): void {
    if (this.magnetometerBuffer.length < 1) return;
    
    const current = this.magnetometerBuffer[this.magnetometerBuffer.length - 1];
    
    // Calculate heading from magnetometer with improved calculation
    const heading = Math.atan2(current.y, current.x) * (180 / Math.PI);
    let normalizedHeading = (heading + 360) % 360;
    
    // Apply magnetic declination correction (adjust based on your location)
    normalizedHeading = (normalizedHeading + this.sensorCalibration.magneticDeclination) % 360;
    if (normalizedHeading < 0) normalizedHeading += 360;
    
    // Check for valid values
    if (isNaN(normalizedHeading) || !isFinite(normalizedHeading)) {
      return;
    }
    
    // Add to heading history for smoothing
    this.headingHistory.push(normalizedHeading);
    if (this.headingHistory.length > 10) {
      this.headingHistory.shift();
    }
    
    // Apply improved sensor fusion
    if (this.headingHistory.length >= 3) {
      const smoothedHeading = this.headingHistory.reduce((sum, h) => sum + h, 0) / this.headingHistory.length;
      
      // Calculate heading difference for smooth transition
      let headingDiff = smoothedHeading - this.position.heading;
      if (headingDiff > 180) headingDiff -= 360;
      if (headingDiff < -180) headingDiff += 360;
      
      // Apply weighted fusion with better balance
      const gyroWeight = 0.7; // 70% gyroscope (for smoothness)
      const magWeight = 0.3;  // 30% magnetometer (for accuracy)
      
      this.position.heading = this.position.heading + (headingDiff * magWeight);
      this.position.heading = (this.position.heading + 360) % 360;
    }
  }

  /**
   * Real drift detection
   */
  private checkDriftReal(): void {
    const currentTime = Date.now();
    
    // Check if we've been moving for a while
    if (this.position.stepCount > 5) {
      // Calculate distance from origin
      const distanceFromOrigin = Math.sqrt(this.position.x * this.position.x + this.position.y * this.position.y);
      
      if (distanceFromOrigin > this.config.driftThreshold) {
        if (!this.driftStartTime) {
          this.driftStartTime = currentTime;
        } else if (currentTime - this.driftStartTime > this.config.driftTimeThreshold) {
          // Drift detected for too long
          if (this.onDriftDetected) {
            this.onDriftDetected();
          }
          this.driftStartTime = null; // Reset to prevent repeated alerts
        }
      } else {
        this.driftStartTime = null; // Reset if we're back in range
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
    this.position.accuracy = 0.2; // High accuracy after calibration
    this.position.timestamp = Date.now();
    this.lastCalibrationTime = Date.now();
    this.driftStartTime = null; // Reset drift detection
    
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
      heading: this.position.heading, // Keep current heading
      confidence: 1.0,
      timestamp: Date.now(),
      stepCount: 0,
      accuracy: 1.0,
      velocity: 0,
      stepLength: this.config.stepLength
    };
    this.driftStartTime = null;
    this.lastCalibrationTime = Date.now();
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

  /**
   * Get walking state
   */
  getWalkingState(): { isWalking: boolean; walkingDuration: number } {
    return {
      isWalking: this.isWalking,
      walkingDuration: this.isWalking ? Date.now() - this.walkingStartTime : 0
    };
  }

  /**
   * Get heading accuracy and debugging info
   */
  getHeadingInfo(): {
    currentHeading: number;
    headingAccuracy: number;
    gyroscopeData: { x: number; y: number; z: number };
    magnetometerData: { x: number; y: number; z: number };
    headingHistory: number[];
  } {
    return {
      currentHeading: this.position.heading,
      headingAccuracy: this.calculateHeadingAccuracy(),
      gyroscopeData: this.sensorData.gyroscope,
      magnetometerData: this.sensorData.magnetometer,
      headingHistory: [...this.headingHistory]
    };
  }

  /**
   * Calculate heading accuracy based on sensor data quality
   */
  private calculateHeadingAccuracy(): number {
    let accuracy = 1.0;
    
    // Reduce accuracy based on gyroscope variance
    if (this.gyroscopeBuffer.length > 5) {
      const gyroZValues = this.gyroscopeBuffer.slice(-5).map(g => g.z);
      const gyroVariance = this.calculateVariance(gyroZValues);
      accuracy *= Math.max(0.5, 1.0 - gyroVariance);
    }
    
    // Reduce accuracy based on magnetometer variance
    if (this.magnetometerBuffer.length > 5) {
      const magValues = this.magnetometerBuffer.slice(-5).map(m => Math.sqrt(m.x*m.x + m.y*m.y + m.z*m.z));
      const magVariance = this.calculateVariance(magValues);
      accuracy *= Math.max(0.5, 1.0 - magVariance);
    }
    
    // Reduce accuracy over time (gyroscope drift)
    const timeSinceCalibration = Date.now() - this.lastCalibrationTime;
    const timeFactor = Math.max(0.3, 1.0 - (timeSinceCalibration / (this.config.calibrationInterval * 3)));
    accuracy *= timeFactor;
    
    return Math.max(0.1, Math.min(1.0, accuracy));
  }

  /**
   * Get real-time statistics
   */
  getStatistics(): {
    totalSteps: number;
    averageStepLength: number;
    currentAccuracy: number;
    timeSinceCalibration: number;
    isWalking: boolean;
    sensorDataQuality: {
      accelerometer: number;
      gyroscope: number;
      magnetometer: number;
    };
  } {
    const averageStepLength = this.stepHistory.length > 0 
      ? this.stepHistory.reduce((sum, s) => sum + s.stepLength, 0) / this.stepHistory.length
      : this.config.stepLength;
    
    // Calculate sensor data quality based on variance
    const accelQuality = this.accelerationBuffer.length > 0 ? 
      Math.min(1.0, Math.max(0.0, 1.0 - this.calculateVariance(this.accelerationBuffer))) : 0;
    
    const gyroQuality = this.gyroscopeBuffer.length > 0 ? 
      Math.min(1.0, Math.max(0.0, 1.0 - this.calculateVariance(this.gyroscopeBuffer.map(g => g.z)))) : 0;
    
    const magQuality = this.magnetometerBuffer.length > 0 ? 
      Math.min(1.0, Math.max(0.0, 1.0 - this.calculateVariance(this.magnetometerBuffer.map(m => Math.sqrt(m.x*m.x + m.y*m.y + m.z*m.z))))) : 0;
    
    return {
      totalSteps: this.position.stepCount,
      averageStepLength,
      currentAccuracy: this.position.accuracy,
      timeSinceCalibration: Date.now() - this.lastCalibrationTime,
      isWalking: this.isWalking,
      sensorDataQuality: {
        accelerometer: accelQuality,
        gyroscope: gyroQuality,
        magnetometer: magQuality
      }
    };
  }

  /**
   * Calculate variance of a data array
   */
  private calculateVariance(data: number[]): number {
    if (data.length < 2) return 0;
    
    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    const variance = data.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / data.length;
    return Math.sqrt(variance) / mean; // Coefficient of variation
  }
}

export default RealDevicePDRService;
