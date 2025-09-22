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
import { useFocusEffect } from '@react-navigation/native';
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
import { useWalkingTime } from '../hooks/useWalkingTime';
import { AuditService } from '../services/auditService';
import { CoordinateService } from '../services/coordinateService';
import { formatWalkingTime, getCurrentStepText, getSessionStatusText } from '../utils/helpers';
import InstructionsPanel from '../components/InstructionsPanel';
import FloatingActionButtons from '../components/FloatingActionButtons';
import SessionStatus from '../components/SessionStatus';
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
  latitudeDelta: 0.01, // Better default zoom to show building context
  longitudeDelta: 0.01, // Better default zoom to show building context
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

  // Audit session state - fully dynamic from server
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
  
  // Current POI to scan - fetched from server
  const [currentPOIToScan, setCurrentPOIToScan] = useState<POI | null>(null);
  const [sessionProgress, setSessionProgress] = useState<{
    completed: number;
    total: number;
    remaining: number;
  } | null>(null);
  const [isSessionComplete, setIsSessionComplete] = useState(false);
  
  const [showInspectionForm, setShowInspectionForm] = useState(false);
  const [currentInspectionPOI, setCurrentInspectionPOI] = useState<POI | null>(
    null,
  );
  // Live PDR Pointer using AnimatedRegion for smooth movement
  const [pdrAnimatedRegion, setPdrAnimatedRegion] =
    useState<AnimatedRegion | null>(null);
  const [isPdrPointerInitialized, setIsPdrPointerInitialized] = useState(false);
  const [isNavigatingToRoute, setIsNavigatingToRoute] = useState(false);
  const [isSessionHeaderCollapsed, setIsSessionHeaderCollapsed] = useState(true);
  
  // Walking time tracking using custom hook
  const {
    walkingStartTime,
    lastPOICompletionTime,
    currentWalkingTime,
    isWalking,
    resetWalkingTime,
    updateWalkingTimeForPOI,
  } = useWalkingTime(isPDRTracking, pdrPosition, auditSession);
  
  const [showInstructions, setShowInstructions] = useState(false);
  const [isMapReady, setIsMapReady] = useState(false);
  const [lastCalibratedPOI, setLastCalibratedPOI] = useState<POI | null>(null);


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


  // PDR Position Update Handler with throttling for realistic movement
  const lastPDRUpdate = useRef<number>(0);
  const PDR_UPDATE_INTERVAL = 10000; // Update every 10 seconds for very slow, realistic indoor movement

  const handlePDRPositionUpdate = useCallback(
    (position: HogentPDRPosition) => {
      const now = Date.now();
      
      // Throttle updates to make movement more realistic
      if (now - lastPDRUpdate.current < PDR_UPDATE_INTERVAL) {
        return;
      }
      
      lastPDRUpdate.current = now;
      
      // Update animated region for smooth movement with realistic scaling
      if (pdrAnimatedRegion && isPdrPointerInitialized && pdrStartPosition) {
        // Use very small scaling factor for realistic indoor movement
        const SCALE_FACTOR = 0.0000005; // Even smaller for more realistic indoor movement
        const pdrCoords = {
          latitude: pdrStartPosition.latitude + (position.x * SCALE_FACTOR),
          longitude: pdrStartPosition.longitude + (position.y * SCALE_FACTOR)
        };

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
    [pdrAnimatedRegion, isPdrPointerInitialized, pdrStartPosition],
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
  }, []);

  // Restore state when component mounts (for navigation back)
  useEffect(() => {
    const restoreState = async () => {
      // If we have a selected route but no POIs, reload them
      if (selectedRoute && pois.length === 0) {
        await loadRoutePOIs(selectedRoute);
      }
    };

    restoreState();
  }, [selectedRoute]);




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
        
        // PDR is now manual only - user must click Start PDR button
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
      const lat = parseFloat(selectedBuilding.coordinates?.latitude?.toString() || '0');
      const lng = parseFloat(selectedBuilding.coordinates?.longitude?.toString() || '0');
      
      if (lat !== 0 && lng !== 0) {
        mapRef.current.animateToRegion({
          latitude: lat,
          longitude: lng,
          latitudeDelta: 0.005, // Better zoom for building context
          longitudeDelta: 0.005, // Better zoom for building context
        }, 1000);
      }
    }
  }, [selectedBuilding]);

  // Navigate to route POIs when they change
  useEffect(() => {
    if (selectedRoute && pois && pois.length > 0 && mapRef.current && !isNavigatingToRoute) {
      const validCoordinates = [];
      for (const poi of pois) {
        const coordinates = CoordinateService.getTransformedPOICoordinates(poi);
        if (coordinates) {
          validCoordinates.push(coordinates);
        }
      }
      
      if (validCoordinates.length > 0) {
        const { center, zoomLevel } = CoordinateService.calculateOptimalView(validCoordinates);
        const region = {
          latitude: center.latitude,
          longitude: center.longitude,
          latitudeDelta: zoomLevel,
          longitudeDelta: zoomLevel,
        };
        setRegion(region);
        if (mapRef.current && isMapReady) {
          try {
            mapRef.current.animateToRegion(region, 1000);
          } catch (error) {
            // Silent error handling
          }
        }
      }
    }
  }, [pois, selectedRoute]);

  // Restore state when screen comes back into focus (for navigation back)
  useFocusEffect(
    useCallback(() => {
      const restoreState = async () => {
        // If we have a selected route but no POIs, reload them
        if (selectedRoute && pois.length === 0) {
          await loadRoutePOIs(selectedRoute);
        }

        // Restore map view if we have POIs
        if (selectedRoute && pois.length > 0 && mapRef.current) {
          setTimeout(() => {
            const validCoordinates = [];
            for (const poi of pois) {
              const coordinates = CoordinateService.getTransformedPOICoordinates(poi);
              if (coordinates) {
                validCoordinates.push(coordinates);
              }
            }
            
            if (validCoordinates.length > 0) {
              const { center, zoomLevel } = CoordinateService.calculateOptimalView(validCoordinates);
              const region = {
                latitude: center.latitude,
                longitude: center.longitude,
                latitudeDelta: zoomLevel,
                longitudeDelta: zoomLevel,
              };
              setRegion(region);
              if (mapRef.current && isMapReady) {
                try {
                  mapRef.current.animateToRegion(region, 1000);
                } catch (error) {
                  // Silent error handling
                }
              }
            }
          }, 500);
        }
      };

      restoreState();
    }, [selectedRoute, pois])
  );


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

  // Initialize PDR animated region when PDR starts
  useEffect(() => {
    if (isPDRTracking && pdrStartPosition && !pdrAnimatedRegion) {
      const animatedRegion = new AnimatedRegion({
        latitude: pdrStartPosition.latitude,
        longitude: pdrStartPosition.longitude,
        latitudeDelta: 0.001,
        longitudeDelta: 0.001,
      });
      setPdrAnimatedRegion(animatedRegion);
      setIsPdrPointerInitialized(true);
    }
  }, [isPDRTracking, pdrStartPosition, pdrAnimatedRegion]);

  // Update PDR position when PDR data changes
  useEffect(() => {
    if (pdrPosition && isPDRTracking && pdrStartPosition) {
      handlePDRPositionUpdate(pdrPosition);
    }
  }, [pdrPosition, isPDRTracking, pdrStartPosition, handlePDRPositionUpdate]);

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
      // Clear POIs first to ensure fresh state
      setPois([]);
      
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
            name: route.buildingName || 'Route Building',
            coordinates: (route as any).building_lat && (route as any).building_lng ? {
              latitude: parseFloat((route as any).building_lat),
              longitude: parseFloat((route as any).building_lng)
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
          // Set POIs immediately
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
                    }
                  });
                }, 1500);
              }
            } else {
              setPois([]);
            }
          } catch (poiError) {
            setPois([]);
          }
        } else {
          setPois([]);
        }
      }
    } catch (error) {
    }
  };


  // Start audit session - fully dynamic
  const startAuditSession = async (routeId: string) => {
    try {
      const { sessionId, sessionData } = await AuditService.startAuditSession(routeId);
      setAuditSession(sessionData);
      await fetchNextPOI(sessionId);
      return sessionId;
    } catch (error: any) {
      Alert.alert('Error', `Failed to start audit session: ${error.message}`);
      return null;
    }
  };

  // Fetch next POI to scan from server
  const fetchNextPOI = async (sessionId: string) => {
    try {
      const response = await AuditService.fetchNextPOI(sessionId);
      
      if (response.is_complete) {
        setIsSessionComplete(true);
        setCurrentPOIToScan(null);
        setSessionProgress(response.progress);
        
        // Auto-end session when all POIs are completed
      Alert.alert(
          'All POIs Completed!',
          'Congratulations! You have successfully completed all POIs in this audit route. The session will now end automatically.',
          [
            {
              text: 'End Session',
              onPress: async () => {
                // Stop PDR tracking
                if (isPDRTracking) {
                  stopPDRTracking();
                }
                // End the audit session
                await endAuditSession();
              }
            }
          ]
        );
      } else {
        setCurrentPOIToScan(response.poi);
        setSessionProgress(response.progress);
        setIsSessionComplete(false);
      }
    } catch (error: any) {
      Alert.alert('Error', `Failed to fetch next POI: ${error.message}`);
    }
  };

  // End audit session - fully dynamic
  const endAuditSession = async () => {
    if (!AuditService.validateSessionState(auditSession, 'session ending')) return;

    try {
      // Check if any POIs were actually scanned (use server data)
      if (auditSession.completed_pois.length === 0) {
        Alert.alert(
          'No POIs Scanned',
          'You haven\'t scanned any POIs yet. Are you sure you want to end this session?',
          [
            { text: 'Cancel', style: 'cancel' },
            { 
              text: 'End Anyway', 
              style: 'destructive',
              onPress: () => confirmEndSession()
            }
          ]
        );
        return;
      }

      await confirmEndSession();
    } catch (error: any) {
      Alert.alert('Error', `Failed to end audit session: ${error.message}`);
    }
  };

  const confirmEndSession = async () => {
    try {
      await AuditService.endAuditSession(auditSession!.session_id);

      // Clear all local state - don't fetch updated session data
      setAuditSession(null);
        setIsNavigating(false);
        setCurrentPOIIndex(0);
        setCompletedPOIs(new Set());
        setPdrStartPosition(null);
      setSelectedRoute(null);
      setCurrentPOIToScan(null);
      setSessionProgress(null);
      setIsSessionComplete(false);
      setNavigationState(null);
      
      
      // Reset walking time tracking
      resetWalkingTime();
      
      // Stop PDR if running
      if (isPDRTracking) {
        stopPDRTracking();
      }

      Alert.alert(
        'Session Ended',
        'Audit session has been ended. You can start a new session anytime.',
      );
    } catch (error: any) {
      Alert.alert('Error', `Failed to end audit session: ${error.message}`);
    }
  };

  // Submit POI inspection data - fully dynamic
  const submitPOIInspection = async (inspectionData: InspectionData) => {
    if (!AuditService.validateSessionState(auditSession, 'POI inspection submission')) {
      Alert.alert('Error', 'No active audit session found. Please select a route first.');
      return false;
    }

    try {
      // Calculate walking time for this POI
      const walkingTimeForPOI = lastPOICompletionTime 
        ? Math.floor((new Date().getTime() - lastPOICompletionTime.getTime()) / 1000)
        : currentWalkingTime;

      const success = await AuditService.submitPOIInspection(
        auditSession.session_id,
        inspectionData,
        walkingTimeForPOI,
        formatWalkingTime
      );

      if (success) {
        // Update walking time tracking
        updateWalkingTimeForPOI();
        
        // CALIBRATE USER POSITION TO SCANNED POI
        // Use the current POI to scan (from server) instead of local index
        const currentPOI = currentPOIToScan;
        console.log('🔍 Current POI to scan:', currentPOI?.name, 'ID:', currentPOI?.puid || currentPOI?.id);
        if (currentPOI && pdrStartPosition) {
          const poiCoords = CoordinateService.getTransformedPOICoordinates(currentPOI);
          if (poiCoords) {
            console.log('🎯 Calibrating to POI:', currentPOI.name, 'at coordinates:', poiCoords);
            
            // Update PDR start position to the POI location
            setPdrStartPosition(poiCoords);
            
            // Set this POI as the last calibrated POI
            setLastCalibratedPOI(currentPOI);
            
            // Reset PDR position to origin (0,0) relative to the new POI
            calibratePDRPosition(0, 0, pdrPosition?.heading || 0);
            
            // IMMEDIATELY move current location marker to POI coordinates
            // This ensures the marker shows the user is now at the POI location
            if (pdrAnimatedRegion) {
              pdrAnimatedRegion.setValue({
                latitude: poiCoords.latitude,
                longitude: poiCoords.longitude,
                latitudeDelta: 0.001,
                longitudeDelta: 0.001,
              });
            }
            
            // Force update the PDR position handler to reflect the new position
            // This ensures the marker moves to the POI location immediately
            setTimeout(() => {
              if (pdrPosition) {
                // Trigger a position update with the calibrated position
                handlePDRPositionUpdate({
                  ...pdrPosition,
                  x: 0,
                  y: 0,
                  timestamp: Date.now()
                });
              }
            }, 100);
            
            // Also force update the animated region immediately to show the marker at POI location
            if (pdrAnimatedRegion) {
              pdrAnimatedRegion.setValue({
                latitude: poiCoords.latitude,
                longitude: poiCoords.longitude,
                latitudeDelta: 0.001,
                longitudeDelta: 0.001,
              });
            }
            
            // Also update the map region to center on the POI
            if (mapRef.current && isMapReady) {
              try {
                mapRef.current.animateToRegion({
                  latitude: poiCoords.latitude,
                  longitude: poiCoords.longitude,
                  latitudeDelta: 0.001,
                  longitudeDelta: 0.001,
                }, 1000);
              } catch (error) {
                console.warn('Error animating to POI location:', error);
              }
            }
            
            // Show visual feedback that position has been calibrated
            Alert.alert(
              'Position Calibrated',
              `Your position has been calibrated to ${currentPOI.name}.\n\nYou are now at the POI location.`,
              [{ text: 'OK' }]
            );
            
            console.log('✅ Position calibrated to POI location');
          }
        }
        
        // Fetch updated session data from backend
        const updatedSession = await AuditService.getAuditSession(auditSession.session_id);
      setAuditSession(updatedSession);
        
        // Fetch next POI to scan
        await fetchNextPOI(auditSession.session_id);

      return true;
      } else {
        Alert.alert('Error', 'Failed to submit POI inspection data');
        return false;
      }
    } catch (error: any) {
      Alert.alert('Error', `Failed to submit inspection data: ${error.message}`);
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
          setPois([]);
        }
      }

      if (mapRef.current && building.coordinates && isMapReady) {
        try {
        mapRef.current.animateToRegion({
          latitude: building.coordinates.latitude,
          longitude: building.coordinates.longitude,
            latitudeDelta: 0.001, // Closer zoom for building selection
            longitudeDelta: 0.001, // Closer zoom for building selection
          }, 1000);
        } catch (error) {
          // Silent error handling
        }
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to load building details');
    }
  };

  const handleRouteSelect = async (route: AuditRoute) => {
    try {
      // CRITICAL: Reset all previous state before loading new route
      
      // Reset navigation flag
      setIsNavigatingToRoute(false);
      
      // Stop any active PDR tracking
      if (isPDRTracking) {
        stopPDRTracking();
      }
      
      // Reset PDR state completely
      resetPDR();
      setPdrStartPosition(null);
      setPdrAnimatedRegion(null);
      setIsPdrPointerInitialized(false);
      
      // Reset navigation state
      setIsNavigating(false);
      setCurrentPOIIndex(0);
      setCompletedPOIs(new Set());
      setNavigationState(null);
      
      // Reset building and floor state
      setSelectedBuilding(null);
      setSelectedFloor('');
      clearFloorPlan();
      
      // Reset audit session
      setAuditSession(null);
      setShowInspectionForm(false);
      setCurrentInspectionPOI(null);
      
      // Set the new route
    setSelectedRoute(route);

      // Load POI data for the new route
    await loadRoutePOIs(route);

      // Wait a bit for POIs to be set, then navigate to route location
      setTimeout(() => {
        // Double-check that POIs are loaded before navigating
        if (route.pois && route.pois.length > 0) {
          navigateToRouteLocation(route);
        } else {
          // Retry loading POIs
          setTimeout(() => {
            loadRoutePOIs(route).then(() => {
              navigateToRouteLocation(route);
            });
          }, 200);
        }
      }, 300);

      // Wait for POI data to be loaded, then initialize PDR
      setTimeout(async () => {
        
     if (selectedBuilding && pois && pois.length > 0) {
       // Ensure building has coordinates for coordinate transformation
       const buildingWithCoords = {
         ...selectedBuilding,
         coordinates: selectedBuilding.coordinates || {
           latitude: pois[0].coordinates?.lat || pois[0].latitude || 0,
           longitude: pois[0].coordinates?.lon || pois[0].longitude || 0,
         },
       };

          try {
            await initializePDRBuilding(buildingWithCoords, pois);
          } catch (error) {
            // Silent error handling
          }
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

        // Navigate to the new route location
      navigateToRouteLocation(route);
      }, 1000); // Increased delay to ensure all state is reset
      
    } catch (error) {
      Alert.alert('Error', 'Failed to load route. Please try again.');
    }
  };

  const navigateToRouteLocation = (route: AuditRoute) => {
    // Prevent multiple navigation calls
    if (isNavigatingToRoute) {
        return;
    }
    
    setIsNavigatingToRoute(true);
    
    // Use route POIs if available, otherwise use loaded POIs
    const poisToUse = route.pois && route.pois.length > 0 ? route.pois : pois;
    
    if (poisToUse && poisToUse.length > 0) {
      const success = CoordinateService.navigateToRouteLocation(
        route,
        poisToUse,
        mapRef,
        setRegion,
        setIsNavigatingToRoute
      );
      
      if (success) {
        // Show message to scan first POI
        setTimeout(() => {
      Alert.alert(
          'Route Selected',
            `Navigate to the first POI and scan the QR code to start PDR tracking.`,
          [
            { text: 'OK', style: 'default' },
            { text: 'Scan QR Now', onPress: () => handleQRScan() },
          ],
        );
        }, 1200); // Wait for animation to complete
      } else {
        setIsNavigatingToRoute(false);
      }
    } else {
      setIsNavigatingToRoute(false);
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
      Alert.alert('Error', 'Failed to process QR code');
    }
  };

  const handleAnchorScanned = (anchor: QRAnchor) => {
    setShowQRScanner(false);

    // Check if there's an active session and current POI to scan
    if (!auditSession || !currentPOIToScan) {
          Alert.alert(
        'No Active Session',
        'Please start an audit session first before scanning POIs.',
          );
          return;
        }

    // Check if the scanned POI matches the current POI to scan
    const scannedPOIId = anchor.id;
    const expectedPOIId = currentPOIToScan.puid || currentPOIToScan.id;
    
    
    if (scannedPOIId === expectedPOIId) {
      
      // Get POI coordinates for PDR calibration
      const poiCoords = getTransformedPOICoordinates(currentPOIToScan);
      if (poiCoords) {
        // Convert lat/lng to local coordinates for PDR
        const localCoords = toLocal(poiCoords.latitude, poiCoords.longitude);

        // Calibrate Hogent PDR position using POI coordinates
        calibratePDRPosition(localCoords.x, localCoords.y, anchor.heading);

        // Set PDR starting position for indoor positioning
        setPdrStartPosition(poiCoords);
        }

        // Show inspection form for POI scanning
      setCurrentInspectionPOI(currentPOIToScan);
        setShowInspectionForm(true);
      } else {
    Alert.alert(
        'Wrong POI',
        `Please scan the correct POI: ${currentPOIToScan.name}\n\nScanned: ${anchor.name}`,
        [
          { text: 'OK', style: 'default' },
          { 
            text: 'Scan Again', 
            onPress: () => setShowQRScanner(true)
          }
        ]
      );
    }
    if (navigationState?.isActive) {
      navService.current.calibratePosition(anchor);
    }
  };


  const startNavigationToNextPOI = () => {
    if (!selectedRoute || !pois || pois.length === 0) return;

    setIsNavigating(true);
    setCurrentPOIIndex(0); // Start with first POI

       // PDR tracking is now manual only
  };

  const getNextPOI = () => {
    if (!pois || currentPOIIndex >= pois.length - 1) return null;
    return pois[currentPOIIndex + 1];
  };

  const getCurrentPOI = () => {
    if (!pois || currentPOIIndex >= pois.length) return null;
    return pois[currentPOIIndex];
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

        // POI progression is now handled automatically by the server
        } else {
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
    if (!auditSession) {
      console.log('❌ No audit session for navigation path');
      return [];
    }

    // Use server-driven POI progression instead of local index
    const currentPOI = currentPOIToScan;
    if (!currentPOI) {
      console.log('❌ No current POI to scan for navigation path');
      return [];
    }

    console.log('🔍 Navigation path - Current POI:', currentPOI.name, 'ID:', currentPOI.puid || currentPOI.id);

    // Find the next POI in the route sequence
    const currentPOIIndex = pois.findIndex(poi => 
      poi.puid === currentPOI.puid || poi.id === currentPOI.id
    );
    
    console.log('🔍 Navigation path - Current POI index:', currentPOIIndex, 'Total POIs:', pois.length);
    
    if (currentPOIIndex === -1 || currentPOIIndex >= pois.length - 1) {
      console.log('❌ No next POI available for navigation path');
      return [];
    }

    const nextPOI = pois[currentPOIIndex + 1];
    if (!nextPOI) {
      console.log('❌ Next POI not found');
      return [];
    }

    console.log('🔍 Navigation path - Next POI:', nextPOI.name, 'ID:', nextPOI.puid || nextPOI.id);

    const currentCoords = getTransformedPOICoordinates(currentPOI);
    const nextCoords = getTransformedPOICoordinates(nextPOI);

    if (!currentCoords || !nextCoords) {
      console.log('❌ Invalid coordinates for navigation path');
      return [];
    }

    console.log('✅ Navigation path coordinates:', {
      current: currentCoords,
      next: nextCoords
    });

    // Create path from current POI to next POI
    return [currentCoords, nextCoords];
  };

  // Get dynamic path progress - shows how far user has traveled along the path
  const getDynamicPathProgress = () => {
    if (!auditSession) return [];

    // Use server-driven POI progression instead of local index
    const currentPOI = currentPOIToScan;
    if (!currentPOI) return [];

    // Find the next POI in the route sequence
    const currentPOIIndex = pois.findIndex(poi => 
      poi.puid === currentPOI.puid || poi.id === currentPOI.id
    );
    
    if (currentPOIIndex === -1 || currentPOIIndex >= pois.length - 1) return [];

    const nextPOI = pois[currentPOIIndex + 1];
    if (!nextPOI) return [];

    const currentCoords = getTransformedPOICoordinates(currentPOI);
    const nextCoords = getTransformedPOICoordinates(nextPOI);

    if (!currentCoords || !nextCoords) return [];

    // If PDR is not active, just show the full path
    if (!pdrPosition) {
      return [currentCoords, nextCoords];
    }

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

  // Get recent walking path (last 10 points) for smooth Google Maps-like navigation
  const getRecentWalkingPath = () => {
    if (!pdrStartPosition || !pathHistory || pathHistory.length === 0) {
      return [];
    }
    
    // Take only the last 15 points to avoid long trails
    const recentPoints = pathHistory.slice(-15);
    
    // Much smaller scaling factor for realistic indoor movement
    const SCALE_FACTOR = 0.0000005; // Even smaller for more realistic indoor movement
    const MIN_DISTANCE = 0.5; // Minimum distance in meters to add a point
    
    const smoothedPath = [];
    let lastValidPoint = null;
    
    for (let i = 0; i < recentPoints.length; i++) {
      const point = recentPoints[i];
      const lat = pdrStartPosition.latitude + (point.x * SCALE_FACTOR);
      const lng = pdrStartPosition.longitude + (point.y * SCALE_FACTOR);
      
      // Check if this point is far enough from the last valid point
      if (lastValidPoint) {
        const distance = Math.sqrt(
          Math.pow(point.x - lastValidPoint.x, 2) + 
          Math.pow(point.y - lastValidPoint.y, 2)
        );
        
        if (distance < MIN_DISTANCE) {
          continue; // Skip this point if too close
        }
      }
      
      smoothedPath.push({ latitude: lat, longitude: lng });
      lastValidPoint = point;
    }
    
    return smoothedPath;
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
    return CoordinateService.getTransformedPOICoordinates(poi);
  };

  const startNavigation = async () => {
    
    if (!selectedRoute?.pois) {
      Alert.alert('Error', 'No route selected');
      return;
    }

    // Check if there's already an active session
    if (auditSession?.session_status === 'active') {
      Alert.alert(
        'Session Already Active',
        'There is already an active audit session. Please end the current session before starting a new one.',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'End Current & Start New', 
            style: 'destructive',
            onPress: () => {
              endAuditSession().then(() => {
                // Start new session after ending current one
                setTimeout(() => startNavigation(), 1000);
              });
            }
          }
        ]
      );
      return;
    }

    try {
      
      // 1. Start audit session with server
      const sessionId = await startAuditSession(selectedRoute.id);
      if (!sessionId) {
        Alert.alert('Error', 'Failed to start audit session');
        return;
      }


      // 2. Initialize PDR tracking if not already active
      if (!isPDRTracking && selectedBuilding && pois && pois.length > 0) {
        initializePDRBuilding(selectedBuilding, pois);
        // Don't auto-start PDR - user must click Start PDR button
      }

      // 3. Start local navigation service
      navService.current.startRoute(selectedRoute, selectedRoute.pois);
      
      // 4. Navigate to route location on map
      navigateToRouteLocation(selectedRoute);
      
      // 5. Update UI state
      setIsNavigating(true);
      setCurrentPOIIndex(0);
      setNavigationState({ isActive: true });
      
      
      // Show instructions for first-time users
      setShowInstructions(true);
      
      Alert.alert(
        'Route Started', 
        `Audit session started for: ${selectedRoute.name}\n\nFollow the instructions to complete the audit.`
      );
      
    } catch (error) {
      Alert.alert('Error', `Failed to start navigation: ${error.message}`);
    }
  };

  const stopNavigation = async () => {
    try {
      // Check if any POIs were actually scanned (use server data)
      if (auditSession?.completed_pois?.length === 0) {
        Alert.alert(
          'No POIs Scanned',
          'You haven\'t scanned any POIs yet. Are you sure you want to end this session?',
          [
            { text: 'Cancel', style: 'cancel' },
            { 
              text: 'End Anyway', 
              style: 'destructive',
              onPress: () => confirmStopNavigation()
            }
          ]
        );
      return;
    }

      await confirmStopNavigation();
    } catch (error) {
      Alert.alert('Error', `Failed to stop navigation: ${error.message}`);
    }
  };

  const confirmStopNavigation = async () => {
    try {
      // 1. Stop local navigation service
    navService.current.stopRoute();
      
      // 2. Stop PDR tracking
      if (isPDRTracking) {
        stopPDRTracking();
      }
      
      // 3. End audit session if active
      if (auditSession?.session_status === 'active') {
        await AuditService.endAuditSession(auditSession.session_id);
      }
      
      // 4. Clear all local state
      setAuditSession(null);
      setIsNavigating(false);
      setCurrentPOIIndex(0);
      setCompletedPOIs(new Set());
      setPdrStartPosition(null);
      setSelectedRoute(null);
      setCurrentPOIToScan(null);
      setSessionProgress(null);
      setIsSessionComplete(false);
      setNavigationState(null);
      
      // 5. Reset walking time tracking
      resetWalkingTime();
      
      // 6. Stop PDR if running
      if (isPDRTracking) {
        stopPDRTracking();
      }
    } catch (error: any) {
      Alert.alert('Error', `Failed to end audit session: ${error.message}`);
    }
  };

  // Force map to show POI locations when POIs are loaded
  useEffect(() => {
    if (pois.length > 0 && !isNavigating) {
      const validCoordinates = [];
      for (const poi of pois) {
        const coordinates = CoordinateService.getTransformedPOICoordinates(poi);
        if (coordinates) {
          validCoordinates.push(coordinates);
        }
      }
      
      if (validCoordinates.length > 0) {
        // Use hardcoded region based on the POI coordinates
        const region = {
          latitude: 31.5151, // Center of the POI coordinates
          longitude: 74.2975,
          latitudeDelta: 0.001, // Very close zoom
          longitudeDelta: 0.001,
        };
        
        setRegion(region);
        
        // Retry mechanism if map isn't ready
        const tryAnimateToRegion = () => {
          if (mapRef.current && isMapReady) {
            try {
              mapRef.current.animateToRegion(region, 1000);
            } catch (error) {
              // Silent error handling
            }
          } else {
            setTimeout(tryAnimateToRegion, 500);
          }
        };
        
        tryAnimateToRegion();
      }
    }
  }, [pois, isNavigating, isMapReady]);

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
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Floor Selector - Hidden for automatic mode */}
      {false && selectedBuilding && selectedBuilding?.floors && (selectedBuilding?.floors?.length ?? 0) > 0 && (
        <View style={styles.floorSelector}>
          <Text style={styles.floorSelectorLabel}>Select Floor:</Text>
          <View style={styles.floorButtons}>
            {selectedBuilding?.floors?.map((floor) => (
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

      {/* Session Status Component */}
      <SessionStatus
        auditSession={auditSession}
        sessionProgress={sessionProgress}
        currentPOIToScan={currentPOIToScan}
        isPDRTracking={isPDRTracking}
        isSessionComplete={isSessionComplete}
        currentWalkingTime={currentWalkingTime}
        isWalking={isWalking}
        pdrPosition={pdrPosition}
        stepCount={stepCount}
        formatWalkingTime={formatWalkingTime}
      />

      {/* Instructions Panel */}
      <InstructionsPanel
        visible={showInstructions}
        onClose={() => setShowInstructions(false)}
      />

      {/* Floating Action Buttons Component */}
      <FloatingActionButtons
        onQRScan={handleQRScan}
        onPDRToggle={() => {
          if (isPDRTracking) {
            stopPDRTracking();
                      } else {
                  startPDRTracking();
          }
        }}
        onPDRReset={() => {
          // Stop PDR tracking if active
          if (isPDRTracking) {
            stopPDRTracking();
          }
          
          // Reset PDR completely
          resetPDR();
          
          // Clear PDR state
          setPdrStartPosition(null);
          setPdrAnimatedRegion(null);
          setIsPdrPointerInitialized(false);
          setLastCalibratedPOI(null);
          
          // Show confirmation
          Alert.alert(
            'PDR Reset',
            'PDR has been reset successfully. You can start fresh tracking.',
            [{ text: 'OK' }]
          );
        }}
        onRouteToggle={auditSession?.session_status === 'active' ? stopNavigation : startNavigation}
        onShowHelp={() => setShowInstructions(true)}
        isPDRTracking={isPDRTracking}
        selectedRoute={selectedRoute}
        auditSession={auditSession}
      />


      {/* PDR Values Display - Hogent Style (Legacy) */}
      {false && isPDRTracking && pdrPosition && (
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
          onMapReady={() => {
            setIsMapReady(true);
          }}
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
              <FloorPlanOverlay
              imageUri={floorPlan.floor_plan_base64_data.startsWith('data:') 
                ? floorPlan.floor_plan_base64_data 
                : `data:image/png;base64,${floorPlan.floor_plan_base64_data}`}
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
  {(() => {
    const hasSession = !!auditSession;
    const pathCoords = getDynamicPathProgress();
    const hasPath = pathCoords.length > 1;
    
    console.log('🟢 Green line check:', {
      hasSession,
      pathCoordsLength: pathCoords.length,
      hasPath,
      pathCoords
    });
    
    return hasSession && hasPath ? (
    <Polyline
        coordinates={pathCoords}
      strokeColor="#00FF00"
      strokeWidth={6}
      lineDashPattern={[8, 4]}
    />
    ) : null;
  })()}

  {/* Remaining Path - Shows remaining path to next POI */}
  {auditSession && getNavigationPathCoordinates().length > 1 && (() => {
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


  {/* PDR WALKING PATH - Shows recent walking path like Google Maps */}
  {(() => {
    const path = getRecentWalkingPath();
    
    // Show path if we have PDR data, or show a test path if PDR is tracking but no history
    if (isPDRTracking && pdrStartPosition) {
      if (path.length > 1) {
        return (
    <Polyline
            coordinates={path}
      strokeColor="#FF0000"
            strokeWidth={12}
            lineCap="round"
            lineJoin="round"
          />
        );
      } else if (pathHistory && pathHistory.length === 0) {
        // Show a test path to verify polyline is working
        const testPath = [
          { latitude: pdrStartPosition.latitude, longitude: pdrStartPosition.longitude },
          { 
            latitude: pdrStartPosition.latitude + 0.0001, 
            longitude: pdrStartPosition.longitude + 0.0001 
          }
        ];
                      return (
          <Polyline
            coordinates={testPath}
            strokeColor="#00FF00"
            strokeWidth={6}
            lineCap="round"
            lineJoin="round"
          />
        );
      }
    }
    
    return null;
  })()}

  {/* LIVE USER COMPASS MARKER - Single marker showing user position and direction */}
  {((isPDRTracking && pdrPosition && pdrStartPosition)) && (() => {
    let finalHeading = pdrPosition?.heading !== undefined ? pdrPosition.heading : 0;
    
    // Normalize heading to 0-360 range
    if (finalHeading > 360) {
      finalHeading = finalHeading % 360;
    } else if (finalHeading < 0) {
      finalHeading = ((finalHeading % 360) + 360) % 360;
    }
    
    const currentCoords = {
      latitude: pdrStartPosition.latitude + ((pdrPosition?.x || 0) * 0.0000005),
      longitude: pdrStartPosition.longitude + ((pdrPosition?.y || 0) * 0.0000005)
    };
    
    return (
      <CompassNeedleMarker
        key="live-user-compass"
        coordinate={currentCoords}
        heading={finalHeading}
        size={16}
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


  {/* Static POI Markers (when not navigating) - TEMPORARILY ALWAYS SHOW */}
  {pois.map((poi, index) => {
    if (!poi) return null;

    const coordinates = getTransformedPOICoordinates(poi);
    
    if (!coordinates) {
      return null;
    }

    // Check if this is the last calibrated POI
    const isLastCalibrated = lastCalibratedPOI && (lastCalibratedPOI.id === poi.id || lastCalibratedPOI.puid === poi.puid);

    return (
      <Marker
        key={poi.id || poi.puid || `poi_${index}`}
        coordinate={coordinates}
        title={poi.name || poi.title || 'POI'}
        description={poi.description || poi.pois_type || poi.type || 'Point of Interest'}
        pinColor={isLastCalibrated ? '#FFD700' : '#2196F3'}
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
  // New Collapsible Session Header Styles
  sessionHeader: {
    backgroundColor: '#1a1a1a',
    margin: 10,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
    overflow: 'hidden',
  },
  sessionHeaderBar: {
    backgroundColor: '#2a2a2a',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  sessionHeaderBarContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sessionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  sessionHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sessionHeaderContent: {
    padding: 16,
  },
  sessionStatusBadge: {
    backgroundColor: '#ff4444',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  sessionStatusText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  sessionProgressBadge: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  sessionProgressText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  sessionIdText: {
    color: '#ccc',
    fontSize: 10,
    fontFamily: 'monospace',
    marginRight: 8,
  },
  sessionCurrentPOI: {
    color: '#FFD700',
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  collapseIcon: {
    color: '#888',
    fontSize: 16,
    fontWeight: 'bold',
  },
  currentPOIRow: {
    backgroundColor: '#2a2a2a',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#FFD700',
  },
  currentPOILabel: {
    color: '#FFD700',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  currentPOIName: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  sessionCompleteRow: {
    backgroundColor: '#2a2a2a',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#4CAF50',
  },
  sessionCompleteText: {
    color: '#4CAF50',
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  pdrDataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#2a2a2a',
    padding: 12,
    borderRadius: 8,
  },
  pdrDataColumn: {
    alignItems: 'center',
    flex: 1,
  },
  pdrDataLabel: {
    color: '#888',
    fontSize: 10,
    marginBottom: 4,
  },
  pdrDataValue: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  // Floating Session Button
  floatingSessionButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
    borderWidth: 2,
    borderColor: '#ff4444',
    minWidth: 120,
    alignItems: 'center',
  },
  floatingSessionButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
  },
  floatingSessionButtonPOI: {
    color: '#FFD700',
    fontSize: 12,
    fontWeight: 'bold',
    marginTop: 4,
    textAlign: 'center',
  },
  // Live PDR Section Styles (Legacy)
  livePDRSection: {
    backgroundColor: '#1a1a1a',
    margin: 10,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  livePDRHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  livePDRTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  livePDRStatus: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  livePDRIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00FF00',
    marginRight: 6,
  },
  livePDRStatusText: {
    color: '#00FF00',
    fontSize: 12,
    fontWeight: 'bold',
  },
  livePDRData: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  livePDRDataItem: {
    alignItems: 'center',
    flex: 1,
  },
  livePDRDataLabel: {
    color: '#888',
    fontSize: 10,
    marginBottom: 4,
  },
  livePDRDataValue: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
});

export default MapScreen;
