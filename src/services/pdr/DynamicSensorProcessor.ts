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

export interface SensorData {
  accelerometer: { x: number; y: number; z: number };
  magnetometer: { x: number; y: number; z: number };
  gyroscope: { x: number; y: number; z: number };
}

export interface ProcessedData {
  attitude: { pitch: number; roll: number; yaw: number };
  heading: number;
  headingStep: number;
  stepDetected: boolean;
  stepLength: number;
  accelerationMagnitude: number;
  filteredAcceleration: number;
}

export class DynamicSensorProcessor {
  private subscriptions: Subscription[] = [];
  private isProcessing = false;
  private updateInterval: number;

  // Sensor data
  private sensorData: SensorData = {
    accelerometer: { x: 0, y: 0, z: 0 },
    magnetometer: { x: 0, y: 0, z: 0 },
    gyroscope: { x: 0, y: 0, z: 0 }
  };

  // EXACT Hogent implementation state
  private attitude = { pitch: 0, roll: 0, yaw: 0 };
  private heading = 0;
  private headingStep = 0;
  private stepLength = 0.7;
  
  // Hogent step detection
  private gravity = { x: 0, y: 0, z: 1 };
  private movingWindow: number[] = [];
  private accStep = 0;
  private accEvent = 0;
  private accList: number[] = [];
  private stepCount = 0;
  private lastStepTime = 0;
  
  // Hogent heading calculation
  private gyrAngTI: string[] = [];
  private bias = { x: 0, y: 0, z: 0 };
  private headingMag = { prev: null as number | null, current: 0 };
  private headingGyr = 0;
  
  // Hogent constants
  private readonly W = 3;
  private readonly N = 6;
  private readonly dt = 100; // ms
  private readonly h_decline = (7.5 * Math.PI) / 180;

  constructor(updateInterval: number = 100) {
    this.updateInterval = updateInterval;
    this.setupSensors();
  }

  private setupSensors(): void {
    // Set different update intervals for Android vs iOS for optimal performance
    const sensorInterval = Platform.OS === 'android' ? Math.max(50, this.updateInterval) : this.updateInterval;
    
    setUpdateIntervalForType(SensorTypes.accelerometer, sensorInterval);
    setUpdateIntervalForType(SensorTypes.gyroscope, sensorInterval);
    setUpdateIntervalForType(SensorTypes.magnetometer, sensorInterval);
  }

  startProcessing(): void {
    if (this.isProcessing) return;

    this.isProcessing = true;
    this.startSensorSubscriptions();
    console.log('Dynamic sensor processing started');
  }

  stopProcessing(): void {
    if (!this.isProcessing) return;

    this.isProcessing = false;
    this.stopSensorSubscriptions();
    console.log('Dynamic sensor processing stopped');
  }

  private startSensorSubscriptions(): void {
    console.log('Starting sensor subscriptions...');
    
    try {
      // Accelerometer
      const accelSub = accelerometer.subscribe(
        ({ x, y, z }) => {
          console.log('Accelerometer data:', { x, y, z });
          this.sensorData.accelerometer = { x, y, z };
          this.processAccelerometerData(x, y, z);
        },
        (error) => {
          console.error('Accelerometer subscription error:', error);
        }
      );

      // Gyroscope
      const gyroSub = gyroscope.subscribe(
        ({ x, y, z }) => {
          console.log('Gyroscope data:', { x, y, z });
          this.sensorData.gyroscope = { x, y, z };
          this.processGyroscopeData(x, y, z);
        },
        (error) => {
          console.error('Gyroscope subscription error:', error);
        }
      );

      // Magnetometer
      const magSub = magnetometer.subscribe(
        ({ x, y, z }) => {
          console.log('Magnetometer data:', { x, y, z });
          this.sensorData.magnetometer = { x, y, z };
          this.processMagnetometerData(x, y, z);
        },
        (error) => {
          console.error('Magnetometer subscription error:', error);
        }
      );

      this.subscriptions = [accelSub, gyroSub, magSub];
      console.log('Sensor subscriptions started successfully');
    } catch (error) {
      console.error('Failed to start sensor subscriptions:', error);
    }
  }

