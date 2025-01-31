import { WebSocket, WebSocketServer } from 'ws';
import type { Server } from 'http';
import type { IncomingMessage } from 'http';
import { db } from "@db";
import { loads, loadUpdates, users } from "@db/schema";
import { eq } from "drizzle-orm";

interface TrackingUpdate {
  loadId: number;
  latitude: number;
  longitude: number;
  status?: string;
  message?: string;
}

interface VerifyClientInfo {
  origin: string;
  secure: boolean;
  req: IncomingMessage;
}

export function setupWebSocket(httpServer: Server) {
  try {
    const wss = new WebSocketServer({ 
      noServer: true,
      path: '/ws/tracking'
    });

    console.log('WebSocket server initialized successfully');

    // Handle upgrade event manually to avoid conflicts with Vite's WebSocket
    httpServer.on('upgrade', (request, socket, head) => {
      const pathname = new URL(request.url!, `http://${request.headers.host}`).pathname;

      // Skip if this is a Vite HMR WebSocket request
      if (request.headers['sec-websocket-protocol']?.includes('vite-hmr')) {
        return;
      }

      // Only handle our tracking WebSocket connections
      if (pathname === '/ws/tracking') {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      }
    });

    // Broadcast carrier locations periodically
    const broadcastInterval = setInterval(async () => {
      try {
        // Query active carriers from users table
        const activeCarriers = await db
          .select({
            id: users.id,
            currentLat: users.currentLat,
            currentLng: users.currentLng,
            name: users.companyName
          })
          .from(users)
          .where(eq(users.userType, 'carrier'));

        const carrierData = activeCarriers
          .filter((carrier: any) => carrier.currentLat && carrier.currentLng)
          .map((carrier: any) => ({
            id: carrier.id,
            location: [carrier.currentLat, carrier.currentLng],
            name: carrier.name || `Carrier ${carrier.id}`
          }));

        if (wss.clients.size > 0) {
          const message = JSON.stringify({
            type: 'carrier_locations',
            carriers: carrierData
          });

          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(message);
            }
          });
        }
      } catch (error) {
        console.error('Error broadcasting carrier locations:', error);
      }
    }, 5000);

    wss.on('connection', (ws: WebSocket) => {
      console.log('Client connected to tracking system');

      ws.on('message', async (message: string) => {
        try {
          const data: TrackingUpdate = JSON.parse(message);
          console.log('Received tracking update:', data);

          // Update load location
          await db.update(loads)
            .set({
              currentLat: data.latitude,
              currentLng: data.longitude,
              lastLocationUpdate: new Date(),
              ...(data.status && { status: data.status })
            })
            .where(eq(loads.id, data.loadId));

          // Create tracking update record
          await db.insert(loadUpdates).values({
            loadId: data.loadId,
            status: data.status || 'location_update',
            latitude: data.latitude,
            longitude: data.longitude,
            message: data.message,
          });

          // Broadcast update to all connected clients
          const broadcastData = JSON.stringify({
            type: 'load_update',
            data
          });

          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(broadcastData);
            }
          });
        } catch (error) {
          console.error('Error processing tracking update:', error);
          ws.send(JSON.stringify({ error: 'Failed to process update' }));
        }
      });

      ws.on('close', () => {
        console.log('Client disconnected from tracking system');
      });
    });

    // Cleanup on server close
    httpServer.on('close', () => {
      clearInterval(broadcastInterval);
      wss.close(() => {
        console.log('WebSocket server closed');
      });
    });

    return wss;
  } catch (error) {
    console.error('Error setting up WebSocket server:', error);
    throw error;
  }
}