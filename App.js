// App.js - Keg Batch Scanner with Google Sheets Integration
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  StyleSheet,
  Dimensions,
  StatusBar,
  ActivityIndicator,
  BackHandler,
} from 'react-native';
import { RNCamera } from 'react-native-camera';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import AsyncStorage from '@react-native-async-storage/async-storage';

// IMPORTANT: Replace this with YOUR Google Apps Script Web App URL
const GOOGLE_SHEETS_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycby87KX7t0nmio433zyB7H0fl2-7-zhZ3GFY6q9yp7b9zGp41rglrgolg4RMN156yrcUnA/exec';

const { width, height } = Dimensions.get('window');

const App = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [offlineQueue, setOfflineQueue] = useState([]);
  const cameraRef = useRef(null);

  useEffect(() => {
    loadOfflineQueue();
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => backHandler.remove();
  }, []);

  const loadOfflineQueue = async () => {
    try {
      const queue = await AsyncStorage.getItem('offlineQueue');
      if (queue) {
        setOfflineQueue(JSON.parse(queue));
      }
    } catch (error) {
      console.log('Error loading offline queue:', error);
    }
  };

  const saveOfflineData = async (data) => {
    try {
      const currentQueue = [...offlineQueue, data];
      await AsyncStorage.setItem('offlineQueue', JSON.stringify(currentQueue));
      setOfflineQueue(currentQueue);
    } catch (error) {
      console.log('Error saving offline data:', error);
    }
  };

  const extractLCode = (text) => {
    // Pattern for L-codes: L + 5 digits + 1-2 letters + optional time
    // Examples: L50780A 10:52, L5025MB 04:22, L5149MA 13:53
    const lCodePattern = /L\d{5}[A-Z]{1,2}(?:\s+\d{1,2}:\d{2})?/gi;
    const matches = text.match(lCodePattern);
    
    if (matches && matches.length > 0) {
      // Return the first match, cleaned up
      return matches[0].trim();
    }
    return null;
  };

  const uploadToGoogleSheets = async (data) => {
    try {
      const response = await fetch(GOOGLE_SHEETS_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          lCode: data.lCode,
          timestamp: data.timestamp,
          device: 'WarehouseScanner'
        }),
      });
      
      const result = await response.json();
      console.log('Google Sheets response:', result);
      
      return result.success || false;
    } catch (error) {
      console.log('Google Sheets upload error:', error);
      return false;
    }
  };

  const syncOfflineData = async () => {
    if (offlineQueue.length === 0) return;
    
    try {
      for (const data of offlineQueue) {
        const success = await uploadToGoogleSheets(data);
        if (!success) {
          break; // Stop if upload fails
        }
      }
      
      // Clear queue on successful sync
      await AsyncStorage.removeItem('offlineQueue');
      setOfflineQueue([]);
      
    } catch (error) {
      console.log('Sync error:', error);
    }
  };

  const takePicture = async () => {
    if (cameraRef.current && !isProcessing) {
      setIsProcessing(true);
      setLastResult(null);
      
      try {
        const options = { quality: 0.8, base64: false, fixOrientation: true };
        const data = await cameraRef.current.takePictureAsync(options);
        
        // Perform OCR on the captured image using ML Kit
        const result = await TextRecognition.recognize(data.uri);
        console.log('OCR Result:', result.text);
        
        const lCode = extractLCode(result.text);
        
        if (lCode) {
          const timestamp = new Date().toISOString();
          const batchData = { lCode, timestamp };
          
          // Try to upload immediately
          const uploadSuccess = await uploadToGoogleSheets(batchData);
          
          if (!uploadSuccess) {
            // Save offline if upload fails
            await saveOfflineData(batchData);
          }
          
          setLastResult({
            success: true,
            message: `L-Code found: ${lCode}`,
            lCode: lCode
          });
          
          // Auto-sync any offline data
          setTimeout(() => syncOfflineData(), 1000);
          
        } else {
          setLastResult({
            success: false,
            message: 'No L-Code detected. Please try again.',
          });
        }
        
      } catch (error) {
        console.log('Camera error:', error);
        setLastResult({
          success: false,
          message: 'Error processing image. Please try again.',
        });
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const ResultIndicator = () => {
    if (!lastResult) return null;
    
    return (
      <View style={[
        styles.resultContainer,
        { backgroundColor: lastResult.success ? '#4CAF50' : '#F44336' }
      ]}>
        <Text style={styles.resultText}>{lastResult.message}</Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      
      <RNCamera
        ref={cameraRef}
        style={styles.camera}
        type={RNCamera.Constants.Type.back}
        flashMode={RNCamera.Constants.FlashMode.auto}
        androidCameraPermissionOptions={{
          title: 'Permission to use camera',
          message: 'We need your permission to use your camera',
          buttonPositive: 'Ok',
          buttonNegative: 'Cancel',
        }}
      >
        <View style={styles.overlay}>
          <Text style={styles.title}>Keg Batch Scanner</Text>
          <Text style={styles.instruction}>
            Point camera at L-code on keg label
          </Text>
          
          {/* Viewfinder frame */}
          <View style={styles.viewfinder}>
            <View style={styles.viewfinderCorner} />
            <View style={[styles.viewfinderCorner, styles.topRight]} />
            <View style={[styles.viewfinderCorner, styles.bottomLeft]} />
            <View style={[styles.viewfinderCorner, styles.bottomRight]} />
          </View>
          
          <ResultIndicator />
          
          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[styles.captureButton, isProcessing && styles.captureButtonDisabled]}
              onPress={takePicture}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <ActivityIndicator size="large" color="#FFFFFF" />
              ) : (
                <Text style={styles.captureButtonText}>SCAN</Text>
              )}
            </TouchableOpacity>
          </View>
          
          {offlineQueue.length > 0 && (
            <View style={styles.offlineIndicator}>
              <Text style={styles.offlineText}>
                {offlineQueue.length} items queued for sync
              </Text>
            </View>
          )}
        </View>
      </RNCamera>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  camera: {
    flex: 1,
    justifyContent: 'space-between',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 50,
    paddingBottom: 50,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  instruction: {
    fontSize: 16,
    color: '#FFFFFF',
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 20,
  },
  viewfinder: {
    width: width * 0.8,
    height: 200,
    position: 'relative',
  },
  viewfinderCorner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: '#FFFFFF',
    borderWidth: 3,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    top: 0,
    left: 0,
  },
  topRight: {
    top: 0,
    right: 0,
    left: 'auto',
    borderLeftWidth: 0,
    borderRightWidth: 3,
    borderTopWidth: 3,
    borderBottomWidth: 0,
  },
  bottomLeft: {
    bottom: 0,
    top: 'auto',
    left: 0,
    borderTopWidth: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderRightWidth: 0,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    top: 'auto',
    left: 'auto',
    borderTopWidth: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderLeftWidth: 0,
  },
  resultContainer: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 5,
    marginHorizontal: 20,
  },
  resultText: {
    color: '#FFFFFF',
    fontSize: 16,
    textAlign: 'center',
    fontWeight: 'bold',
  },
  buttonContainer: {
    alignItems: 'center',
  },
  captureButton: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 5,
    borderColor: '#FFFFFF',
  },
  captureButtonDisabled: {
    backgroundColor: '#666666',
  },
  captureButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  offlineIndicator: {
    position: 'absolute',
    bottom: 10,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(255, 152, 0, 0.9)',
    padding: 8,
    borderRadius: 5,
  },
  offlineText: {
    color: '#FFFFFF',
    fontSize: 12,
    textAlign: 'center',
  },
});

export default App;
