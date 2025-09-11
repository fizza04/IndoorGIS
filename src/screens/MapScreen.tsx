import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  ActivityIndicator,
  StatusBar,
  SafeAreaView,
  Platform,
  Modal,
  Image,
  Vibration,
  Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MapView, {
  Marker,
  PROVIDER_DEFAULT,
  Circle,
  Polyline,
} from 'react-native-maps';
import { Overlay } from 'react-native-maps';
import { useAuth } from '../contexts/AuthContext';
import { buildingAPI, auditAPI, poiAPI, floorPlanAPI } from '../services/api';
import { Building, POI, AuditRoute, FloorPlan } from '../types';
import RealDevicePDRService, {
  PDRPosition,
} from '../services/pdr/RealDevicePDRService';
import QRAnchorService, { QRAnchor } from '../services/anchors/QRAnchorService';
import NavigationService, {
  NavigationState,
} from '../services/navigation/NavigationService';
import QRScanner from '../components/QRScanner';

// const { height } = Dimensions.get('window');

interface MapScreenProps {
  navigation: any;
  route?: {
    params?: {
      selectedRoute?: AuditRoute;
      auditSession?: boolean;
    };
  };
}

// Default coordinates for Minsk, Belarus
const DEFAULT_COORDINATES = {
  latitude: 53.9023,
  longitude: 27.5618,
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};

