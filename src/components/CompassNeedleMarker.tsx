import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Text, Animated } from 'react-native';
import { Marker } from 'react-native-maps';

interface CompassNeedleMarkerProps {
  coordinate: {
    latitude: number;
    longitude: number;
  };
  heading: number;
  size?: number;
  showDebug?: boolean;
}

const CompassNeedleMarker: React.FC<CompassNeedleMarkerProps> = ({
  coordinate,
  heading,
  size = 24,
  showDebug = false,
}) => {
  // Animated values for smooth rotation and pulsing
  const rotationAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const previousHeading = useRef(heading);
  
  // Convert heading to rotation angle for the needle
  // React Native rotation is counter-clockwise, so we need to negate it
  const rotation = -heading;
  
  // Smooth animation when heading changes
  useEffect(() => {
    if (heading !== previousHeading.current) {
      // Calculate the shortest rotation path
      let targetRotation = -heading;
      let currentRotation = previousHeading.current;
      
      // Normalize angles to 0-360
      while (targetRotation < 0) targetRotation += 360;
      while (currentRotation < 0) currentRotation += 360;
      
      // Calculate shortest path
      let diff = targetRotation - currentRotation;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      
      const finalRotation = currentRotation + diff;
      
      Animated.timing(rotationAnim, {
        toValue: finalRotation,
        duration: 200, // Smooth 200ms animation
        useNativeDriver: true,
      }).start();
      
      previousHeading.current = heading;
    }
  }, [heading, rotationAnim]);

  // Continuous pulsing animation for live feel
  useEffect(() => {
    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1.0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    
    pulseAnimation.start();
    
    return () => pulseAnimation.stop();
  }, [pulseAnim]);
  
  // Debug logging
  if (showDebug) {
    console.log('CompassNeedleMarker render:', {
      heading,
      rotation,
      coordinate
    });
  }

  // Determine direction name
  const getDirectionName = (deg: number) => {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(deg / 45) % 8;
    return directions[index];
  };

  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <View style={[styles.container, { width: size, height: size }]}>
        {/* Compass background circle with pulsing animation */}
        <Animated.View style={[styles.compassBackground, { 
          width: size, 
          height: size,
          borderRadius: size / 2,
          transform: [{ scale: pulseAnim }]
        }]}>
          {/* North indicator - small red dot at top */}
          <View style={[styles.northDot, { 
            top: 2,
            width: 4,
            height: 4,
            borderRadius: 2,
          }]} />
          
          {/* Direction text */}
          <Text style={[styles.directionText, { fontSize: size * 0.3 }]}>
            {getDirectionName(heading)}
          </Text>
        </Animated.View>
        
        {/* Main needle - larger and more visible with smooth animation */}
        <Animated.View 
          style={[
            styles.needle, 
            { 
              width: size * 0.9,
              height: size * 0.9,
              transform: [{ rotate: rotationAnim.interpolate({
                inputRange: [0, 360],
                outputRange: ['0deg', '360deg']
              })}]
            }
          ]}
        >
          {/* Needle pointer (red arrow pointing forward) */}
          <View style={[styles.needlePointer, { 
            width: 0, 
            height: 0,
            borderLeftWidth: size * 0.15,
            borderRightWidth: size * 0.15,
            borderBottomWidth: size * 0.35,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderBottomColor: '#FF0000',
          }]} />
          
          {/* Needle tail (smaller, opposite direction) */}
          <View style={[styles.needleTail, { 
            width: 0, 
            height: 0,
            borderLeftWidth: size * 0.08,
            borderRightWidth: size * 0.08,
            borderTopWidth: size * 0.2,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderTopColor: '#666666',
          }]} />
        </Animated.View>
        
        {/* Debug info overlay */}
        {showDebug && (
          <View style={styles.debugOverlay}>
            <Text style={styles.debugText}>{heading.toFixed(0)}°</Text>
          </View>
        )}
      </View>
    </Marker>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  compassBackground: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderWidth: 2,
    borderColor: '#333333',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  northDot: {
    position: 'absolute',
    backgroundColor: '#FF0000',
    alignSelf: 'center',
  },
  directionText: {
    position: 'absolute',
    bottom: 2,
    color: '#333333',
    fontWeight: 'bold',
    alignSelf: 'center',
  },
  needle: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  needlePointer: {
    position: 'absolute',
    top: 0,
  },
  needleTail: {
    position: 'absolute',
    bottom: 0,
  },
  debugOverlay: {
    position: 'absolute',
    top: -20,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
  debugText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
});

export default CompassNeedleMarker;
