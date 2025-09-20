import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { User, Building, AuditRoute, POI } from '../types';

// API Configuration
const API_BASE_URL = 'http://167.99.236.54:9000/api'; // Your server IP

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// JWT Interceptor
api.interceptors.request.use(
  async (config) => {
    const token = await AsyncStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response Interceptor for token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Token expired, redirect to login
      await AsyncStorage.removeItem('access_token');
      await AsyncStorage.removeItem('user');
      // You can add navigation logic here
    }
    return Promise.reject(error);
  }
);

// Authentication API
export const authAPI = {
  login: async (username: string, password: string): Promise<{ user: User; status: string; message: string }> => {
    const response = await api.post('/user/login', { username, password });
    return response.data;
  },

  validateToken: async (): Promise<boolean> => {
    try {
      const response = await api.post('/user/refresh', {});
      return response.status === 200;
    } catch {
      return false;
    }
  },

  logout: async (): Promise<void> => {
    try {
      // Clear local storage on logout
      await AsyncStorage.multiRemove(['access_token', 'user']);
    } catch (error) {
      console.log('Logout error:', error);
    }
  },
};

// User API
export const userAPI = {
  getProfile: async (): Promise<User> => {
    const response = await api.post('/user/refresh', {});
    return response.data.user;
  },
};

// Audit API
export const auditAPI = {
  getRoutes: async (): Promise<{ routes: AuditRoute[] }> => {
    const response = await api.get('/auditor/routes');
    return response.data;
  },

  getRoute: async (routeId: string): Promise<AuditRoute> => {
    const response = await api.get(`/auditor/route/${routeId}`);
    return response.data;
  },

  updateRoute: async (routeId: string, routeData: any): Promise<AuditRoute> => {
    const response = await api.put(`/auditor/route/${routeId}`, routeData);
    return response.data;
  },

  getTechnicians: async (): Promise<any[]> => {
    const response = await api.get('/auditor/technicians');
    return response.data;
  },

  // Essential audit session endpoints
  startAuditSession: async (routeId: string): Promise<{ sessionId: string; status: string; route: any }> => {
    const response = await api.post('/auditor/session/start', { route_id: routeId });
    return response.data;
  },

  getAuditSession: async (sessionId: string): Promise<{ 
    session_id: string; 
    route_id: string; 
    auditor_id: string; 
    session_status: string; 
    started_at: string; 
    ended_at: string; 
    completed_pois: string[]; 
    total_pois: number; 
    last_updated: string; 
  }> => {
    const response = await api.get(`/auditor/session/${sessionId}`);
    return response.data;
  },

  submitPOIAudit: async (sessionId: string, poiId: string, auditData: any): Promise<{ status: string }> => {
    const response = await api.post('/auditor/poi/audit', { 
      session_id: sessionId, 
      poi_id: poiId, 
      ...auditData 
    });
    return response.data;
  },

  endAuditSession: async (sessionId: string): Promise<{ status: string }> => {
    const response = await api.post('/auditor/session/end', { session_id: sessionId });
    return response.data;
  },
};

// Building API
export const buildingAPI = {
  getBuildings: async (): Promise<{ spaces: Building[] }> => {
    const response = await api.post('/auth/mapping/space/accessible', {});
    return response.data;
  },

  getBuilding: async (buildingId: string): Promise<Building> => {
    const response = await api.post('/mapping/space/get', { bu_code: buildingId });
    return response.data;
  },
};

// POI API
export const poiAPI = {
  getPOIsByBuilding: async (buildingId: string, floorNumber?: string): Promise<{ pois: POI[] }> => {
    const response = await api.post('/mapping/pois/space/all', { 
      buid: buildingId,
      floor_number: floorNumber 
    });
    return response.data;
  },

  getPOI: async (poiId: string): Promise<POI> => {
    const response = await api.get(`/mapping/poi/get/${poiId}`);
    return response.data;
  },
};

