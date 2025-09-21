import React from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { Marker } from 'react-native-maps';

interface FloorPlanOverlayProps {
  imageUri: string;
  bounds: {
    northEast: {
      latitude: number;
      longitude: number;
    };
    southWest: {
      latitude: number;
      longitude: number;
    };
  };
  visible?: boolean;
}

const FloorPlanOverlay: React.FC<FloorPlanOverlayProps> = ({
  imageUri,
  bounds,
  visible = true,
}) => {
  if (!visible || !imageUri) {
    return null;
  }

  // Debug logging removed

  // Validate coordinates
  const { southWest, northEast } = bounds;
  if (
    !southWest || !northEast ||
    southWest.latitude === 0 || southWest.longitude === 0 ||
    northEast.latitude === 0 || northEast.longitude === 0 ||
    southWest.latitude === northEast.latitude ||
    southWest.longitude === northEast.longitude
  ) {
    console.warn('Invalid floorplan coordinates, skipping overlay:', bounds);
    return null;
  }

  // Note: We don't validate coordinate ordering here because we handle it automatically
  // like google.maps.LatLngBounds does - we'll correct the ordering in the bounds calculation

  // Convert bounds to the format expected by react-native-maps Overlay
  // React Native Maps expects [[southwest], [northeast]] format
  // Use the Builder pattern like google.maps.LatLngBounds.Builder
  // This automatically handles coordinate ordering by including both points
  
  // Create a bounds builder that automatically determines southwest and northeast
  // Add some padding to ensure the bounds are not too small
  const padding = 0.0001; // Small padding to ensure bounds are not too close
  const boundsBuilder = {
    minLat: Math.min(southWest.latitude, northEast.latitude) - padding,
    maxLat: Math.max(southWest.latitude, northEast.latitude) + padding,
    minLng: Math.min(southWest.longitude, northEast.longitude) - padding,
    maxLng: Math.max(southWest.longitude, northEast.longitude) + padding
  };
  
  // Try different bounds format - React Native Maps might expect different structure
  const overlayBounds = [
    [boundsBuilder.minLat, boundsBuilder.minLng], // Southwest corner
    [boundsBuilder.maxLat, boundsBuilder.maxLng], // Northeast corner
  ];
  
  // Alternative format - try as LatLng objects
  const boundsAsLatLng = [
    { latitude: boundsBuilder.minLat, longitude: boundsBuilder.minLng },
    { latitude: boundsBuilder.maxLat, longitude: boundsBuilder.maxLng }
  ];
  
  // Bounds builder logging removed

  // Calculate center point for the floorplan
  const centerLat = (boundsBuilder.minLat + boundsBuilder.maxLat) / 2;
  const centerLng = (boundsBuilder.minLng + boundsBuilder.maxLng) / 2;
  
  // Calculate the dimensions of the floorplan area
  const latDelta = boundsBuilder.maxLat - boundsBuilder.minLat;
  const lngDelta = boundsBuilder.maxLng - boundsBuilder.minLng;

  // Use a Marker with a custom image that represents the floorplan
  // This avoids the Overlay bounds issue entirely
  return (
    <Marker
      coordinate={{ latitude: centerLat, longitude: centerLng }}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <View style={styles.floorplanContainer}>
        <Image
          source={{ uri: imageUri }}
          style={styles.floorplanImage}
          resizeMode="contain"
        />
      </View>
    </Marker>
  );
};

const styles = StyleSheet.create({
  floorplanContainer: {
    width: 200,
    height: 200,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    borderRadius: 8,
    padding: 4,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  floorplanImage: {
    width: '100%',
    height: '100%',
  },
});

export default FloorPlanOverlay;
