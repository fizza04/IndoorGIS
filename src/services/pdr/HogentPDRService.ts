import { accelerometer, gyroscope, magnetometer, setUpdateIntervalForType, SensorTypes } from 'react-native-sensors';
import { Subscription } from 'rxjs';
import { Platform } from 'react-native';
import { 
  object_sign_inversion,
  LPFilter,
  compFilter,
  toGCS,
  range,
  argmin
} from '../smartpdr/sensors_utils';
import { CoordinateTransformer } from './CoordinateTransformer';
import { PathTracker } from './PathTracker';

export interface HogentPDRPosition {
  x: number;
  y: number;
  heading: number;
  confidence: number;
  timestamp: number;
  stepCount: number;
  accuracy: number;
}

export interface HogentPDRConfig {
  stepLength: number; // meters
  updateInterval: number; // milliseconds
  enableDriftCorrection: boolean;
  coordinateSystem: 'local' | 'latlng';
  stepLengthScaler?: number;
  headingOffset?: number;
}

export class HogentPDRService {
  private isTracking = false;
  private config: HogentPDRConfig;
  private coordinateTransformer: CoordinateTransformer;
  private pathTracker: PathTracker;
  private currentPosition: HogentPDRPosition;
  private stepCount = 0;
  private lastStepTime = 0;
  private heading = 0;
  private processingInterval?: NodeJS.Timeout;
  
  // Sensor data
  private accelerometerData = { x: 0, y: 0, z: 0 };
  private magnetometerData = { x: 0, y: 0, z: 0 };
  private gyroscopeData = { x: 0, y: 0, z: 0 };
  
  // Hogent hooks state
  private attitude = { pitch: 0, roll: 0, yaw: 0 };
  private stepLength = 0.7;
  private headingStep = 0;
  
  // Hogent algorithm state - properly initialized
  private gravity = { x: 0, y: 0, z: 1 };
  private movingWindow: number[] = [];
  private accStep = 0;
  private accEvent = 0;
  private accList: number[] = [];
  private gyrAngTI: string[] = [];
  private bias = { x: 0, y: 0, z: 0 };
  private headingMag = { prev: null as number | null, current: 0 };
  private headingGyr = 0;
  
  // Hogent constants
  private readonly W = 3;
  private readonly N = 6;
  private readonly dt = 100; // ms
  private readonly h_decline = (7.5 * Math.PI) / 180;
  
  // Callbacks
  private onPositionUpdate?: (position: HogentPDRPosition) => void;
  private onStepDetected?: (stepCount: number) => void;
  private onDriftDetected?: () => void;

