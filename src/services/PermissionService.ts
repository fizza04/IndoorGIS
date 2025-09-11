import { Platform, Alert, Linking } from 'react-native';
import { check, request, PERMISSIONS, RESULTS, Permission } from 'react-native-permissions';

export interface PermissionStatus {
  granted: boolean;
  canAskAgain: boolean;
  status: string;
}

export class PermissionService {
  private static instance: PermissionService;
  
  private constructor() {}
  
  public static getInstance(): PermissionService {
    if (!PermissionService.instance) {
      PermissionService.instance = new PermissionService();
    }
    return PermissionService.instance;
  }

  /**
   * Request camera permission for QR scanning
   */
  async requestCameraPermission(): Promise<PermissionStatus> {
    const permission = Platform.OS === 'ios' 
      ? PERMISSIONS.IOS.CAMERA 
      : PERMISSIONS.ANDROID.CAMERA;

    return this.requestPermission(permission, 'Camera access is required for QR code scanning');
  }

  /**
   * Request location permission for PDR
   */
  async requestLocationPermission(): Promise<PermissionStatus> {
    const permission = Platform.OS === 'ios' 
      ? PERMISSIONS.IOS.LOCATION_WHEN_IN_USE 
      : PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION;

    return this.requestPermission(permission, 'Location access is required for indoor navigation');
  }

  /**
   * Request all required permissions
   */
  async requestAllPermissions(): Promise<{
    camera: PermissionStatus;
    location: PermissionStatus;
    allGranted: boolean;
  }> {
    try {
      console.log('Requesting all permissions...');
      
      // Check current status first
      const currentStatus = await this.getPermissionStatus();
      console.log('Current permission status:', currentStatus);
      
      const camera = await this.requestCameraPermission();
      const location = await this.requestLocationPermission();
      
      const result = {
        camera,
        location,
        allGranted: camera.granted && location.granted
      };
      
      console.log('Permission request result:', result);
      return result;
    } catch (error) {
      console.error('Error requesting permissions:', error);
      throw error;
    }
  }

  /**
   * Check if camera permission is granted
   */
  async checkCameraPermission(): Promise<boolean> {
    const permission = Platform.OS === 'ios' 
      ? PERMISSIONS.IOS.CAMERA 
      : PERMISSIONS.ANDROID.CAMERA;

    const result = await check(permission);
    return result === RESULTS.GRANTED;
  }

  /**
   * Check if location permission is granted
   */
  async checkLocationPermission(): Promise<boolean> {
    const permission = Platform.OS === 'ios' 
      ? PERMISSIONS.IOS.LOCATION_WHEN_IN_USE 
      : PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION;

    const result = await check(permission);
    return result === RESULTS.GRANTED;
  }

  /**
   * Generic permission request method
   */
  private async requestPermission(permission: Permission, message: string): Promise<PermissionStatus> {
    try {
      // Check current status
      const currentStatus = await check(permission);
      
      if (currentStatus === RESULTS.GRANTED) {
        return {
          granted: true,
          canAskAgain: true,
          status: currentStatus
        };
      }

      if (currentStatus === RESULTS.DENIED) {
        // Request permission
        const requestResult = await request(permission);
        
        if (requestResult === RESULTS.GRANTED) {
          return {
            granted: true,
            canAskAgain: true,
            status: requestResult
          };
        } else if (requestResult === RESULTS.BLOCKED) {
          this.showPermissionDeniedAlert(message);
          return {
            granted: false,
            canAskAgain: false,
            status: requestResult
          };
        } else {
          return {
            granted: false,
            canAskAgain: true,
            status: requestResult
          };
        }
      }

      if (currentStatus === RESULTS.BLOCKED) {
        this.showPermissionDeniedAlert(message);
        return {
          granted: false,
          canAskAgain: false,
          status: currentStatus
        };
      }

      return {
        granted: false,
        canAskAgain: true,
        status: currentStatus
      };

    } catch (error) {
      console.error('Permission request error:', error);
      return {
        granted: false,
        canAskAgain: false,
        status: 'error'
      };
    }
  }

  /**
   * Show alert when permission is permanently denied
   */
  private showPermissionDeniedAlert(message: string) {
    Alert.alert(
      'Permission Required',
      `${message}. Please enable it in Settings.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Open Settings', 
          onPress: () => Linking.openSettings() 
        }
      ]
    );
  }

  /**
   * Check if all required permissions are granted
   */
  async areAllPermissionsGranted(): Promise<boolean> {
    const camera = await this.checkCameraPermission();
    const location = await this.checkLocationPermission();
    return camera && location;
  }

  /**
   * Get permission status for all required permissions
   */
  async getPermissionStatus(): Promise<{
    camera: boolean;
    location: boolean;
    allGranted: boolean;
  }> {
    const camera = await this.checkCameraPermission();
    const location = await this.checkLocationPermission();
    
    return {
      camera,
      location,
      allGranted: camera && location
    };
  }
}

export default PermissionService;
