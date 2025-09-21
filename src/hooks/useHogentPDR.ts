import { useState, useEffect, useRef, useCallback } from 'react';
import { HogentPDRService, HogentPDRPosition } from '../services/pdr/HogentPDRService';

export interface UseHogentPDRReturn {
  // PDR State
  isTracking: boolean;
  currentPosition: HogentPDRPosition;
  stepCount: number;
  pathHistory: HogentPDRPosition[];
  
  // PDR Controls
  startTracking: () => Promise<void>;
  stopTracking: () => void;
  calibratePosition: (x: number, y: number, heading?: number) => void;
  reset: () => void;
  initializeBuilding: (building: any, pois: any[]) => Promise<void>;
  
  // Utility functions
  toLatLng: (x: number, y: number) => { latitude: number; longitude: number };
  toLocal: (latitude: number, longitude: number) => { x: number; y: number };
}

export function useHogentPDR(): UseHogentPDRReturn {
  // PDR Service instance
  const pdrServiceRef = useRef<HogentPDRService | null>(null);
  
  // State
  const [isTracking, setIsTracking] = useState(false);
  const [currentPosition, setCurrentPosition] = useState<HogentPDRPosition>({
    x: 0,
    y: 0,
    heading: 0,
    confidence: 0,
    timestamp: Date.now(),
    stepCount: 0,
    accuracy: 0
  });
  const [stepCount, setStepCount] = useState(0);
  const [pathHistory, setPathHistory] = useState<HogentPDRPosition[]>([]);

  // Initialize PDR service
  useEffect(() => {
    if (!pdrServiceRef.current) {
      pdrServiceRef.current = new HogentPDRService();
      
      // Set up callbacks
      pdrServiceRef.current.setOnPositionUpdate((position) => {
        setCurrentPosition(position);
        setStepCount(position.stepCount);
        setPathHistory(prev => [...prev, position]);
      });

      pdrServiceRef.current.setOnStepDetected((count) => {
        setStepCount(count);
      });
    }

    return () => {
      if (pdrServiceRef.current) {
        pdrServiceRef.current.stopTracking();
      }
    };
  }, []);

  // PDR Controls
  const startTracking = useCallback(async () => {
    if (pdrServiceRef.current && !isTracking) {
      try {
        pdrServiceRef.current.startTracking();
        setIsTracking(true);
      } catch (error) {
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

  const initializeBuilding = useCallback(async (building: any, pois: any[]) => {
    if (pdrServiceRef.current) {
      await pdrServiceRef.current.initializeBuilding(building, pois);
    }
  }, []);

  // Utility functions
  const toLatLng = useCallback((x: number, y: number) => {
    return pdrServiceRef.current?.toLatLng(x, y) || { latitude: 0, longitude: 0 };
  }, []);

  const toLocal = useCallback((latitude: number, longitude: number) => {
    return pdrServiceRef.current?.toLocal(latitude, longitude) || { x: 0, y: 0 };
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
    toLocal
  };
}