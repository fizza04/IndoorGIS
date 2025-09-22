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

  // Validate coordinates
  const { southWest, northEast } = bounds;
  if (
    !southWest || !northEast ||
    southWest.latitude === 0 || southWest.longitude === 0 ||
    northEast.latitude === 0 || northEast.longitude === 0 ||
    southWest.latitude === northEast.latitude ||
    southWest.longitude === northEast.longitude
  ) {
    return null;
  }

  // Calculate center point for the floorplan
  const centerLat = (southWest.latitude + northEast.latitude) / 2;
  const centerLng = (southWest.longitude + northEast.longitude) / 2;
  
  // Calculate the dimensions of the floorplan area
  const latDelta = Math.abs(northEast.latitude - southWest.latitude);
  const lngDelta = Math.abs(northEast.longitude - southWest.longitude);


  // Use a much larger scaling factor to make the floorplan visible
  const scaleFactor = 1000000; // Increased from 100000
  const floorplanWidth = Math.max(300, lngDelta * scaleFactor);
  const floorplanHeight = Math.max(300, latDelta * scaleFactor);


  return (
    <Marker
      coordinate={{ latitude: centerLat, longitude: centerLng }}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <View style={[styles.floorplanContainer, {
        width: floorplanWidth,
        height: floorplanHeight,
      }]}>
        <Image
          source={{ uri: imageUri }}
          style={styles.floorplanImage}
          resizeMode="contain"
          onError={(error) => {
            console.log('Floorplan image load error:', error);
          }}
        />
      </View>
    </Marker>
  );
};

const styles = StyleSheet.create({
  floorplanContainer: {
    backgroundColor: 'rgba(255, 0, 0, 0.1)', // Temporary red background to see the container
    borderWidth: 2,
    borderColor: 'red',
    borderRadius: 4,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  floorplanImage: {
    width: '100%',
    height: '100%',
  },
});

export default FloorPlanOverlay;
