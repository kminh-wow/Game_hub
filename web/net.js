const Net = (() => {
  let ws = null;
  const handlers = {};

  function connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${location.host}/ws`);
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(e);
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        const fn = handlers[msg.type];
        if (fn) fn(msg);
      };
      ws.onclose = () => {
        const fn = handlers["disconnected"];
        if (fn) fn();
      };
    });
  }

  function on(type, fn) {
    handlers[type] = fn;
  }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  return { connect, on, send };
})();
