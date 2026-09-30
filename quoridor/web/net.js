const Net = (() => {
  let ws = null;
  let connecting = null;
  const handlers = {};

  function connect() {
    if (ws?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (connecting) return connecting;
    connecting = new Promise((resolve, reject) => {
      // 페이지 위치 기준 상대 주소라서 /quoridor/ 처럼 하위 경로에 붙어도 동작한다.
      const url = new URL("ws", location.href);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(url);
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(e);
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        const fn = handlers[msg.type];
        if (fn) fn(msg);
      };
      ws.onclose = () => {
        reject(new Error('Connection closed'));
        const fn = handlers["disconnected"];
        if (fn) fn();
      };
    }).finally(() => { connecting = null; });
    return connecting;
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
