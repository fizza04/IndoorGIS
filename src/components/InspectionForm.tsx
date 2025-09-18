import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  Image,
  Dimensions,
} from 'react-native';
import { POI } from '../types';

interface InspectionFormProps {
  visible: boolean;
  poi: POI | null;
  onClose: () => void;
  onSubmit: (data: InspectionData) => void;
}

export interface InspectionData {
  poiId: string;
  status: 'completed' | 'skipped' | 'failed';
  notes: string;
  skipReason?: string;
  photos: string[];
  timestamp: string;
}

const InspectionForm: React.FC<InspectionFormProps> = ({
  visible,
  poi,
  onClose,
  onSubmit,
}) => {
  const [status, setStatus] = useState<'completed' | 'skipped' | 'failed'>('completed');
  const [notes, setNotes] = useState('');
  const [skipReason, setSkipReason] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [lastPOIId, setLastPOIId] = useState<string | null>(null);

  // Reset form only when POI changes
  React.useEffect(() => {
    if (poi && poi.puid !== lastPOIId) {
      setStatus('completed');
      setNotes('');
      setSkipReason('');
      setPhotos([]);
      setLastPOIId(poi.puid || poi.id);
    }
  }, [poi, lastPOIId]);

  const handleSubmit = () => {
    if (!poi) return;

    // Validate required fields based on status
    if (status === 'skipped' && !skipReason.trim()) {
      Alert.alert('Validation Error', 'Please provide a reason for skipping this POI.');
      return;
    }

    if (status === 'failed' && !notes.trim()) {
      Alert.alert('Validation Error', 'Please provide notes explaining why this POI failed inspection.');
      return;
    }

    const inspectionData: InspectionData = {
      poiId: poi.puid || poi.id,
      status,
      notes: notes.trim(),
      skipReason: status === 'skipped' ? skipReason.trim() : undefined,
      photos,
      timestamp: new Date().toISOString(),
    };

    onSubmit(inspectionData);
  };

  const handleCancel = () => {
    onClose();
  };

  if (!poi) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleCancel}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>POI Inspection</Text>
          <TouchableOpacity onPress={handleCancel} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content}>
          {/* POI Information */}
          <View style={styles.poiInfo}>
            <Text style={styles.poiName}>{poi.name}</Text>
            <Text style={styles.poiType}>Type: {poi.type}</Text>
            <Text style={styles.poiFloor}>Floor: {poi.floor}</Text>
            {poi.description && (
              <Text style={styles.poiDescription}>{poi.description}</Text>
            )}
          </View>

          {/* Status Selection */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Inspection Status *</Text>
            <View style={styles.statusButtons}>
              <TouchableOpacity
                style={[styles.statusButton, status === 'completed' && styles.statusButtonActive]}
                onPress={() => setStatus('completed')}
              >
                <Text style={[styles.statusButtonText, status === 'completed' && styles.statusButtonTextActive]}>
                  ✅ Completed
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.statusButton, status === 'skipped' && styles.statusButtonActive]}
                onPress={() => setStatus('skipped')}
              >
                <Text style={[styles.statusButtonText, status === 'skipped' && styles.statusButtonTextActive]}>
                  ⏭️ Skipped
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.statusButton, status === 'failed' && styles.statusButtonActive]}
                onPress={() => setStatus('failed')}
              >
                <Text style={[styles.statusButtonText, status === 'failed' && styles.statusButtonTextActive]}>
                  ❌ Failed
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Skip Reason (only for skipped status) */}
          {status === 'skipped' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Skip Reason *</Text>
              <TextInput
                style={styles.textInput}
                value={skipReason}
                onChangeText={setSkipReason}
                placeholder="Why is this POI being skipped?"
                multiline
                numberOfLines={3}
              />
            </View>
          )}

          {/* Notes */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              Notes {status === 'failed' ? '*' : ''}
            </Text>
            <TextInput
              style={styles.textInput}
              value={notes}
              onChangeText={setNotes}
              placeholder={
                status === 'failed' 
                  ? "Explain why this POI failed inspection..." 
                  : "Add any additional notes about this POI..."
              }
              multiline
              numberOfLines={4}
            />
          </View>

          {/* Photos Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Photos (Optional)</Text>
            <TouchableOpacity 
              style={styles.addPhotoButton}
              onPress={() => {
                // For now, just add a placeholder photo
                setPhotos([...photos, 'placeholder_photo_' + Date.now()]);
              }}
            >
              <Text style={styles.addPhotoButtonText}>📷 Add Photo</Text>
            </TouchableOpacity>
            {photos.length > 0 && (
              <View style={styles.photosContainer}>
                {photos.map((photo, index) => (
                  <View key={index} style={styles.photoItem}>
                    <View style={styles.photoPlaceholder}>
                      <Text style={styles.photoPlaceholderText}>📷 Photo {index + 1}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.removePhotoButton}
                      onPress={() => setPhotos(photos.filter((_, i) => i !== index))}
                    >
                      <Text style={styles.removePhotoButtonText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>

        {/* Action Buttons */}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.submitButton} onPress={handleSubmit}>
            <Text style={styles.submitButtonText}>Submit Inspection</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  closeButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 18,
    color: '#666',
  },
  content: {
    flex: 1,
    padding: 20,
  },
  poiInfo: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  poiName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  poiType: {
    fontSize: 16,
    color: '#666',
    marginBottom: 3,
  },
  poiFloor: {
    fontSize: 16,
    color: '#666',
    marginBottom: 3,
  },
  poiDescription: {
    fontSize: 14,
    color: '#888',
    marginTop: 5,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  statusButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statusButton: {
    flex: 1,
    padding: 12,
    marginHorizontal: 5,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
  },
  statusButtonActive: {
    backgroundColor: '#007AFF',
  },
  statusButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666',
  },
  statusButtonTextActive: {
    color: '#fff',
  },
  textInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  addPhotoButton: {
    backgroundColor: '#007AFF',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  addPhotoButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  photosContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
  },
  photoItem: {
    position: 'relative',
    margin: 5,
  },
  photo: {
    width: 80,
    height: 80,
    borderRadius: 8,
  },
  photoPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  photoPlaceholderText: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
  },
  removePhotoButton: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#ff4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  removePhotoButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  actions: {
    flexDirection: 'row',
    padding: 20,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  cancelButton: {
    flex: 1,
    padding: 15,
    marginRight: 10,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#666',
  },
  submitButton: {
    flex: 1,
    padding: 15,
    marginLeft: 10,
    borderRadius: 8,
    backgroundColor: '#007AFF',
    alignItems: 'center',
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#fff',
  },
});

export default InspectionForm;
