import { useEffect, useRef, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import ReconnectingWebSocket from 'reconnecting-websocket';

interface TrackingUpdate {
  loadId: number;
  latitude: number;
  longitude: number;
  status?: string;
  message?: string;
  error?: string;
}

export function useTracking(onUpdate: (update: TrackingUpdate) => void) {
  const ws = useRef<ReconnectingWebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const hostname = window.location.hostname;
    const isReplit = hostname.includes('.repl');
    const wsUrl = isReplit 
      ? `wss://${hostname.replace('00-', '')}/ws/tracking` 
      : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/tracking`;

    try {
      ws.current = new ReconnectingWebSocket(wsUrl, [], {
        maxRetries: 5,
        reconnectionDelayGrowFactor: 1.3,
        maxReconnectionDelay: 30000,
        minReconnectionDelay: 1000,
        debug: true,
      });

      // Connection opened
      ws.current.addEventListener('open', () => {
        console.log('Connected to tracking server');
        setIsConnected(true);
        toast({
          title: "Connected",
          description: "Real-time tracking is now active",
        });
      });

      // Listen for messages
      ws.current.addEventListener('message', (event) => {
        try {
          const update: TrackingUpdate = JSON.parse(event.data);
          if (update.error) {
            console.error('Server error:', update.error);
            return;
          }
          onUpdate(update);
        } catch (error) {
          console.error('Error processing tracking update:', error);
        }
      });

      // Connection closed
      ws.current.addEventListener('close', () => {
        console.log('Disconnected from tracking server');
        setIsConnected(false);
        toast({
          variant: "destructive",
          title: "Disconnected",
          description: "Attempting to reconnect...",
        });
      });

      // Connection error
      ws.current.addEventListener('error', (error) => {
        console.error('WebSocket error:', error);
        toast({
          variant: "destructive",
          title: "Connection Error",
          description: "Error connecting to tracking server",
        });
      });

      // Cleanup on unmount
      return () => {
        if (ws.current) {
          ws.current.close();
        }
      };
    } catch (error) {
      console.error('Error initializing WebSocket:', error);
      toast({
        variant: "destructive",
        title: "Connection Error",
        description: "Failed to initialize tracking connection",
      });
    }
  }, [toast, onUpdate]);

  const sendUpdate = (update: TrackingUpdate) => {
    if (!ws.current) {
      toast({
        variant: "destructive",
        title: "Connection Error",
        description: "Tracking system not initialized",
      });
      return;
    }

    if (ws.current.readyState === WebSocket.OPEN) {
      try {
        ws.current.send(JSON.stringify(update));
      } catch (error) {
        console.error('Error sending update:', error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to send tracking update",
        });
      }
    } else {
      toast({
        variant: "destructive",
        title: "Connection Error",
        description: "Cannot send update: not connected to tracking server",
      });
    }
  };

  return { 
    sendUpdate,
    isConnected 
  };
}