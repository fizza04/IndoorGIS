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
  Circle,
  Overlay,
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
import { useSmartPDR } from '../hooks/useSmartPDR';
import { useHogentPDR } from '../hooks/useHogentPDR';
import { HogentPDRPosition } from '../services/pdr/HogentPDRService';
import { PDRPosition } from '../services/pdr/SmartPDRService';
import { AndroidPermissions } from '../utils/AndroidPermissions';

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

  // PDR Position Update Handler
  const handlePDRPositionUpdate = useCallback(
    (position: PDRPosition) => {
      // Update animated region for smooth movement
      if (pdrAnimatedRegion && isPdrPointerInitialized) {
        const pdrCoords = toLatLng(position.x, position.y);

        if (pdrCoords.latitude !== 0 && pdrCoords.longitude !== 0) {
          pdrAnimatedRegion
            .timing({
              latitude: pdrCoords.latitude,
              longitude: pdrCoords.longitude,
              duration: 100, // Smooth animation duration
            })
            .start();
        }
      }
    },
    [pdrAnimatedRegion, isPdrPointerInitialized, toLatLng],
  );

  // Floor plan overlay state
  const [floorPlanData, setFloorPlanData] = useState<{
    image: string;
    bounds: {
      northEast: { latitude: number; longitude: number };
      southWest: { latitude: number; longitude: number };
    };
  } | null>(null);
  const [showFloorPlan, setShowFloorPlan] = useState(false);
  const [currentFloor, setCurrentFloor] = useState<string>('1');

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
  } = useSmartPDR({
    stepLength: 0.7,
    updateInterval: 100,
    enableDriftCorrection: true,
    coordinateSystem: 'local',
    enablePathTracking: true,
    onPositionUpdate: handlePDRPositionUpdate,
    onStepDetected: (count: number) => {
      // Step detected - no logging needed
    },
    onDriftDetected: () => {
      Alert.alert(
        'Drift Detected',
        'Please scan a QR anchor to recalibrate your position',
      );
    },
  });

  // Hogent PDR - EXACT implementation using new hook
  const {
    isTracking: isHogentPDRTracking,
    currentPosition: hogentPDRPosition,
    stepCount: hogentStepCount,
    pathHistory: hogentPathHistory,
    startTracking: startHogentPDRTracking,
    stopTracking: stopHogentPDRTracking,
    calibratePosition: calibrateHogentPDRPosition,
    reset: resetHogentPDR,
    initializeBuilding: initializeHogentPDRBuilding,
    toLatLng: hogentToLatLng,
    toLocal: hogentToLocal,
  } = useHogentPDR({
    stepLength: 0.7,
    updateInterval: 100,
    enableDriftCorrection: true,
    coordinateSystem: 'local',
    enablePathTracking: true,
    stepLengthScaler: 1,
    headingOffset: 0,
    onPositionUpdate: (position: HogentPDRPosition) => {
      console.log(`HOGENT PDR Position: (${position.x.toFixed(2)}, ${position.y.toFixed(2)}) Heading: ${(position.heading * 180 / Math.PI).toFixed(1)}°`);
    },
    onStepDetected: (count: number) => {
      console.log(`HOGENT STEP DETECTED! Count: ${count}`);
    },
    onDriftDetected: () => {
      Alert.alert(
        'Drift Detected',
        'Please scan a QR anchor to recalibrate your position',
      );
    },
  });

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

  // Debug audit session state
  useEffect(() => {
    if (auditSession) {
      console.log('Session ID:', auditSession.session_id);
      console.log('Session Status:', auditSession.session_status);
      console.log('Completed POIs:', auditSession.completed_pois);
    }
  }, [auditSession]);

  // Current location pin stays FIXED at POI coordinates - no useEffect needed

  const checkAndroidPermissions = async () => {
    if (Platform.OS === 'android') {
      const result = await AndroidPermissions.checkAllPermissions();
      if (!result.granted) {
        console.log('Android permissions not granted:', result.message);
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
      console.error('Error loading initial data:', err);
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
      
      if (route.pois && route.pois.length > 0) {
        console.log('Route POIs found, but checking for coordinates...');

        // Check if POIs have coordinates
        const hasCoordinates = route.pois.some(
          poi => poi.coordinates || poi.latitude || poi.coordinates_lat,
        );

        if (hasCoordinates) {
          console.log('POIs have coordinates, using them directly');
        setPois(route.pois);
        } else {
          console.log('POIs missing coordinates, fetching full POI data...');
          // Fetch full POI details using puids
          const fullPOIs = await fetchFullPOIDetails(route.pois);
          setPois(fullPOIs);
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
            } else {
              setPois([]);
            }
          } catch (poiError) {
            console.error('Error fetching POIs:', poiError);
            setPois([]);
          }
        } else {
          setPois([]);
        }
      }
    } catch (error) {
      console.error('Error loading route POIs:', error);
    }
  };

  // Load floor plan for current building and floor
  const loadFloorPlan = async (
    buildingId: string,
    floorNumber: string = '1',
  ) => {
    try {
      console.log(
        `Loading floor plan for building: ${buildingId}, floor: ${floorNumber}`,
      );
      const floorPlan = await floorPlanAPI.getFloorPlan(
        buildingId,
        floorNumber,
      );

      if (floorPlan.floor_plan_base64_data) {
        const imageUri = `data:image/png;base64,${floorPlan.floor_plan_base64_data}`;

        setFloorPlanData({
          image: imageUri,
          bounds: {
            northEast: {
              latitude: floorPlan.top_right_lat,
              longitude: floorPlan.top_right_lng,
            },
            southWest: {
              latitude: floorPlan.bottom_left_lat,
              longitude: floorPlan.bottom_left_lng,
            },
          },
        });

        setShowFloorPlan(true);
        setCurrentFloor(floorNumber);

        console.log('Floor plan loaded successfully');
      }
    } catch (error) {
      console.error('Error loading floor plan:', error);
      setShowFloorPlan(false);
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
      console.error('Error starting audit session:', error);
      console.error('Error details:', error.response?.data || error.message);
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
      console.log('Ending audit session:', auditSession.session_id);
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
      console.error('Error ending audit session:', error);
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
    console.log('submitPOIInspection called with:', inspectionData);
    console.log('Current audit session state:', auditSession);

    if (!auditSession?.session_id) {
      console.error('No audit session found');
      console.error('Audit session state:', auditSession);
      Alert.alert(
        'Error',
        'No active audit session found. Please select a route first.',
      );
      return false;
    }

    try {
      console.log('Submitting POI inspection:', inspectionData);
      console.log('Session ID:', auditSession.session_id);
      console.log('POI ID:', inspectionData.poiId);

      const response = await auditAPI.submitPOIAudit(
        auditSession.session_id,
        inspectionData.poiId,
        inspectionData,
      );
      console.log('Server response:', response);

      // Fetch updated session data from backend instead of updating local state
      const updatedSession = await auditAPI.getAuditSession(
        auditSession.session_id,
      );
      setAuditSession(updatedSession);

      console.log('POI inspection submitted successfully');
      console.log('Updated session data from backend:', updatedSession);
      return true;
    } catch (error: any) {
      console.error('Error submitting POI inspection:', error);
      console.error('Error details:', error.response?.data || error.message);
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
          console.log(`Fetching full details for POI: ${routePOI.puid}`);
          const fullPOI = await poiAPI.getPOI(routePOI.puid);
          fullPOIs.push(fullPOI);
        }
      } catch (error) {
        console.error(`Error fetching POI ${routePOI.puid}:`, error);
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

      const buildingId = building.id || building.bu_code;
      if (buildingId) {
        try {
          const poisResponse = await poiAPI.getPOIsByBuilding(buildingId);
          if (poisResponse?.pois) {
            setPois(poisResponse.pois);
          }
        } catch (err) {
          console.error('Error loading POIs:', err);
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
      console.error('Error selecting building:', err);
      Alert.alert('Error', 'Failed to load building details');
    }
  };

  const handleRouteSelect = async (route: AuditRoute) => {
    console.log('Route selected:', route);
    console.log('Route POIs:', route.pois);
    if (route.pois && route.pois.length > 0) {
      console.log('First POI details:', route.pois[0]);
      console.log('First POI coordinates:', route.pois[0].coordinates);
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
      console.log('First POI after loading:', firstPOI);
      const coordinates = getTransformedPOICoordinates(firstPOI);
      console.log('Transformed coordinates:', coordinates);

      if (coordinates && mapRef.current) {
        console.log('Navigating to POI coordinates:', coordinates);
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
      console.log('No POI coordinates, trying building:', building);
      if (building && building.coordinates && mapRef.current) {
        console.log(
          'Navigating to building coordinates:',
          building.coordinates,
        );
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
      console.error('QR scan error:', error);
      Alert.alert('Error', 'Failed to process QR code');
    }
  };

  const handleAnchorScanned = (anchor: QRAnchor) => {
    setShowQRScanner(false);

    console.log('Anchor scanned:', anchor);

    // Try to find matching POI by name or ID
    const matchingPOI = findPOIByNameOrId(anchor.name, anchor.id);

    if (matchingPOI) {
      console.log('Found matching POI:', matchingPOI.name);

      // Get POI coordinates
      console.log('Getting POI coordinates for:', matchingPOI);
      const poiCoords = getTransformedPOICoordinates(matchingPOI);
      console.log('POI coordinates result:', poiCoords);
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

        console.log(`Scanned POI: ${matchingPOI.name} (Index: ${poiIndex})`);
        console.log(`Current POI Index: ${currentPOIIndex}`);

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

        // Calibrate PDR position using POI coordinates
        calibratePDRPosition(localCoords.x, localCoords.y, anchor.heading);

        // Calibrate Hogent PDR position using POI coordinates
        calibrateHogentPDRPosition(localCoords.x, localCoords.y, anchor.heading);

        // Set PDR starting position for indoor positioning
        setPdrStartPosition(poiCoords);

        console.log(
          `PDR calibrated to POI: ${matchingPOI.name} at local (${localCoords.x}, ${localCoords.y})`,
        );
        console.log(
          `PDR starting position set to: (${poiCoords.latitude}, ${poiCoords.longitude})`,
        );

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

        console.log(`PDR calibrated to anchor: (${x}, ${y})`);

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
       
       // Start Hogent PDR tracking
      startHogentPDRTracking().then(() => {
        console.log('Hogent PDR tracking started');
      }).catch((error) => {
        console.error('Failed to start Hogent PDR tracking:', error);
      });
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
    console.log(
      'moveToNextPOI called. Current index:',
      currentPOIIndex,
      'Total POIs:',
      pois.length,
    );

    if (currentPOIIndex < pois.length - 1) {
      // Mark current POI as completed
      setCompletedPOIs(prev => new Set([...prev, currentPOIIndex]));

      // Move to next POI
      const newIndex = currentPOIIndex + 1;
      setCurrentPOIIndex(newIndex);
      console.log(
        `Moved to next POI: ${getCurrentPOI()?.name} (Index: ${newIndex})`,
      );
    } else {
      // Mark last POI as completed
      setCompletedPOIs(prev => new Set([...prev, currentPOIIndex]));

      // All POIs completed
      setIsNavigating(false);
      console.log('All POIs completed!');
      Alert.alert('Route Complete', 'All POIs have been visited!');
    }
  };

  // Handle inspection form submission
  const handleInspectionSubmit = async (inspectionData: InspectionData) => {
    console.log('Submitting inspection data:', inspectionData);
    console.log('Current POI index before submission:', currentPOIIndex);

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
      console.log(
        'Found POI index:',
        poiIndex,
        'for POI ID:',
        inspectionData.poiId,
      );
      console.log('Current POI index:', currentPOIIndex);
      console.log('Completed POIs from backend:', auditSession?.completed_pois);

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
          console.log('Moving to next POI from index:', currentPOIIndex);
          moveToNextPOI();
        } else {
          console.log(
            'POI index mismatch. Current:',
            currentPOIIndex,
            'Submitted:',
            poiIndex,
          );
          // Force update to next POI if there's a mismatch
          if (poiIndex < currentPOIIndex) {
            console.log('POI already completed, moving to next');
            moveToNextPOI();
          }
        }
      } else {
        console.error('POI not found in route for ID:', inspectionData.poiId);
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
      console.log(
        `Found closest POI: ${closestPOI?.name} at distance: ${minDistance}`,
      );
      return closestPOI;
    }

    console.log(
      `No POI found within threshold. Closest distance: ${minDistance}`,
    );
    return null;
  };

  const findPOIByNameOrId = (name: string, id: string): POI | null => {
    if (!pois || pois.length === 0) return null;

    console.log(`Searching for POI with name: "${name}" or id: "${id}"`);
    console.log(
      'Available POIs:',
      pois.map(p => ({ name: p.name, puid: p.puid, id: p.id })),
    );

    // Try to find by exact name match first
    let matchingPOI = pois.find(
      poi =>
        poi.name === name ||
        poi.name === id ||
        poi.title === name ||
        poi.title === id,
    );

    if (matchingPOI) {
      console.log(`Found POI by name: ${matchingPOI.name}`);
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
      console.log(`Found POI by ID: ${matchingPOI.name}`);
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
      console.log(`Found POI by partial name match: ${matchingPOI.name}`);
      return matchingPOI;
    }

    console.log(`No POI found matching "${name}" or "${id}"`);
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
      console.log('PDR Breadcrumb Trail: No starting position');
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
      console.log(`PDR Breadcrumb Trail: ${completePath.length} points, showing path walked`);
      
      // Debug: Show first few path points
      if (pathPoints.length > 0) {
        console.log(`First path point: (${pathPoints[0].latitude.toFixed(6)}, ${pathPoints[0].longitude.toFixed(6)})`);
        if (pathPoints.length > 1) {
          console.log(`Last path point: (${pathPoints[pathPoints.length - 1].latitude.toFixed(6)}, ${pathPoints[pathPoints.length - 1].longitude.toFixed(6)})`);
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
      console.log('POI is null or undefined');
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
      console.log('Invalid coordinates:', poiLat, poiLng);
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
      console.log('Navigation started');
    } catch (error) {
      console.error('Failed to start navigation:', error);
      Alert.alert('Error', 'Failed to start navigation');
    }
  };

  const stopNavigation = () => {
    navService.current.stopRoute();
    console.log('Navigation stopped');
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

          {floorPlanData && (
                  <TouchableOpacity
                    style={[
                styles.pdrCardButton,
                showFloorPlan
                  ? styles.pdrCardButtonActive
                  : styles.pdrCardButtonInactive,
              ]}
              onPress={() => setShowFloorPlan(!showFloorPlan)}
            >
              <Text style={styles.pdrCardButtonIcon}>
                {showFloorPlan ? '🏢' : '📐'}
              </Text>
              <Text style={styles.pdrCardButtonText}>
                {showFloorPlan ? 'Hide Floor' : 'Show Floor'}
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
              <Text style={styles.pdrValueLabel}>Hogent Steps:</Text>
              <Text style={[styles.pdrValueText, { color: '#00FF00' }]}>
                {hogentStepCount}
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

  {/* COORDINATE SYSTEM TEST - Visual test markers */}
  {isPDRTracking && pdrStartPosition && (
    <>
      {/* North marker */}
      <Marker
        coordinate={{
          latitude: pdrStartPosition.latitude + 0.0001,
          longitude: pdrStartPosition.longitude
        }}
        title="North Test"
        description="Should be North of starting point"
      >
        <View style={styles.testMarker}>
          <Text style={styles.testMarkerText}>N</Text>
              </View>
      </Marker>
      
      {/* East marker */}
      <Marker
        coordinate={{
          latitude: pdrStartPosition.latitude,
          longitude: pdrStartPosition.longitude + 0.0001
        }}
        title="East Test"
        description="Should be East of starting point"
      >
        <View style={styles.testMarker}>
          <Text style={styles.testMarkerText}>E</Text>
          </View>
      </Marker>
    </>
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

  {/* PDR CURRENT POSITION - Small red dot at current position */}
  {isPDRTracking && pdrPosition && pdrStartPosition && (
    <Marker
      key="current-pdr-position"
      coordinate={{
        latitude: pdrStartPosition.latitude + (pdrPosition.x * 0.00001),
        longitude: pdrStartPosition.longitude + (pdrPosition.y * 0.00001)
      }}
      title="Your Position"
      description="Live PDR tracking"
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <View style={styles.pdrCurrentPositionMarker}>
        <View style={styles.pdrCurrentPositionMarkerInner} />
          </View>
    </Marker>
  )}

  {/* HOGENT PDR CURRENT POSITION - Green dot at current position */}
  {isHogentPDRTracking && hogentPDRPosition && pdrStartPosition && (
    <Marker
      key="hogent-pdr-position"
      coordinate={{
        latitude: pdrStartPosition.latitude + (hogentPDRPosition.x * 0.00001),
        longitude: pdrStartPosition.longitude + (hogentPDRPosition.y * 0.00001)
      }}
      title="Hogent PDR Position"
      description="EXACT Hogent implementation"
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <View style={styles.hogentPDRPositionMarker}>
        <View style={styles.hogentPDRPositionMarkerInner} />
            </View>
    </Marker>
  )}

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

  {/* Floor Plan Overlay */}
  {showFloorPlan && floorPlanData && (
    <Overlay
      image={{ uri: floorPlanData.image }}
      bounds={[
        [floorPlanData.bounds.southWest.latitude, floorPlanData.bounds.southWest.longitude],
        [floorPlanData.bounds.northEast.latitude, floorPlanData.bounds.northEast.longitude]
      ]}
      opacity={0.7}
    />
  )}

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

  // Test Marker Styles
  testMarker: {
    backgroundColor: '#FF0000',
    padding: 8,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  testMarkerText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 12,
  },

  // Test Marker Styles - For coordinate system verification
  testMarker: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#00FF00',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 6,
  },
  testMarkerText: {
    color: '#000000',
    fontWeight: 'bold',
    fontSize: 14,
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

  // Hogent PDR Position Marker Styles - Green dot for EXACT Hogent implementation
  hogentPDRPositionMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#00FF00',
    borderWidth: 4,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
    elevation: 8,
  },
  hogentPDRPositionMarkerInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
  },
});

export default MapScreen;
