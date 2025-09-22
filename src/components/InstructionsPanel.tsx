import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface InstructionsPanelProps {
  visible: boolean;
  onClose: () => void;
}

const InstructionsPanel: React.FC<InstructionsPanelProps> = ({ visible, onClose }) => {
  if (!visible) return null;

  return (
    <View style={styles.instructionsPanel}>
      <View style={styles.instructionsContent}>
        <Text style={styles.instructionsTitle}>🎯 How to Use</Text>
        <View style={styles.instructionsList}>
          <View style={styles.instructionItem}>
            <Text style={styles.instructionIcon}>1️⃣</Text>
            <Text style={styles.instructionText}>Click "Start PDR" to begin tracking your movement</Text>
          </View>
          <View style={styles.instructionItem}>
            <Text style={styles.instructionIcon}>2️⃣</Text>
            <Text style={styles.instructionText}>Walk to the highlighted POI on the map</Text>
          </View>
          <View style={styles.instructionItem}>
            <Text style={styles.instructionIcon}>3️⃣</Text>
            <Text style={styles.instructionText}>Click "Scan POI" and scan the QR code at the location</Text>
          </View>
          <View style={styles.instructionItem}>
            <Text style={styles.instructionIcon}>4️⃣</Text>
            <Text style={styles.instructionText}>Fill out the inspection form and submit</Text>
          </View>
          <View style={styles.instructionItem}>
            <Text style={styles.instructionIcon}>5️⃣</Text>
            <Text style={styles.instructionText}>Repeat for all POIs - session ends automatically when complete</Text>
          </View>
        </View>
        <TouchableOpacity 
          style={styles.instructionsClose}
          onPress={onClose}
        >
          <Text style={styles.instructionsCloseText}>Got it! Let's start</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  instructionsPanel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2000,
  },
  instructionsContent: {
    backgroundColor: '#fff',
    margin: 20,
    borderRadius: 16,
    padding: 24,
    maxWidth: 350,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  instructionsTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    marginBottom: 20,
  },
  instructionsList: {
    marginBottom: 24,
  },
  instructionItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  instructionIcon: {
    fontSize: 16,
    marginRight: 12,
    marginTop: 2,
  },
  instructionText: {
    flex: 1,
    fontSize: 14,
    color: '#555',
    lineHeight: 20,
  },
  instructionsClose: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
  },
  instructionsCloseText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default InstructionsPanel;
