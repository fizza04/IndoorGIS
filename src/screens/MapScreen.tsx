import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  SafeAreaView,
  Platform,
  Animated,
} from 'react-native';
import MapView, {
  Marker,
  PROVIDER_DEFAULT,
  Polyline,
  AnimatedRegion,
} from 'react-native-maps';
import { useAuth } from '../contexts/AuthContext';
import { buildingAPI, auditAPI, poiAPI, floorPlanAPI } from '../services/api';
import { Building, POI, AuditRoute } from '../types';
import QRAnchorService, { QRAnchor } from '../services/anchors/QRAnchorService';
import NavigationService, {
  NavigationState,
} from '../services/navigation/NavigationService';
import QRScanner from '../components/QRScanner';
import InspectionForm, { InspectionData } from '../components/InspectionForm';
import { useHogentPDR } from '../hooks/useHogentPDR';
import { useFloorPlan } from '../hooks/useFloorPlan';
import { HogentPDRPosition } from '../services/pdr/HogentPDRService';
import { AndroidPermissions } from '../utils/AndroidPermissions';
import FloorPlanOverlay from '../components/FloorPlanOverlay';
import CompassNeedleMarker from '../components/CompassNeedleMarker';

interface MapScreenProps {
  navigation: {
    navigate: (screen: string, params?: any) => void;
    goBack: () => void;
  };
  route?: {
    params?: {
      selectedRoute?: AuditRoute;
      auditSession?: boolean;
    };
  };
}

const DEFAULT_COORDINATES = {
  latitude: 0, // No default location - will be set by first building
  longitude: 0,
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};

