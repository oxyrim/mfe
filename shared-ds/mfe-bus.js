/**
 * MfeBus — cross-iframe custom event bus built on postMessage.
 *
 * Each MFE dispatches events with MfeBus.emit() and listens with MfeBus.on().
 * The shell's AppComponent acts as the broker: it receives raw `message` events
 * from any iframe window and relays them to all other iframe windows.
 *
 * Protocol envelope: { __mfeBus: true, type: string, payload: unknown }
 *
 * Usage (in any MFE):
 *   MfeBus.emit('mfe:product-ordered', { id: 'P-1', name: 'Mouse', price: 45 });
 *   const unsub = MfeBus.on('mfe:product-ordered', payload => console.log(payload));
 *   unsub(); // remove listener
 */
(() => {
  const handlers = new Map(); // type → Set<Function>

  // Receive events relayed back from the shell broker
  window.addEventListener('message', (e) => {
    if (!e.data || e.data.__mfeBus !== true) return;
    const { type, payload } = e.data;
    handlers.get(type)?.forEach(h => {
      try { h(payload); } catch (err) { console.error('[MfeBus] handler error:', err); }
    });
  });

  window.MfeBus = {
    /**
     * Emit an event. Sends upward to the shell broker via postMessage;
     * also fires local handlers so the emitting MFE can self-listen.
     */
    emit(type, payload) {
      const envelope = { __mfeBus: true, type, payload };
      // Send to shell (or top window) for relay to other MFEs
      if (window !== window.parent) {
        window.parent.postMessage(envelope, '*');
      }
      // Also dispatch locally
      handlers.get(type)?.forEach(h => {
        try { h(payload); } catch (err) { console.error('[MfeBus] handler error:', err); }
      });
    },

    /**
     * Subscribe to an event type.
     * Returns an unsubscribe function — call it in DestroyRef.onDestroy().
     */
    on(type, handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(handler);
      return () => handlers.get(type).delete(handler);
    },
  };
})();
