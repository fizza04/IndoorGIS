import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { User } from '../types';
import { authAPI } from '../services/api';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isRefreshing: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  validateAuditPermission: (action: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    checkAuthState();
  }, []);

  const checkAuthState = async () => {
    try {
      const token = await AsyncStorage.getItem('access_token');
      const userData = await AsyncStorage.getItem('user');
      
      if (token && userData) {
        // Validate token with server
        const isValid = await authAPI.validateToken();
        if (isValid) {
          setUser(JSON.parse(userData));
        } else {
          await AsyncStorage.multiRemove(['access_token', 'user']);
        }
      }
    } catch (error) {
      console.error('Auth check error:', error);
      // Clear invalid data
      await AsyncStorage.multiRemove(['access_token', 'user']);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (username: string, password: string): Promise<boolean> => {
    try {
      setIsLoading(true);
      
      const response = await authAPI.login(username, password);
      console.log('Login response:', response);
      
      if (response.status === 'success' && response.user) {
        // Store user data and token
        await AsyncStorage.setItem('access_token', response.user.access_token);
        await AsyncStorage.setItem('user', JSON.stringify(response.user));
        
        setUser(response.user);
        return true;
      } else {
        console.error('Login failed:', response.message);
        return false;
      }
    } catch (error) {
      console.error('Login error:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      // Clear local storage and user state
      await AsyncStorage.multiRemove(['access_token', 'user']);
      setUser(null);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const refreshToken = async () => {
    try {
      setIsRefreshing(true);
      await checkAuthState();
    } catch (error) {
      console.error('Token refresh error:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const validateAuditPermission = (action: string): boolean => {
    if (!user) return false;
    
    switch (action) {
      case 'start_audit':
        return user.role === 'technician' || user.role === 'auditor';
      case 'edit_poi':
        return user.role === 'technician' || user.role === 'auditor';
      case 'view_audits':
        return true; // All authenticated users can view
      default:
        return false;
    }
  };

  const value: AuthContextType = {
    user,
    isLoading,
    isRefreshing,
    login,
    logout,
    refreshToken,
    validateAuditPermission,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
