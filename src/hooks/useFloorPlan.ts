import { useState, useEffect, useCallback } from 'react';
import { floorPlanAPI } from '../services/api';
import { FloorPlan } from '../types';

interface UseFloorPlanReturn {
  floorPlan: FloorPlan | null;
  loading: boolean;
  error: string | null;
  loadFloorPlan: (buildingId: string, floorNumber: string) => Promise<void>;
  clearFloorPlan: () => void;
}

export const useFloorPlan = (): UseFloorPlanReturn => {
  const [floorPlan, setFloorPlan] = useState<FloorPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFloorPlan = useCallback(async (buildingId: string, floorNumber: string) => {
    if (!buildingId || !floorNumber) {
      setError('Building ID and floor number are required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await floorPlanAPI.getFloorPlan(buildingId, floorNumber);
      
      const floorPlanData: FloorPlan = {
        fuid: `${buildingId}_${floorNumber}`,
        buid: buildingId,
        floor_number: floorNumber,
        floor_name: floorNumber,
        is_published: true,
        bottom_left_lat: data.bottom_left_lat,
        bottom_left_lng: data.bottom_left_lng,
        top_right_lat: data.top_right_lat,
        top_right_lng: data.top_right_lng,
        zoom: data.zoom,
        floor_plan_base64_data: data.floor_plan_base64_data,
      };

      setFloorPlan(floorPlanData);
    } catch (err) {
      console.error('Error loading floorplan:', err);
      setError(err instanceof Error ? err.message : 'Failed to load floorplan');
      setFloorPlan(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearFloorPlan = useCallback(() => {
    setFloorPlan(null);
    setError(null);
  }, []);

  return {
    floorPlan,
    loading,
    error,
    loadFloorPlan,
    clearFloorPlan,
  };
};
