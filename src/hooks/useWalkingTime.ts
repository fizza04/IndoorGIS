import { useState, useEffect } from 'react';

interface WalkingTimeState {
  walkingStartTime: Date | null;
  lastPOICompletionTime: Date | null;
  currentWalkingTime: number;
  isWalking: boolean;
}

interface WalkingTimeActions {
  setWalkingStartTime: (time: Date | null) => void;
  setLastPOICompletionTime: (time: Date | null) => void;
  setCurrentWalkingTime: (time: number) => void;
  setIsWalking: (walking: boolean) => void;
  resetWalkingTime: () => void;
  updateWalkingTimeForPOI: () => void;
}

/**
 * Hook for managing walking time tracking
 */
export const useWalkingTime = (
  isPDRTracking: boolean,
  pdrPosition: any,
  auditSession: any
): WalkingTimeState & WalkingTimeActions => {
  const [walkingStartTime, setWalkingStartTime] = useState<Date | null>(null);
  const [lastPOICompletionTime, setLastPOICompletionTime] = useState<Date | null>(null);
  const [currentWalkingTime, setCurrentWalkingTime] = useState<number>(0);
  const [isWalking, setIsWalking] = useState(false);

  // Walking time tracking - detect movement and track time
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (isPDRTracking && pdrPosition && auditSession?.session_status === 'active') {
      // Start tracking walking time when PDR is active and user is moving
      if (!walkingStartTime) {
        setWalkingStartTime(new Date());
        setIsWalking(true);
      }
      
      // Update current walking time every second
      interval = setInterval(() => {
        if (walkingStartTime) {
          const now = new Date();
          const walkingTime = Math.floor((now.getTime() - walkingStartTime.getTime()) / 1000);
          setCurrentWalkingTime(walkingTime);
        }
      }, 1000);
    } else {
      // Stop tracking when PDR is not active
      if (walkingStartTime) {
        setWalkingStartTime(null);
        setIsWalking(false);
        setCurrentWalkingTime(0);
      }
    }
    
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [isPDRTracking, pdrPosition, auditSession?.session_status, walkingStartTime]);

  const resetWalkingTime = () => {
    setWalkingStartTime(null);
    setLastPOICompletionTime(null);
    setCurrentWalkingTime(0);
    setIsWalking(false);
  };

  const updateWalkingTimeForPOI = () => {
    setLastPOICompletionTime(new Date());
    setWalkingStartTime(new Date()); // Reset for next POI
  };

  return {
    walkingStartTime,
    lastPOICompletionTime,
    currentWalkingTime,
    isWalking,
    setWalkingStartTime,
    setLastPOICompletionTime,
    setCurrentWalkingTime,
    setIsWalking,
    resetWalkingTime,
    updateWalkingTimeForPOI,
  };
};
