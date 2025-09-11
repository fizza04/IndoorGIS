import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Dimensions,
  StatusBar,
  SafeAreaView,
  Platform,
  Vibration
} from 'react-native';

const { width, height } = Dimensions.get('window');

interface NavigationDemoScreenProps {
  navigation: any;
  route: {
    params: {
      pois: any[];
      routeName?: string;
    };
  };
}

export default function NavigationDemoScreen({ navigation, route }: NavigationDemoScreenProps) {
  // Mock position state
  const [position, setPosition] = useState({
    x: 0,
    y: 0,
    heading: 0,
    confidence: 1.0,
    stepCount: 0,
    timestamp: Date.now()
  });

  const [navigationState, setNavigationState] = useState({
    currentPOI: 0,
    totalPOIs: route.params?.pois?.length || 3,
    progress: 0,
    isActive: true,
    nextInstruction: 'Navigate to first POI'
  });

  const [driftDetected, setDriftDetected] = useState(false);
  const [showQRScanner, setShowQRScanner] = useState(false);

  // Mock POIs for demo
  const mockPOIs = route.params?.pois || [
    { id: '1', name: 'Fire Extinguisher A', type: 'fire_extinguisher', position: { x: 5, y: 0 } },
    { id: '2', name: 'Exit Sign B', type: 'exit_sign', position: { x: 5, y: 5 } },
    { id: '3', name: 'Equipment Panel C', type: 'equipment_panel', position: { x: 0, y: 5 } }
  ];

  // Simulate PDR tracking
  useEffect(() => {
    const interval = setInterval(() => {
      if (navigationState.isActive) {
        // Simulate step
        const newStepCount = position.stepCount + 1;
        const radians = position.heading * Math.PI / 180;
        const stepLength = 0.7; // meters per step
        
        setPosition(prev => ({
          ...prev,
          x: prev.x + stepLength * Math.cos(radians),
          y: prev.y + stepLength * Math.sin(radians),
          stepCount: newStepCount,
          confidence: Math.max(0.1, 1.0 - (newStepCount * 0.01)),
          timestamp: Date.now()
        }));

        // Check for drift
        if (newStepCount > 8 && !driftDetected) {
          const distance = Math.sqrt(position.x * position.x + position.y * position.y);
          if (distance > 3.0) {
            setDriftDetected(true);
            Vibration.vibrate([0, 200, 100, 200]);
            Alert.alert(
              'Position Drift Detected',
              'Your position may be inaccurate. Please scan a nearby QR code to calibrate.',
              [
                { text: 'Scan QR Code', onPress: () => setShowQRScanner(true) },
                { text: 'Continue Anyway', onPress: () => setDriftDetected(false) }
              ]
            );
          }
        }
      }
    }, 3000); // Every 3 seconds

    return () => clearInterval(interval);
  }, [position.stepCount, navigationState.isActive, driftDetected]);

  const handleQRScan = () => {
    setShowQRScanner(false);
    
    // Simulate QR calibration
    setPosition(prev => ({
      ...prev,
      x: 0,
      y: 0,
      confidence: 1.0,
      stepCount: 0
    }));
    
    setDriftDetected(false);
    Alert.alert('Position Calibrated', 'Your position has been updated using QR anchor.');
  };

  const completeCurrentPOI = () => {
    if (navigationState.currentPOI < navigationState.totalPOIs - 1) {
      setNavigationState(prev => ({
        ...prev,
        currentPOI: prev.currentPOI + 1,
        progress: (prev.currentPOI + 1) / prev.totalPOIs,
        nextInstruction: `Navigate to ${mockPOIs[prev.currentPOI + 1]?.name}`
      }));
      Vibration.vibrate(200);
    } else {
      Alert.alert(
        'Route Complete!',
        'Congratulations! You have completed the navigation route.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    }
  };

  const skipCurrentPOI = () => {
    if (navigationState.currentPOI < navigationState.totalPOIs - 1) {
      setNavigationState(prev => ({
        ...prev,
        currentPOI: prev.currentPOI + 1,
        progress: (prev.currentPOI + 1) / prev.totalPOIs,
        nextInstruction: `Navigate to ${mockPOIs[prev.currentPOI + 1]?.name}`
      }));
      Vibration.vibrate(50);
    }
  };

  const endRoute = () => {
    Alert.alert(
      'End Navigation',
      'Are you sure you want to end the current navigation session?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'End Route', 
          style: 'destructive',
          onPress: () => navigation.goBack()
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

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#007AFF" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Navigation Demo</Text>
        <TouchableOpacity onPress={() => setShowQRScanner(true)} style={styles.scanButton}>
          <Text style={styles.scanButtonText}>📷</Text>
        </TouchableOpacity>
      </View>
      
      {/* Position Display */}
      <View style={styles.positionCard}>
        <Text style={styles.positionTitle}>Current Position (Simulated)</Text>
        <View style={styles.positionRow}>
          <Text style={styles.positionLabel}>X:</Text>
          <Text style={styles.positionValue}>{position.x.toFixed(1)}m</Text>
          <Text style={styles.positionLabel}>Y:</Text>
          <Text style={styles.positionValue}>{position.y.toFixed(1)}m</Text>
        </View>
        <View style={styles.positionRow}>
          <Text style={styles.positionLabel}>Heading:</Text>
          <Text style={styles.positionValue}>{formatHeading(position.heading)}</Text>
        </View>
        <View style={styles.positionRow}>
          <Text style={styles.positionLabel}>Steps:</Text>
          <Text style={styles.positionValue}>{position.stepCount}</Text>
          <Text style={styles.positionLabel}>Confidence:</Text>
          <Text style={[
            styles.positionValue,
            { color: position.confidence > 0.7 ? '#4CAF50' : '#FF9800' }
          ]}>
            {Math.round(position.confidence * 100)}%
          </Text>
        </View>
        
        {driftDetected && (
          <View style={styles.driftWarning}>
            <Text style={styles.driftWarningText}>⚠️ Drift Detected - Calibration Recommended</Text>
          </View>
        )}
      </View>
      
      {/* Navigation Info */}
      <View style={styles.navigationCard}>
        <Text style={styles.navigationTitle}>Route: {route.params?.routeName || 'Demo Route'}</Text>
        <Text style={styles.navigationSubtitle}>
          {navigationState.totalPOIs} POIs • Simulated tracking
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
      
      {/* Current POI */}
      {navigationState.currentPOI < navigationState.totalPOIs && (
        <View style={styles.poiCard}>
          <Text style={styles.poiTitle}>Next POI</Text>
          <Text style={styles.poiName}>{mockPOIs[navigationState.currentPOI]?.name}</Text>
          <Text style={styles.poiType}>{mockPOIs[navigationState.currentPOI]?.type}</Text>
          <Text style={styles.poiDescription}>
            {navigationState.nextInstruction}
          </Text>
          
          <View style={styles.poiActions}>
            <TouchableOpacity style={styles.completeButton} onPress={completeCurrentPOI}>
              <Text style={styles.completeButtonText}>Complete</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.skipButton} onPress={skipCurrentPOI}>
              <Text style={styles.skipButtonText}>Skip</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      
      {/* Route Complete */}
      {navigationState.currentPOI >= navigationState.totalPOIs && (
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
          onPress={endRoute}
        >
          <Text style={styles.actionButtonText}>End Route</Text>
        </TouchableOpacity>
      </View>
      
      {/* QR Scanner Modal */}
      {showQRScanner && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>QR Code Scanner</Text>
            <Text style={styles.modalText}>
              In the real app, this would open the camera to scan QR codes on POIs.
            </Text>
            <Text style={styles.modalText}>
              For this demo, we'll simulate a successful scan.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalButton} onPress={handleQRScan}>
                <Text style={styles.modalButtonText}>Simulate Scan</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalButton, styles.cancelModalButton]} 
                onPress={() => setShowQRScanner(false)}
              >
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
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
  driftWarning: {
    marginTop: 15,
    padding: 10,
    backgroundColor: '#FFF3CD',
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#FF9800',
  },
  driftWarningText: {
    color: '#856404',
    fontSize: 14,
    fontWeight: '600',
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
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 30,
    margin: 20,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
  modalText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 10,
    lineHeight: 24,
  },
  modalActions: {
    flexDirection: 'row',
    marginTop: 20,
  },
  modalButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginHorizontal: 10,
  },
  cancelModalButton: {
    backgroundColor: '#FF4444',
  },
  modalButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
