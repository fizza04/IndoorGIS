import React, { useState, useEffect, useRef } from 'react';
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
} from 'react-native';
import MapView, {
  Marker,
  PROVIDER_DEFAULT,
  Polyline,
} from 'react-native-maps';
import { useAuth } from '../contexts/AuthContext';
import { buildingAPI, auditAPI, poiAPI } from '../services/api';
import { Building, POI, AuditRoute } from '../types';
import QRAnchorService, { QRAnchor } from '../services/anchors/QRAnchorService';
import NavigationService, { NavigationState } from '../services/navigation/NavigationService';
import QRScanner from '../components/QRScanner';

// PDR Position interface - will be replaced with new implementation
export interface PDRPosition {
  x: number;
  y: number;
  heading: number;
  confidence: number;
  timestamp: number;
  stepCount: number;
  accuracy: number;
}

interface MapScreenProps {
  navigation: any;
  route?: {
    params?: {
      selectedRoute?: AuditRoute;
      auditSession?: boolean;
    };
  };
}

const DEFAULT_COORDINATES = {
  latitude: 53.9023,
  longitude: 27.5618,
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};

const MapScreen: React.FC<MapScreenProps> = ({ navigation, route }) => {
  const { user } = useAuth();
  const mapRef = useRef<MapView>(null);

  // Core State
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [selectedBuilding, setSelectedBuilding] = useState<Building | null>(null);
  const [selectedFloor, setSelectedFloor] = useState<string>('');
  const [auditRoutes, setAuditRoutes] = useState<AuditRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<AuditRoute | null>(null);
  const [pois, setPois] = useState<POI[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // PDR and Navigation State - will be replaced with new implementation
  const [pdrPosition, setPdrPosition] = useState<PDRPosition | null>(null);
  const [isPDRTracking, setIsPDRTracking] = useState(false);
  const [navigationState, setNavigationState] = useState<NavigationState | null>(null);
  const [showQRScanner, setShowQRScanner] = useState(false);

  // Services
  const qrService = useRef(new QRAnchorService());
  const navService = useRef(new NavigationService());

  const [region, setRegion] = useState(DEFAULT_COORDINATES);

  useEffect(() => {
    initializeMap();
  }, [route?.params]);

  const initializeMap = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load buildings
      const buildingsResponse = await buildingAPI.getBuildings();
      if (buildingsResponse?.spaces) {
        const mappedBuildings = buildingsResponse.spaces.map((building: any) => ({
            id: building.buid || building.id || `building_${Date.now()}`,
            bu_code: building.bu_code || building.id,
            name: building.bu_name || building.name || 'Unknown Building',
            description: building.bu_description || building.description || '',
            coordinates: {
            latitude: parseFloat(building.bu_lat || building.coordinates_lat || building.lat || DEFAULT_COORDINATES.latitude),
            longitude: parseFloat(building.bu_lng || building.coordinates_lon || building.lng || DEFAULT_COORDINATES.longitude),
            },
            floors: building.floors || building.bu_floors || [],
            total_floors: building.total_floors || 0,
            accessible: building.accessible !== false,
        }));

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
        if (routesResponse?.routes) {
          setAuditRoutes(routesResponse.routes);
        }
      } catch (routeError) {
        setAuditRoutes([]);
      }

      // Handle route selection
      if (route?.params?.selectedRoute) {
        setSelectedRoute(route.params.selectedRoute);
        loadRoutePOIs(route.params.selectedRoute);
      }

    } catch (err) {
      console.error('Error loading initial data:', err);
      setError(`Failed to load data: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const loadRoutePOIs = async (route: AuditRoute) => {
    try {
      setSelectedRoute(route);
      
      if (route.pois && route.pois.length > 0) {
        setPois(route.pois);
      } else {
        const buildingId = route.building_id || route.bu_code || route.building_code;
        const floorNumber = route.floorNumbers?.[0] || route.floors?.[0];

        if (buildingId) {
          try {
            const poiResponse = await poiAPI.getPOIsByBuilding(buildingId, floorNumber?.toString());
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
    setSelectedRoute(route);
    loadRoutePOIs(route);
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
        Alert.alert('Invalid QR Code', result.error || 'Unknown QR code format');
      }
    } catch (error) {
      console.error('QR scan error:', error);
      Alert.alert('Error', 'Failed to process QR code');
    }
  };

  const handleAnchorScanned = (anchor: QRAnchor) => {
    setShowQRScanner(false);

    // Update navigation if active
    if (navigationState?.isActive) {
      navService.current.calibratePosition(anchor);
    }

    Alert.alert('Position Calibrated', `Position updated using anchor: ${anchor.name}`, [{ text: 'OK' }]);
  };

  const getRoutePolylineCoordinates = () => {
    if (!selectedRoute?.pois || selectedRoute.pois.length === 0) return [];

    return selectedRoute.pois
      .filter(poi => (poi.latitude && poi.longitude) || (poi.coordinates?.latitude && poi.coordinates?.longitude) || (poi.coordinates_lat && poi.coordinates_lon))
      .map(poi => {
        let lat, lon;
        if (poi.latitude && poi.longitude) {
          lat = poi.latitude;
          lon = poi.longitude;
        } else if (poi.coordinates?.latitude && poi.coordinates?.longitude) {
          lat = poi.coordinates.latitude;
          lon = poi.coordinates.longitude;
        } else if (poi.coordinates_lat && poi.coordinates_lon) {
          lat = parseFloat(poi.coordinates_lat.toString());
          lon = parseFloat(poi.coordinates_lon.toString());
        }

        return { latitude: lat!, longitude: lon! };
      });
  };

  const getTransformedPOICoordinates = (poi: POI) => {
    if (!poi) return null;

    let poiLat = 0;
    let poiLng = 0;

    if (poi.coordinates_lat && poi.coordinates_lon) {
      poiLat = parseFloat(String(poi.coordinates_lat));
      poiLng = parseFloat(String(poi.coordinates_lon));
    } else if (poi.coordinates?.latitude && poi.coordinates?.longitude) {
      poiLat = poi.coordinates.latitude;
      poiLng = poi.coordinates.longitude;
    } else if (poi.latitude && poi.longitude) {
      poiLat = poi.latitude;
      poiLng = poi.longitude;
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

          {/* POI Markers */}
          {pois.map((poi, index) => {
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

        {/* Floating Controls */}
        <View style={styles.floatingControls}>
          <TouchableOpacity style={styles.controlButton} onPress={handleQRScan}>
            <Text style={styles.controlButtonText}>📷</Text>
          </TouchableOpacity>
          
          {selectedRoute && (
              <TouchableOpacity
              style={[styles.controlButton, styles.navButton]}
              onPress={navigationState?.isActive ? stopNavigation : startNavigation}
            >
              <Text style={styles.controlButtonText}>
                {navigationState?.isActive ? '⏹️' : '🚀'}
                    </Text>
                  </TouchableOpacity>
          )}
              </View>
              </View>

      {/* QR Scanner Modal */}
      <QRScanner
        visible={showQRScanner}
        onClose={() => setShowQRScanner(false)}
        onScan={handleQRScanResult}
        title="Scan QR Anchor"
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
  navButton: {
    backgroundColor: '#4CAF50',
    borderColor: '#4CAF50',
  },
  controlButtonText: {
    color: 'white',
    fontSize: 20,
  },
});

export default MapScreen;