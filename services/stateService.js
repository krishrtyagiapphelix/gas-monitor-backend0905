/**
 * Device State Management Service
 * 
 * This service maintains an in-memory cache of device states
 * to handle partial updates from sensors and provide complete state
 * to frontend clients.
 */

const NodeCache = require('node-cache');

// Create a device state cache with 1 hour default TTL
const deviceStateCache = new NodeCache({ 
  stdTTL: 3600, // 1 hour TTL
  checkperiod: 600, // Check for expired keys every 10 minutes
  useClones: false // Better performance by not cloning objects
});

/**
 * Get the complete state for a device
 * @param {string} deviceId - Device ID
 * @returns {Object|null} - Complete device state or null if not found
 */
const getDeviceState = (deviceId) => {
  if (!deviceId) return null;
  
  return deviceStateCache.get(deviceId) || null;
};

/**
 * Update device state with partial data
 * @param {string} deviceId - Device ID
 * @param {Object} partialData - Partial telemetry data
 * @param {boolean} isPartialUpdate - Whether this is a partial update
 * @returns {Object} - The complete updated state
 */
const updateDeviceState = (deviceId, partialData, isPartialUpdate = true) => {
  if (!deviceId || !partialData) {
    console.error('❌ Invalid device ID or data for state update');
    return null;
  }
  
  // Get existing state or create new one
  let existingState = deviceStateCache.get(deviceId) || {};
  
  // If not a partial update, just replace the entire state
  if (!isPartialUpdate) {
    // Set timestamp for each parameter in the full update
    const timestamp = partialData.timestamp || partialData.Timestamp || new Date();
    const updatedState = {
      ...partialData,
      _lastUpdated: timestamp,
      _parameterTimestamps: {
        ...Object.keys(partialData).reduce((acc, key) => {
          // Skip metadata fields
          if (!key.startsWith('_') && key !== 'deviceId' && key !== 'DeviceId' && key !== 'deviceName' && key !== 'DeviceName') {
            acc[key] = timestamp;
          }
          return acc;
        }, {})
      }
    };
    
    // Store the full state
    deviceStateCache.set(deviceId, updatedState);
    
    return updatedState;
  }
  
  // For partial updates, merge with existing state
  const timestamp = partialData.timestamp || partialData.Timestamp || new Date();
  const updatedParameters = {};
  
  // Initialize parameter timestamps if they don't exist
  if (!existingState._parameterTimestamps) {
    existingState._parameterTimestamps = {};
  }
  
  // Record which parameters were updated
  Object.keys(partialData).forEach(key => {
    // Skip metadata fields
    if (!key.startsWith('_') && key !== 'deviceId' && key !== 'DeviceId' && key !== 'deviceName' && key !== 'DeviceName') {
      // Only consider it an update if the key has a value (not null/undefined)
      if (partialData[key] !== null && partialData[key] !== undefined) {
        updatedParameters[key] = partialData[key];
        existingState._parameterTimestamps[key] = timestamp;
      }
    }
  });
  
  // Merge partial data with existing state
  const updatedState = {
    ...existingState,
    ...partialData,
    _lastUpdated: timestamp,
    _parameterTimestamps: existingState._parameterTimestamps,
    _partialUpdate: true
  };
  
  // Store the updated state
  deviceStateCache.set(deviceId, updatedState);
  
  console.log(`📝 Updated device state for ${deviceId} with parameters: ${Object.keys(updatedParameters).join(', ')}`);
  
  return updatedState;
};

/**
 * Get all cached device states
 * @returns {Object} - Map of deviceId to state
 */
const getAllDeviceStates = () => {
  return deviceStateCache.mget(deviceStateCache.keys());
};

/**
 * Clear a device state from cache
 * @param {string} deviceId - Device ID
 * @returns {boolean} - Whether the state was successfully cleared
 */
const clearDeviceState = (deviceId) => {
  if (!deviceId) return false;
  
  return deviceStateCache.del(deviceId);
};

module.exports = {
  getDeviceState,
  updateDeviceState,
  getAllDeviceStates,
  clearDeviceState
}; 