import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Platform } from 'react-native';

interface LoadingScreenProps {
  message?: string;
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({ message = 'Loading...' }) => {
  return (
    <View style={styles.container}>
      <ActivityIndicator 
        size={Platform.OS === 'ios' ? 'large' : 48} 
        color="#3498db" 
      />
      <Text style={styles.message}>{message}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
  },
  message: {
    marginTop: 16,
    fontSize: 16,
    color: '#7f8c8d',
  },
});

export default LoadingScreen;
