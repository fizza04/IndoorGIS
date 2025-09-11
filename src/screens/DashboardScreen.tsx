import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Alert,
  Platform,
  RefreshControl,
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { buildingAPI, auditAPI } from '../services/api';
import { Building, AuditRoute } from '../types';

interface DashboardScreenProps {
  navigation: any;
}

const DashboardScreen: React.FC<DashboardScreenProps> = ({ navigation }) => {
  const { user } = useAuth();
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [assignedRoutes, setAssignedRoutes] = useState<AuditRoute[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [buildingsLoading, setBuildingsLoading] = useState(false);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setIsLoading(true);
      
      // Fetch accessible buildings from server
      setBuildingsLoading(true);
      try {
        const buildingsResponse = await buildingAPI.getBuildings();
        if (buildingsResponse?.spaces && Array.isArray(buildingsResponse.spaces)) {
          // Map server data to our interface format
          const mappedBuildings = buildingsResponse.spaces.map((building: any) => {

            
            return {
              id: building.buid || building.bu_code || building._id || building.id || `building_${Date.now()}`,
              bu_code: building.bucode || building.bu_code || building.building_code || building.code,
              name: building.name || building.bu_name || building.building_name || 'Unnamed Building',
              bu_name: building.name || building.bu_name || building.building_name,
              description: building.description || building.bu_description || building.building_description || 'No description available',
              bu_description: building.description || building.bu_description || building.building_description,
              coordinates: building.coordinates || (building.coordinates_lat && building.coordinates_lon ? {
                latitude: parseFloat(building.coordinates_lat),
                longitude: parseFloat(building.coordinates_lon)
              } : undefined),
              bu_lat: building.coordinates_lat ? parseFloat(building.coordinates_lat) : undefined,
              bu_lng: building.coordinates_lon ? parseFloat(building.coordinates_lon) : undefined,
              floors: (() => {
                // Try multiple possible field names for floors
                let floors = [];
                
                if (building.floor_number) {
                  floors = [parseInt(building.floor_number)];
                } else if (building.bu_floors) {
                  floors = Array.isArray(building.bu_floors) ? building.bu_floors : [building.bu_floors];
                } else if (building.floors) {
                  floors = Array.isArray(building.floors) ? building.floors : [building.floors];
                } else if (building.floor_numbers) {
                  floors = Array.isArray(building.floor_numbers) ? building.floor_numbers : [building.floor_numbers];
                } else if (building.floors_count) {
                  floors = Array.from({length: parseInt(building.floors_count)}, (_, i) => i + 1);
                } else if (building.total_floors) {
                  floors = Array.from({length: parseInt(building.total_floors)}, (_, i) => i + 1);
                }
                
                return floors;
              })(),
              bu_floors: (() => {
                // Use the same logic as floors field
                let floors = [];
                
                if (building.floor_number) {
                  floors = [parseInt(building.floor_number)];
                } else if (building.bu_floors) {
                  floors = Array.isArray(building.bu_floors) ? building.bu_floors : [building.bu_floors];
                } else if (building.floors) {
                  floors = Array.isArray(building.floors) ? building.floors : [building.floors];
                } else if (building.floor_numbers) {
                  floors = Array.from({length: parseInt(building.floor_numbers)}, (_, i) => i + 1);
                } else if (building.floors_count) {
                  floors = Array.from({length: parseInt(building.floors_count)}, (_, i) => i + 1);
                } else if (building.total_floors) {
                  floors = Array.from({length: parseInt(building.total_floors)}, (_, i) => i + 1);
                }
                
                return floors;
              })(),
              accessible: building.is_published === 'true' || building.accessible !== false,
              space_type: building.space_type
            };
          });
          setBuildings(mappedBuildings);
        } else {
          console.log('No buildings found or invalid response format:', buildingsResponse);
          setBuildings([]);
        }
      } catch (error) {
        console.error('Failed to fetch buildings:', error);
        Alert.alert(
          'Buildings Error', 
          `Failed to load buildings: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
        setBuildings([]);
      } finally {
        setBuildingsLoading(false);
      }

      // Fetch assigned audit routes from server
      setRoutesLoading(true);
      try {
        const routesResponse = await auditAPI.getRoutes();
        if (routesResponse?.routes && Array.isArray(routesResponse.routes)) {
          // Map server data to our interface format
          const mappedRoutes = routesResponse.routes.map((route: any) => {

            
            return {
              id: route._id || route.id || `route_${Date.now()}`,
              _id: route._id,
              name: route.name || route.route_name || route.title || 'Unnamed Route',
              route_name: route.name || route.route_name || route.title,
              buildingId: route.building_id || route.building_code || route.buildingId || route.bu_code,
              buildingName: route.description || route.building_name || route.buildingName || route.building || 'Unknown Building',
              bu_code: route.building_id || route.building_code || route.bu_code,
              floorNumbers: route.floor_number ? [parseInt(route.floor_number)] : route.floors || route.floorNumbers || route.floor_numbers || route.floor_list || [],
              floors: route.floor_number ? [parseInt(route.floor_number)] : route.floors || route.floorNumbers || route.floor_numbers || route.floor_list,
              totalPOIs: route.pois?.length || route.pois_count || route.totalPOIs || route.total_pois || route.poi_count || 0,
              pois_count: route.pois?.length || route.pois_count || route.totalPOIs || route.total_pois || route.poi_count || 0,
              completedPOIs: route.completed_at ? (route.pois?.length || 0) : route.completed_pois || route.completedPOIs || route.completed_count || 0,
              completed_pois: route.completed_at ? (route.pois?.length || 0) : route.completed_pois || route.completedPOIs || route.completed_count,
              assignedTechnicianId: route.assigned_auditors?.[0] || route.assigned_auditor || route.assignedTechnicianId || route.technician_id || '',
              assigned_auditors: route.assigned_auditors || [route.assigned_auditor || route.assignedTechnicianId || route.technician_id || ''],
              assigned_auditor: route.assigned_auditors?.[0] || route.assigned_auditor || route.assignedTechnicianId || route.technician_id,
              status: route.status || route.state || 'active',
              createdAt: route.created_at || route.createdAt || route.created || new Date().toISOString(),
              updatedAt: route.updated_at || route.updatedAt || route.modified || new Date().toISOString(),
              created_by: route.created_by || route.creator || route.owner || 'Unknown',
              estimated_time: route.estimated_time,
              optimization_method: route.optimization_method,
              // Include POIs data
              pois: route.pois || route.poi_list || route.points || [],
              // Include floor information
              floor_number: route.floor_number || route.floor || route.floor_num,
              floor: route.floor_number || route.floor || route.floor_num,
              // Include building information
              building_id: route.building_id || route.building_code || route.bu_code,
              building_code: route.building_id || route.building_code || route.bu_code,
              description: route.description || route.route_description || route.notes || 'No description'
            };
          });
          setAssignedRoutes(mappedRoutes);
        } else {
          console.log('No routes found or invalid response format:', routesResponse);
          setAssignedRoutes([]);
        }
      } catch (error) {
        console.error('Failed to fetch routes:', error);
        Alert.alert(
          'Routes Error', 
          `Failed to load audit routes: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
        setAssignedRoutes([]);
      } finally {
        setRoutesLoading(false);
      }
    } catch (error) {
      console.error('Dashboard data fetch error:', error);
      Alert.alert('Error', 'Failed to load dashboard data');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRouteSelect = (route: AuditRoute) => {
    navigation.navigate('Map', { 
      selectedRoute: route,
      auditSession: true 
    });
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#f8f9fa" />
      
              <View style={styles.header}>
          <Text style={styles.welcomeText}>Welcome back,</Text>
          <Text style={styles.userName}>{user?.name || 'Technician'}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>{user?.role?.toUpperCase()}</Text>
          </View>
          <View style={styles.aclInfo}>
            <Text style={styles.aclText}>
              🔐 Access Level: {user?.role === 'admin' ? 'Full Access' : 
                               user?.role === 'planner' ? 'Planning Access' : 
                               user?.role === 'auditor' ? 'Audit Access' : 
                               user?.role === 'technician' ? 'Technician Access' : 'Limited Access'}
            </Text>
          </View>
        </View>

      <ScrollView 
        style={styles.content} 
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Assigned Audit Routes</Text>
          <Text style={styles.sectionSubtitle}>
            {routesLoading ? 'Loading...' : `${assignedRoutes.length} route(s) assigned`}
          </Text>
        </View>

        {routesLoading ? (
          <View style={styles.loadingCard}>
            <Text style={styles.loadingText}>Loading routes...</Text>
          </View>
        ) : assignedRoutes.length > 0 ? (
          assignedRoutes.map((route, index) => (
            <TouchableOpacity
              key={route._id || route.id || `route_${index}`}
              style={styles.routeCard}
              onPress={() => handleRouteSelect(route)}
            >
              <View style={styles.routeHeader}>
                <Text style={styles.routeName}>{route.route_name || route.name}</Text>
                <View style={[styles.statusBadge, 
                  route.status === 'completed' ? styles.statusCompleted : 
                  route.status === 'in_progress' ? styles.statusInProgress : 
                  styles.statusAssigned
                ]}>
                  <Text style={styles.statusText}>{route.status.replace('_', ' ')}</Text>
                </View>
              </View>
              
              <View style={styles.routeDetails}>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Building:</Text>
                  <Text style={styles.detailValue}>{route.buildingName || route.description || route.building_code || 'Unknown'}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Floors:</Text>
                  <Text style={styles.detailValue}>
                    {(route.floors || route.floorNumbers || []).length > 0 
                      ? (route.floors || route.floorNumbers || []).join(', ') 
                      : 'N/A'}
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>POIs:</Text>
                  <Text style={styles.detailValue}>
                    {(route.completed_pois || route.completedPOIs || 0)}/{(route.pois_count || route.totalPOIs || 0)} completed
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Created By:</Text>
                  <Text style={styles.detailValue}>{route.created_by || 'Unknown'}</Text>
                </View>
              </View>

              <View style={styles.progressBar}>
                <View 
                  style={[
                    styles.progressFill, 
                    { 
                      width: `${((route.completed_pois || route.completedPOIs || 0) / (route.pois_count || route.totalPOIs || 1)) * 100}%` 
                    }
                  ]} 
                />
              </View>
            </TouchableOpacity>
          ))
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No audit routes assigned</Text>
            <Text style={styles.emptySubtext}>Contact your administrator to get assigned to audit routes</Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Accessible Buildings</Text>
          <Text style={styles.sectionSubtitle}>
            {buildingsLoading ? 'Loading...' : `${buildings.length} building(s) accessible`}
          </Text>
        </View>



        {buildingsLoading ? (
          <View style={styles.loadingCard}>
            <Text style={styles.loadingText}>Loading buildings...</Text>
          </View>
        ) : buildings.length > 0 ? (
          buildings.map((building) => (
            <View key={building.bu_code || building.id} style={styles.buildingCard}>
                          <Text style={styles.buildingName}>{building.bu_name || building.name}</Text>
            <Text style={styles.buildingInfo}>
              {(building.floors || building.bu_floors || []).length || 0} floors • {building.bu_description || building.description || 'No description'}
            </Text>
            {(building.bu_lat && building.bu_lng) && (
              <Text style={styles.buildingCoordinates}>
                📍 {building.bu_lat?.toFixed(6)}, {building.bu_lng?.toFixed(6)}
              </Text>
            )}
            </View>
          ))
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No buildings accessible</Text>
            <Text style={styles.emptySubtext}>Contact your administrator to get building access</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 18,
    color: '#7f8c8d',
  },
  header: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 24,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
  },
  welcomeText: {
    fontSize: 16,
    color: '#7f8c8d',
    marginBottom: 4,
  },
  userName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 12,
  },
  roleBadge: {
    backgroundColor: '#3498db',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    alignSelf: 'flex-start',
  },
  roleText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
  },
  section: {
    marginTop: 24,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#7f8c8d',
  },
  routeCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e9ecef',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },

  routeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  routeName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2c3e50',
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  statusAssigned: {
    backgroundColor: '#f39c12',
  },
  statusInProgress: {
    backgroundColor: '#3498db',
  },
  statusCompleted: {
    backgroundColor: '#27ae60',
  },
  statusText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  routeDetails: {
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  detailLabel: {
    fontSize: 14,
    color: '#7f8c8d',
  },
  detailValue: {
    fontSize: 14,
    color: '#2c3e50',
    fontWeight: '500',
  },
  progressBar: {
    height: 6,
    backgroundColor: '#e9ecef',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#27ae60',
    borderRadius: 3,
  },
  buildingCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  buildingName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 4,
  },
  buildingInfo: {
    fontSize: 14,
    color: '#7f8c8d',
  },
  buildingCoordinates: {
    fontSize: 12,
    color: '#95a5a6',
    marginTop: 4,
    fontStyle: 'italic',
  },
  aclInfo: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  aclText: {
    fontSize: 12,
    color: '#6c757d',
    fontWeight: '500',
  },
  loadingCard: {
    backgroundColor: '#ffffff',
    padding: 20,
    borderRadius: 12,
    marginBottom: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e9ecef',
  },

  emptyCard: {
    backgroundColor: '#ffffff',
    padding: 40,
    borderRadius: 12,
    marginBottom: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#7f8c8d',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#95a5a6',
    textAlign: 'center',
  },

});

export default DashboardScreen;
