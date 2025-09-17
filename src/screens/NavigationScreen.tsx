import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  StatusBar,
  SafeAreaView,
  Platform,
  Vibration
} from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { POI } from '../types';
// PDR Position interface - moved here to remove PDR dependency
export interface PDRPosition {
  x: number;
  y: number;
  heading: number;
  confidence: number;
  timestamp: number;
  stepCount: number;
  accuracy: number;
}
import QRAnchorService, { QRAnchor } from '../services/anchors/QRAnchorService';
import NavigationService, { NavigationState } from '../services/navigation/NavigationService';
import SimpleQRScanner from '../components/SimpleQRScanner';


interface NavigationScreenProps {
  navigation: any;
  route: {
    params: {
      pois: POI[];
      routeName?: string;
    };
  };
}

export default function NavigationScreen({ navigation, route }: NavigationScreenProps) {
  const { user } = useAuth();
  
  // Services
  const [anchorService] = useState(() => new QRAnchorService());
  const [navService] = useState(() => new NavigationService());
  
  // State
  const [currentPosition, setCurrentPosition] = useState<PDRPosition>({
    x: 0, y: 0, heading: 0, confidence: 1.0, timestamp: Date.now(), stepCount: 0
  });
  const [navigationState, setNavigationState] = useState<NavigationState | null>(null);
  const [showQRScanner, setShowQRScanner] = useState(false);
  // Drift detection removed - will be handled by new PDR implementation
  const [isCalibrating, setIsCalibrating] = useState(false);
  
  // Refs
  const positionUpdateInterval = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    initializeNavigation();
    
    return () => {
      cleanup();
    };
  }, []);

  const initializeNavigation = async () => {
    try {
      // PDR initialization removed - will be replaced with new implementation
      
      // Set up navigation event handlers
      navService.setOnStateUpdate((state) => {
        setNavigationState(state);
      });
      
      navService.setOnPOIReached((poi) => {
        Vibration.vibrate(200);
        Alert.alert(
          'POI Reached',
          `You have reached ${poi.name || poi.title}. Scan the QR code to complete this POI.`,
          [
            { text: 'Scan QR', onPress: () => setShowQRScanner(true) },
            { text: 'Skip', onPress: () => navService.skipCurrentPOI() }
          ]
        );
      });
      
      navService.setOnRouteComplete(() => {
        Alert.alert(
          'Route Complete!',
          'Congratulations! You have completed the navigation route.',
          [
            { text: 'OK', onPress: () => navigation.goBack() }
          ]
        );
      });
      
      // Start navigation if POIs provided
      if (route.params?.pois && route.params.pois.length > 0) {
        navService.startRoute(route.params.pois, route.params.routeName || 'Navigation Route');
      } else {
        Alert.alert('No Route', 'No POIs provided for navigation');
        navigation.goBack();
      }
      
    } catch (error) {
      console.error('Navigation initialization error:', error);
      Alert.alert('Error', 'Failed to initialize navigation');
    }
  };

  const cleanup = () => {
    // PDR cleanup removed - will be handled by new implementation
    if (positionUpdateInterval.current) {
      clearInterval(positionUpdateInterval.current);
    }
  };

  const handleQRScan = async (qrData: string) => {
    try {
      setIsCalibrating(true);
      setShowQRScanner(false);
      
      // Parse QR code
      const anchor = anchorService.parseQRCode(qrData);
      if (!anchor) {
        Alert.alert('Invalid QR Code', 'This QR code is not a valid anchor.');
        return;
      }
      
      // Add anchor to service if not exists
      await anchorService.addAnchor(anchor);
      
      // Calibrate position - will be handled by new PDR implementation
      const calibratedPosition = anchorService.calibratePosition(anchor, currentPosition);
      
      // Update current position
      setCurrentPosition({
        ...calibratedPosition,
        confidence: 1.0,
        timestamp: Date.now(),
        stepCount: currentPosition.stepCount
      });
      
      // Drift detection reset - will be handled by new PDR implementation
      
      // Check if this is the current target POI
      const currentPOI = navService.getNextPOI();
      if (currentPOI && anchor.id === currentPOI.id) {
        navService.completeCurrentPOI();
        Vibration.vibrate([0, 100, 50, 100]); // Success vibration
      }
      
      Alert.alert(
        'Position Calibrated',
        `Position updated using anchor: ${anchor.metadata?.name || anchor.id}`
      );
      
    } catch (error) {
      console.error('QR scan error:', error);
      Alert.alert('Error', 'Failed to process QR code');
    } finally {
      setIsCalibrating(false);
    }
  };

  const handleCompletePOI = () => {
    const currentPOI = navService.getNextPOI();
    if (currentPOI) {
      Alert.alert(
        'Complete POI',
        `Mark ${currentPOI.name || currentPOI.title} as complete?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Complete', 
            onPress: () => {
              navService.completeCurrentPOI();
              Vibration.vibrate(100);
            }
          }
        ]
      );
    }
  };

  const handleSkipPOI = () => {
    const currentPOI = navService.getNextPOI();
    if (currentPOI) {
      Alert.alert(
        'Skip POI',
        `Skip ${currentPOI.name || currentPOI.title}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Skip', 
            onPress: () => {
              navService.skipCurrentPOI();
              Vibration.vibrate(50);
            }
          }
        ]
      );
    }
  };

  const handleEndRoute = () => {
    Alert.alert(
      'End Navigation',
      'Are you sure you want to end the current navigation session?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'End Route', 
          style: 'destructive',
          onPress: () => {
            navService.stopRoute();
            navigation.goBack();
          }
        }
      ]
    );
  };

  const formatDistance = (distance: number): string => {
    if (distance < 1) {
      return `${Math.round(distance * 100)}cm`;
    }
    return `${distance.toFixed(1)}m`;
  };

  const formatHeading = (heading: number): string => {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(heading / 45) % 8;
    return `${directions[index]} (${Math.round(heading)}°)`;
  };

  if (!navigationState) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Initializing Navigation...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#007AFF" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Navigation</Text>
        <TouchableOpacity onPress={() => setShowQRScanner(true)} style={styles.scanButton}>
          <Text style={styles.scanButtonText}>📷</Text>
        </TouchableOpacity>
      </View>
      
      {/* Position Display */}
      <View style={styles.positionCard}>
        <Text style={styles.positionTitle}>Current Position</Text>
        <View style={styles.positionRow}>
          <Text style={styles.positionLabel}>X:</Text>
          <Text style={styles.positionValue}>{currentPosition.x.toFixed(1)}m</Text>
          <Text style={styles.positionLabel}>Y:</Text>
          <Text style={styles.positionValue}>{currentPosition.y.toFixed(1)}m</Text>
        </View>
        <View style={styles.positionRow}>
          <Text style={styles.positionLabel}>Heading:</Text>
          <Text style={styles.positionValue}>{formatHeading(currentPosition.heading)}</Text>
        </View>
        <View style={styles.positionRow}>
          <Text style={styles.positionLabel}>Steps:</Text>
          <Text style={styles.positionValue}>{currentPosition.stepCount}</Text>
          <Text style={styles.positionLabel}>Confidence:</Text>
          <Text style={[
            styles.positionValue,
            { color: currentPosition.confidence > 0.7 ? '#4CAF50' : '#FF9800' }
          ]}>
            {Math.round(currentPosition.confidence * 100)}%
          </Text>
        </View>
        
        {/* Drift warning removed - will be handled by new PDR implementation */}
        
        {isCalibrating && (
          <View style={styles.calibratingIndicator}>
            <Text style={styles.calibratingText}>🔄 Calibrating...</Text>
          </View>
        )}
      </View>
      
      {/* Navigation Info */}
      {navigationState.route && (
        <View style={styles.navigationCard}>
          <Text style={styles.navigationTitle}>Route: {navigationState.route.name}</Text>
          <Text style={styles.navigationSubtitle}>
            {navigationState.route.pois.length} POIs • {navigationState.route.totalDistance.toFixed(1)}m
          </Text>
          
          {/* Progress Bar */}
          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View 
                style={[
                  styles.progressFill, 
                  { width: `${navigationState.progress * 100}%` }
                ]} 
              />
            </View>
            <Text style={styles.progressText}>
              {Math.round(navigationState.progress * 100)}% Complete
            </Text>
          </View>
        </View>
      )}
      
      {/* Current POI */}
      {navigationState.targetPOI && (
        <View style={styles.poiCard}>
          <Text style={styles.poiTitle}>Next POI</Text>
          <Text style={styles.poiName}>{navigationState.targetPOI.name || navigationState.targetPOI.title}</Text>
          <Text style={styles.poiType}>{navigationState.targetPOI.pois_type || navigationState.targetPOI.type}</Text>
          <Text style={styles.poiDescription}>
            {navigationState.nextInstruction}
          </Text>
          
          <View style={styles.poiActions}>
            <TouchableOpacity style={styles.completeButton} onPress={handleCompletePOI}>
              <Text style={styles.completeButtonText}>Complete</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.skipButton} onPress={handleSkipPOI}>
              <Text style={styles.skipButtonText}>Skip</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      
      {/* Route Complete */}
      {!navigationState.targetPOI && navigationState.route && (
        <View style={styles.completeCard}>
          <Text style={styles.completeTitle}>🎉 Route Complete!</Text>
          <Text style={styles.completeSubtitle}>
            All POIs have been visited successfully.
          </Text>
          <TouchableOpacity style={styles.endButton} onPress={() => navigation.goBack()}>
            <Text style={styles.endButtonText}>Return to Map</Text>
          </TouchableOpacity>
        </View>
      )}
      
      {/* Action Buttons */}
      <View style={styles.actionButtons}>
        <TouchableOpacity 
          style={styles.actionButton} 
          onPress={() => setShowQRScanner(true)}
        >
          <Text style={styles.actionButtonText}>📷 Scan QR</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.actionButton, styles.endRouteButton]} 
          onPress={handleEndRoute}
        >
          <Text style={styles.actionButtonText}>End Route</Text>
        </TouchableOpacity>
      </View>
      
      {/* QR Scanner Modal */}
      <SimpleQRScanner
        visible={showQRScanner}
        onScan={handleQRScan}
        onClose={() => setShowQRScanner(false)}
        title="Scan POI QR Code"
        instruction="Enter QR code data manually or use the test QR code for development"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 18,
    color: '#666',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: '#007AFF',
  },
  backButton: {
    padding: 8,
  },
  backButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  title: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  scanButton: {
    padding: 8,
  },
  scanButtonText: {
    color: 'white',
    fontSize: 20,
  },
  positionCard: {
    margin: 15,
    padding: 20,
    backgroundColor: 'white',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  positionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#333',
  },
  positionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  positionLabel: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  positionValue: {
    fontSize: 14,
    color: '#333',
    fontWeight: '600',
  },
  // Drift warning styles removed - will be handled by new PDR implementation
  calibratingIndicator: {
    marginTop: 10,
    padding: 8,
    backgroundColor: '#E3F2FD',
    borderRadius: 6,
    alignItems: 'center',
  },
  calibratingText: {
    color: '#1976D2',
    fontSize: 14,
    fontWeight: '500',
  },
  navigationCard: {
    margin: 15,
    padding: 20,
    backgroundColor: 'white',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  navigationTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  navigationSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 15,
  },
  progressContainer: {
    marginTop: 10,
  },
  progressBar: {
    height: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4CAF50',
    borderRadius: 4,
  },
  progressText: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    marginTop: 5,
  },
  poiCard: {
    margin: 15,
    padding: 20,
    backgroundColor: 'white',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  poiTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  poiName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#007AFF',
    marginBottom: 5,
  },
  poiType: {
    fontSize: 14,
    color: '#666',
    marginBottom: 10,
  },
  poiDescription: {
    fontSize: 14,
    color: '#333',
    marginBottom: 15,
    fontStyle: 'italic',
  },
  poiActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  completeButton: {
    flex: 1,
    backgroundColor: '#4CAF50',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginRight: 10,
  },
  completeButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  skipButton: {
    flex: 1,
    backgroundColor: '#FF9800',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginLeft: 10,
  },
  skipButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  completeCard: {
    margin: 15,
    padding: 30,
    backgroundColor: 'white',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    alignItems: 'center',
  },
  completeTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#4CAF50',
    marginBottom: 10,
  },
  completeSubtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
  },
  endButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 25,
  },
  endButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
  },
  actionButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderRadius: 25,
    minWidth: 120,
    alignItems: 'center',
  },
  endRouteButton: {
    backgroundColor: '#FF4444',
  },
  actionButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
