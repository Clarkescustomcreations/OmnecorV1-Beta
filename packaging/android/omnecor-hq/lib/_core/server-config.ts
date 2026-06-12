/**
 * Persistent server connection config for the Omnecor Mobile HQ app.
 * Stores the Omnecor PC's IP (Tailscale or LAN) so every module can
 * derive the correct base URL without relying on a compile-time env var.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_IP     = "omnecor_server_ip";
const KEY_PORT   = "omnecor_server_port";
const KEY_SECRET = "omnecor_ommesh_secret";
const KEY_NAME   = "omnecor_node_name";

// In-memory cache so callers can use getServerBaseUrl() synchronously
// after the first loadServerConfig() call at app startup.
let _ip     = "";
let _port   = "3000";
let _secret = "";
let _name   = "Phone";

export async function loadServerConfig(): Promise<void> {
  _ip     = (await AsyncStorage.getItem(KEY_IP))     ?? "";
  _port   = (await AsyncStorage.getItem(KEY_PORT))   ?? "3000";
  _secret = (await AsyncStorage.getItem(KEY_SECRET)) ?? "";
  _name   = (await AsyncStorage.getItem(KEY_NAME))   ?? "Phone";
}

export function getServerBaseUrl(): string {
  if (!_ip) return "";
  return `http://${_ip}:${_port}`;
}

export function getWhisperUrl(): string {
  if (!_ip) return "";
  return `http://${_ip}:8001`;
}

export function getTTSUrl(): string {
  if (!_ip) return "";
  return `http://${_ip}:8002`;
}

export function getWsUrl(): string {
  if (!_ip) return "";
  return `ws://${_ip}:${_port}/ws`;
}

export function getOmmeshSecret(): string  { return _secret; }
export function getNodeName(): string       { return _name; }
export function getServerIp(): string       { return _ip; }
export function isServerConfigured(): boolean { return !!_ip; }

export async function saveServerConfig(opts: {
  ip: string;
  port?: string;
  secret?: string;
  nodeName?: string;
}): Promise<void> {
  _ip     = opts.ip.trim();
  _port   = (opts.port ?? "3000").trim();
  _secret = (opts.secret ?? _secret).trim();
  _name   = (opts.nodeName ?? _name).trim();
  await AsyncStorage.multiSet([
    [KEY_IP,     _ip],
    [KEY_PORT,   _port],
    [KEY_SECRET, _secret],
    [KEY_NAME,   _name],
  ]);
}