const MapScreen: React.FC<MapScreenProps> = ({ navigation, route }) => {
  const { user } = useAuth();
  const mapRef = useRef<MapView>(null);

  // Core State
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [selectedBuilding, setSelectedBuilding] = useState<Building | null>(
    null,
  );
  const [selectedFloor, setSelectedFloor] = useState<string>('');
  
  // Floorplan state
  const { floorPlan, loading: floorPlanLoading, error: floorPlanError, loadFloorPlan, clearFloorPlan } = useFloorPlan();
  
  // PDR starting position (first POI coordinates)
  const [pdrStartPosition, setPdrStartPosition] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  const [auditRoutes, setAuditRoutes] = useState<AuditRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<AuditRoute | null>(null);
  const [pois, setPois] = useState<POI[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Navigation State
  const [navigationState, setNavigationState] =
    useState<NavigationState | null>(null);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [currentPOIIndex, setCurrentPOIIndex] = useState(0);
  const [isNavigating, setIsNavigating] = useState(false);
  const [completedPOIs, setCompletedPOIs] = useState<Set<number>>(new Set());

  // Audit session state - fetched from backend
  const [auditSession, setAuditSession] = useState<{
    session_id: string;
    route_id: string;
    auditor_id: string;
    session_status: string;
    started_at: string;
    ended_at: string;
    completed_pois: string[];
    total_pois: number;
    last_updated: string;
  } | null>(null);
  const [showInspectionForm, setShowInspectionForm] = useState(false);
  const [currentInspectionPOI, setCurrentInspectionPOI] = useState<POI | null>(
    null,
  );
  // Live PDR Pointer using AnimatedRegion for smooth movement
  const [pdrAnimatedRegion, setPdrAnimatedRegion] =
    useState<AnimatedRegion | null>(null);
  const [isPdrPointerInitialized, setIsPdrPointerInitialized] = useState(false);

  // Hogent PDR - EXACT implementation
  const {
    isTracking: isPDRTracking,
    currentPosition: pdrPosition,
    stepCount,
    pathHistory,
    startTracking: startPDRTracking,
    stopTracking: stopPDRTracking,
    calibratePosition: calibratePDRPosition,
    reset: resetPDR,
    initializeBuilding: initializePDRBuilding,
    toLatLng,
    toLocal,
  } = useHogentPDR();

  // PDR Position Update Handler
  const handlePDRPositionUpdate = useCallback(
    (position: HogentPDRPosition) => {
      // Update animated region for smooth movement
      if (pdrAnimatedRegion && isPdrPointerInitialized) {
        const pdrCoords = toLatLng(position.x, position.y);

        if (pdrCoords.latitude !== 0 && pdrCoords.longitude !== 0) {
          pdrAnimatedRegion.setValue({
            latitude: pdrCoords.latitude,
            longitude: pdrCoords.longitude,
            latitudeDelta: 0.001,
            longitudeDelta: 0.001,
          });
        }
      }
    },
    [pdrAnimatedRegion, isPdrPointerInitialized, toLatLng],
  );

  // Services
  const qrService = useRef(new QRAnchorService());
  const navService = useRef(new NavigationService());

  const [region, setRegion] = useState(DEFAULT_COORDINATES);

  useEffect(() => {
    initializeMap();
    checkAndroidPermissions();
    
    return () => {
      // Cleanup is handled by the hook
    };
  }, [route?.params]);




  // Load floorplan when building and floor are selected
  useEffect(() => {
    if (selectedBuilding && selectedFloor) {
      const buildingId = selectedBuilding.id || selectedBuilding.bu_code;
      if (buildingId) {
        loadFloorPlan(buildingId, selectedFloor);
      }
    } else {
      clearFloorPlan();
    }
  }, [selectedBuilding, selectedFloor, loadFloorPlan, clearFloorPlan]);

  // Initialize PDR when POIs are loaded
  useEffect(() => {
    if (selectedBuilding && pois && pois.length > 0) {
      
      try {
        // Initialize Hogent PDR system
        initializePDRBuilding(selectedBuilding, pois);
        
        // Auto-start PDR tracking
        if (!isPDRTracking) {
          startPDRTracking();
        }
      } catch (error) {
        // Show user-friendly error message
        Alert.alert(
          'PDR Initialization Failed',
          'Unable to initialize positioning system. Please check that POIs have valid coordinates.',
          [{ text: 'OK' }]
        );
      }
    }
  }, [selectedBuilding, pois, initializePDRBuilding, startPDRTracking, isPDRTracking]);

  // Navigate to building when selected
  useEffect(() => {
    if (selectedBuilding && mapRef.current) {
      const lat = parseFloat(selectedBuilding.coordinates_lat || '0');
      const lng = parseFloat(selectedBuilding.coordinates_lng || '0');
      
      if (lat !== 0 && lng !== 0) {
        mapRef.current.animateToRegion({
          latitude: lat,
          longitude: lng,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }, 1000);
      }
    }
  }, [selectedBuilding]);

  // Auto-load floorplan when POIs are loaded (for audit routes)
  useEffect(() => {
    if (pois.length > 0 && selectedBuilding && !selectedFloor) {
      // Get floor from first POI
      const firstPOI = pois[0];
      const floorNumber = firstPOI.floor_number || firstPOI.floor || '1';
      
      setSelectedFloor(String(floorNumber));
      
      const buildingId = selectedBuilding.id || selectedBuilding.bu_code;
      if (buildingId) {
        loadFloorPlan(buildingId, String(floorNumber)).catch(error => {
          if (error.message.includes('Floorplan not available')) {
          } else {
          }
        });
      }
    }
  }, [pois, selectedBuilding, loadFloorPlan]);

  // Current location pin stays FIXED at POI coordinates - no useEffect needed

  const checkAndroidPermissions = async () => {
    if (Platform.OS === 'android') {
      const result = await AndroidPermissions.checkAllPermissions();
      if (!result.granted) {
      }
    }
  };

  const initializeMap = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load buildings
      const buildingsResponse = await buildingAPI.getBuildings();
      if (buildingsResponse?.spaces) {
        const mappedBuildings = buildingsResponse.spaces
          .map((building: any) => {
            const lat = parseFloat(
              building.bu_lat || building.coordinates_lat || building.lat,
            );
            const lng = parseFloat(
              building.bu_lng || building.coordinates_lon || building.lng,
            );

            return {
              id: building.buid || building.id || `building_${Date.now()}`,
              bu_code: building.bu_code || building.id,
              name: building.bu_name || building.name || 'Unknown Building',
              description:
                building.bu_description || building.description || '',
              coordinates:
                lat && lng && !isNaN(lat) && !isNaN(lng)
                  ? {
                      latitude: lat,
                      longitude: lng,
                    }
                  : null,
              floors: building.floors || building.bu_floors || [],
              total_floors: building.total_floors || 0,
              accessible: building.accessible !== false,
            };
          })
          .filter(building => building.coordinates !== null) as Building[];

        setBuildings(mappedBuildings);

        // Set initial region to first building with valid coordinates
        if (mappedBuildings.length > 0) {
          const firstBuilding = mappedBuildings[0];
          if (firstBuilding.coordinates) {
            setRegion({
              latitude: firstBuilding.coordinates.latitude,
              longitude: firstBuilding.coordinates.longitude,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
            });
          }
        }
      }

      // Load audit routes
      try {
        const routesResponse = await auditAPI.getRoutes();
        if (routesResponse?.routes) {
          setAuditRoutes(routesResponse.routes);
        }
      } catch (routeError) {
        setAuditRoutes([]);
      }

      // Handle route selection
      if (route?.params?.selectedRoute) {
        setSelectedRoute(route.params.selectedRoute);
        if (route.params?.selectedRoute) {
          await loadRoutePOIs(route.params.selectedRoute);
        }

        // Wait for POI data to be loaded, then navigate
      setTimeout(() => {
          if (route.params?.selectedRoute) {
            navigateToRouteLocation(route.params.selectedRoute);
          }
      }, 500);
    }
    } catch (err) {
      setError(
        `Failed to load data: ${
          err instanceof Error ? err.message : 'Unknown error'
        }`,
      );
    } finally {
      setLoading(false);
    }
  };

  const loadRoutePOIs = async (route: AuditRoute) => {
    try {
      setSelectedRoute(route);
      
      // Step 1: Set the building for the route (following anyplace-architect pattern)
      const buildingId = route.building_id || route.bu_code || route.building_code;
      if (buildingId) {
        // Find the building in the buildings list
        const building = buildings.find(b => 
          b.id === buildingId || b.bu_code === buildingId
        );
        if (building) {
          setSelectedBuilding(building);
        } else {
          // Create a mock building object if not found in list
          const mockBuilding = {
            id: buildingId,
            bu_code: buildingId,
            name: route.building_name || 'Route Building',
            coordinates: route.building_lat && route.building_lng ? {
              latitude: parseFloat(route.building_lat),
              longitude: parseFloat(route.building_lng)
            } : undefined,
          };
          setSelectedBuilding(mockBuilding);
        }
      }
      
      if (route.pois && route.pois.length > 0) {

        // Check if POIs have coordinates
        const hasCoordinates = route.pois.some(
          poi => poi.coordinates || poi.latitude || poi.coordinates_lat,
        );

        if (hasCoordinates) {
          setPois(route.pois);
          
          // Auto-load floorplan for first POI's floor
          const firstPOI = route.pois[0];
          const floorNumber = firstPOI.floor_number || firstPOI.floor || '1';
          const buildingId = route.building_id || route.bu_code || route.building_code;
          
          if (buildingId) {
            setSelectedFloor(String(floorNumber));
            
            // Add a small delay to ensure map navigation completes first
            setTimeout(() => {
              loadFloorPlan(buildingId, String(floorNumber)).catch(error => {
                if (error.message.includes('Floorplan not available')) {
                } else {
                  // console.warn('Failed to load floorplan for route:', error.message);
                }
              });
            }, 1500);
          }
        } else {
          // Fetch full POI details using puids
          const fullPOIs = await fetchFullPOIDetails(route.pois);
          setPois(fullPOIs);
          
          // Auto-load floorplan for first POI's floor
          if (fullPOIs.length > 0) {
            const firstPOI = fullPOIs[0];
            const floorNumber = firstPOI.floor_number || firstPOI.floor || '1';
            const buildingId = route.building_id || route.bu_code || route.building_code;
            
          if (buildingId) {
            setSelectedFloor(String(floorNumber));
            
            // Add a small delay to ensure map navigation completes first
            setTimeout(() => {
              loadFloorPlan(buildingId, String(floorNumber)).catch(error => {
                if (error.message.includes('Floorplan not available')) {
                } else {
                  // console.warn('Failed to load floorplan for route:', error.message);
                }
              });
            }, 1500);
          }
          }
        }
      } else {
        const buildingId =
          route.building_id || route.bu_code || route.building_code;
        const floorNumber = route.floorNumbers?.[0] || route.floors?.[0];

        if (buildingId) {
          try {
            const poiResponse = await poiAPI.getPOIsByBuilding(
              buildingId,
              floorNumber?.toString(),
            );
            if (poiResponse.pois && poiResponse.pois.length > 0) {
              setPois(poiResponse.pois);
              
              // Auto-load floorplan for the floor
              if (floorNumber) {
                setSelectedFloor(String(floorNumber));
                
                // Add a small delay to ensure map navigation completes first
                setTimeout(() => {
                  loadFloorPlan(buildingId, String(floorNumber)).catch(error => {
                    if (error.message.includes('Floorplan not available')) {
                    } else {
                      // console.warn('Failed to load floorplan for route floor:', error.message);
                    }
                  });
                }, 1500);
              }
            } else {
              setPois([]);
            }
          } catch (poiError) {
            // console.error('Error fetching POIs:', poiError);
            setPois([]);
          }
        } else {
          setPois([]);
        }
      }
    } catch (error) {
      // console.error('Error loading route POIs:', error);
    }
  };


  // Start audit session - fully dynamic
  const startAuditSession = async (routeId: string) => {
    try {
      const response = await auditAPI.startAuditSession(routeId);

      // Fetch the complete session data from backend
      const sessionData = await auditAPI.getAuditSession(response.sessionId);

      // Ensure we have the correct session data structure
      const formattedSession = {
        session_id: sessionData.session_id || response.sessionId,
        route_id: sessionData.route_id || routeId,
        auditor_id: sessionData.auditor_id || 'admin',
        session_status: sessionData.session_status || 'active',
        started_at: sessionData.started_at || new Date().toISOString(),
        ended_at: sessionData.ended_at || '',
        completed_pois: sessionData.completed_pois || [],
        total_pois: sessionData.total_pois || 0,
        last_updated: sessionData.last_updated || new Date().toISOString(),
      };

      setAuditSession(formattedSession);

      return response.sessionId;
    } catch (error: any) {
      // console.error('Error starting audit session:', error);
      // console.error('Error details:', error.response?.data || error.message);
      Alert.alert(
        'Error',
        `Failed to start audit session: ${
          error.response?.data?.message || error.message
        }`,
      );
      return null;
    }
  };

  // End audit session - fully dynamic
  const endAuditSession = async () => {
    if (!auditSession?.session_id) return;

    try {
      await auditAPI.endAuditSession(auditSession.session_id);

      // Fetch updated session data from backend
      const updatedSession = await auditAPI.getAuditSession(
        auditSession.session_id,
      );
      setAuditSession(updatedSession);

        setIsNavigating(false);
        setCurrentPOIIndex(0);
        setCompletedPOIs(new Set());
        setPdrStartPosition(null);

      Alert.alert(
        'Session Complete',
        'Audit session has been completed successfully!',
      );
    } catch (error: any) {
      // console.error('Error ending audit session:', error);
      Alert.alert(
        'Error',
        `Failed to end audit session: ${
          error.response?.data?.message || error.message
        }`,
      );
    }
  };

  // Submit POI inspection data - fully dynamic
  const submitPOIInspection = async (inspectionData: InspectionData) => {

    if (!auditSession?.session_id) {
      // console.error('No audit session found');
      // console.error('Audit session state:', auditSession);
      Alert.alert(
        'Error',
        'No active audit session found. Please select a route first.',
      );
      return false;
    }

    try {

      const response = await auditAPI.submitPOIAudit(
        auditSession.session_id,
        inspectionData.poiId,
        inspectionData,
      );

      // Fetch updated session data from backend instead of updating local state
      const updatedSession = await auditAPI.getAuditSession(
        auditSession.session_id,
      );
      setAuditSession(updatedSession);

      return true;
    } catch (error: any) {
      // console.error('Error submitting POI inspection:', error);
      // console.error('Error details:', error.response?.data || error.message);
      Alert.alert(
        'Error',
        `Failed to submit inspection data: ${
          error.response?.data?.message || error.message
        }`,
      );
      return false;
    }
  };

  const fetchFullPOIDetails = async (routePOIs: POI[]): Promise<POI[]> => {
    const fullPOIs: POI[] = [];

    for (const routePOI of routePOIs) {
      try {
        if (routePOI.puid) {
          const fullPOI = await poiAPI.getPOI(routePOI.puid);
          
          // Debug: Log the full POI data structure
          //   id: fullPOI.id,
          //   name: fullPOI.name,
          //   latitude: fullPOI.latitude,
          //   longitude: fullPOI.longitude,
          //   coordinates: fullPOI.coordinates,
          //   coordinates_lat: fullPOI.coordinates_lat,
          //   coordinates_lon: fullPOI.coordinates_lon,
          //   floor: fullPOI.floor,
          //   floor_number: fullPOI.floor_number,
          //   allKeys: Object.keys(fullPOI)
          // });
          
          fullPOIs.push(fullPOI);
        }
      } catch (error) {
        // console.error(`Error fetching POI ${routePOI.puid}:`, error);
        // Add the route POI as fallback
        fullPOIs.push(routePOI);
      }
    }

    return fullPOIs;
  };

  const handleBuildingSelect = async (building: Building) => {
    try {
      setSelectedBuilding(building);
        setSelectedFloor('');
      setPois([]);
      clearFloorPlan(); // Clear previous floorplan

      const buildingId = building.id || building.bu_code;
      if (buildingId) {
        try {
          const poisResponse = await poiAPI.getPOIsByBuilding(buildingId);
          if (poisResponse?.pois) {
            setPois(poisResponse.pois);
          }
          
          // Auto-load floorplan for first available floor
          if (building.floors && building.floors.length > 0) {
            const firstFloor = String(building.floors[0]);
            setSelectedFloor(firstFloor);
            loadFloorPlan(buildingId, firstFloor);
          }
        } catch (err) {
          // console.error('Error loading POIs:', err);
          setPois([]);
        }
      }

      if (mapRef.current && building.coordinates) {
        mapRef.current.animateToRegion({
          latitude: building.coordinates.latitude,
          longitude: building.coordinates.longitude,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        });
      }
    } catch (err) {
      // console.error('Error selecting building:', err);
      Alert.alert('Error', 'Failed to load building details');
    }
  };

  const handleRouteSelect = async (route: AuditRoute) => {
    if (route.pois && route.pois.length > 0) {
    }
    setSelectedRoute(route);

    // Load POI data first
    await loadRoutePOIs(route);

     // Initialize PDR building data
     if (selectedBuilding && pois && pois.length > 0) {
       // Ensure building has coordinates for coordinate transformation
       const buildingWithCoords = {
         ...selectedBuilding,
         coordinates: selectedBuilding.coordinates || {
           latitude: pois[0].coordinates?.lat || pois[0].latitude || 0,
           longitude: pois[0].coordinates?.lon || pois[0].longitude || 0,
         },
       };

       initializePDRBuilding(buildingWithCoords, pois);
     }

    // Load floor plan for the building
    if (selectedBuilding) {
      const buildingId = selectedBuilding.bu_code || selectedBuilding.id;
      const floorNumber = route.floorNumbers?.[0] || route.floors?.[0] || '1';
      if (buildingId) {
        await loadFloorPlan(buildingId, floorNumber.toString());
      }
    }

    // Start audit session
    const routeId = route._id || route.id;
    if (!routeId) {
      Alert.alert('Error', 'Route ID not found');
      return;
    }
    const sessionId = await startAuditSession(routeId);
    if (sessionId) {
      Alert.alert(
        'Audit Session Started',
        `Session started for route: ${route.name}\n\nPlease scan the first POI to begin inspection.`,
        [{ text: 'OK' }],
      );
    }

    // Wait a bit for POI data to be processed
    setTimeout(() => {
      navigateToRouteLocation(route);
    }, 500);
  };

  const navigateToRouteLocation = (route: AuditRoute) => {
    // Check if we have POIs with coordinates
    if (pois && pois.length > 0) {
      const firstPOI = pois[0];
      const coordinates = getTransformedPOICoordinates(firstPOI);

      if (coordinates && mapRef.current) {
        mapRef.current.animateToRegion({
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        });

        // Show message to scan first POI
        Alert.alert(
          'Route Selected',
          `Navigate to the first POI: ${
            firstPOI.name || 'Unknown POI'
          }\n\nCoordinates: ${coordinates.latitude.toFixed(
            6,
          )}, ${coordinates.longitude.toFixed(
            6,
          )}\n\nScan the QR code at this location to start PDR tracking.`,
          [
            { text: 'OK', style: 'default' },
            { text: 'Scan QR Now', onPress: () => handleQRScan() },
          ],
        );
        return;
      }
    }

    // Fallback to building if no POI coordinates
    if (route.building_id) {
      const building = buildings.find(
        b => b.id === route.building_id || b.bu_code === route.building_id,
      );
      if (building && building.coordinates && mapRef.current) {
        mapRef.current.animateToRegion({
          latitude: building.coordinates.latitude,
          longitude: building.coordinates.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        });

      Alert.alert(
          'Route Selected',
          `Navigate to building: ${
            building.name
          }\n\nCoordinates: ${building.coordinates.latitude.toFixed(
            6,
          )}, ${building.coordinates.longitude.toFixed(
            6,
          )}\n\nFind the first POI and scan its QR code to start PDR tracking.`,
          [
            { text: 'OK', style: 'default' },
            { text: 'Scan QR Now', onPress: () => handleQRScan() },
          ],
        );
        return;
      }
    }

    // Last resort
    if (mapRef.current) {
      mapRef.current.animateToRegion(DEFAULT_COORDINATES);
    }
  };

  const handleQRScan = () => {
    setShowQRScanner(true);
  };

  const handleQRScanResult = (qrData: string) => {
    setShowQRScanner(false);

    try {
      const result = qrService.current.processQRData(qrData);
      if (result.success && result.anchor) {
        handleAnchorScanned(result.anchor);
      } else {
        Alert.alert(
          'Invalid QR Code',
          result.error || 'Unknown QR code format',
        );
      }
    } catch (error) {
      // console.error('QR scan error:', error);
      Alert.alert('Error', 'Failed to process QR code');
    }
  };

  const handleAnchorScanned = (anchor: QRAnchor) => {
    setShowQRScanner(false);


    // Try to find matching POI by name or ID
    const matchingPOI = findPOIByNameOrId(anchor.name, anchor.id);

    if (matchingPOI) {

      // Get POI coordinates
      const poiCoords = getTransformedPOICoordinates(matchingPOI);
      if (poiCoords) {
        // Find the index of this POI in the route
        const poiIndex = pois.findIndex(
          poi =>
            poi.puid === matchingPOI.puid ||
            poi.id === matchingPOI.puid ||
            poi.puid === matchingPOI.id ||
            poi.id === matchingPOI.id,
        );

        if (poiIndex === -1) {
          Alert.alert(
            'POI Not Found',
            'This POI is not part of the current audit route.',
          );
          return;
        }


        // Check if this is the correct POI in sequence
        if (poiIndex !== currentPOIIndex) {
          const expectedPOI = pois[currentPOIIndex];
    Alert.alert(
            'Wrong POI Order',
            `Please scan POI ${currentPOIIndex + 1} first: ${
              expectedPOI?.name || 'Unknown'
            }\n\nYou scanned: ${matchingPOI.name} (POI ${poiIndex + 1})`,
      [{ text: 'OK' }],
    );
          return;
        }

        // Convert lat/lng to local coordinates for PDR
        const localCoords = toLocal(poiCoords.latitude, poiCoords.longitude);

        // Calibrate Hogent PDR position using POI coordinates
        calibratePDRPosition(localCoords.x, localCoords.y, anchor.heading);

        // Set PDR starting position for indoor positioning
        setPdrStartPosition(poiCoords);


        // If we have a selected route, start navigation to next POI
        if (selectedRoute && pois && pois.length > 0) {
          startNavigationToNextPOI();
        }

        // Show inspection form for POI scanning
        setCurrentInspectionPOI(matchingPOI);
        setShowInspectionForm(true);
      } else {
        Alert.alert('Invalid POI', 'POI does not have valid coordinates');
      }
    } else if (
      anchor.position &&
      anchor.position.x !== 0 &&
      anchor.position.y !== 0
    ) {
      // Fallback to anchor position if available
      const { x, y } = anchor.position;
      calibratePDRPosition(x, y, anchor.heading);


    Alert.alert(
      'Position Calibrated',
        `Position updated using anchor: ${anchor.name}\nCoordinates: (${x}, ${y})`,
      [{ text: 'OK' }],
    );
    } else {
      Alert.alert(
        'Invalid QR Code',
        'Could not find matching POI or valid position data',
      );
    }

    // Update navigation if active
    if (navigationState?.isActive) {
      navService.current.calibratePosition(anchor);
    }
  };


  const startNavigationToNextPOI = () => {
    if (!selectedRoute || !pois || pois.length === 0) return;

    setIsNavigating(true);
    setCurrentPOIIndex(0); // Start with first POI

     // Start PDR tracking
     if (!isPDRTracking) {
       // Initialize building data for coordinate transformation
       if (selectedBuilding && pois && pois.length > 0) {
         initializePDRBuilding(selectedBuilding, pois);
       }
       startPDRTracking();
       
       // Hogent PDR is already started above
     }
  };

  const getNextPOI = () => {
    if (!pois || currentPOIIndex >= pois.length - 1) return null;
    return pois[currentPOIIndex + 1];
  };

  const getCurrentPOI = () => {
    if (!pois || currentPOIIndex >= pois.length) return null;
    return pois[currentPOIIndex];
  };

  const moveToNextPOI = () => {

    if (currentPOIIndex < pois.length - 1) {
      // Mark current POI as completed
      setCompletedPOIs(prev => new Set([...prev, currentPOIIndex]));

      // Move to next POI
      const newIndex = currentPOIIndex + 1;
      setCurrentPOIIndex(newIndex);
    } else {
      // Mark last POI as completed
      setCompletedPOIs(prev => new Set([...prev, currentPOIIndex]));

      // All POIs completed
      setIsNavigating(false);
      Alert.alert('Route Complete', 'All POIs have been visited!');
    }
  };

  // Handle inspection form submission
  const handleInspectionSubmit = async (inspectionData: InspectionData) => {

    // Submit to server
    const success = await submitPOIInspection(inspectionData);

    if (success) {
      // Close inspection form
      setShowInspectionForm(false);
      setCurrentInspectionPOI(null);

      // Update POI completion tracking based on backend data
      const poiIndex = pois.findIndex(
        poi =>
          poi.puid === inspectionData.poiId ||
          poi.id === inspectionData.poiId ||
          poi.puid === inspectionData.poiId ||
          poi.id === inspectionData.poiId,
      );

      if (poiIndex !== -1) {
        // Update local completed POIs set based on backend data
        const completedPOISet = new Set(
          (auditSession?.completed_pois || [])
            .map(poiId =>
              pois.findIndex(poi => poi.puid === poiId || poi.id === poiId),
            )
            .filter(index => index !== -1),
        );
        setCompletedPOIs(completedPOISet);

        // Move to next POI if this was the current one
        if (poiIndex === currentPOIIndex) {
          moveToNextPOI();
        } else {
          // Force update to next POI if there's a mismatch
          if (poiIndex < currentPOIIndex) {
            moveToNextPOI();
          }
        }
      } else {
        // console.error('POI not found in route for ID:', inspectionData.poiId);
      }

      // Show success message
      Alert.alert(
        'Inspection Submitted',
        `POI inspection data has been submitted successfully!\n\nMoving to next POI...`,
        [{ text: 'OK' }],
      );
    }
  };

  // Handle inspection form close
  const handleInspectionClose = () => {
    setShowInspectionForm(false);
    setCurrentInspectionPOI(null);
  };

  const findPOIByLocation = (x: number, y: number): POI | null => {
    if (!pois || pois.length === 0) return null;

    // Convert PDR coordinates to lat/lng for comparison
    const pdrLatLng = toLatLng(x, y);

    // Find POI with closest coordinates
    let closestPOI: POI | null = null;
    let minDistance = Infinity;

    for (const poi of pois) {
      const poiCoords = getTransformedPOICoordinates(poi);
      if (poiCoords) {
        // Calculate distance between PDR position and POI
        const distance = Math.sqrt(
          Math.pow(pdrLatLng.latitude - poiCoords.latitude, 2) +
            Math.pow(pdrLatLng.longitude - poiCoords.longitude, 2),
        );

        if (distance < minDistance) {
          minDistance = distance;
          closestPOI = poi;
        }
      }
    }

    // Only return POI if it's within reasonable distance (e.g., 10 meters)
    const threshold = 0.0001; // Roughly 10 meters in lat/lng
    if (minDistance < threshold) {
      return closestPOI;
    }

    return null;
  };

  const findPOIByNameOrId = (name: string, id: string): POI | null => {
    if (!pois || pois.length === 0) return null;


    // Try to find by exact name match first
    let matchingPOI = pois.find(
      poi =>
        poi.name === name ||
        poi.name === id ||
        poi.title === name ||
        poi.title === id,
    );

    if (matchingPOI) {
      return matchingPOI;
    }

    // Try to find by ID match
    matchingPOI = pois.find(
      poi =>
        poi.id === id ||
        poi.puid === id ||
        poi.id === name ||
        poi.puid === name,
    );

    if (matchingPOI) {
      return matchingPOI;
    }

    // Try partial name match (case insensitive)
    matchingPOI = pois.find(
      poi =>
        poi.name.toLowerCase().includes(name.toLowerCase()) ||
        poi.title?.toLowerCase().includes(name.toLowerCase()) ||
        name.toLowerCase().includes(poi.name.toLowerCase()) ||
        name.toLowerCase().includes(poi.title?.toLowerCase() || ''),
    );

    if (matchingPOI) {
      return matchingPOI;
    }

    return null;
  };

  const getNavigationPathCoordinates = () => {
    if (!isNavigating) return [];

    const currentPOI = getCurrentPOI();
    const nextPOI = getNextPOI();

    if (!currentPOI || !nextPOI) return [];

    const currentCoords = getTransformedPOICoordinates(currentPOI);
    const nextCoords = getTransformedPOICoordinates(nextPOI);

    if (!currentCoords || !nextCoords) return [];

    // Create path from current POI to next POI (not from PDR position)
    return [currentCoords, nextCoords];
  };

  // Get dynamic path progress - shows how far user has traveled along the path
  const getDynamicPathProgress = () => {
    if (!isNavigating || !pdrPosition) return [];

    const currentPOI = getCurrentPOI();
    const nextPOI = getNextPOI();

    if (!currentPOI || !nextPOI) return [];

    const currentCoords = getTransformedPOICoordinates(currentPOI);
    const nextCoords = getTransformedPOICoordinates(nextPOI);

    if (!currentCoords || !nextCoords) return [];

    const pdrLatLng = toLatLng(pdrPosition.x, pdrPosition.y);

    // Calculate progress along the path (0 to 1)
    const totalDistance = Math.sqrt(
      Math.pow(nextCoords.latitude - currentCoords.latitude, 2) +
        Math.pow(nextCoords.longitude - currentCoords.longitude, 2),
    );

    const distanceFromStart = Math.sqrt(
      Math.pow(pdrLatLng.latitude - currentCoords.latitude, 2) +
        Math.pow(pdrLatLng.longitude - currentCoords.longitude, 2),
    );

    const progress = Math.min(distanceFromStart / totalDistance, 1);

    // Create path with progress
    const progressLat =
      currentCoords.latitude +
      (nextCoords.latitude - currentCoords.latitude) * progress;
    const progressLng =
      currentCoords.longitude +
      (nextCoords.longitude - currentCoords.longitude) * progress;

    return [currentCoords, { latitude: progressLat, longitude: progressLng }];
  };

  const getRoutePolylineCoordinates = () => {
    if (!selectedRoute?.pois || selectedRoute.pois.length === 0) return [];

    return selectedRoute.pois
      .map(poi => {
        const coordinates = getTransformedPOICoordinates(poi);
        return coordinates;
      })
      .filter(coord => coord !== null) as {
      latitude: number;
      longitude: number;
    }[];
  };

  // Get complete PDR path including starting position - BREADCRUMB TRAIL
  const getCompletePDRPath = () => {
    if (!pdrStartPosition) {
      return [];
    }

    // Start with the POI coordinates
    const completePath = [pdrStartPosition];
    
    // Add all path history points to create breadcrumb trail
    if (pathHistory && pathHistory.length > 0) {
      const pathPoints = pathHistory.map(point => {
        // Convert PDR position (in meters) to lat/lng offset
        const latOffset = point.x * 0.00001;
        const lngOffset = point.y * 0.00001;
        
        return {
          latitude: pdrStartPosition.latitude + latOffset,
          longitude: pdrStartPosition.longitude + lngOffset
        };
      });
      
      // Add all path points to create the breadcrumb trail
      completePath.push(...pathPoints);
      
      // Debug: Show first few path points
      if (pathPoints.length > 0) {
        if (pathPoints.length > 1) {
        }
      }
    }
    
    return completePath;
  };

  // Get direction text from heading angle
  const getDirectionText = (heading: number) => {
    if (heading >= 337.5 || heading < 22.5) return 'North';
    if (heading >= 22.5 && heading < 67.5) return 'Northeast';
    if (heading >= 67.5 && heading < 112.5) return 'East';
    if (heading >= 112.5 && heading < 157.5) return 'Southeast';
    if (heading >= 157.5 && heading < 202.5) return 'South';
    if (heading >= 202.5 && heading < 247.5) return 'Southwest';
    if (heading >= 247.5 && heading < 292.5) return 'West';
    if (heading >= 292.5 && heading < 337.5) return 'Northwest';
    return 'Unknown';
  };

  const getTransformedPOICoordinates = (poi: POI) => {
    if (!poi) {
      return null;
    }

    let poiLat = 0;
    let poiLng = 0;

    // Check for coordinates.lat and coordinates.lon first (most common format from audit routes)
    if (poi.coordinates && typeof poi.coordinates === 'object') {
      const coords = poi.coordinates as any;
      if (coords.lat && coords.lon) {
        poiLat = parseFloat(String(coords.lat));
        poiLng = parseFloat(String(coords.lon));
      } else if (coords.latitude && coords.longitude) {
        poiLat = parseFloat(String(coords.latitude));
        poiLng = parseFloat(String(coords.longitude));
      } else if (Array.isArray(coords) && coords.length >= 2) {
        // Handle array format [lat, lng]
        poiLat = parseFloat(String(coords[0]));
        poiLng = parseFloat(String(coords[1]));
      }
    } else if (poi.coordinates_lat && poi.coordinates_lon) {
      poiLat = parseFloat(String(poi.coordinates_lat));
      poiLng = parseFloat(String(poi.coordinates_lon));
    } else if (poi.latitude && poi.longitude) {
      poiLat = poi.latitude;
      poiLng = poi.longitude;
    } else {
    }

    if (isNaN(poiLat) || isNaN(poiLng) || poiLat === 0 || poiLng === 0) {
      return null;
    }

    return { latitude: poiLat, longitude: poiLng };
  };

  const startNavigation = () => {
    if (!selectedRoute?.pois) {
      Alert.alert('Error', 'No route selected');
      return;
    }

    try {
      navService.current.startRoute(selectedRoute, selectedRoute.pois);
    } catch (error) {
      // console.error('Failed to start navigation:', error);
      Alert.alert('Error', 'Failed to start navigation');
    }
  };

  const stopNavigation = () => {
    navService.current.stopRoute();
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading Map...</Text>
        {error && <Text style={styles.errorText}>{error}</Text>}
      </View>
    );
  }

  if (error && !buildings.length) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={initializeMap}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#007AFF" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {selectedBuilding ? selectedBuilding.name : 'Select Building'}
        </Text>
        {selectedFloor && (
          <Text style={styles.headerSubtitle}>
            Floor {selectedFloor} • {pois.length} POIs
          </Text>
        )}
      </View>

      {/* Floor Selector - Hidden for automatic mode */}
      {false && selectedBuilding && selectedBuilding.floors && selectedBuilding.floors.length > 0 && (
        <View style={styles.floorSelector}>
          <Text style={styles.floorSelectorLabel}>Select Floor:</Text>
          <View style={styles.floorButtons}>
            {selectedBuilding.floors.map((floor) => (
              <TouchableOpacity
                key={floor}
                style={[
                  styles.floorButton,
                  selectedFloor === String(floor) && styles.floorButtonSelected,
                ]}
                onPress={() => setSelectedFloor(String(floor))}
              >
                <Text
                  style={[
                    styles.floorButtonText,
                    selectedFloor === String(floor) && styles.floorButtonTextSelected,
                  ]}
                >
                  {floor}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* PDR Control Card */}
      <View style={styles.pdrCard}>
        <View style={styles.pdrCardHeader}>
          <Text style={styles.pdrCardTitle}>
            {auditSession?.session_status === 'active'
              ? 'Audit Session Active'
              : 'Indoor Navigation'}
          </Text>
          {auditSession?.session_status === 'active' && (
            <Text style={styles.pdrCardSubtitle}>
              Session: {auditSession.session_id.substring(0, 8)}... | Completed:{' '}
              {auditSession.completed_pois.length}/{auditSession.total_pois}{' '}
              POIs
            </Text>
          )}
          {isPDRTracking && (
            <View style={styles.pdrStatus}>
              {/* Hogent-style live sensor data display */}
              <Text style={styles.pdrStatusText}>
                📍 Location: x:{pdrPosition?.x.toFixed(3)}, y:
                {pdrPosition?.y.toFixed(3)}
              </Text>
              <Text style={styles.pdrStatusText}>
                🧭 Heading:{' '}
                {pdrPosition?.heading ? pdrPosition.heading.toFixed(2) : 0}°
              </Text>
              <Text style={styles.pdrStatusText}>
                🚶 Steps: {stepCount} | Confidence:{' '}
                {pdrPosition ? (pdrPosition.confidence * 100).toFixed(1) : 0}%
              </Text>
              {isNavigating &&
                getCurrentPOI() &&
                (() => {
                  const nextPOI = getNextPOI();
                  let directionStatus = '✓ On Track';
                  let directionColor = '#00FF00';

                  if (nextPOI && pdrPosition?.heading !== undefined) {
                    const nextCoords = getTransformedPOICoordinates(nextPOI);
                    if (nextCoords) {
                      const pdrLatLng = toLatLng(pdrPosition.x, pdrPosition.y);
                      const bearingToNext =
                        (Math.atan2(
                          nextCoords.longitude - pdrLatLng.longitude,
                          nextCoords.latitude - pdrLatLng.latitude,
                        ) *
                          180) /
                        Math.PI;
                      const headingDiff = Math.abs(
                        pdrPosition.heading - bearingToNext,
                      );
                      const normalizedDiff = Math.min(
                        headingDiff,
                        360 - headingDiff,
                      );

                      if (normalizedDiff < 30) {
                        directionStatus = '✓ On Track';
                        directionColor = '#00FF00';
                      } else if (normalizedDiff < 60) {
                        directionStatus = '⚠ Check Direction';
                        directionColor = '#FFA500';
                      } else {
                        directionStatus = '❌ Wrong Direction';
                        directionColor = '#FF0000';
                      }
                    }
                  }

                  // Calculate progress percentage
                  const progressPath = getDynamicPathProgress();
                  const fullPath = getNavigationPathCoordinates();
                  let progressPercent = 0;

                  if (progressPath.length > 1 && fullPath.length > 1) {
                    const totalDistance = Math.sqrt(
                      Math.pow(fullPath[1].latitude - fullPath[0].latitude, 2) +
                        Math.pow(
                          fullPath[1].longitude - fullPath[0].longitude,
                          2,
                        ),
                    );
                    const traveledDistance = Math.sqrt(
                      Math.pow(
                        progressPath[1].latitude - progressPath[0].latitude,
                        2,
                      ) +
                        Math.pow(
                          progressPath[1].longitude - progressPath[0].longitude,
                          2,
                        ),
                    );
                    progressPercent = Math.min(
                      (traveledDistance / totalDistance) * 100,
                      100,
                    );
            }

            return (
                    <>
                      <Text style={styles.pdrStatusText}>
                        📍 Current POI: {getCurrentPOI()?.name} (POI{' '}
                        {currentPOIIndex + 1})
                      </Text>
                      <Text style={styles.pdrStatusText}>
                        🎯 Next POI: {nextPOI?.name || 'Complete'} (POI{' '}
                        {currentPOIIndex + 2})
                      </Text>
                      <Text
                        style={[
                          styles.pdrStatusText,
                          { color: directionColor },
                        ]}
                      >
                        🧭 {directionStatus} | Progress:{' '}
                        {progressPercent.toFixed(1)}%
                      </Text>
                    </>
                  );
                })()}
            </View>
          )}
        </View>

        <View style={styles.pdrCardButtons}>
          <TouchableOpacity style={styles.pdrCardButton} onPress={handleQRScan}>
            <Text style={styles.pdrCardButtonIcon}>📷</Text>
            <Text style={styles.pdrCardButtonText}>Scan QR</Text>
              </TouchableOpacity>

                  <TouchableOpacity
                    style={[
              styles.pdrCardButton,
              isPDRTracking
                ? styles.pdrCardButtonStop
                : styles.pdrCardButtonStart,
            ]}
            onPress={isPDRTracking ? stopPDRTracking : startPDRTracking}
          >
            <Text style={styles.pdrCardButtonIcon}>
              {isPDRTracking ? '⏹️' : '🚶'}
            </Text>
            <Text style={styles.pdrCardButtonText}>
              {isPDRTracking ? 'Stop' : 'Start'} PDR
                    </Text>
                  </TouchableOpacity>

          {isNavigating && (
                  <TouchableOpacity
              style={[styles.pdrCardButton, styles.pdrCardButtonNext]}
              onPress={moveToNextPOI}
                  >
              <Text style={styles.pdrCardButtonIcon}>➡️</Text>
              <Text style={styles.pdrCardButtonText}>Next POI</Text>
                  </TouchableOpacity>
          )}

          {isPDRTracking && (
                    <TouchableOpacity
              style={[styles.pdrCardButton, styles.pdrCardButtonReset]}
              onPress={resetPDR}
            >
              <Text style={styles.pdrCardButtonIcon}>🔄</Text>
              <Text style={styles.pdrCardButtonText}>Reset</Text>
                    </TouchableOpacity>
          )}

          {/* Manual PDR initialization button */}
          {!isPDRTracking && selectedBuilding && pois && pois.length > 0 && (
            <TouchableOpacity
              style={[styles.pdrCardButton, styles.pdrCardButtonInit]}
              onPress={() => {
                try {
                  initializePDRBuilding(selectedBuilding, pois);
                  startPDRTracking();
                } catch (error) {
                  // console.error('Manual PDR initialization failed:', error);
                  Alert.alert('PDR Initialization Failed', 'Please check POI coordinates and try again.');
                }
              }}
            >
              <Text style={styles.pdrCardButtonIcon}>🔧</Text>
              <Text style={styles.pdrCardButtonText}>Init PDR</Text>
            </TouchableOpacity>
          )}




          {selectedRoute && (
                      <TouchableOpacity
              style={[styles.pdrCardButton, styles.pdrCardButtonNav]}
              onPress={
                navigationState?.isActive ? stopNavigation : startNavigation
              }
            >
              <Text style={styles.pdrCardButtonIcon}>
                {navigationState?.isActive ? '⏹️' : '🚀'}
              </Text>
              <Text style={styles.pdrCardButtonText}>
                {navigationState?.isActive ? 'Stop' : 'Start'} Route
                        </Text>
                      </TouchableOpacity>
          )}

          {false && (selectedBuilding && selectedFloor) && (
                  <TouchableOpacity
                    style={[
                styles.pdrCardButton,
                floorPlan
                  ? styles.pdrCardButtonActive
                  : styles.pdrCardButtonInactive,
              ]}
              onPress={() => {
                if (floorPlan) {
                  clearFloorPlan();
                } else if (selectedBuilding && selectedFloor) {
                  const buildingId = selectedBuilding.id || selectedBuilding.bu_code;
                  if (buildingId) {
                    loadFloorPlan(buildingId, selectedFloor);
                  }
                }
              }}
            >
              <Text style={styles.pdrCardButtonIcon}>
                {floorPlan ? '🏢' : '📐'}
              </Text>
              <Text style={styles.pdrCardButtonText}>
                {floorPlan ? 'Hide Floor Plan' : 'Show Floor Plan'}
              </Text>
                  </TouchableOpacity>
          )}

          {auditSession?.session_status === 'active' && (
                  <TouchableOpacity
              style={[styles.pdrCardButton, styles.pdrCardButtonEnd]}
              onPress={endAuditSession}
                  >
              <Text style={styles.pdrCardButtonIcon}>🏁</Text>
              <Text style={styles.pdrCardButtonText}>End Session</Text>
                  </TouchableOpacity>
          )}
        </View>
                </View>

      {/* PDR Values Display - Hogent Style */}
      {isPDRTracking && pdrPosition && (
        <View style={styles.pdrValuesOverlay}>
          <Text style={styles.pdrValuesTitle}>📍 Live PDR Data</Text>
          <View style={styles.pdrValuesGrid}>
            <View style={styles.pdrValueItem}>
              <Text style={styles.pdrValueLabel}>X:</Text>
              <Text style={styles.pdrValueText}>
                {pdrPosition.x.toFixed(3)}m
                    </Text>
            </View>
            <View style={styles.pdrValueItem}>
              <Text style={styles.pdrValueLabel}>Y:</Text>
              <Text style={styles.pdrValueText}>
                {pdrPosition.y.toFixed(3)}m
                    </Text>
                  </View>
            <View style={styles.pdrValueItem}>
              <Text style={styles.pdrValueLabel}>Heading:</Text>
              <Text style={styles.pdrValueText}>
                {pdrPosition.heading.toFixed(1)}°
                    </Text>
                  </View>
            <View style={styles.pdrValueItem}>
              <Text style={styles.pdrValueLabel}>Steps:</Text>
              <Text style={styles.pdrValueText}>{pdrPosition.stepCount}</Text>
              </View>
            <View style={styles.pdrValueItem}>
              <Text style={styles.pdrValueLabel}>Direction:</Text>
              <Text style={[styles.pdrValueText, styles.directionText]}>
                {getDirectionText(pdrPosition.heading)}
                    </Text>
                </View>
            <View style={styles.pdrValueItem}>
              <Text style={styles.pdrValueLabel}>Hogent PDR Steps:</Text>
              <Text style={[styles.pdrValueText, { color: '#00FF00' }]}>
                {stepCount}
                    </Text>
            </View>
            <View style={styles.pdrValueItem}>
              <Text style={styles.pdrValueLabel}>Accuracy:</Text>
              <Text style={styles.pdrValueText}>
                {(pdrPosition.accuracy * 100).toFixed(1)}%
                    </Text>
                  </View>
                  </View>
              </View>
            )}

      {/* Map */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          provider={PROVIDER_DEFAULT}
          initialRegion={region}
  showsUserLocation={false}
  showsMyLocationButton={false}
          showsCompass={true}
          showsScale={true}
          mapType="standard"
          zoomEnabled={true}
          scrollEnabled={true}
          rotateEnabled={true}
          pitchEnabled={true}
        >
          {/* Building Markers */}
          {buildings.map((building, index) => {
    if (!building?.coordinates) return null;

            const { latitude, longitude } = building.coordinates;
    if (!latitude || !longitude || isNaN(latitude) || isNaN(longitude)) return null;

            return (
              <Marker
                key={building.id || `building_${index}`}
                coordinate={{ latitude, longitude }}
                title={building.name || 'Unknown Building'}
                description={building.description || ''}
        pinColor={selectedBuilding?.id === building.id ? '#FF6B35' : '#8B4513'}
                onPress={() => handleBuildingSelect(building)}
                tracksViewChanges={false}
              />
            );
          })}

          {/* Floorplan Overlay */}
          {floorPlan && floorPlan.floor_plan_base64_data && (
            <>
              {/* console.log('MapScreen passing bounds to FloorPlanOverlay:', {
                northEast: { lat: floorPlan.top_right_lat, lng: floorPlan.top_right_lng },
                southWest: { lat: floorPlan.bottom_left_lat, lng: floorPlan.bottom_left_lng }
              }) */}
              <FloorPlanOverlay
                imageUri={`data:image/png;base64,${floorPlan.floor_plan_base64_data}`}
                bounds={{
                  northEast: {
                    latitude: floorPlan.top_right_lat,
                    longitude: floorPlan.top_right_lng,
                  },
                  southWest: {
                    latitude: floorPlan.bottom_left_lat,
                    longitude: floorPlan.bottom_left_lng,
                  },
                }}
                visible={true}
              />
            </>
          )}

          {/* Audit Route Polyline */}
          {selectedRoute && getRoutePolylineCoordinates().length > 1 && (
            <Polyline
              coordinates={getRoutePolylineCoordinates()}
              strokeColor="#007AFF"
              strokeWidth={4}
              lineDashPattern={[5, 5]}
            />
          )}


  {/* Dynamic Navigation Path - Shows progress from current POI to next POI */}
  {isNavigating && getDynamicPathProgress().length > 1 && (
    <Polyline
      coordinates={getDynamicPathProgress()}
      strokeColor="#00FF00"
      strokeWidth={6}
      lineDashPattern={[8, 4]}
    />
  )}

  {/* Remaining Path - Shows remaining path to next POI */}
  {isNavigating && getNavigationPathCoordinates().length > 1 && (() => {
    const progressPath = getDynamicPathProgress();
    const fullPath = getNavigationPathCoordinates();
    
    if (progressPath.length > 1 && fullPath.length > 1) {
      const remainingPath = [
        progressPath[progressPath.length - 1], // End of progress
        fullPath[fullPath.length - 1] // End of full path
      ];

            return (
        <Polyline
          coordinates={remainingPath}
          strokeColor="#CCCCCC"
          strokeWidth={4}
          lineDashPattern={[5, 5]}
        />
      );
    }
    return null;
  })()}


  {/* PDR BREADCRUMB TRAIL - Shows your actual path walked */}
  {isPDRTracking && pdrStartPosition && getCompletePDRPath().length > 1 && (
    <Polyline
      coordinates={getCompletePDRPath()}
      strokeColor="#FF0000"
      strokeWidth={6}
      lineDashPattern={[3, 3]}
    />
  )}



  {/* PDR BREADCRUMB MARKERS - Small dots along the path */}
  {isPDRTracking && pdrStartPosition && pathHistory && pathHistory.map((point, index) => {
    const latOffset = point.x * 0.00001;
    const lngOffset = point.y * 0.00001;
    
                      return (
      <Marker
        key={`breadcrumb-${index}`}
        coordinate={{
          latitude: pdrStartPosition.latitude + latOffset,
          longitude: pdrStartPosition.longitude + lngOffset
        }}
        anchor={{ x: 0.5, y: 0.5 }}
      >
        <View style={styles.breadcrumbMarker} />
      </Marker>
    );
  })}

  {/* LIVE USER COMPASS MARKER - Single marker showing user position and direction */}
  {((isPDRTracking && pdrPosition && pdrStartPosition)) && (() => {
    let finalHeading = pdrPosition?.heading !== undefined ? pdrPosition.heading : 0;
    
    // Normalize heading to 0-360 range
    if (finalHeading > 360) {
      finalHeading = finalHeading % 360;
    } else if (finalHeading < 0) {
      finalHeading = ((finalHeading % 360) + 360) % 360;
    }
    
    return (
      <CompassNeedleMarker
        key="live-user-compass"
        coordinate={{
          latitude: pdrStartPosition.latitude + ((pdrPosition?.x || 0) * 0.00001),
          longitude: pdrStartPosition.longitude + ((pdrPosition?.y || 0) * 0.00001)
        }}
        heading={finalHeading}
        size={32}
        showDebug={false}
      />
    );
  })()}


  {/* Dynamic POI Markers - Color based on status */}
  {isNavigating && pois.map((poi, index) => {
    const coords = getTransformedPOICoordinates(poi);
    if (!coords) return null;
    
    const poiId = poi.puid || poi.id;
    const isCompleted = auditSession?.completed_pois.includes(poiId) || completedPOIs.has(index);
    
    let markerColor = "gray"; // Default
    let title = poi.name;
    let description = `Order: ${poi.order || 'N/A'}`;
    
    if (isCompleted) {
      // Completed POI - Green
      markerColor = "green";
      title = `✓ Completed: ${poi.name}`;
      description = `${description} - Inspected`;
    } else if (index === currentPOIIndex) {
      // Current POI - Blue
      markerColor = "blue";
      title = `Current: ${poi.name}`;
      description = `${description} - Scan QR to Inspect`;
    } else if (index === currentPOIIndex + 1) {
      // Next POI - Orange
      markerColor = "orange";
      title = `Next: ${poi.name}`;
      description = `${description} - Target`;
    } else {
      // Future POI - Gray
      markerColor = "gray";
      title = `Future: ${poi.name}`;
      description = `${description} - Upcoming`;
    }

    return (
      <Marker
        key={`poi-${poi.puid || index}`}
        coordinate={coords}
        title={title}
        description={description}
        pinColor={markerColor}
      />
    );
  })}


  {/* Static POI Markers (when not navigating) */}
  {!isNavigating && pois.map((poi, index) => {
    if (!poi) return null;

    const coordinates = getTransformedPOICoordinates(poi);
    if (!coordinates) return null;

    return (
      <Marker
        key={poi.id || poi.puid || `poi_${index}`}
        coordinate={coordinates}
        title={poi.name || poi.title || 'POI'}
        description={poi.description || poi.pois_type || poi.type || 'Point of Interest'}
        pinColor="#2196F3"
        onPress={() => {
          Alert.alert(
            poi.name || poi.title || 'POI',
            `Type: ${poi.pois_type || poi.type || 'Unknown'}\nFloor: ${poi.floor_number || poi.floor || 'Unknown'}\nDescription: ${poi.description || 'No description'}`
          );
        }}
        tracksViewChanges={false}
      />
    );
  })}
</MapView>
            </View>

      {/* QR Scanner Modal */}
      <QRScanner
        visible={showQRScanner}
        onClose={() => setShowQRScanner(false)}
        onScan={handleQRScanResult}
        title="Scan QR Anchor"
      />

      {/* Inspection Form Modal */}
      <InspectionForm
        visible={showInspectionForm}
        poi={currentInspectionPOI}
        onClose={handleInspectionClose}
        onSubmit={handleInspectionSubmit}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  errorText: {
    marginTop: 10,
    fontSize: 16,
    color: '#FF0000',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  retryButton: {
    marginTop: 20,
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 40 : 20,
    paddingHorizontal: 15,
    paddingBottom: 10,
    backgroundColor: '#007AFF',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  mapContainer: {
    flex: 1,
    margin: 10,
    borderRadius: 10,
    overflow: 'hidden',
  },
  map: {
    flex: 1,
  },
  pdrCard: {
    backgroundColor: 'white',
    margin: 10,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  pdrCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  pdrCardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  pdrCardSubtitle: {
    fontSize: 12,
    color: '#666',
    marginBottom: 10,
  },
  pdrCardButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  pdrCardButton: {
    backgroundColor: '#007AFF',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    minWidth: 80,
    marginBottom: 8,
    flex: 1,
    marginHorizontal: 4,
  },
  pdrCardButtonStart: {
    backgroundColor: '#4CAF50',
  },
  pdrCardButtonStop: {
    backgroundColor: '#F44336',
  },
  pdrCardButtonReset: {
    backgroundColor: '#FF9800',
  },
  pdrCardButtonNext: {
    backgroundColor: '#4CAF50',
  },
  pdrCardButtonActive: {
    backgroundColor: '#2196F3',
  },
  pdrCardButtonInactive: {
    backgroundColor: '#9E9E9E',
  },
  pdrCardButtonClear: {
    backgroundColor: '#FF5722',
  },
  pdrCardButtonEnd: {
    backgroundColor: '#E91E63',
  },
  pdrCardButtonNav: {
    backgroundColor: '#9C27B0',
  },
  pdrCardButtonInit: {
    backgroundColor: '#FF9800',
  },
  pdrCardButtonHeading: {
    backgroundColor: '#4CAF50',
  },
  pdrCardButtonIcon: {
    fontSize: 20,
    marginBottom: 4,
  },
  pdrCardButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  pdrStatus: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#E3F2FD',
    borderRadius: 12,
  },
  pdrStatusText: {
    color: '#1976D2',
    fontSize: 11,
    fontWeight: '600',
  },

  // PDR Values Overlay Styles
  pdrValuesOverlay: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderRadius: 12,
    padding: 12,
    zIndex: 1000,
  },
  pdrValuesTitle: {
    color: '#00FF00',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  pdrValuesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  pdrValueItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    minWidth: '30%',
  },
  pdrValueLabel: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    marginRight: 4,
  },
  pdrValueText: {
    color: '#00FF00',
    fontSize: 12,
    fontWeight: 'bold',
  },
  directionText: {
    color: '#00FF00',
    fontWeight: 'bold',
    fontSize: 14,
  },

  // Current Location Pin Styles - Different from PDR position
  currentLocationPin: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FF6B35', // Orange color to distinguish from PDR
    borderWidth: 4,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 8,
  },
  currentLocationPinInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
  },

  // PDR Moving Pin Styles - Like Google Maps blue dot
  pdrMovingPin: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#007AFF',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  pdrMovingPinInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  pdrDirectionIndicator: {
    position: 'absolute',
    top: -8,
    width: 0,
    height: 0,
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderBottomWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#007AFF',
  },

  // Moving PDR Marker Styles - Like Google Maps blue dot
  movingPDRMarker: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#007AFF',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  movingPDRMarkerInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  movingPDRDirectionIndicator: {
    position: 'absolute',
    top: -8,
    width: 0,
    height: 0,
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderBottomWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#007AFF',
  },


  // Breadcrumb Marker Styles - Small dots along the path
  breadcrumbMarker: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF0000',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },

  // PDR Current Position Marker Styles - Small red dot that moves with PDR
  pdrCurrentPositionMarker: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FF0000',
    borderWidth: 4,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 8,
  },
  pdrCurrentPositionMarkerInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },


  // Floor Selector Styles
  floorSelector: {
    backgroundColor: 'white',
    margin: 10,
    padding: 15,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  floorSelectorLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  floorButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  floorButton: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  floorButtonSelected: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  floorButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  floorButtonTextSelected: {
    color: 'white',
  },
});

export default MapScreen;
