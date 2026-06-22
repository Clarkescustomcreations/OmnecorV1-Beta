/**
 * Small holder for runtime facts that are only known after boot — currently the
 * actual HTTP port the server bound to (it may differ from the preferred port if
 * that was taken). Used by the device-pairing flow to build the QR payload the
 * phone scans (host + port + code).
 */
let _boundPort = 0;

export function setBoundPort(port: number): void {
  _boundPort = port;
}

export function getBoundPort(): number {
  return _boundPort || Number(process.env.PORT) || 3000;
}
