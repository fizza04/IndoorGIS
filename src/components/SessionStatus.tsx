import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { getCurrentStepText, getSessionStatusText } from '../utils/helpers';

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

interface SessionStatusProps {
  auditSession: any;
  sessionProgress: any;
  currentPOIToScan: any;
  isPDRTracking: boolean;
  isSessionComplete: boolean;
  currentWalkingTime: number;
  isWalking: boolean;
  pdrPosition: any;
  stepCount: number;
  formatWalkingTime: (seconds: number) => string;
}

const SessionStatus: React.FC<SessionStatusProps> = ({
  auditSession,
  sessionProgress,
  currentPOIToScan,
  isPDRTracking,
  isSessionComplete,
  currentWalkingTime,
  isWalking,
  pdrPosition,
  stepCount,
  formatWalkingTime,
}) => {
  return (
    <>
      {/* Enhanced Session Status - Top Right - Only show when session is active */}
      {auditSession?.session_status === 'active' && (
        <View style={styles.minimalSessionStatus}>
          <View style={styles.sessionStatusBadge}>
            <Text style={styles.sessionStatusText}>🔴 LIVE</Text>
          </View>
          <Text style={styles.sessionProgressText}>
            {getSessionStatusText(sessionProgress, isSessionComplete)}
          </Text>
          {currentPOIToScan && (
            <Text style={styles.currentPOIText}>
              🎯 {currentPOIToScan.name}
            </Text>
          )}
          {/* Current Step Indicator */}
          <View style={styles.stepIndicator}>
            <Text style={styles.stepText}>
              {getCurrentStepText(isPDRTracking, currentPOIToScan)}
            </Text>
          </View>
        </View>
      )}

      {/* Live PDR Data - Bottom Left - Always show when PDR is tracking */}
      {isPDRTracking && (
        <View style={styles.livePDRCompact}>
          <View style={styles.livePDRHeader}>
            <Text style={styles.livePDRTitle}>📍 PDR</Text>
            <View style={styles.livePDRIndicator} />
          </View>
          <Text style={styles.livePDRDataValue}>
            {pdrPosition ? 
              `x:${pdrPosition.x?.toFixed(1) || '0'} y:${pdrPosition.y?.toFixed(1) || '0'} | ${stepCount} steps` :
              'Initializing...'
            }
          </Text>
          {pdrPosition && pdrPosition.heading !== undefined && (
            <Text style={styles.livePDRDirection}>
              🧭 {pdrPosition.heading.toFixed(0)}° {getDirectionText(pdrPosition.heading)}
            </Text>
          )}
          {isWalking && currentWalkingTime > 0 && (
            <Text style={styles.livePDRWalkingTime}>
              🚶 Walking: {formatWalkingTime(currentWalkingTime)}
            </Text>
          )}
        </View>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  minimalSessionStatus: {
    position: 'absolute',
    top: 50,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    zIndex: 1000,
    alignItems: 'center',
    minWidth: 120,
  },
  sessionStatusBadge: {
    backgroundColor: '#FF3B30',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 4,
  },
  sessionStatusText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
  sessionProgressText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  currentPOIText: {
    color: '#FFD700',
    fontSize: 10,
    fontWeight: 'bold',
    maxWidth: 100,
    textAlign: 'center',
  },
  stepIndicator: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 4,
  },
  stepText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '600',
    textAlign: 'center',
  },
  livePDRCompact: {
    position: 'absolute',
    bottom: 30,
    left: 20,
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    zIndex: 1000,
  },
  livePDRHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  livePDRTitle: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    marginRight: 8,
  },
  livePDRIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00FF00',
  },
  livePDRDataValue: {
    color: '#fff',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  livePDRDirection: {
    color: '#FFD700',
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 2,
    fontWeight: 'bold',
  },
  livePDRWalkingTime: {
    color: '#4CAF50',
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 4,
    fontWeight: 'bold',
  },
});

export default SessionStatus;
