export interface User {
  id?: string; 
  username: string;
  name: string;
  email: string;
  role: 'technician' | 'admin' | 'auditor' | 'planner';
  access_token: string;
  owner_id: string;
  type?: string;
  external?: string;
  
  assigned_buildings?: string[];
  can_start_audit?: boolean;
  can_edit_poi?: boolean;
}

export interface POI {
  id: string;
  puid?: string; 
  name: string;
  title?: string; 
  type: string;
  floor: number;
  floor_number?: string; 
  latitude: number;
  longitude: number;
  coordinates?: {
    latitude: number;
    longitude: number;
  } | {
    lat: number;
    lon: number;
  } | any; // Allow any structure for flexibility
  description?: string;
  status: 'pending' | 'completed' | 'skipped';
  buildingId: string;
  order?: number; 
  
  coordinates_lat?: string | number;
  coordinates_lon?: string | number;
  pois_type?: string;
  buid?: string;
  floor_name?: string;
  is_building_entrance?: string;
  is_door?: string;
  is_published?: string;
  image?: string;
  link?: string;
  manufacturer?: string;
  modelNumber?: string;
  price?: string;
  purchaseDate?: string;
  quantity?: string;
  serialNumber?: string;
  tags?: string;
  warranty?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuditRoute {
  id?: string; 
  _id?: string; 
  name: string;
  buildingId?: string;
  buildingName?: string;
  bu_code?: string; 
  building_id?: string; 
  floorNumbers?: number[];
  totalPOIs?: number;
  completedPOIs?: number;
  assignedTechnicianId?: string;
  assigned_auditors?: string[];
  assigned_auditor?: string;
  status: 'assigned' | 'in_progress' | 'completed';
  createdAt?: string;
  updatedAt?: string;
  created_by?: string;
  
  route_name?: string;
  building_code?: string;
  floors?: number[];
  pois_count?: number;
  completed_pois?: number;
  description?: string;
  estimated_time?: number;
  optimization_method?: string;
  
  pois?: POI[];
}

export interface AuditSession {
  id: string;
  routeId: string;
  technicianId: string;
  startTime: string;
  endTime?: string;
  currentPOI?: string;
  steps: number;
  status: 'active' | 'completed' | 'paused';
}

export interface POIAuditData {
  poiId: string;
  status: 'completed' | 'skipped' | 'pending';
  notes?: string;
  imageUrl?: string;
  timestamp: string;
  technicianId: string;
}

export interface AuditProgress {
  totalPOIs: number;
  completedPOIs: number;
  skippedPOIs: number;
  currentPOI?: string;
  estimatedTimeRemaining?: number;
}

export interface Building {
  id?: string; 
  bu_code?: string; 
  name: string;
  description?: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  floors?: (number | string)[]; 
  accessible?: boolean;
  // Server fields
  bu_name?: string;
  bu_description?: string;
  bu_lat?: number;
  bu_lng?: number;
  bu_floors?: (number | string)[]; 
}

export interface FloorPlan {
  fuid: string;
  buid: string;
  floor_number: string;
  floor_name: string;
  description?: string;
  is_published: boolean;
  bottom_left_lat: number;
  bottom_left_lng: number;
  top_right_lat: number;
  top_right_lng: number;
  zoom: number;
  floor_plan_base64_data?: string;
}
