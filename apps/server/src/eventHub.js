class EventHub {
  constructor() {
    this.listeners = new Map();
  }

  subscribe(jobId, response, currentPayload) {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    response.write(`event: job\n`);
    response.write(`data: ${JSON.stringify(currentPayload || {})}\n\n`);

    const set = this.listeners.get(jobId) || new Set();
    set.add(response);
    this.listeners.set(jobId, set);

    response.on("close", () => {
      const listeners = this.listeners.get(jobId);
      if (!listeners) {
        return;
      }
      listeners.delete(response);
      if (listeners.size === 0) {
        this.listeners.delete(jobId);
      }
    });
  }

  emit(jobId, payload) {
    const listeners = this.listeners.get(jobId);
    if (!listeners) {
      return;
    }

    const data = JSON.stringify(payload);
    for (const response of listeners) {
      response.write(`event: job\n`);
      response.write(`data: ${data}\n\n`);
    }
  }
}

module.exports = {
  EventHub
};
