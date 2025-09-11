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
  startAuditSession: async (routeId: string): Promise<{ sessionId: string; status: string }> => {
    const response = await api.post('/auditor/session/start', { route_id: routeId });
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
    const response = await api.post(`/floorplans64/${buildingId}/${floorNumber}`, {});
    return response.data;
  },

  getFloors: async (buildingId: string): Promise<{ floors: any[] }> => {
    const response = await api.post('/mapping/floor/all', { buid: buildingId });
    return response.data;
  },
};

export default api;
