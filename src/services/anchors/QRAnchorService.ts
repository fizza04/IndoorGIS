import { Alert } from 'react-native';
import QRCodeScanner from 'react-native-qrcode-scanner';

export interface QRAnchor {
  id: string;
  type: 'poi' | 'calibration' | 'entrance';
  position: {
    x: number;
    y: number;
    floor: string;
  };
  heading?: number; // Optional heading calibration
  name: string;
  description?: string;
  buildingId: string;
  metadata?: Record<string, any>;
}

export interface QRScanResult {
  success: boolean;
  anchor?: QRAnchor;
  error?: string;
}

export class QRAnchorService {
  private knownAnchors: Map<string, QRAnchor> = new Map();
  private onAnchorScanned?: (anchor: QRAnchor) => void;
  private onCalibrationRequired?: (anchor: QRAnchor) => void;

  constructor() {
    this.initializeKnownAnchors();
  }

  /**
   * Initialize known QR anchors for testing
   */
  private initializeKnownAnchors(): void {
    // Sample anchors for testing
    const sampleAnchors: QRAnchor[] = [
      {
        id: 'entrance_main',
        type: 'entrance',
        position: { x: 0, y: 0, floor: '1' },
        heading: 0,
        name: 'Main Entrance',
        description: 'Building main entrance',
        buildingId: 'building_1'
      },
      {
        id: 'poi_fire_extinguisher_1',
        type: 'poi',
        position: { x: 5, y: 3, floor: '1' },
        name: 'Fire Extinguisher #1',
        description: 'Emergency equipment - Floor 1',
        buildingId: 'building_1'
      },
      {
        id: 'poi_elevator_1',
        type: 'poi',
        position: { x: 10, y: 0, floor: '1' },
        name: 'Elevator #1',
        description: 'Main elevator - Floor 1',
        buildingId: 'building_1'
      },
      {
        id: 'calibration_point_1',
        type: 'calibration',
        position: { x: 2, y: 2, floor: '1' },
        heading: 90,
        name: 'Calibration Point 1',
        description: 'Known position for PDR calibration',
        buildingId: 'building_1'
      },
      {
        id: 'poi_office_101',
        type: 'poi',
        position: { x: 8, y: 5, floor: '1' },
        name: 'Office 101',
        description: 'Conference room - Floor 1',
        buildingId: 'building_1'
      }
    ];

    sampleAnchors.forEach(anchor => {
      this.knownAnchors.set(anchor.id, anchor);
    });
  }

  /**
   * Simulate QR code scanning
   * In a real implementation, this would use react-native-qrcode-scanner
   */
  async simulateQRScan(): Promise<QRScanResult> {
    return new Promise((resolve) => {
      // Simulate scanning delay
      setTimeout(() => {
        // Randomly select an anchor for demo
        const anchorIds = Array.from(this.knownAnchors.keys());
        const randomId = anchorIds[Math.floor(Math.random() * anchorIds.length)];
        const anchor = this.knownAnchors.get(randomId);
        
        if (anchor) {
          resolve({
            success: true,
            anchor: { ...anchor }
          });
        } else {
          resolve({
            success: false,
            error: 'Unknown QR code'
          });
        }
      }, 1000); // 1 second delay
    });
  }

  /**
   * Process scanned QR code data
   */
  processQRData(qrData: string): QRScanResult {
    try {
      // Parse QR code data (could be JSON, URL, or simple ID)
      let anchorId: string;
      
      if (qrData.startsWith('{')) {
        // JSON format
        const data = JSON.parse(qrData);
        anchorId = data.id || data.anchorId;
      } else if (qrData.startsWith('http')) {
        // URL format - extract ID from URL
        try {
          const url = new URL(qrData);
          const pathname = (url as any).pathname || url.href.split('/').slice(3).join('/');
          anchorId = pathname.split('/').pop() || qrData;
        } catch {
          anchorId = qrData;
        }
      } else {
        // Simple ID format
        anchorId = qrData;
      }

      const anchor = this.knownAnchors.get(anchorId);
      
      if (anchor) {
        return {
          success: true,
          anchor: { ...anchor }
        };
      } else {
        return {
          success: false,
          error: `Unknown anchor ID: ${anchorId}`
        };
      }
    } catch (error) {
      return {
        success: false,
        error: `Invalid QR code format: ${error}`
      };
    }
  }

  /**
   * Add a new anchor to the known anchors
   */
  addAnchor(anchor: QRAnchor): void {
    this.knownAnchors.set(anchor.id, anchor);
    console.log(`Added anchor: ${anchor.name} (${anchor.id})`);
  }