// Floor Plan API
export const floorPlanAPI = {
  getFloorPlan: async (buildingId: string, floorNumber: string): Promise<{ 
    floor_plan_base64_data: string;
    bottom_left_lat: number;
    bottom_left_lng: number;
    top_right_lat: number;
    top_right_lng: number;
    zoom: number;
  }> => {
    try {
      // First get floor data with coordinates
      const floorResponse = await api.post('/mapping/floor/all', { buid: buildingId });
      const floors = floorResponse.data.floors || [];
      const floorData = floors.find((floor: any) => floor.floor_number === floorNumber);
      
      // If no floor data found, try to get the floorplan anyway with mock coordinates
      if (!floorData) {
        console.warn(`Floor ${floorNumber} not found for building ${buildingId}, trying to load floorplan with mock coordinates`);
        
        try {
          // Get the floorplan image
          const response = await api.post(`/floorplans64/${buildingId}/${floorNumber}`, {}, {
            responseType: 'arraybuffer', // Handle binary data
            headers: {
              'Accept-Encoding': 'gzip',
            }
          });
          
          // Convert ArrayBuffer to Base64 using a simple method
          const uint8Array = new Uint8Array(response.data);
          let binary = '';
          const chunkSize = 1024; // Process in smaller chunks
          for (let i = 0; i < uint8Array.length; i += chunkSize) {
            const chunk = uint8Array.slice(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, Array.from(chunk));
          }
          const base64 = btoa(binary);
          
          // Use mock coordinates around the building center (ensure proper ordering)
          // Use coordinates that match the actual region (Pakistan)
          const coordinates = {
            bottom_left_lat: 31.514, // Southwest corner (smaller lat/lng)
            bottom_left_lng: 74.296,
            top_right_lat: 31.515,   // Northeast corner (larger lat/lng)
            top_right_lng: 74.298,
            zoom: 19,
          };
          
          console.log(`Floorplan loaded with mock coordinates for building ${buildingId}, floor ${floorNumber}:`, coordinates);
          
          return {
            floor_plan_base64_data: base64,
            ...coordinates,
          };
        } catch (floorplanError: any) {
          if (floorplanError.response?.status === 400) {
            console.warn(`Floorplan not available for building ${buildingId}, floor ${floorNumber}`);
            throw new Error(`Floorplan not available for this building/floor`);
          }
          throw floorplanError;
        }
      }
      
      // Get the floorplan image
      try {
        const response = await api.post(`/floorplans64/${buildingId}/${floorNumber}`, {}, {
          responseType: 'arraybuffer', // Handle binary data
          headers: {
            'Accept-Encoding': 'gzip',
          }
        });
        
        // Convert ArrayBuffer to Base64 using a simple method
        const uint8Array = new Uint8Array(response.data);
        let binary = '';
        const chunkSize = 1024; // Process in smaller chunks
        for (let i = 0; i < uint8Array.length; i += chunkSize) {
          const chunk = uint8Array.slice(i, i + chunkSize);
          binary += String.fromCharCode.apply(null, Array.from(chunk));
        }
        const base64 = btoa(binary);
        
        // Use floor data coordinates - the database labels are swapped
        // What's labeled as "bottom_left" is actually the top-right corner
        const dbBottomLeftLat = parseFloat(floorData.bottom_left_lat || '0');
        const dbBottomLeftLng = parseFloat(floorData.bottom_left_lng || '0');
        const dbTopRightLat = parseFloat(floorData.top_right_lat || '0');
        const dbTopRightLng = parseFloat(floorData.top_right_lng || '0');
        
        // Swap the coordinates since database labels are inverted
        const actualBottomLeftLat = Math.min(dbBottomLeftLat, dbTopRightLat);
        const actualBottomLeftLng = Math.min(dbBottomLeftLng, dbTopRightLng);
        const actualTopRightLat = Math.max(dbBottomLeftLat, dbTopRightLat);
        const actualTopRightLng = Math.max(dbBottomLeftLng, dbTopRightLng);
        
        const coordinates = {
          bottom_left_lat: actualBottomLeftLat,
          bottom_left_lng: actualBottomLeftLng,
          top_right_lat: actualTopRightLat,
          top_right_lng: actualTopRightLng,
          zoom: parseInt(floorData.zoom || '1'),
        };
        
        console.log(`Floorplan loaded for building ${buildingId}, floor ${floorNumber}:`, {
          database_labels: {
            bottom_left_lat: floorData.bottom_left_lat,
            bottom_left_lng: floorData.bottom_left_lng,
            top_right_lat: floorData.top_right_lat,
            top_right_lng: floorData.top_right_lng,
          },
          actual_coordinates: {
            southwest: { lat: actualBottomLeftLat, lng: actualBottomLeftLng },
            northeast: { lat: actualTopRightLat, lng: actualTopRightLng }
          },
          validation: {
            lat_ordered: actualBottomLeftLat < actualTopRightLat,
            lng_ordered: actualBottomLeftLng < actualTopRightLng
          }
        });
        
        // Check for coordinate mismatch - floorplan coordinates should be reasonable
        // This prevents loading floorplans with invalid coordinates (0,0 or extreme values)
        const isInvalidCoordinates = actualBottomLeftLat === 0 || actualBottomLeftLng === 0 || 
                                   actualTopRightLat === 0 || actualTopRightLng === 0 ||
                                   Math.abs(actualBottomLeftLat) > 90 || Math.abs(actualBottomLeftLng) > 180;
        if (isInvalidCoordinates) {
          console.warn('Invalid floorplan coordinates detected');
          console.warn('Floorplan coordinates:', { 
            southwest: { lat: actualBottomLeftLat, lng: actualBottomLeftLng },
            northeast: { lat: actualTopRightLat, lng: actualTopRightLng }
          });
          throw new Error('Invalid floorplan coordinates: coordinates are invalid or extreme');
        }
        
        return {
          floor_plan_base64_data: base64,
          ...coordinates,
        };
      } catch (floorplanError: any) {
        if (floorplanError.response?.status === 400) {
          console.warn(`Floorplan not available for building ${buildingId}, floor ${floorNumber}`);
          throw new Error(`Floorplan not available for this building/floor`);
        }
        throw floorplanError;
      }
    } catch (error) {
      console.error('Error loading floorplan:', error);
      throw error;
    }
  },

  getFloors: async (buildingId: string): Promise<{ floors: any[] }> => {
    const response = await api.post('/mapping/floor/all', { buid: buildingId });
    return response.data;
  },
};

export default api;