  private stopSensorSubscriptions(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];
  }

  private processAccelerometerData(x: number, y: number, z: number): void {
    if (!this.isProcessing) return;

    // EXACT Hogent accelerometer processing
    const acc_inv = object_sign_inversion({ x, y, z });
    const acc_gcs = toGCS(acc_inv, this.attitude);
    this.gravity = { ...this.gravity, z: LPFilter(this.gravity.z, acc_gcs.z * 9.81) };
    
    const acc_hpf = (acc_gcs.z - this.gravity.z) * 9.81;
    
    this.movingWindow.push(acc_hpf);
    if (this.movingWindow.length === this.W) {
      this.accStep = this.movingWindow.reduce((a, b) => a + b) / this.W;
      this.accList.push(this.accStep);
      
      console.log('Accelerometer processing:', {
        acc_hpf: acc_hpf.toFixed(3),
        accStep: this.accStep.toFixed(3),
        accListLength: this.accList.length,
        movingWindowLength: this.movingWindow.length
      });
      
      if (this.accList.length === this.N) {
        this.accEvent = this.hogentStepDetectionAlgorithm();
        console.log('Step detection result:', this.accEvent);
        this.accList = this.accList.slice(1);
      }
      this.movingWindow = this.movingWindow.slice((this.W - 1) / 2);
    }
  }

  private hogentStepDetectionAlgorithm(): number {
    // EXACT Hogent peak detection algorithm
    const acc_peak_th = 0.5;
    const acc_pp_th = 1.0;
    const t = this.N / 2;
    let cond = { peak: false, pp: false, slope: false };

    // Peak detection
    if (this.accList[t] > acc_peak_th) {
      for (let i = -this.N / 2; i < this.N / 2; i++) {
        if (i === 0) continue;
        if (this.accList[t] > this.accList[t + i]) {
          cond.peak = true;
          break;
        }
      }
    }

    // Peak-to-peak detection
    let diff = { prev: [], next: [] };
    for (let i = 1; i < this.N / 2; i++) {
      diff.prev.push(this.accList[t] - this.accList[t - i]);
      diff.next.push(this.accList[t] - this.accList[t + i]);
    }
    if (
      Math.max(...diff.prev) > acc_pp_th &&
      Math.max(...diff.next) > acc_pp_th
    ) {
      cond.pp = true;
    }

    // Slope detection
    let sum = { pos: 0, neg: 0 };
    for (let i = t - this.N / 2; i <= t - 1; i++) {
      sum.pos += this.accList[i + 1] - this.accList[i];
    }
    for (let i = t + 1; i < t + this.N / 2; i++) {
      sum.neg += this.accList[i] - this.accList[i - 1];
    }
    if ((2 / this.N) * sum.pos > 0 && (2 / this.N) * sum.neg < 0) cond.slope = true;

    if (cond.peak && cond.pp && cond.slope) {
      this.stepCount++;
      this.lastStepTime = Date.now();
      
      // Calculate step length using EXACT Hogent formulas
      this.stepLength = this.calculateHogentStepLength(this.accList[t]);
      
      console.log(`HOGENT STEP DETECTED! Count: ${this.stepCount}, Length: ${this.stepLength.toFixed(3)}m`);
      return this.accList[t];
    }
    
    return 0;
  }

  private calculateDynamicStepLength(acceleration: number): number {
    // Dynamic step length based on acceleration magnitude
    const baseStepLength = 0.7; // 70cm base
    const accelerationFactor = Math.min(acceleration / 2.0, 1.0); // Normalize to 0-1
    const dynamicStepLength = baseStepLength * (0.8 + 0.4 * accelerationFactor);
    
    return Math.max(0.3, Math.min(1.2, dynamicStepLength)); // Clamp between 30cm and 120cm
  }

  private calculateHogentStepLength(acceleration: number): number {
    // EXACT Hogent step length calculation formulas
    const acc_th = 3.23;
    const acc_pp = acceleration; // Peak-to-peak acceleration value
    
    let stepLength: number;
    if (acc_pp < acc_th) {
      // EXACT Hogent formula: fourth root for low acceleration
      stepLength = 1.479 * Math.pow(acc_pp, 1 / 4) + -1.259;
    } else {
      // EXACT Hogent formula: logarithmic for high acceleration
      stepLength = 1.131 * Math.log(acc_pp) + 0.159;
    }
    
    // Return raw Hogent calculation (no additional scaling)
    return Math.max(0.1, Math.min(2.0, stepLength)); // Reasonable bounds
  }

  private processGyroscopeData(x: number, y: number, z: number): void {
    if (!this.isProcessing) return;

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
      
      if (this.headingGyr) {
        this.headingGyr = range(this.headingGyr - gyr_gcs * (this.dt / 1000), '2PI');
      }
    }
  }

  private processMagnetometerData(x: number, y: number, z: number): void {
    if (!this.isProcessing) return;

    // EXACT Hogent magnetometer processing
    const { pitch, roll, yaw } = this.attitude;
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
      if (num_TI) {
        const start = JSON.parse(this.gyrAngTI[0]);
        const end = JSON.parse(this.gyrAngTI[this.gyrAngTI.length - 1]);
        this.bias = {
          x: (end.pitch - start.pitch) / (num_TI * (this.dt / 1000)),
          y: (end.roll - start.roll) / (num_TI * (this.dt / 1000)),
          z: (end.yaw - start.yaw) / (num_TI * (this.dt / 1000)),
        };
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

  private normalizeAngle(angle: number): number {
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    return angle;
  }

  getProcessedData(): ProcessedData {
    const filteredAcceleration = this.accList.length > 0 
      ? this.accList.reduce((a, b) => a + b) / this.accList.length
      : 0;

    return {
      attitude: { ...this.attitude },
      heading: this.heading,
      headingStep: this.headingStep,
      stepDetected: this.stepCount > 0 && (Date.now() - this.lastStepTime) < 1000,
      stepLength: this.stepLength,
      accelerationMagnitude: Math.sqrt(
        this.sensorData.accelerometer.x ** 2 +
        this.sensorData.accelerometer.y ** 2 +
        this.sensorData.accelerometer.z ** 2
      ),
      filteredAcceleration
    };
  }

  getStepCount(): number {
    return this.stepCount;
  }

  reset(): void {
    this.stepCount = 0;
    this.lastStepTime = 0;
    this.accList = [];
    this.movingWindow = [];
    this.attitude = { pitch: 0, roll: 0, yaw: 0 };
    this.heading = 0;
    this.headingStep = 0;
    this.stepLength = 0.7;
    this.gravity = { x: 0, y: 0, z: 1 };
    this.gyrAngTI = [];
    this.bias = { x: 0, y: 0, z: 0 };
    this.headingMag = { prev: null, current: 0 };
    this.headingGyr = 0;
  }

  destroy(): void {
    this.stopProcessing();
  }
}
