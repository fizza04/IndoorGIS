import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface FloatingActionButtonsProps {
  onQRScan: () => void;
  onPDRToggle: () => void;
  onPDRReset: () => void;
  onRouteToggle: () => void;
  onShowHelp: () => void;
  isPDRTracking: boolean;
  selectedRoute: any;
  auditSession: any;
}

const FloatingActionButtons: React.FC<FloatingActionButtonsProps> = ({
  onQRScan,
  onPDRToggle,
  onPDRReset,
  onRouteToggle,
  onShowHelp,
  isPDRTracking,
  selectedRoute,
  auditSession,
}) => {
  return (
    <View style={styles.floatingActionButtons}>
      {/* QR Scanner Button - Always visible when route is selected */}
      {selectedRoute && (
        <TouchableOpacity 
          style={[styles.fab, styles.fabPrimary]} 
          onPress={onQRScan}
          activeOpacity={0.8}
        >
          <Text style={styles.fabIcon}>📷</Text>
          <Text style={styles.fabLabel}>Scan POI</Text>
        </TouchableOpacity>
      )}

      {/* PDR Start/Stop Button - Only show when route is selected */}
      {selectedRoute && (
        <TouchableOpacity
          style={[
            styles.fab,
            isPDRTracking ? styles.fabStop : styles.fabStart,
          ]}
          onPress={onPDRToggle}
          activeOpacity={0.8}
        >
          <Text style={styles.fabIcon}>
            {isPDRTracking ? '⏹️' : '🚶'}
          </Text>
          <Text style={styles.fabLabel}>
            {isPDRTracking ? 'Stop PDR' : 'Start PDR'}
          </Text>
        </TouchableOpacity>
      )}

      {/* PDR Reset Button - Only show when route is selected */}
      {selectedRoute && (
        <TouchableOpacity
          style={[styles.fab, styles.fabReset]}
          onPress={onPDRReset}
          activeOpacity={0.8}
        >
          <Text style={styles.fabIcon}>🔄</Text>
          <Text style={styles.fabLabel}>Reset PDR</Text>
        </TouchableOpacity>
      )}

      {/* Start/Stop Session Button - Only show when route is selected */}
      {selectedRoute && (
        <TouchableOpacity
          style={[styles.fab, styles.fabNav]}
          onPress={onRouteToggle}
          activeOpacity={0.8}
        >
          <Text style={styles.fabIcon}>
            {auditSession?.session_status === 'active' ? '⏹️' : '🚀'}
          </Text>
          <Text style={styles.fabLabel}>
            {auditSession?.session_status === 'active' ? 'End Session' : 'Start Session'}
          </Text>
        </TouchableOpacity>
      )}

      {/* Help Button - Always visible */}
      <TouchableOpacity
        style={[styles.fab, styles.fabHelp]}
        onPress={onShowHelp}
        activeOpacity={0.8}
      >
        <Text style={styles.fabIcon}>❓</Text>
        <Text style={styles.fabLabel}>Help</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  floatingActionButtons: {
    position: 'absolute',
    bottom: 30,
    right: 20,
    zIndex: 1000,
    flexDirection: 'column',
    alignItems: 'flex-end',
  },
  fab: {
    minWidth: 80,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 8,
    flexDirection: 'row',
  },
  fabIcon: {
    fontSize: 18,
    color: '#fff',
    marginRight: 6,
  },
  fabLabel: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '600',
    textAlign: 'center',
  },
  fabPrimary: {
    backgroundColor: '#007AFF',
  },
  fabStart: {
    backgroundColor: '#34C759',
  },
  fabStop: {
    backgroundColor: '#FF3B30',
  },
  fabNav: {
    backgroundColor: '#5856D6',
  },
  fabHelp: {
    backgroundColor: '#8E8E93',
  },
  fabReset: {
    backgroundColor: '#FF9500',
  },
});

export default FloatingActionButtons;
