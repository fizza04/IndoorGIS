import { useState, useEffect, useRef, useCallback } from 'react';
import { SmartPDRService, PDRPosition, PDRConfig } from '../services/pdr/SmartPDRService';

export interface UseSmartPDRConfig extends PDRConfig {
  enableAutoStart?: boolean;
  enablePathTracking?: boolean;
  onPositionUpdate?: (position: PDRPosition) => void;
  onStepDetected?: (stepCount: number) => void;
  onDriftDetected?: () => void;
}

export interface UseSmartPDRReturn {
  // PDR State
  isTracking: boolean;
  currentPosition: PDRPosition;
  stepCount: number;
  pathHistory: Array<{ x: number; y: number; timestamp: number }>;
  
  // PDR Controls
  startTracking: () => Promise<void>;
  stopTracking: () => void;
  calibratePosition: (x: number, y: number, heading?: number) => void;
  reset: () => void;
  initializeBuilding: (building: any, pois: any[]) => void;
  
  // Utility functions
  toLatLng: (x: number, y: number) => { latitude: number; longitude: number };
  toLocal: (latitude: number, longitude: number) => { x: number; y: number };
  exportPathData: () => string;
}

export function useSmartPDR(config: UseSmartPDRConfig = {}): UseSmartPDRReturn {
  // Default configuration
  const defaultConfig: PDRConfig = {
    stepLength: 0.7, // 70cm per step
    updateInterval: 100, // 100ms
    enableDriftCorrection: true,
    coordinateSystem: 'local',
    ...config
  };

  // PDR Service instance
  const pdrServiceRef = useRef<SmartPDRService | null>(null);
  
  // State
  const [isTracking, setIsTracking] = useState(false);
  const [currentPosition, setCurrentPosition] = useState<PDRPosition>({
    x: 0,
    y: 0,
    heading: 0,
    confidence: 0,
    timestamp: Date.now(),
    stepCount: 0,
    accuracy: 0
  });
  const [stepCount, setStepCount] = useState(0);
  const [pathHistory, setPathHistory] = useState<Array<{ x: number; y: number; timestamp: number }>>([]);

  // Initialize PDR service
  useEffect(() => {
    if (!pdrServiceRef.current) {
      pdrServiceRef.current = new SmartPDRService(defaultConfig);
      
      // Set up callbacks
      pdrServiceRef.current.setOnPositionUpdate((position) => {
        setCurrentPosition(position);
        setStepCount(position.stepCount);
        config.onPositionUpdate?.(position);
      });

      pdrServiceRef.current.setOnStepDetected((count) => {
        setStepCount(count);
        config.onStepDetected?.(count);
      });

      pdrServiceRef.current.setOnDriftDetected(() => {
        config.onDriftDetected?.();
      });
    }

    return () => {
      if (pdrServiceRef.current) {
        pdrServiceRef.current.stopTracking();
      }
    };
  }, []);

  // Update path history when position changes
  useEffect(() => {
    if (config.enablePathTracking !== false && pdrServiceRef.current) {
      const newPathHistory = pdrServiceRef.current.getPathHistory();
      setPathHistory(newPathHistory);
    }
  }, [currentPosition, config.enablePathTracking]);

  // Auto-start if enabled
  useEffect(() => {
    if (config.enableAutoStart && pdrServiceRef.current && !isTracking) {
      startTracking();
    }
  }, [config.enableAutoStart]);

  // PDR Controls
  const startTracking = useCallback(async () => {
    if (pdrServiceRef.current && !isTracking) {
      try {
        await pdrServiceRef.current.startTracking();
        setIsTracking(true);
      } catch (error) {
        console.error('Failed to start PDR tracking:', error);
      }
    }
  }, [isTracking]);

  const stopTracking = useCallback(() => {
    if (pdrServiceRef.current && isTracking) {
      pdrServiceRef.current.stopTracking();
      setIsTracking(false);
    }
  }, [isTracking]);

  const calibratePosition = useCallback((x: number, y: number, heading?: number) => {
    if (pdrServiceRef.current) {
      pdrServiceRef.current.calibratePosition(x, y, heading);
    }
  }, []);

  const reset = useCallback(() => {
    if (pdrServiceRef.current) {
      pdrServiceRef.current.reset();
      setCurrentPosition({
        x: 0,
        y: 0,
        heading: 0,
        confidence: 0,
        timestamp: Date.now(),
        stepCount: 0,
        accuracy: 0
      });
      setStepCount(0);
      setPathHistory([]);
      setIsTracking(false);
    }
  }, []);

  const initializeBuilding = useCallback((building: any, pois: any[]) => {
    if (pdrServiceRef.current) {
      pdrServiceRef.current.initializeBuilding(building, pois);
    }
  }, []);

  // Utility functions
  const toLatLng = useCallback((x: number, y: number) => {
    return pdrServiceRef.current?.toLatLng(x, y) || { latitude: 0, longitude: 0 };
  }, []);

  const toLocal = useCallback((latitude: number, longitude: number) => {
    return pdrServiceRef.current?.toLocal(latitude, longitude) || { x: 0, y: 0 };
  }, []);

  const exportPathData = useCallback(() => {
    return pdrServiceRef.current?.exportPathData() || '{}';
  }, []);

  return {
    // PDR State
    isTracking,
    currentPosition,
    stepCount,
    pathHistory,
    
    // PDR Controls
    startTracking,
    stopTracking,
    calibratePosition,
    reset,
    initializeBuilding,
    
    // Utility functions
    toLatLng,
    toLocal,
    exportPathData
  };
}