  /**
   * Get anchor by ID
   */
  getAnchor(anchorId: string): QRAnchor | undefined {
    return this.knownAnchors.get(anchorId);
  }

  /**
   * Get all anchors for a building
   */
  getAnchorsForBuilding(buildingId: string): QRAnchor[] {
    return Array.from(this.knownAnchors.values())
      .filter(anchor => anchor.buildingId === buildingId);
  }

  /**
   * Get anchors by type
   */
  getAnchorsByType(type: QRAnchor['type']): QRAnchor[] {
    return Array.from(this.knownAnchors.values())
      .filter(anchor => anchor.type === type);
  }

  /**
   * Find nearest anchor to a position
   */
  findNearestAnchor(x: number, y: number, floor: string, maxDistance: number = 5): QRAnchor | null {
    const floorAnchors = Array.from(this.knownAnchors.values())
      .filter(anchor => anchor.position.floor === floor);

    let nearestAnchor: QRAnchor | null = null;
    let minDistance = maxDistance;

    floorAnchors.forEach(anchor => {
      const distance = Math.sqrt(
        Math.pow(anchor.position.x - x, 2) + 
        Math.pow(anchor.position.y - y, 2)
      );
      
      if (distance < minDistance) {
        minDistance = distance;
        nearestAnchor = anchor;
      }
    });

    return nearestAnchor;
  }

  /**
   * Show QR scanner (mock implementation)
   * In a real app, this would open the camera scanner
   */
  async showQRScanner(): Promise<QRScanResult> {
    return new Promise((resolve) => {
      Alert.alert(
        'QR Code Scanner',
        'Choose an anchor to simulate scanning:',
        [
          ...Array.from(this.knownAnchors.values()).map(anchor => ({
            text: anchor.name,
            onPress: () => resolve({
              success: true,
              anchor: { ...anchor }
            })
          })),
          {
            text: 'Cancel',
            onPress: () => resolve({
              success: false,
              error: 'Scan cancelled'
            }),
            style: 'cancel'
          }
        ]
      );
    });
  }

  /**
   * Generate QR code data for an anchor
   */
  generateQRData(anchor: QRAnchor): string {
    return JSON.stringify({
      id: anchor.id,
      type: anchor.type,
      position: anchor.position,
      heading: anchor.heading,
      name: anchor.name,
      buildingId: anchor.buildingId
    });
  }

  /**
   * Validate anchor data
   */
  validateAnchor(anchor: Partial<QRAnchor>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!anchor.id) errors.push('ID is required');
    if (!anchor.type) errors.push('Type is required');
    if (!anchor.position) errors.push('Position is required');
    if (!anchor.name) errors.push('Name is required');
    if (!anchor.buildingId) errors.push('Building ID is required');

    if (anchor.position) {
      if (typeof anchor.position.x !== 'number') errors.push('Position X must be a number');
      if (typeof anchor.position.y !== 'number') errors.push('Position Y must be a number');
      if (!anchor.position.floor) errors.push('Floor is required');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Set event callbacks
   */
  setOnAnchorScanned(callback: (anchor: QRAnchor) => void): void {
    this.onAnchorScanned = callback;
  }

  setOnCalibrationRequired(callback: (anchor: QRAnchor) => void): void {
    this.onCalibrationRequired = callback;
  }

  /**
   * Trigger anchor scanned event
   */
  private triggerAnchorScanned(anchor: QRAnchor): void {
    if (this.onAnchorScanned) {
      this.onAnchorScanned(anchor);
    }
  }

  /**
   * Trigger calibration required event
   */
  private triggerCalibrationRequired(anchor: QRAnchor): void {
    if (this.onCalibrationRequired) {
      this.onCalibrationRequired(anchor);
    }
  }

  /**
   * Get statistics about known anchors
   */
  getStatistics(): {
    totalAnchors: number;
    anchorsByType: Record<string, number>;
    anchorsByBuilding: Record<string, number>;
  } {
    const anchors = Array.from(this.knownAnchors.values());
    
    const anchorsByType: Record<string, number> = {};
    const anchorsByBuilding: Record<string, number> = {};

    anchors.forEach(anchor => {
      anchorsByType[anchor.type] = (anchorsByType[anchor.type] || 0) + 1;
      anchorsByBuilding[anchor.buildingId] = (anchorsByBuilding[anchor.buildingId] || 0) + 1;
    });

    return {
      totalAnchors: anchors.length,
      anchorsByType,
      anchorsByBuilding
    };
  }
}

export default QRAnchorService;