const MapScreen: React.FC<MapScreenProps> = ({
  navigation: _navigation,
  route,
}) => {
  const { user: _user } = useAuth();
  const mapRef = useRef<MapView>(null);

  // State
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [selectedBuilding, setSelectedBuilding] = useState<Building | null>(
    null,
  );
  const [selectedFloor, setSelectedFloor] = useState<string>('');
  const [auditRoutes, setAuditRoutes] = useState<AuditRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<AuditRoute | null>(null);
  const [pois, setPois] = useState<POI[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(false);
  const [allBuildingPois, setAllBuildingPois] = useState<POI[]>([]); // Store all POIs for the building
  const [filteredPois, setFilteredPois] = useState<POI[]>([]); // POIs filtered by floor

  // PDR and Navigation State
  const [pdrPosition, setPdrPosition] = useState<PDRPosition | null>(null);
  const [isPDRTracking, setIsPDRTracking] = useState(false);
  const [navigationState, setNavigationState] =
    useState<NavigationState | null>(null);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [driftDetected, setDriftDetected] = useState(false);
  const [nearestAnchor, setNearestAnchor] = useState<QRAnchor | null>(null);

  // Audit Session State
  const [auditRoute, setAuditRoute] = useState<AuditRoute | null>(null);
  const [isAuditSession, setIsAuditSession] = useState(false);
  const [showRouteSelection, setShowRouteSelection] = useState(false);

  // Services
  const pdrService = useRef(new RealDevicePDRService());
  const qrService = useRef(new QRAnchorService());
  const navService = useRef(new NavigationService());

  // Floor plan state
  const [currentFloorPlan, setCurrentFloorPlan] = useState<FloorPlan | null>(
    null,
  );
  const [floorPlanLoading, setFloorPlanLoading] = useState(false);
  const [availableFloors, setAvailableFloors] = useState<string[]>([]);
  const [showFloorPlanModal, setShowFloorPlanModal] = useState(false);

  const [region, setRegion] = useState(DEFAULT_COORDINATES);

  const saveSelectedRoute = async (route: AuditRoute) => {
    try {
      await AsyncStorage.setItem('selectedAuditRoute', JSON.stringify(route));
    } catch (error) {
      console.error('Error saving route:', error);
    }
  };

  const loadSelectedRoute = async () => {
    try {
      const savedRoute = await AsyncStorage.getItem('selectedAuditRoute');
      if (savedRoute) {
        return JSON.parse(savedRoute);
      }
    } catch (error) {
      console.error('Error loading route:', error);
    }
    return null;
  };

  const clearSelectedRoute = async () => {
    try {
      await AsyncStorage.removeItem('selectedAuditRoute');
    } catch (error) {
      console.error('Error clearing route:', error);
    }
  };

  useEffect(() => {
    const initializeMap = async () => {
      if (route?.params?.selectedRoute) {
        setAuditRoute(route.params.selectedRoute);
        setIsAuditSession(route.params.auditSession || false);
        setSelectedRoute(route.params.selectedRoute);
        setShowRouteSelection(false);
        await saveSelectedRoute(route.params.selectedRoute);
        loadRoutePOIs(route.params.selectedRoute);
      } else {
        const savedRoute = await loadSelectedRoute();
        if (savedRoute) {
          setAuditRoute(savedRoute);
          setIsAuditSession(true);
          setSelectedRoute(savedRoute);
          setShowRouteSelection(false);
          loadRoutePOIs(savedRoute);
        } else {
          setShowRouteSelection(true);
        }
      }
      
      loadInitialData();
    };

    initializeMap();
    
    return () => {
      pdrService.current.stopTracking();
    };
  }, [route?.params]);

  // Only initialize PDR if we have an audit route
  useEffect(() => {
    if (auditRoute && isAuditSession) {
      initializePDR();
    }
  }, [auditRoute, isAuditSession]);

  // Force hide route selection modal when we have a valid route
  useEffect(() => {
    if (auditRoute && showRouteSelection) {
      setShowRouteSelection(false);
    }
  }, [auditRoute, showRouteSelection]);

  // Set building and floor when buildings are loaded and we have an audit route
  useEffect(() => {
    if (auditRoute && buildings.length > 0) {
      const buildingId =
        auditRoute.building_id ||
        auditRoute.bu_code ||
        auditRoute.building_code;
      if (buildingId) {
        const building = buildings.find(
          b =>
            b.id === buildingId ||
            b.bu_code === buildingId ||
            b.building_code === buildingId,
        );

        if (building) {
          setSelectedBuilding(building);

          const buildingId = building.id || building.bu_code;
          if (buildingId) {
            loadAvailableFloors(buildingId);
          }

          if (auditRoute.floor_number || auditRoute.floor) {
            const floor = auditRoute.floor_number || auditRoute.floor;
            setSelectedFloor(floor.toString());
          }

          if (mapRef.current && building.coordinates) {
            mapRef.current.animateToRegion(
              {
                latitude: building.coordinates.latitude,
                longitude: building.coordinates.longitude,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              },
              1000,
            );
          }

          setTimeout(() => {
            centerMapOnRoutePOIs();
          }, 1500);
        }
      }
    }
  }, [auditRoute, buildings]);

  // Center map when POIs are loaded for a route
  useEffect(() => {
    if (auditRoute && pois.length > 0) {
      // Small delay to ensure map is ready
      setTimeout(() => {
        centerMapOnRoutePOIs();
      }, 500);
    }
  }, [auditRoute, pois]);

  // Set floor when available floors are loaded and we have an audit route
  useEffect(() => {
    if (auditRoute && availableFloors.length > 0 && !selectedFloor) {
      if (auditRoute.floor_number || auditRoute.floor) {
        const floor = auditRoute.floor_number || auditRoute.floor;
        console.log('Setting floor after floors loaded:', floor);
        setSelectedFloor(floor.toString());
      } else {
        console.log('Setting first available floor:', availableFloors[0]);
        setSelectedFloor(availableFloors[0].toString());
      }
    }
  }, [auditRoute, availableFloors, selectedFloor]);

  const centerMapOnRoutePOIs = () => {
    if (
      !selectedRoute ||
      !selectedRoute.pois ||
      selectedRoute.pois.length === 0
    )
      return;

    const coordinates = getRoutePolylineCoordinates();
    if (coordinates.length === 0) return;

    const latitudes = coordinates.map(c => c.latitude);
    const longitudes = coordinates.map(c => c.longitude);

    const minLat = Math.min(...latitudes);
    const maxLat = Math.max(...latitudes);
    const minLng = Math.min(...longitudes);
    const maxLng = Math.max(...longitudes);

    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;

    const latDelta = Math.max(maxLat - minLat, 0.001) * 1.2;
    const lngDelta = Math.max(maxLng - minLng, 0.001) * 1.2;

    if (mapRef.current) {
      mapRef.current.animateToRegion(
        {
          latitude: centerLat,
          longitude: centerLng,
          latitudeDelta: latDelta,
          longitudeDelta: lngDelta,
        },
        1000,
      );
    }
  };

  // Initialize PDR service
  const initializePDR = () => {
    // Set up PDR event handlers
    pdrService.current.setOnPositionUpdate(position => {
      setPdrPosition(position);
      navService.current.updatePosition(position);
    });

    pdrService.current.setOnDriftDetected(() => {
      setDriftDetected(true);
      Vibration.vibrate([0, 200, 100, 200]);
      Alert.alert(
        'Position Drift Detected',
        'Your position may be inaccurate. Please scan a nearby QR code to calibrate.',
        [
          { text: 'Scan QR Code', onPress: () => setShowQRScanner(true) },
          { text: 'Continue Anyway', onPress: () => setDriftDetected(false) },
        ],
      );
    });

    // Set up navigation event handlers
    navService.current.setOnStateUpdate(state => {
      setNavigationState(state);
    });

    navService.current.setOnPOIReached(poi => {
      Vibration.vibrate(200);
      Alert.alert(
        'POI Reached',
        `You have reached ${
          poi.name || poi.title
        }. Scan the QR code to complete this POI.`,
        [
          { text: 'Scan QR', onPress: () => setShowQRScanner(true) },
          { text: 'Skip', onPress: () => navService.current.skipCurrentPOI() },
        ],
      );
    });

    navService.current.setOnRouteComplete(() => {
      Alert.alert(
        'Route Complete!',
        'Congratulations! You have completed the navigation route.',
        [{ text: 'OK' }],
      );
    });

    // Set up QR service handlers
    qrService.current.setOnAnchorScanned(anchor => {
      handleAnchorScanned(anchor);
    });
  };

  const loadRoutePOIs = async (route: AuditRoute) => {
    try {
      setSelectedRoute(route);
      
      if (route.pois && route.pois.length > 0) {
        setPois(route.pois);
        setAllBuildingPois(route.pois);
        setFilteredPois(route.pois);
      } else {
        const buildingId =
          route.building_id || route.bu_code || route.building_code;
        const floorNumber = route.floor_number || route.floor;

        if (buildingId) {
          try {
            const poiResponse = await poiAPI.getPOIsByBuilding(
              buildingId,
              floorNumber?.toString(),
            );
            if (poiResponse.pois && poiResponse.pois.length > 0) {
              setPois(poiResponse.pois);
              setAllBuildingPois(poiResponse.pois);
              setFilteredPois(poiResponse.pois);
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

  const loadInitialData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load buildings
      const buildingsResponse = await buildingAPI.getBuildings();
      if (buildingsResponse && buildingsResponse.spaces) {
        const mappedBuildings = buildingsResponse.spaces.map(
          (building: any) => ({
            id: building.buid || building.id || `building_${Date.now()}`,
            bu_code: building.bu_code || building.id,
            name: building.bu_name || building.name || 'Unknown Building',
            description: building.bu_description || building.description || '',
            coordinates: {
              latitude: parseFloat(
                building.bu_lat ||
                  building.coordinates_lat ||
                  building.lat ||
                  DEFAULT_COORDINATES.latitude,
              ),
              longitude: parseFloat(
                building.bu_lng ||
                  building.coordinates_lon ||
                  building.lng ||
                  DEFAULT_COORDINATES.longitude,
              ),
            },
            floors: building.floors || building.bu_floors || [],
            total_floors: building.total_floors || 0,
            accessible: building.accessible !== false,
          }),
        );

        setBuildings(mappedBuildings);

        // Set initial region to first building
        if (mappedBuildings.length > 0) {
          const firstBuilding = mappedBuildings[0];
          setRegion({
            latitude: firstBuilding.coordinates.latitude,
            longitude: firstBuilding.coordinates.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          });
        }
      }

      // Load audit routes
      try {
        const routesResponse = await auditAPI.getRoutes();
        if (routesResponse && routesResponse.routes) {
          setAuditRoutes(routesResponse.routes);
        }
      } catch (routeError) {
        setAuditRoutes([]);
      }
    } catch (err) {
      console.error('Error loading initial data:', err);
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown error occurred';
      setError(`Failed to load data: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const loadFloorPlan = async (buildingId: string, floorNumber: string) => {
    try {
      setFloorPlanLoading(true);
      setCurrentFloorPlan(null);

      // Get floor plan image (base64 string)
      const floorPlanImageData = await floorPlanAPI.getFloorPlan(
        buildingId,
        floorNumber,
      );

      // Get floor metadata with coordinates from the floors list
      const floorsResponse = await floorPlanAPI.getFloors(buildingId);
      const floorData = floorsResponse.floors.find(
        (floor: any) =>
          (floor.floor_number || floor.floor_name) === floorNumber,
      );

      if (!floorData) {
        throw new Error('Floor data not found');
      }

      // Use coordinates directly from API - simple approach
      const bottomLeftLat = parseFloat(floorData.bottom_left_lat);
      const bottomLeftLng = parseFloat(floorData.bottom_left_lng);
      const topRightLat = parseFloat(floorData.top_right_lat);
      const topRightLng = parseFloat(floorData.top_right_lng);

      const floorPlan: FloorPlan = {
        fuid: `${buildingId}_${floorNumber}`,
        buid: buildingId,
        floor_number: floorNumber,
        floor_name: floorData.floor_name || `Floor ${floorNumber}`,
        is_published: true,
        bottom_left_lat: bottomLeftLat,
        bottom_left_lng: bottomLeftLng,
        top_right_lat: topRightLat,
        top_right_lng: topRightLng,
        zoom: floorData.zoom || 18,
        floor_plan_base64_data: floorPlanImageData.floor_plan_base64_data,
      };
      setCurrentFloorPlan(floorPlan);

      // Update map region to floor plan bounds
      if (mapRef.current) {
        try {
          const bounds = {
            latitude: (floorPlan.bottom_left_lat + floorPlan.top_right_lat) / 2,
            longitude:
              (floorPlan.bottom_left_lng + floorPlan.top_right_lng) / 2,
            latitudeDelta:
              Math.abs(floorPlan.top_right_lat - floorPlan.bottom_left_lat) *
              1.1,
            longitudeDelta:
              Math.abs(floorPlan.top_right_lng - floorPlan.bottom_left_lng) *
              1.1,
          };

          mapRef.current.animateToRegion(bounds);
        } catch (regionError) {
          // Silent fail for region animation
        }
      }
    } catch (err) {
      console.error('Error loading floor plan:', err);
      setCurrentFloorPlan(null);
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown error occurred';
      Alert.alert(
        'Error',
        `Failed to load floor plan for floor ${floorNumber}: ${errorMessage}`,
      );
    } finally {
      setFloorPlanLoading(false);
    }
  };

  const loadAvailableFloors = async (buildingId: string) => {
    try {
      const floorsResponse = await floorPlanAPI.getFloors(buildingId);

      if (floorsResponse && floorsResponse.floors) {
        const floorNumbers = floorsResponse.floors
          .map((floor: any) => floor.floor_number || floor.floor_name)
          .filter((floor: any) => floor !== null && floor !== undefined)
          .sort((a: string, b: string) => parseInt(a, 10) - parseInt(b, 10));
        setAvailableFloors(floorNumbers);
      } else {
        setAvailableFloors([]);
      }
    } catch (err) {
      console.error('Error loading floors:', err);
      setAvailableFloors([]);
    }
  };

  const handleBuildingSelect = async (building: Building) => {
    try {
      setSelectedBuilding(building);

      // Only reset route if we're not in an audit session
      if (!auditRoute || !isAuditSession) {
        setSelectedFloor('');
        setPois([]); // IMPORTANT: Start with empty array - no POIs shown initially
        setAllBuildingPois([]);
        setFilteredPois([]);
        setSelectedRoute(null);
        setCurrentFloorPlan(null);
        setAvailableFloors([]);
      }

      const buildingId = building.id || building.bu_code;
      if (buildingId) {
        try {
          const poisResponse = await poiAPI.getPOIsByBuilding(buildingId);
          if (poisResponse && poisResponse.pois) {
            setAllBuildingPois(poisResponse.pois);
          }
        } catch (err) {
          console.error('Error loading POIs:', err);
          setAllBuildingPois([]);
          setPois([]);
        }

        await loadAvailableFloors(buildingId);
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

  const handleFloorSelect = async (floorNumber: string) => {
    try {
      if (!selectedBuilding) return;

      setSelectedFloor(floorNumber);
      const buildingId = selectedBuilding.id || selectedBuilding.bu_code;

      if (buildingId) {
        await loadFloorPlan(buildingId, floorNumber);
        filterPOIsByFloor(floorNumber); // Filter POIs for this floor
      }
    } catch (err) {
      console.error('Error selecting floor:', err);
      Alert.alert('Error', 'Failed to select floor');
    }
  };

  const filterPOIsByFloor = (floorNumber: string) => {
    if (!floorNumber || allBuildingPois.length === 0) {
      setFilteredPois([]);
      setPois([]);
      return;
    }

    // Clear previous POIs first
    setPois([]);
    setFilteredPois([]);

    const floorPois = allBuildingPois.filter(poi => {
      if (!poi) return false;

      const poiFloor = poi.floor_number || poi.floor || poi.floor_name;
      const poiFloorStr = String(poiFloor).trim();
      const selectedFloorStr = String(floorNumber).trim();

      return poiFloorStr === selectedFloorStr;
    });

    setFilteredPois(floorPois);
    setPois(floorPois);
  };

  const handleRouteSelect = async (route: AuditRoute) => {
    setSelectedRoute(route);
    setAuditRoute(route);
    setIsAuditSession(true);
    setShowRouteSelection(false);
    
    // Save route to storage
    await saveSelectedRoute(route);
    
    // Load POIs for the selected route
    loadRoutePOIs(route);
  };

  const handleClearRoute = async () => {
    setSelectedRoute(null);
    setAuditRoute(null);
    setIsAuditSession(false);
    setPois([]);
    setAllBuildingPois([]);
    setFilteredPois([]);
    setShowRouteSelection(true);
    await clearSelectedRoute();
  };

  // PDR Control Functions
  const startPDRTracking = async () => {
    try {
      await pdrService.current.startTracking();
      setIsPDRTracking(true);
      console.log('PDR tracking started');
    } catch (error) {
      console.error('Failed to start PDR tracking:', error);
      Alert.alert(
        'Permission Required',
        'PDR tracking requires camera and location permissions. Please grant permissions in Settings to enable real sensor tracking.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open Settings',
            onPress: () => {
              // Open device settings
              Linking.openSettings();
            },
          },
        ],
      );
    }
  };

  const stopPDRTracking = () => {
    pdrService.current.stopTracking();
    setIsPDRTracking(false);
    setPdrPosition(null);
    console.log('PDR tracking stopped');
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

    // Calibrate PDR position
    pdrService.current.calibratePosition(anchor.position, anchor.heading);

    // Update navigation if active
    if (navigationState?.isActive) {
      navService.current.calibratePosition(anchor);
    }

    setDriftDetected(false);
    setNearestAnchor(anchor);

    Alert.alert(
      'Position Calibrated',
      `Position updated using anchor: ${anchor.name}`,
      [{ text: 'OK' }],
    );
  };

  // Create route polyline coordinates from POIs
  const getRoutePolylineCoordinates = () => {
    if (
      !selectedRoute ||
      !selectedRoute.pois ||
      selectedRoute.pois.length === 0
    ) {
      return [];
    }

    return selectedRoute.pois
      .filter(poi => {
        // Check for coordinates in different formats
        return (
          (poi.latitude && poi.longitude) ||
          (poi.coordinates?.lat && poi.coordinates?.lon) ||
          (poi.coordinates_lat && poi.coordinates_lon)
        );
      })
      .map(poi => {
        // Extract coordinates from different formats
        let lat, lon;
        if (poi.latitude && poi.longitude) {
          lat = poi.latitude;
          lon = poi.longitude;
        } else if (poi.coordinates?.lat && poi.coordinates?.lon) {
          lat = poi.coordinates.lat;
          lon = poi.coordinates.lon;
        } else if (poi.coordinates_lat && poi.coordinates_lon) {
          lat = parseFloat(poi.coordinates_lat.toString());
          lon = parseFloat(poi.coordinates_lon.toString());
        }

        return {
          latitude: lat!,
          longitude: lon!,
        };
      });
  };

  // Get POI markers with order numbers
  const getOrderedPOIMarkers = () => {
    if (
      !selectedRoute ||
      !selectedRoute.pois ||
      selectedRoute.pois.length === 0
    ) {
      return [];
    }

    return selectedRoute.pois
      .filter(poi => {
        // Check for coordinates in different formats
        return (
          (poi.latitude && poi.longitude) ||
          (poi.coordinates?.lat && poi.coordinates?.lon) ||
          (poi.coordinates_lat && poi.coordinates_lon)
        );
      })
      .map((poi, index) => {
        // Extract coordinates from different formats
        let lat, lon;
        if (poi.latitude && poi.longitude) {
          lat = poi.latitude;
          lon = poi.longitude;
        } else if (poi.coordinates?.lat && poi.coordinates?.lon) {
          lat = poi.coordinates.lat;
          lon = poi.coordinates.lon;
        } else if (poi.coordinates_lat && poi.coordinates_lon) {
          lat = parseFloat(poi.coordinates_lat.toString());
          lon = parseFloat(poi.coordinates_lon.toString());
        }

        return {
          id: poi.puid || poi.id || `poi_${index}`,
          coordinate: {
            latitude: lat!,
            longitude: lon!,
          },
          title: poi.name || `POI ${index + 1}`,
          description: poi.description || `Order: ${poi.order || index + 1}`,
          order: poi.order || index + 1,
          poi: poi,
        };
      });
  };

  const startNavigation = () => {
    if (!selectedRoute || !selectedRoute.pois) {
      Alert.alert('Error', 'No route selected');
      return;
    }

    if (!isPDRTracking) {
      Alert.alert('Error', 'PDR tracking must be started first');
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

  const getPOIColor = (poi: POI) => {
    if (selectedRoute && selectedRoute.pois) {
      const isInRoute = selectedRoute.pois.some(
        routePOI => routePOI.puid === poi.puid || routePOI.id === poi.id,
      );
      return isInRoute ? '#4CAF50' : '#FF9800';
    }
    return '#2196F3'; // Blue for POIs
  };

  const getTransformedPOICoordinates = (poi: POI) => {
    if (!poi) return null;

    let poiLat = 0;
    let poiLng = 0;

    // Handle different coordinate formats
    if (poi.coordinates_lat && poi.coordinates_lon) {
      poiLat = parseFloat(String(poi.coordinates_lat));
      poiLng = parseFloat(String(poi.coordinates_lon));
    } else if (poi.coordinates?.latitude && poi.coordinates?.longitude) {
      poiLat = poi.coordinates.latitude;
      poiLng = poi.coordinates.longitude;
    } else if (poi.coordinates?.lat && poi.coordinates?.lon) {
      poiLat = poi.coordinates.lat;
      poiLng = poi.coordinates.lon;
    } else if (poi.latitude && poi.longitude) {
      poiLat = poi.latitude;
      poiLng = poi.longitude;
    }

    if (isNaN(poiLat) || isNaN(poiLng) || poiLat === 0 || poiLng === 0) {
      return null;
    }

    return {
      latitude: poiLat,
      longitude: poiLng,
    };
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
        <TouchableOpacity style={styles.retryButton} onPress={loadInitialData}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#007AFF" />

      {/* Header Info */}
      <View style={styles.headerInfo}>
        <Text style={styles.headerTitle}>
          {selectedBuilding ? selectedBuilding.name : 'Select Building'}
        </Text>
        {selectedFloor && (
          <Text style={styles.headerSubtitle}>
            Floor {selectedFloor} • {pois.length} POIs
            {floorPlanLoading && ' • Loading floor plan...'}
          </Text>
        )}
      </View>

      {/* Map */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          provider={PROVIDER_DEFAULT}
          initialRegion={region}
          showsUserLocation={true}
          showsMyLocationButton={true}
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
            if (!building || !building.coordinates) return null;

            const { latitude, longitude } = building.coordinates;
            if (!latitude || !longitude || isNaN(latitude) || isNaN(longitude))
              return null;

            return (
              <Marker
                key={building.id || `building_${index}`}
                coordinate={{ latitude, longitude }}
                title={building.name || 'Unknown Building'}
                description={building.description || ''}
                pinColor={
                  selectedBuilding?.id === building.id ? '#FF6B35' : '#8B4513'
                }
                onPress={() => handleBuildingSelect(building)}
                tracksViewChanges={false}
              />
            );
          })}

          {/* Floor Plan Center Marker - Simple approach */}
          {currentFloorPlan && currentFloorPlan.floor_plan_base64_data && (
            <Marker
              coordinate={{
                latitude:
                  (currentFloorPlan.bottom_left_lat +
                    currentFloorPlan.top_right_lat) /
                  2,
                longitude:
                  (currentFloorPlan.bottom_left_lng +
                    currentFloorPlan.top_right_lng) /
                  2,
              }}
              title={`Floor Plan: ${currentFloorPlan.floor_name}`}
              description={`Floor ${currentFloorPlan.floor_number} - Tap to view image`}
              pinColor="#4CAF50"
              onPress={() => setShowFloorPlanModal(true)}
            />
          )}

          {/* PDR Position Marker */}
          {pdrPosition && (
            <>
              <Marker
                coordinate={{
                  latitude:
                    (currentFloorPlan?.bottom_left_lat || 0) +
                    pdrPosition.y / 1000,
                  longitude:
                    (currentFloorPlan?.bottom_left_lng || 0) +
                    pdrPosition.x / 1000,
                }}
                title="Your Position (PDR)"
                description={`Steps: ${pdrPosition.stepCount} | Confidence: ${(
                  pdrPosition.confidence * 100
                ).toFixed(1)}%`}
                pinColor="#FF0000"
                tracksViewChanges={false}
              />
              {/* Accuracy circle */}
              <Circle
                center={{
                  latitude:
                    (currentFloorPlan?.bottom_left_lat || 0) +
                    pdrPosition.y / 1000,
                  longitude:
                    (currentFloorPlan?.bottom_left_lng || 0) +
                    pdrPosition.x / 1000,
                }}
                radius={pdrPosition.accuracy * 1000} // Convert to meters
                strokeColor="#FF0000"
                fillColor="rgba(255, 0, 0, 0.1)"
                strokeWidth={2}
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

          {/* Ordered POI Markers for Audit Route */}
          {selectedRoute &&
            getOrderedPOIMarkers().map(marker => (
              <Marker
                key={marker.id}
                coordinate={marker.coordinate}
                title={marker.title}
                description={marker.description}
                pinColor="#007AFF"
                onPress={() => {
                  Alert.alert(
                    marker.title,
                    `Order: ${marker.order}\nDescription: ${
                      marker.poi.description || 'No description'
                    }`,
                  );
                }}
              >
                <View style={styles.poiOrderContainer}>
                  <Text style={styles.poiOrderText}>{marker.order}</Text>
                </View>
              </Marker>
            ))}

          {/* POI Markers - Show route POIs when route is selected, regular POIs otherwise */}
          {pois.map((poi, index) => {
            if (!poi) return null;

            const coordinates = getTransformedPOICoordinates(poi);
            if (!coordinates) {
              return null;
            }

            return (
              <Marker
                key={poi.id || poi.puid || `poi_${index}`}
                coordinate={coordinates}
                title={poi.name || poi.title || 'POI'}
                description={
                  poi.description ||
                  poi.pois_type ||
                  poi.type ||
                  'Point of Interest'
                }
                pinColor={getPOIColor(poi)}
                onPress={() => {
                  Alert.alert(
                    poi.name || poi.title || 'POI',
                    `Type: ${poi.pois_type || poi.type || 'Unknown'}\nFloor: ${
                      poi.floor_number || poi.floor || 'Unknown'
                    }\nDescription: ${poi.description || 'No description'}`,
                  );
                }}
                tracksViewChanges={false}
              />
            );
          })}
        </MapView>

        {/* Floating Controls */}
        <View style={styles.floatingControls}>
          <TouchableOpacity
            style={styles.controlButton}
            onPress={() => setShowControls(!showControls)}
          >
            <Text style={styles.controlButtonText}>☰</Text>
          </TouchableOpacity>
        </View>

        {/* Control Panel */}
        {showControls && (
          <View style={styles.controlPanel}>
            {/* Header */}
            <View style={styles.controlPanelHeader}>
              <Text style={styles.controlPanelTitle}>Map Controls</Text>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setShowControls(false)}
              >
                <Text style={styles.closeButtonText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Scrollable Content */}
            <ScrollView 
              style={styles.controlPanelContent}
              showsVerticalScrollIndicator={true}
              bounces={true}
            >
              {/* Building Selection */}
            <View style={styles.controlSection}>
              <Text style={styles.sectionTitle}>Select Building</Text>
              <ScrollView
                horizontal
                style={styles.buildingSelector}
                showsHorizontalScrollIndicator={false}
              >
                {buildings.map((building, index) => (
                  <TouchableOpacity
                    key={building.id || `building_${index}`}
                    style={[
                      styles.buildingButton,
                      selectedBuilding?.id === building.id &&
                        styles.selectedBuildingButton,
                    ]}
                    onPress={() => handleBuildingSelect(building)}
                  >
                    <Text
                      style={[
                        styles.buildingButtonText,
                        selectedBuilding?.id === building.id &&
                          styles.selectedBuildingButtonText,
                      ]}
                    >
                      {building.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* Audit Route Information */}
            {auditRoute && (
              <View style={styles.controlSection}>
                <Text style={styles.sectionTitle}>Selected Audit Route</Text>
                <View style={styles.routeInfoCard}>
                  <Text style={styles.routeName}>{auditRoute.name}</Text>
                  <Text style={styles.routeDescription}>
                    {auditRoute.description || 'No description'}
                  </Text>
                  <View style={styles.routeDetails}>
                    <Text style={styles.routeDetailText}>
                      Building:{' '}
                      {selectedBuilding?.name ||
                        auditRoute.buildingName ||
                        auditRoute.building_id ||
                        auditRoute.bu_code ||
                        auditRoute.building_code ||
                        'Unknown'}
                    </Text>
                    <Text style={styles.routeDetailText}>
                      Floor:{' '}
                      {selectedFloor ||
                        auditRoute.floor_number ||
                        auditRoute.floor ||
                        'Unknown'}
                    </Text>
                    <Text style={styles.routeDetailText}>
                      POIs: {pois.length || auditRoute.pois?.length || 0} points
                    </Text>
                    <Text style={styles.routeDetailText}>
                      Status: {auditRoute.status || 'assigned'}
                    </Text>
                    <Text style={styles.routeDetailText}>
                      Created by: {auditRoute.created_by || 'Unknown'}
                    </Text>
                  </View>
                  
                  {/* Clear Route Button */}
                  <TouchableOpacity
                    style={styles.clearRouteButtonSmall}
                    onPress={handleClearRoute}
                  >
                    <Text style={styles.clearRouteButtonTextSmall}>
                      Clear Route
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Floor Selection */}
            {selectedBuilding && availableFloors.length > 0 && (
              <View style={styles.controlSection}>
                <Text style={styles.sectionTitle}>Select Floor</Text>
                <ScrollView
                  horizontal
                  style={styles.floorSelector}
                  showsHorizontalScrollIndicator={false}
                >
                  {availableFloors.map((floor, index) => (
                    <TouchableOpacity
                      key={`floor_${floor}_${index}`}
                      style={[
                        styles.floorButton,
                        selectedFloor === floor && styles.selectedFloorButton,
                      ]}
                      onPress={() => handleFloorSelect(floor)}
                    >
                      <Text
                        style={[
                          styles.floorButtonText,
                          selectedFloor === floor &&
                            styles.selectedFloorButtonText,
                        ]}
                      >
                        Floor {floor}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Route Selection */}
            {selectedBuilding && (
              <View style={styles.controlSection}>
                <Text style={styles.sectionTitle}>Select Route</Text>
                <ScrollView
                  horizontal
                  style={styles.routeSelector}
                  showsHorizontalScrollIndicator={false}
                >
                  {auditRoutes
                    .filter(route => {
                      const buildingId =
                        selectedBuilding.id || selectedBuilding.bu_code;
                      return (
                        route.building_id === buildingId ||
                        route.bu_code === buildingId ||
                        route.building_code === buildingId
                      );
                    })
                    .map((route, index) => (
                      <TouchableOpacity
                        key={route.id || route._id || `route_${index}`}
                        style={[
                          styles.routeButton,
                          selectedRoute?.id === route.id &&
                            styles.selectedRouteButton,
                        ]}
                        onPress={() => handleRouteSelect(route)}
                      >
                        <Text
                          style={[
                            styles.routeButtonText,
                            selectedRoute?.id === route.id &&
                              styles.selectedRouteButtonText,
                          ]}
                        >
                          {route.name ||
                            route.description ||
                            `Route ${route.id}`}
                        </Text>
                      </TouchableOpacity>
                    ))}
                </ScrollView>
              </View>
            )}

            {/* PDR Controls - Only show when audit route is selected */}
            {auditRoute && isAuditSession && (
              <View style={styles.controlSection}>
                <Text style={styles.sectionTitle}>PDR Navigation</Text>
                <View style={styles.pdrControls}>
                  <TouchableOpacity
                    style={[
                      styles.pdrButton,
                      isPDRTracking && styles.pdrButtonActive,
                    ]}
                    onPress={isPDRTracking ? stopPDRTracking : startPDRTracking}
                  >
                    <Text
                      style={[
                        styles.pdrButtonText,
                        isPDRTracking && styles.pdrButtonTextActive,
                      ]}
                    >
                      {isPDRTracking ? '⏹️ Stop PDR' : '▶️ Start PDR'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.pdrButton}
                    onPress={handleQRScan}
                  >
                    <Text style={styles.pdrButtonText}>📱 Scan QR Code</Text>
                  </TouchableOpacity>
                </View>

                {pdrPosition && (
                  <View style={styles.pdrStatus}>
                    <Text style={styles.pdrStatusText}>
                      Position: ({pdrPosition.x.toFixed(1)},{' '}
                      {pdrPosition.y.toFixed(1)})m
                    </Text>
                    <Text style={styles.pdrStatusText}>
                      Steps: {pdrPosition.stepCount} | Heading:{' '}
                      {pdrPosition.heading.toFixed(0)}°
                    </Text>
                    <Text style={styles.pdrStatusText}>
                      Confidence: {(pdrPosition.confidence * 100).toFixed(1)}% |
                      Accuracy: {pdrPosition.accuracy.toFixed(1)}m
                    </Text>
                  </View>
                )}

                {driftDetected && (
                  <View style={styles.driftWarning}>
                    <Text style={styles.driftWarningText}>
                      ⚠️ Position drift detected! Scan QR to calibrate.
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* Navigation Controls - Only show when audit route is selected */}
            {auditRoute && isAuditSession && selectedRoute && (
              <View style={styles.controlSection}>
                <Text style={styles.sectionTitle}>Route Navigation</Text>
                <View style={styles.navigationControls}>
                  <TouchableOpacity
                    style={[
                      styles.navButton,
                      navigationState?.isActive && styles.navButtonActive,
                    ]}
                    onPress={
                      navigationState?.isActive
                        ? stopNavigation
                        : startNavigation
                    }
                  >
                    <Text
                      style={[
                        styles.navButtonText,
                        navigationState?.isActive && styles.navButtonTextActive,
                      ]}
                    >
                      {navigationState?.isActive
                        ? '⏹️ Stop Nav'
                        : '🚀 Start Nav'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {navigationState && (
                  <View style={styles.navigationStatus}>
                    <Text style={styles.navStatusText}>
                      Progress: {navigationState.completedPOIs}/
                      {navigationState.totalPOIs} POIs
                    </Text>
                    <Text style={styles.navStatusText}>
                      Current: {navigationState.currentPOI?.name || 'None'}
                    </Text>
                    <Text style={styles.navStatusText}>
                      Distance: {navigationState.distanceToNextPOI.toFixed(1)}m
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* Floor Plan Actions */}
            {currentFloorPlan && currentFloorPlan.floor_plan_base64_data && (
              <View style={styles.controlSection}>
                <Text style={styles.sectionTitle}>Floor Plan Actions</Text>
                <TouchableOpacity
                  style={styles.floorPlanButton}
                  onPress={() => setShowFloorPlanModal(true)}
                >
                  <Text style={styles.floorPlanButtonText}>
                    📋 View Floor Plan Image
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Info Panel */}
            <View style={styles.infoPanel}>
              <Text style={styles.infoText}>
                Buildings: {buildings.length} | POIs:{' '}
                {selectedFloor ? filteredPois.length : 0} | Routes:{' '}
                {auditRoutes.length}
                {availableFloors.length > 0 &&
                  ` | Floors: ${availableFloors.length}`}
              </Text>
              {selectedFloor && (
                <Text style={styles.floorInfo}>
                  Floor {selectedFloor}: {filteredPois.length} POI
                  {filteredPois.length !== 1 ? 's' : ''}
                  {floorPlanLoading && ' (Loading floor plan...)'}
                </Text>
              )}
              {!selectedFloor && selectedBuilding && (
                <Text style={styles.floorInfo}>
                  Please select a floor to view POIs
                </Text>
              )}
              {selectedRoute && (
                <Text style={styles.routeInfo}>
                  Selected Route:{' '}
                  {selectedRoute.name ||
                    selectedRoute.description ||
                    'Unknown Route'}
                  ({selectedRoute.pois?.length || 0} POIs)
                </Text>
              )}
              {pois.length === 0 && selectedBuilding && selectedFloor && (
                <Text style={styles.warningText}>
                  ⚠️ No POIs found for floor {selectedFloor}. No pins displayed
                  on map.
                </Text>
              )}
              {!selectedFloor && selectedBuilding && (
                <Text style={styles.warningText}>
                  ⚠️ Select a floor to view its POIs and floor plan.
                </Text>
              )}
              {availableFloors.length === 0 && selectedBuilding && (
                <Text style={styles.warningText}>
                  ⚠️ No floor plans available for this building.
                </Text>
              )}
              </View>
            </ScrollView>
          </View>
        )}
      </View>

      {/* Floor Plan Modal */}
      <Modal
        visible={showFloorPlanModal}
        animationType="slide"
        onRequestClose={() => setShowFloorPlanModal(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              Floor Plan: {currentFloorPlan?.floor_name}
            </Text>
            <TouchableOpacity
              style={styles.closeModalButton}
              onPress={() => setShowFloorPlanModal(false)}
            >
              <Text style={styles.closeModalButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          {currentFloorPlan && currentFloorPlan.floor_plan_base64_data && (
            <View style={styles.imageContainer}>
              <Image
                source={{
                  uri: currentFloorPlan.floor_plan_base64_data.startsWith(
                    'data:image/',
                  )
                    ? currentFloorPlan.floor_plan_base64_data
                    : `data:image/png;base64,${currentFloorPlan.floor_plan_base64_data}`,
                }}
                style={styles.floorPlanImage}
                resizeMode="contain"
              />
            </View>
          )}
        </SafeAreaView>
      </Modal>

      {/* QR Scanner Modal */}
      <QRScanner
        visible={showQRScanner}
        onClose={() => setShowQRScanner(false)}
        onScan={handleQRScanResult}
        title="Scan QR Anchor"
      />

      {/* Route Selection Modal */}
      <Modal
        visible={showRouteSelection && !auditRoute}
        animationType="slide"
        presentationStyle="fullScreen"
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Audit Route</Text>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => _navigation.navigate('Dashboard')}
            >
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.modalContent}>
            <Text style={styles.modalMessage}>
              Please select an audit route from the Dashboard to start
              navigation and PDR tracking.
            </Text>

            <TouchableOpacity
              style={styles.goToDashboardButton}
              onPress={() => _navigation.navigate('Dashboard')}
            >
              <Text style={styles.goToDashboardButtonText}>
                Go to Dashboard
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.clearRouteButton}
              onPress={handleClearRoute}
            >
              <Text style={styles.clearRouteButtonText}>
                Clear Saved Route
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
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
  headerInfo: {
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
  floatingControls: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 100 : 60,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: 25,
    padding: 5,
    zIndex: 1000,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  controlButton: {
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 25,
    marginVertical: 5,
    backgroundColor: '#007AFF',
    borderWidth: 1,
    borderColor: '#0056CC',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  controlButtonText: {
    color: 'white',
    fontSize: 20,
  },
  controlPanel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: 300,
    backgroundColor: 'white',
    borderRadius: 0,
    overflow: 'hidden',
    zIndex: 1000,
    shadowColor: '#000',
    shadowOffset: { width: -2, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 5,
  },
  controlPanelContent: {
    flex: 1,
    paddingBottom: 20,
  },
  controlPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  controlPanelTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  closeButton: {
    padding: 8,
    backgroundColor: '#f0f0f0',
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  closeButtonText: {
    color: '#666',
    fontSize: 18,
    fontWeight: 'bold',
  },
  controlSection: {
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  buildingSelector: {
    marginBottom: 10,
  },
  buildingButton: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginBottom: 5,
  },
  selectedBuildingButton: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  buildingButtonText: {
    color: '#333',
    fontSize: 14,
    fontWeight: '500',
  },
  selectedBuildingButtonText: {
    color: 'white',
  },
  floorSelector: {
    marginBottom: 10,
  },
  floorButton: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginBottom: 5,
  },
  selectedFloorButton: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  floorButtonText: {
    color: '#333',
    fontSize: 14,
    fontWeight: '500',
  },
  selectedFloorButtonText: {
    color: 'white',
  },
  routeSelector: {
    marginBottom: 10,
  },
  routeButton: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginBottom: 5,
  },
  selectedRouteButton: {
    backgroundColor: '#FF9800',
    borderColor: '#FF9800',
  },
  routeButtonText: {
    color: '#333',
    fontSize: 14,
    fontWeight: '500',
  },
  selectedRouteButtonText: {
    color: 'white',
  },
  infoPanel: {
    backgroundColor: 'white',
    padding: 15,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  infoText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 5,
  },
  floorInfo: {
    fontSize: 14,
    color: '#4CAF50',
    textAlign: 'center',
    fontWeight: '500',
    marginTop: 5,
  },
  routeInfo: {
    fontSize: 14,
    color: '#007AFF',
    textAlign: 'center',
    fontWeight: '500',
  },
  warningText: {
    fontSize: 14,
    color: '#FF9800',
    textAlign: 'center',
    marginTop: 5,
  },
  floorPlanButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 5,
    alignItems: 'center',
  },
  floorPlanButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  closeModalButton: {
    padding: 8,
    backgroundColor: '#f0f0f0',
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeModalButtonText: {
    color: '#666',
    fontSize: 18,
    fontWeight: 'bold',
  },
  imageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  floorPlanImage: {
    width: '100%',
    height: '100%',
  },
  // PDR Controls
  pdrControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  pdrButton: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    flex: 1,
    marginHorizontal: 5,
    alignItems: 'center',
  },
  pdrButtonActive: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  pdrButtonText: {
    color: '#333',
    fontSize: 14,
    fontWeight: '500',
  },
  pdrButtonTextActive: {
    color: 'white',
  },
  pdrStatus: {
    backgroundColor: '#f8f9fa',
    padding: 10,
    borderRadius: 8,
    marginTop: 5,
  },
  pdrStatusText: {
    fontSize: 12,
    color: '#666',
    marginBottom: 2,
  },
  driftWarning: {
    backgroundColor: '#fff3cd',
    padding: 10,
    borderRadius: 8,
    marginTop: 5,
    borderWidth: 1,
    borderColor: '#ffeaa7',
  },
  driftWarningText: {
    fontSize: 12,
    color: '#856404',
    fontWeight: '500',
  },
  // Navigation Controls
  navigationControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 10,
  },
  navButton: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    alignItems: 'center',
  },
  navButtonActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  navButtonText: {
    color: '#333',
    fontSize: 16,
    fontWeight: '500',
  },
  navButtonTextActive: {
    color: 'white',
  },
  navigationStatus: {
    backgroundColor: '#f8f9fa',
    padding: 10,
    borderRadius: 8,
    marginTop: 5,
  },
  navStatusText: {
    fontSize: 12,
    color: '#666',
    marginBottom: 2,
  },
  // Route Selection Modal Styles
  modalContainer: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: '#007AFF',
  },
  modalTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
  },
  modalContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  modalMessage: {
    fontSize: 16,
    color: '#333',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 30,
  },
  goToDashboardButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 8,
  },
  goToDashboardButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  clearRouteButton: {
    backgroundColor: '#FF4444',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 8,
    marginTop: 15,
  },
  clearRouteButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  clearRouteButtonSmall: {
    backgroundColor: '#FF4444',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 6,
    marginTop: 10,
    alignSelf: 'center',
  },
  clearRouteButtonTextSmall: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  // POI Order Marker Styles
  poiOrderContainer: {
    backgroundColor: '#007AFF',
    borderRadius: 15,
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'white',
  },
  poiOrderText: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
  },
  // Route Information Styles
  routeInfoCard: {
    backgroundColor: '#f8f9fa',
    padding: 15,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  routeName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  routeDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 10,
  },
  routeDetails: {
    gap: 5,
  },
  routeDetailText: {
    fontSize: 12,
    color: '#666',
  },
});

export default MapScreen;