  constructor(config: HogentPDRConfig) {
    this.config = config;
    this.coordinateTransformer = new CoordinateTransformer();
    this.pathTracker = new PathTracker(this.coordinateTransformer);
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
   * Start PDR tracking using exact Hogent implementation
   */
  async startTracking(): Promise<void> {
    if (this.isTracking) {
      console.warn('Hogent PDR tracking is already running');
      return;
    }

    try {
      // Check Android permissions first
      if (Platform.OS === 'android') {
        const { AndroidPermissions } = await import('../../utils/AndroidPermissions');
        const permissionResult = await AndroidPermissions.requestEssentialPermissions();
        if (!permissionResult.granted) {
          console.warn('Essential permissions not granted, but continuing with PDR...');
          console.warn('Permission issue:', permissionResult.message);
        }
      }

      this.setupSensors();
      this.startProcessingLoop();
      this.isTracking = true;
      
      console.log('Hogent PDR tracking started');
    } catch (error) {
      console.error('Failed to start Hogent PDR tracking:', error);
      throw error;
    }
  }

  /**
   * Stop PDR tracking
   */
  stopTracking(): void {
    if (!this.isTracking) {
      console.warn('Hogent PDR tracking is not running');
      return;
    }

    this.stopSensorSubscriptions();
    this.stopProcessingLoop();
    this.isTracking = false;
    console.log('Hogent PDR tracking stopped');
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
  getCurrentPosition(): HogentPDRPosition {
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
  setOnPositionUpdate(callback: (position: HogentPDRPosition) => void): void {
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
   * Setup sensors with Hogent configuration
   */
  private setupSensors(): void {
    const sensorInterval = Platform.OS === 'android' ? Math.max(50, this.config.updateInterval) : this.config.updateInterval;
    
    setUpdateIntervalForType(SensorTypes.accelerometer, sensorInterval);
    setUpdateIntervalForType(SensorTypes.gyroscope, sensorInterval);
    setUpdateIntervalForType(SensorTypes.magnetometer, sensorInterval);
  }

  /**
   * Start sensor subscriptions
   */
  private startSensorSubscriptions(): void {
    // Accelerometer
    const accelSub = accelerometer.subscribe(({ x, y, z }) => {
      this.accelerometerData = { x, y, z };
    });

    // Gyroscope
    const gyroSub = gyroscope.subscribe(({ x, y, z }) => {
      this.gyroscopeData = { x, y, z };
    });

    // Magnetometer
    const magSub = magnetometer.subscribe(({ x, y, z }) => {
      this.magnetometerData = { x, y, z };
    });

    this.subscriptions = [accelSub, gyroSub, magSub];
  }

  /**
   * Stop sensor subscriptions
   */
  private stopSensorSubscriptions(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];
  }

  /**
   * Start processing loop
   */
  private startProcessingLoop(): void {
    this.startSensorSubscriptions();
    this.processingInterval = setInterval(() => {
      this.processHogentPDR();
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
   * Process PDR using exact Hogent implementation
   */
  private processHogentPDR(): void {
    if (!this.isTracking) return;

    // Process accelerometer data for step detection
    this.processAccelerometerData();
    
    // Process gyroscope and magnetometer for heading
    this.processGyroscopeData();
    this.processMagnetometerData();

    // Update position
    this.currentPosition.heading = this.heading;
    this.currentPosition.stepCount = this.stepCount;
    this.currentPosition.timestamp = Date.now();
    this.onPositionUpdate?.(this.currentPosition);
  }

  /**
   * Process accelerometer data using exact Hogent implementation
   */
  private processAccelerometerData(): void {
    const { x, y, z } = this.accelerometerData;
    
    // Safety check for valid sensor data
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) {
      return;
    }
    
    const acc_inv = object_sign_inversion({ x, y, z });
    const acc_gcs = toGCS(acc_inv, this.attitude);
    this.gravity = { ...this.gravity, z: LPFilter(this.gravity.z, acc_gcs.z * 9.81) };
    
    const acc_hpf = (acc_gcs.z - this.gravity.z) * 9.81;
    
    // Safety check for valid acceleration value
    if (!isFinite(acc_hpf)) {
      return;
    }
    
    this.movingWindow.push(acc_hpf);
    if (this.movingWindow.length === this.W) {
      this.accStep = this.movingWindow.reduce((a, b) => a + b) / this.W;
      this.accList.push(this.accStep);
      
      if (this.accList.length === this.N) {
        const accEvent = this.hogentStepDetectionAlgorithm();
        if (accEvent > 0) {
          this.stepCount++;
          this.lastStepTime = Date.now();
          
          // Calculate step length using exact Hogent formulas
          this.stepLength = this.calculateHogentStepLength(accEvent);
          
          // Update position using exact Hogent calculation
          this.updatePositionFromStep(this.stepLength, this.headingStep);
          
          // Update confidence (decreases over time)
          this.currentPosition.confidence = Math.max(0.1, 1.0 - (this.stepCount * 0.01));
          this.currentPosition.accuracy = this.currentPosition.confidence;
          
          console.log(`HOGENT STEP DETECTED! Count: ${this.stepCount}, Length: ${this.stepLength.toFixed(3)}m`);
          this.onStepDetected?.(this.stepCount);
        }
        this.accList = this.accList.slice(1);
      }
      this.movingWindow = this.movingWindow.slice((this.W - 1) / 2);
    }
  }

  /**
   * Process gyroscope data using exact Hogent implementation
   */
  private processGyroscopeData(): void {
    const { x, y, z } = this.gyroscopeData;
    
    // Safety check for valid sensor data
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) {
      return;
    }
    
    // EXACT Hogent gyroscope processing for attitude
    const pitch = x * Math.cos(this.attitude.roll) + z * Math.sin(this.attitude.roll);
    const roll = x * Math.sin(this.attitude.roll) * Math.tan(this.attitude.pitch) + y + z * -Math.cos(this.attitude.roll) * Math.tan(this.attitude.pitch);
    const yaw = x * (-Math.sin(this.attitude.roll) / Math.cos(this.attitude.pitch)) + z * (Math.cos(this.attitude.roll) / Math.cos(this.attitude.pitch));

    if (this.attitude.roll && this.attitude.pitch) {
      this.attitude = {
        pitch: compFilter(this.attitude.pitch + pitch * (this.dt / 1000), this.attitude.pitch),
        roll: compFilter(range(this.attitude.roll + roll * (this.dt / 1000), 'PI'), this.attitude.roll),
        yaw: compFilter(range(this.attitude.yaw + yaw * (this.dt / 1000), 'PI'), this.attitude.yaw),
      };
    }

    // EXACT Hogent gyroscope-based heading
    if (x + y + z) {
      const gt = toGCS(this.gravity, this.attitude, true);
      const corrGyr = {
        x: x - this.bias.x,
        y: y - this.bias.y,
        z: z - this.bias.z,
      };
      const gyr_gcs = (corrGyr.x * gt.x + corrGyr.y * gt.y + corrGyr.z * gt.z) /
        Math.sqrt(Math.pow(gt.x, 2) + Math.pow(gt.y, 2) + Math.pow(gt.z, 2));
      
      if (this.headingGyr && isFinite(gyr_gcs)) {
        this.headingGyr = range(this.headingGyr - gyr_gcs * (this.dt / 1000), '2PI');
      }
    }
  }

  /**
   * Process magnetometer data using exact Hogent implementation
   */
  private processMagnetometerData(): void {
    const { x, y, z } = this.magnetometerData;
    const { pitch, roll, yaw } = this.attitude;
    
    // Safety check for valid sensor data
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) {
      return;
    }
    
    if (x + y + z && pitch && roll && yaw) {
      const mag_gcs = toGCS({ x, y, z }, { ...this.attitude, yaw: 0 });
      const h_mag = this.atan2(-mag_gcs.y, mag_gcs.x) - this.h_decline;
      const h_mag_normalized = range(h_mag - Math.PI / 2, '2PI');

      // Calculate gyroscope bias
      if (Math.abs(h_mag_normalized - this.headingMag.current) > (0.7 * Math.PI) / 180) {
        this.gyrAngTI = [];
      } else {
        this.gyrAngTI.push(JSON.stringify({ pitch: this.attitude.pitch, roll: this.attitude.roll, yaw: this.attitude.yaw }));
      }
      
      const num_TI = this.gyrAngTI.length;
      if (num_TI > 0) {
        try {
          const start = JSON.parse(this.gyrAngTI[0]);
          const end = JSON.parse(this.gyrAngTI[this.gyrAngTI.length - 1]);
          this.bias = {
            x: (end.pitch - start.pitch) / (num_TI * (this.dt / 1000)),
            y: (end.roll - start.roll) / (num_TI * (this.dt / 1000)),
            z: (end.yaw - start.yaw) / (num_TI * (this.dt / 1000)),
          };
        } catch (error) {
          console.warn('Error parsing gyroscope bias data:', error);
        }
      }

      if (!this.headingMag.current) this.headingGyr = h_mag_normalized;
      this.headingMag = { prev: this.headingMag.current, current: h_mag_normalized };
    }

    // EXACT Hogent heading fusion algorithm
    if (this.headingMag.current && this.headingGyr) {
      if (this.headingGyr % (Math.PI / 2) <= (5 * Math.PI) / 180) {
        this.headingMag = { prev: null, current: 0 };
        this.headingGyr = 0;
      }
      this.heading = this.hogentHeadingAlgorithm(
        this.headingMag.current, 
        this.headingGyr, 
        this.headingMag.prev, 
        this.heading
      );
    }
  }

  /**
   * Update position based on detected step - EXACT Hogent implementation
   */
  private updatePositionFromStep(stepLength: number, headingStep: number): void {
    // EXACT Hogent implementation from their locationScreen.tsx:
    // const nx = stepLength ? stepLength * Math.sin(headingStep) * 10 : 0;
    // const ny = stepLength ? stepLength * Math.cos(headingStep) * 10 : 0;
    // setLocation((previous) => ({ x: previous.x + nx, y: previous.y - ny }));
    
    const nx = stepLength ? stepLength * Math.sin(headingStep) : 0;
    const ny = stepLength ? stepLength * Math.cos(headingStep) : 0;
    
    this.currentPosition.x += nx;
    this.currentPosition.y -= ny; // Note: Hogent uses negative Y for North-South
    this.currentPosition.timestamp = Date.now();
    
    console.log(`Step ${this.stepCount}: Heading ${(headingStep * 180 / Math.PI).toFixed(1)}°, StepLength ${stepLength.toFixed(2)}m, Moved (${nx.toFixed(2)}, ${-ny.toFixed(2)}) to (${this.currentPosition.x.toFixed(2)}, ${this.currentPosition.y.toFixed(2)})`);
    
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
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stopTracking();
  }

  private subscriptions: Subscription[] = [];

  /**
   * Hogent step detection algorithm - EXACT implementation
   */
  private hogentStepDetectionAlgorithm(): number {
    const acc_peak_th = 0.5;
    const acc_pp_th = 1.0;
    const t = this.N / 2;
    let cond = { peak: false, pp: false, slope: false };

    // Check if we have enough data
    if (this.accList.length < this.N) {
      return 0;
    }

    // Peak detection
    if (this.accList[t] > acc_peak_th) {
      for (let i = -this.N / 2; i < this.N / 2; i++) {
        if (i === 0) continue;
        const index = t + i;
        if (index >= 0 && index < this.accList.length && this.accList[t] > this.accList[index]) {
          cond.peak = true;
          break;
        }
      }
    }

    // Peak-to-peak detection
    let diff = { prev: [], next: [] };
    for (let i = 1; i < this.N / 2; i++) {
      const prevIndex = t - i;
      const nextIndex = t + i;
      if (prevIndex >= 0 && nextIndex < this.accList.length) {
        diff.prev.push(this.accList[t] - this.accList[prevIndex]);
        diff.next.push(this.accList[t] - this.accList[nextIndex]);
      }
    }
    if (diff.prev.length > 0 && diff.next.length > 0 &&
        Math.max(...diff.prev) > acc_pp_th &&
        Math.max(...diff.next) > acc_pp_th
    ) {
      cond.pp = true;
    }

    // Slope detection
    let sum = { pos: 0, neg: 0 };
    for (let i = t - this.N / 2; i <= t - 1; i++) {
      if (i >= 0 && i + 1 < this.accList.length) {
        sum.pos += this.accList[i + 1] - this.accList[i];
      }
    }
    for (let i = t + 1; i < t + this.N / 2; i++) {
      if (i < this.accList.length && i - 1 >= 0) {
        sum.neg += this.accList[i] - this.accList[i - 1];
      }
    }
    if ((2 / this.N) * sum.pos > 0 && (2 / this.N) * sum.neg < 0) cond.slope = true;

    if (cond.peak && cond.pp && cond.slope) {
      return this.accList[t];
    }
    
    return 0;
  }

  /**
   * Calculate step length using exact Hogent formulas
   */
  private calculateHogentStepLength(acceleration: number): number {
    const acc_th = 3.23;
    const acc_pp = acceleration;
    
    let stepLength: number;
    if (acc_pp < acc_th) {
      stepLength = 1.479 * Math.pow(acc_pp, 1 / 4) + -1.259;
    } else {
      stepLength = 1.131 * Math.log(acc_pp) + 0.159;
    }
    
    return Math.max(0.1, Math.min(2.0, stepLength));
  }

  /**
   * Hogent heading fusion algorithm - EXACT implementation
   */
  private hogentHeadingAlgorithm(h_mag: number, h_gyr: number, h_mag_prev: number | null, h_t_prev: number): number {
    const weight = { prev: 2, mag: 1, gyr: 2, pmg: 1 / 5, mg: 1 / 3, pg: 1 / 4 };
    const threshold = {
      h_cor_t: (5 * Math.PI) / 180,
      h_mag_t: (2 * Math.PI) / 180,
    };
    const diff = {
      h_cor_diff: Math.abs(h_mag - h_gyr),
      h_mag_diff: Math.abs(h_mag - (h_mag_prev || 0)),
    };
    let h_t = 0;

    if (diff.h_cor_diff <= threshold.h_cor_t) {
      if (diff.h_mag_diff <= threshold.h_mag_t) {
        h_t = weight.pmg * (weight.prev * h_t_prev + weight.mag * h_mag + weight.gyr * h_gyr);
      } else {
        h_t = weight.mg * (weight.mag * h_mag + weight.gyr * h_gyr);
      }
    } else {
      if (diff.h_mag_diff <= threshold.h_mag_t) {
        h_t = h_t_prev;
      } else {
        h_t = weight.pg * (weight.prev * h_t_prev + weight.gyr * h_gyr);
      }
    }
    return h_t;
  }

  /**
   * Atan2 helper function
   */
  private atan2(y: number, x: number): number {
    return 2 * Math.atan(y / (Math.sqrt(x * x + y * y) + x));
  }
}