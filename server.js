require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const socketIo = require("socket.io");
const redis = require("redis");

const { connectDB } = require("./config/db");

// Route imports - wait for database before importing
let authRoutes, plantRoutes, deviceRoutes, telemetryRoutes, azureDeviceRoutes, alarmRoutes;

// Redis test routes - can be imported immediately
const redisTestRoutes = require('./routes/redisTestRoutes');

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO with CORS settings
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Initialize Redis client
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
  socket: {
    reconnectStrategy: (retries) => {
      console.log(`Redis reconnection attempt: ${retries}`);
      return Math.min(retries * 50, 2000); // Exponential backoff with cap
    }
  }
});

// Handle Redis connection events
redisClient.on("error", (err) => {
  console.error("❌ Redis Client Error:", err);
});

redisClient.on("connect", () => {
  console.log("✅ Connected to Redis server");
});

redisClient.on("ready", () => {
  console.log("✅ Redis client is ready to use");
});

// Connect to Redis
(async () => {
  try {
    await redisClient.connect();
  } catch (err) {
    console.error("❌ Failed to connect to Redis:", err);
  }
})();

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from the public directory
app.use(express.static('public'));

// Route for the dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(__dirname + '/public/dashboard.html');
});

// Redis test routes
app.use('/api/redis', redisTestRoutes);

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log(`🔌 New client connected: ${socket.id}`);
  
  // Handle device subscription
  socket.on("subscribe", (deviceId) => {
    console.log(`👂 Client ${socket.id} subscribed to device: ${deviceId}`);
    socket.join(`device:${deviceId}`);
  });
  
  // Handle plant subscription
  socket.on("subscribePlant", (plantId) => {
    console.log(`👂 Client ${socket.id} subscribed to plant: ${plantId}`);
    socket.join(`plant:${plantId}`);
  });
  
  // Handle client disconnection
  socket.on("disconnect", () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });
});

// Redis subscriber for telemetry and alarm data
const redisSub = redisClient.duplicate();

// Connect Redis subscriber
(async () => {
  try {
    await redisSub.connect();
    
    // Subscribe to telemetry channel
    await redisSub.subscribe("telemetry", (message) => {
      try {
        const telemetryData = JSON.parse(message);
        const deviceId = telemetryData.deviceId || telemetryData.device;
        const deviceName = telemetryData.deviceName || telemetryData.DeviceName || deviceId;
        
        console.log(`📡 Received telemetry data for device: ${deviceName}`);
        
        // Emit to specific device room
        io.to(`device:${deviceId}`).emit("telemetry", telemetryData);
        
        // Also emit to plant room if we can determine the plant
        const plantName = telemetryData.plantName || 
                         (deviceName.includes("esp32_04") ? "Plant D" : "Plant C");
        const plantId = plantName === "Plant D" ? 2 : 1; // Map plant names to IDs
        
        io.to(`plant:${plantId}`).emit("telemetry", telemetryData);
      } catch (err) {
        console.error("❌ Error processing telemetry message:", err);
      }
    });
    
    // Subscribe to alarm channel
    await redisSub.subscribe("alarms", (message) => {
      try {
        const alarmData = JSON.parse(message);
        const deviceId = alarmData.deviceId || alarmData.DeviceId;
        
        console.log(`🚨 Received alarm data for device: ${deviceId}`);
        
        // Emit to specific device room
        io.to(`device:${deviceId}`).emit("alarm", alarmData);
        
        // Also emit to plant room
        const plantId = alarmData.plantId || 
                      (alarmData.plantName === "Plant D" ? 2 : 1);
        
        io.to(`plant:${plantId}`).emit("alarm", alarmData);
        
        // Broadcast to all clients for notifications
        io.emit("alarm_notification", {
          id: alarmData._id || alarmData.id,
          deviceId: deviceId,
          deviceName: alarmData.deviceName || alarmData.DeviceName,
          alarmCode: alarmData.alarmCode || alarmData.AlarmCode,
          description: alarmData.alarmDescription || alarmData.AlarmDescription,
          timestamp: alarmData.createdTimestamp || alarmData.CreatedTimestamp || new Date()
        });
      } catch (err) {
        console.error("❌ Error processing alarm message:", err);
      }
    });
    
    console.log("✅ Redis subscriber connected and listening");
  } catch (err) {
    console.error("❌ Failed to connect Redis subscriber:", err);
  }
})();

// Initialize routes only after database connections are established
const initializeRoutes = () => {
  // Now import all route files after DB connections are ready
  authRoutes = require("./routes/authRoutes");
  plantRoutes = require("./routes/plantRoutes");
  deviceRoutes = require("./routes/deviceRoutes");
  telemetryRoutes = require("./routes/telemetryRoutes");
  azureDeviceRoutes = require("./routes/azureDevice");
  alarmRoutes = require("./routes/alarmRoutes");
  
  // Set up routes
  app.use("/api/auth", authRoutes);
  app.use("/api/plants", plantRoutes);
  app.use("/api/devices", deviceRoutes);
  app.use("/api/telemetry", telemetryRoutes);
  app.use("/api/azure", azureDeviceRoutes);
  app.use("/api/alarms", alarmRoutes);
};

// Connect to multiple MongoDB databases (test and oxygen_monitor)
connectDB()
  .then(() => {
    console.log("✅ Databases initialized successfully!");
    
    // Import telemetry model initialization only after DB is connected
    const TelemetryModel = require("./models/telemetryModel");
    // Initialize the telemetry model with the correct database connection
    TelemetryModel.initModel();
    
    // Now that the database connections are ready, initialize routes
    initializeRoutes();
    
    // Export Redis client for use in other modules
    app.set('redisClient', redisClient);
    app.set('io', io);

    // Initialize WebSocket service
    const webSocketService = require('./services/webSocketService');
    webSocketService.initializeWebSocketEvents();
    console.log("✅ WebSocket service initialized");

    // Start the server
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
      console.log(`✅ WebSocket server initialized on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ Database initialization failed:", err);
    process.exit(1);
  });

// Export Redis client and io for use in other files
module.exports = { redisClient, io };

// Default route for API health check
app.get("/", (req, res) => {
  res.json({ status: "API is running", message: "Gas Monitoring Backend" });
});
