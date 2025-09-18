import { Platform, PermissionsAndroid, Alert } from 'react-native';

export interface PermissionResult {
  granted: boolean;
  message?: string;
}

export class AndroidPermissions {
  /**
   * Request all required permissions for PDR functionality
   */
  static async requestAllPermissions(): Promise<PermissionResult> {
    if (Platform.OS !== 'android') {
      return { granted: true };
    }

    try {
      // Core permissions that are always available
      const corePermissions = [
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
        PermissionsAndroid.PERMISSIONS.CAMERA,
      ];

      // Optional permissions that might not be available on all devices
      const optionalPermissions = [
        PermissionsAndroid.PERMISSIONS.VIBRATE,
        PermissionsAndroid.PERMISSIONS.WAKE_LOCK,
        PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
        PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
      ];

      // Sensor permissions for Android 6.0+ (API 23+)
      const sensorPermissions = [];
      if (Platform.Version >= 23) {
        if (PermissionsAndroid.PERMISSIONS.BODY_SENSORS) {
          sensorPermissions.push(PermissionsAndroid.PERMISSIONS.BODY_SENSORS);
        }
        if (PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION) {
          sensorPermissions.push(PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION);
        }
      }

      const allPermissions = [...corePermissions, ...optionalPermissions, ...sensorPermissions];
      const results: { [key: string]: string } = {};
      
      // Request permissions with delay to avoid overwhelming the system
      for (let i = 0; i < allPermissions.length; i++) {
        const permission = allPermissions[i];
        
        // Skip undefined permissions
        if (!permission) {
          console.warn(`Skipping undefined permission at index ${i}`);
          continue;
        }

        try {
          console.log(`Requesting permission: ${permission}`);
          const result = await PermissionsAndroid.request(permission);
          results[permission] = result;
          console.log(`Permission ${permission}: ${result}`);
          
          // Add small delay between requests
          if (i < allPermissions.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        } catch (error) {
          console.warn(`Failed to request permission ${permission}:`, error);
          results[permission] = PermissionsAndroid.RESULTS.DENIED;
        }
      }
      
      // Check if core permissions are granted
      const coreGranted = corePermissions.every(permission => 
        results[permission] === PermissionsAndroid.RESULTS.GRANTED
      );

      if (!coreGranted) {
        const deniedCorePermissions = corePermissions.filter(permission => 
          results[permission] !== PermissionsAndroid.RESULTS.GRANTED
        );

        return {
          granted: false,
          message: `Core permissions denied: ${deniedCorePermissions.join(', ')}`
        };
      }

      // Check optional permissions
      const optionalGranted = optionalPermissions.filter(permission => 
        results[permission] === PermissionsAndroid.RESULTS.GRANTED
      ).length;

      const sensorGranted = sensorPermissions.filter(permission => 
        results[permission] === PermissionsAndroid.RESULTS.GRANTED
      ).length;

      console.log(`Core permissions: ${coreGranted ? 'GRANTED' : 'DENIED'}`);
      console.log(`Optional permissions: ${optionalGranted}/${optionalPermissions.length} granted`);
      console.log(`Sensor permissions: ${sensorGranted}/${sensorPermissions.length} granted`);

      return { granted: true };
    } catch (error) {
      console.error('Error requesting permissions:', error);
      return {
        granted: false,
        message: `Failed to request permissions: ${error}`
      };
    }
  }

  /**
   * Check if all required permissions are granted
   */
  static async checkAllPermissions(): Promise<PermissionResult> {
    if (Platform.OS !== 'android') {
      return { granted: true };
    }

    try {
      // Core permissions that are always available
      const corePermissions = [
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
        PermissionsAndroid.PERMISSIONS.CAMERA,
      ];

      // Optional permissions that might not be available on all devices
      const optionalPermissions = [
        PermissionsAndroid.PERMISSIONS.VIBRATE,
        PermissionsAndroid.PERMISSIONS.WAKE_LOCK,
        PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
        PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
      ];

      // Sensor permissions for Android 6.0+ (API 23+)
      const sensorPermissions = [];
      if (Platform.Version >= 23) {
        if (PermissionsAndroid.PERMISSIONS.BODY_SENSORS) {
          sensorPermissions.push(PermissionsAndroid.PERMISSIONS.BODY_SENSORS);
        }
        if (PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION) {
          sensorPermissions.push(PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION);
        }
      }

      const allPermissions = [...corePermissions, ...optionalPermissions, ...sensorPermissions];
      const results: { [key: string]: boolean } = {};
      
      // Check permissions individually
      for (const permission of allPermissions) {
        // Skip undefined permissions
        if (!permission) {
          console.warn(`Skipping undefined permission`);
          continue;
        }

        try {
          results[permission] = await PermissionsAndroid.check(permission);
        } catch (error) {
          console.warn(`Failed to check permission ${permission}:`, error);
          results[permission] = false;
        }
      }
      
      // Check if core permissions are granted
      const coreGranted = corePermissions.every(permission => 
        results[permission] === true
      );

      if (!coreGranted) {
        const deniedCorePermissions = corePermissions.filter(permission => 
          results[permission] !== true
        );

        return {
          granted: false,
          message: `Missing core permissions: ${deniedCorePermissions.join(', ')}`
        };
      }

      return { granted: true };
    } catch (error) {
      console.error('Error checking permissions:', error);
      return {
        granted: false,
        message: `Failed to check permissions: ${error}`
      };
    }
  }

  /**
   * Show permission explanation dialog
   */
  static showPermissionExplanation(): void {
    Alert.alert(
      'Permissions Required',
      'This app needs access to your device sensors (accelerometer, gyroscope, magnetometer) and location services to provide accurate indoor navigation. Please grant all permissions for the best experience.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Grant Permissions', onPress: () => this.requestAllPermissions() }
      ]
    );
  }

  /**
   * Check and request permissions with user-friendly flow
   */
  static async ensurePermissions(): Promise<boolean> {
    const checkResult = await this.checkAllPermissions();
    
    if (checkResult.granted) {
      return true;
    }

    // Show explanation if permissions are missing
    this.showPermissionExplanation();
    
    const requestResult = await this.requestAllPermissions();
    
    if (!requestResult.granted) {
      console.warn('Some permissions not granted:', requestResult.message);
      // Don't show alert, just log the warning
      // The app can still function with basic permissions
    }

    return requestResult.granted;
  }

  /**
   * Request only essential permissions for PDR
   */
  static async requestEssentialPermissions(): Promise<PermissionResult> {
    if (Platform.OS !== 'android') {
      return { granted: true };
    }

    try {
      // Only request the most essential permissions
      const essentialPermissions = [
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
        PermissionsAndroid.PERMISSIONS.CAMERA,
      ];

      const results: { [key: string]: string } = {};
      
      for (let i = 0; i < essentialPermissions.length; i++) {
        const permission = essentialPermissions[i];
        
        if (!permission) {
          console.warn(`Skipping undefined permission at index ${i}`);
          continue;
        }

        try {
          console.log(`Requesting essential permission: ${permission}`);
          const result = await PermissionsAndroid.request(permission);
          results[permission] = result;
          console.log(`Essential permission ${permission}: ${result}`);
          
          // Add delay between requests
          if (i < essentialPermissions.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (error) {
          console.warn(`Failed to request essential permission ${permission}:`, error);
          results[permission] = PermissionsAndroid.RESULTS.DENIED;
        }
      }
      
      // Check if essential permissions are granted
      const essentialGranted = essentialPermissions.every(permission => 
        results[permission] === PermissionsAndroid.RESULTS.GRANTED
      );

      if (!essentialGranted) {
        const deniedPermissions = essentialPermissions.filter(permission => 
          results[permission] !== PermissionsAndroid.RESULTS.GRANTED
        );

        return {
          granted: false,
          message: `Essential permissions denied: ${deniedPermissions.join(', ')}`
        };
      }

      return { granted: true };
    } catch (error) {
      console.error('Error requesting essential permissions:', error);
      return {
        granted: false,
        message: `Failed to request essential permissions: ${error}`
      };
    }
  }
}
