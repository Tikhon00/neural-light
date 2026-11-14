#include <Arduino.h>
#include <Adafruit_NeoPixel.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <esp_http_server.h>
#include <esp_system.h>
#include "FrameReceiver.h"
#include "SetupPage.h"

// This build deliberately targets classic ESP32-WROOM with 4 MB flash.
#if !defined(CONFIG_IDF_TARGET_ESP32)
#error "Select the classic ESP32 esp32dev target; other chips need a separate validated build."
#endif

namespace {
constexpr uint32_t kConfigMagic = 0x4e4c0001;
constexpr uint16_t kUdpPort = 4048;
constexpr uint32_t kStreamTimeoutMs = 2000;
constexpr uint32_t kConnectTimeoutMs = 30000;
constexpr uint32_t kApGraceMs = 120000;
constexpr uint32_t kFrameIntervalUs = 16667;
constexpr uint8_t kPins[] = {13, 14, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33};

struct Config {
  uint32_t magic = 0;
  char ssid[33] = {};
  char password[64] = {};
  uint16_t count = 240;
  uint8_t pin = 16;
  uint8_t limit = 25;
  uint8_t grb = 1;
};
struct Snapshot {
  bool connected = false, connecting = false, outputEnabled = false, apActive = false;
  char ip[16] = "0.0.0.0";
  char error[96] = {};
  uint32_t received = 0, displayed = 0, dropped = 0, malformed = 0;
  uint16_t fps = 0;
};

Preferences preferences;
Config configuration, pendingConfiguration;
Snapshot snapshot;
portMUX_TYPE stateMux = portMUX_INITIALIZER_UNLOCKED;
bool pending = false;
WiFiUDP udp;
Adafruit_NeoPixel strip;
neural::FrameReceiver receiver;
httpd_handle_t httpServer = nullptr;
char hostname[32], apName[32], apPassword[17], csrfToken[33];
bool stripReady = false, apActive = false, connecting = false;
bool maintenance = false, wifiWasConnected = false, udpStarted = false;
bool mdnsStarted = false, sourceLocked = false;
uint32_t connectStartedMs = 0, connectedSinceMs = 0, lastSourceMs = 0;
uint32_t lastShowUs = 0, lastSnapshotMs = 0, rateWindowMs = 0;
uint32_t displayed = 0, foreignPackets = 0, oversizedPackets = 0, showWindowCount = 0;
uint16_t outputFps = 0, sourcePort = 0;
IPAddress sourceIp;
char runtimeError[96] = {};
uint8_t packet[neural::FrameReceiver::kMaxPacketBytes];

bool allowedPin(uint8_t pin) {
  for (const uint8_t candidate : kPins) if (candidate == pin) return true;
  return false;
}
bool validConfig(const Config& c) {
  const size_t ssidLength = strnlen(c.ssid, sizeof(c.ssid));
  const size_t passwordLength = strnlen(c.password, sizeof(c.password));
  return c.magic == kConfigMagic && ssidLength >= 1 && ssidLength <= 32 &&
    (passwordLength == 0 || (passwordLength >= 8 && passwordLength <= 63)) &&
    c.count >= 1 && c.count <= neural::FrameReceiver::kMaxLeds &&
    allowedPin(c.pin) && c.limit >= 1 && c.limit <= 100 && c.grb <= 1;
}
void randomHex(char* output, size_t bytes) {
  static const char hex[] = "0123456789abcdef";
  for (size_t i = 0; i < bytes; ++i) {
    const uint8_t value = static_cast<uint8_t>(esp_random());
    output[i * 2] = hex[value >> 4];
    output[i * 2 + 1] = hex[value & 15];
  }
  output[bytes * 2] = '\0';
}
void blackout() {
  if (stripReady) { strip.clear(); strip.show(); }
  receiver.reset();
  sourceLocked = false;
}
void serialInfo() {
  // Recovery credentials are available only to someone with physical USB access.
  // Never print the home network password, token or complete saved configuration.
  Serial.printf("\nNEURAL LIGHT %s | classic ESP32\n", NEURAL_FIRMWARE_VERSION);
  Serial.printf("Setup Wi-Fi: %s\nSetup password: %s\n", apName, apPassword);
  Serial.println("Setup page: http://192.168.4.1/ (use SETUP to enable access point)");
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("Controller IP: %s | http://%s.local/ | DDP UDP 4048\n",
      WiFi.localIP().toString().c_str(), hostname);
  }
  Serial.println("INFO = show these details; SETUP = enable setup and pause LED output.");
}
void startAccessPoint(bool pauseOutput) {
  if (pauseOutput) { maintenance = true; blackout(); }
  if (!apActive) {
    WiFi.mode(WIFI_AP_STA);
    apActive = WiFi.softAP(apName, apPassword, 1, false, 2);
    if (!apActive) strlcpy(runtimeError, "Не удалось открыть сеть настройки. Нажми RESET.", sizeof(runtimeError));
    else Serial.printf("Setup Wi-Fi ready: %s | http://192.168.4.1/\n", apName);
  }
  connectedSinceMs = millis(); // Keep recovery AP available long enough to configure it.
}
void beginStation() {
  if (!validConfig(configuration)) return;
  WiFi.disconnect(false, false);
  WiFi.setHostname(hostname);
  WiFi.begin(configuration.ssid, configuration.password);
  connecting = true;
  connectStartedMs = millis();
}
bool prepareStrip() {
  blackout();
  stripReady = false;
  strip.updateType((configuration.grb ? NEO_GRB : NEO_RGB) + NEO_KHZ800);
  strip.updateLength(configuration.count);
  if (!strip.getPixels()) {
    strlcpy(runtimeError, "Не хватает памяти для ленты. Уменьши число LED.", sizeof(runtimeError));
    return false;
  }
  strip.setPin(configuration.pin);
  stripReady = strip.begin();
  if (!stripReady) {
    strlcpy(runtimeError, "Не удалось запустить вывод LED.", sizeof(runtimeError));
    return false;
  }
  strip.clear();
  strip.show();
  receiver.configure(configuration.count);
  return true;
}
void applyPendingConfig() {
  Config next;
  bool hasPending;
  portENTER_CRITICAL(&stateMux);
  hasPending = pending;
  if (hasPending) { next = pendingConfiguration; pending = false; }
  portEXIT_CRITICAL(&stateMux);
  if (!hasPending) return;
  blackout();
  if (preferences.putBytes("config", &next, sizeof(next)) != sizeof(next)) {
    strlcpy(runtimeError, "Не удалось сохранить настройки. Повтори попытку.", sizeof(runtimeError));
    maintenance = true;
    return;
  }
  portENTER_CRITICAL(&stateMux);
  configuration = next;
  portEXIT_CRITICAL(&stateMux);
  runtimeError[0] = '\0';
  maintenance = !prepareStrip();
  beginStation();
  Serial.println("Configuration saved. Connecting to home Wi-Fi; password is not logged.");
}

String jsonString(const char* value) {
  String result = "\"";
  for (const unsigned char* p = reinterpret_cast<const unsigned char*>(value); *p; ++p) {
    if (*p == '"' || *p == '\\') { result += '\\'; result += static_cast<char>(*p); }
    else if (*p < 32) {
      char escaped[7]; snprintf(escaped, sizeof(escaped), "\\u%04x", *p); result += escaped;
    } else result += static_cast<char>(*p);
  }
  result += '"';
  return result;
}
void responseHeaders(httpd_req_t* request, const char* type) {
  httpd_resp_set_type(request, type);
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  httpd_resp_set_hdr(request, "X-Content-Type-Options", "nosniff");
  httpd_resp_set_hdr(request, "X-Frame-Options", "DENY");
  httpd_resp_set_hdr(request, "Referrer-Policy", "no-referrer");
  httpd_resp_set_hdr(request, "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}
esp_err_t jsonError(httpd_req_t* request, const char* status, const char* message) {
  responseHeaders(request, "application/json; charset=utf-8");
  httpd_resp_set_status(request, status);
  const String body = "{\"error\":" + jsonString(message) + "}";
  return httpd_resp_send(request, body.c_str(), body.length());
}
bool sameOriginRequest(httpd_req_t* request) {
  char host[96] = {}, origin[128] = {};
  if (httpd_req_get_hdr_value_str(request, "Host", host, sizeof(host)) != ESP_OK) return false;
  Snapshot s;
  portENTER_CRITICAL(&stateMux); s = snapshot; portEXIT_CRITICAL(&stateMux);
  String address(host); address.toLowerCase();
  if (address.endsWith(":80")) address.remove(address.length() - 3);
  const bool knownHost = address == String(hostname) + ".local" || address == hostname ||
    (s.apActive && address == "192.168.4.1") || (s.connected && address == s.ip);
  if (!knownHost) return false; // Also rejects DNS rebinding through an unrelated hostname.
  const size_t originLength = httpd_req_get_hdr_value_len(request, "Origin");
  if (originLength) {
    if (httpd_req_get_hdr_value_str(request, "Origin", origin, sizeof(origin)) != ESP_OK) return false;
    if (String(origin) != String("http://") + host) return false;
  }
  return true;
}
esp_err_t rootPage(httpd_req_t* request) {
  if (!sameOriginRequest(request)) return jsonError(request, "403 Forbidden", "Открой страницу по локальному адресу контроллера.");
  responseHeaders(request, "text/html; charset=utf-8");
  return httpd_resp_send(request, kSetupPage, sizeof(kSetupPage) - 1);
}
esp_err_t getConfig(httpd_req_t* request) {
  if (!sameOriginRequest(request)) return jsonError(request, "403 Forbidden", "Недопустимый адрес.");
  Config c;
  portENTER_CRITICAL(&stateMux); c = configuration; portEXIT_CRITICAL(&stateMux);
  String body; body.reserve(320);
  body = "{\"configured\":"; body += validConfig(c) ? "true" : "false";
  body += ",\"ssid\":"; body += jsonString(c.ssid);
  body += ",\"pin\":"; body += c.pin;
  body += ",\"count\":"; body += c.count;
  body += ",\"limit\":"; body += c.limit;
  body += ",\"order\":\""; body += c.grb ? "GRB" : "RGB";
  body += "\",\"openNetwork\":"; body += validConfig(c) && c.password[0] == '\0' ? "true" : "false";
  body += ",\"token\":"; body += jsonString(csrfToken); body += '}';
  // No saved Wi-Fi or recovery password is ever included in a network response.
  responseHeaders(request, "application/json; charset=utf-8");
  return httpd_resp_send(request, body.c_str(), body.length());
}
esp_err_t getStatus(httpd_req_t* request) {
  if (!sameOriginRequest(request)) return jsonError(request, "403 Forbidden", "Недопустимый адрес.");
  Snapshot s;
  portENTER_CRITICAL(&stateMux); s = snapshot; portEXIT_CRITICAL(&stateMux);
  String body; body.reserve(440);
  body = "{\"version\":\"" NEURAL_FIRMWARE_VERSION "\",\"connected\":";
  body += s.connected ? "true" : "false";
  body += ",\"connecting\":"; body += s.connecting ? "true" : "false";
  body += ",\"outputEnabled\":"; body += s.outputEnabled ? "true" : "false";
  body += ",\"ip\":"; body += jsonString(s.ip);
  body += ",\"received\":"; body += s.received;
  body += ",\"displayed\":"; body += s.displayed;
  body += ",\"dropped\":"; body += s.dropped;
  body += ",\"malformed\":"; body += s.malformed;
  body += ",\"fps\":"; body += s.fps;
  body += ",\"error\":"; body += jsonString(s.error); body += '}';
  responseHeaders(request, "application/json; charset=utf-8");
  return httpd_resp_send(request, body.c_str(), body.length());
}
int hexDigit(char value) {
  if (value >= '0' && value <= '9') return value - '0';
  if (value >= 'a' && value <= 'f') return value - 'a' + 10;
  if (value >= 'A' && value <= 'F') return value - 'A' + 10;
  return -1;
}
bool urlDecode(const char* source, size_t length, char* output, size_t capacity) {
  size_t used = 0;
  for (size_t i = 0; i < length; ++i) {
    unsigned char value = source[i];
    if (value == '+') value = ' ';
    else if (value == '%') {
      if (i + 2 >= length) return false;
      const int high = hexDigit(source[i + 1]), low = hexDigit(source[i + 2]);
      if (high < 0 || low < 0) return false;
      value = static_cast<unsigned char>((high << 4) | low); i += 2;
    }
    if (value < 32 || value == 127 || used + 1 >= capacity) return false;
    output[used++] = static_cast<char>(value);
  }
  output[used] = '\0';
  return true;
}
bool integerValue(const char* value, uint16_t minimum, uint16_t maximum, uint16_t& output) {
  if (!*value) return false;
  uint32_t number = 0;
  for (const char* p = value; *p; ++p) {
    if (*p < '0' || *p > '9') return false;
    number = number * 10 + (*p - '0');
    if (number > maximum) return false;
  }
  if (number < minimum) return false;
  output = static_cast<uint16_t>(number); return true;
}
bool parseSettings(const char* body, Config& result) {
  Config old;
  portENTER_CRITICAL(&stateMux); old = configuration; portEXIT_CRITICAL(&stateMux);
  result = old;
  const char* names[] = {"ssid", "password", "openNetwork", "pin", "count", "order", "limit", "confirmWiring"};
  uint16_t fields = 0;
  char password[64] = {};
  bool openNetwork = false, confirmed = false;
  for (const char* item = body; *item;) {
    const char* end = strchr(item, '&'); if (!end) end = item + strlen(item);
    const char* equals = static_cast<const char*>(memchr(item, '=', end - item));
    if (!equals) return false;
    char key[24], value[128];
    if (!urlDecode(item, equals - item, key, sizeof(key)) ||
        !urlDecode(equals + 1, end - equals - 1, value, sizeof(value))) return false;
    int index = -1;
    for (int i = 0; i < 8; ++i) if (strcmp(key, names[i]) == 0) index = i;
    if (index < 0 || (fields & (1 << index))) return false;
    fields |= 1 << index;
    uint16_t numeric;
    switch (index) {
      case 0: if (strlen(value) > 32 || !*value) return false; strlcpy(result.ssid, value, sizeof(result.ssid)); break;
      case 1: if (strlen(value) > 63) return false; strlcpy(password, value, sizeof(password)); break;
      case 2: if (strcmp(value, "1")) return false; openNetwork = true; break;
      case 3: if (!integerValue(value, 0, 33, numeric) || !allowedPin(numeric)) return false; result.pin = numeric; break;
      case 4: if (!integerValue(value, 1, neural::FrameReceiver::kMaxLeds, numeric)) return false; result.count = numeric; break;
      case 5: if (strcmp(value, "GRB") && strcmp(value, "RGB")) return false; result.grb = strcmp(value, "GRB") == 0; break;
      case 6: if (!integerValue(value, 1, 100, numeric)) return false; result.limit = numeric; break;
      case 7: if (strcmp(value, "1")) return false; confirmed = true; break;
    }
    item = *end ? end + 1 : end;
  }
  const uint16_t required = (1 << 0) | (1 << 3) | (1 << 4) | (1 << 5) | (1 << 6) | (1 << 7);
  if ((fields & required) != required || !confirmed) return false;
  if (openNetwork) {
    if (*password) return false;
    result.password[0] = '\0';
  } else if (*password) strlcpy(result.password, password, sizeof(result.password));
  else if (!validConfig(old) || strcmp(result.ssid, old.ssid) || old.password[0] == '\0') return false;
  result.magic = kConfigMagic;
  return validConfig(result);
}
esp_err_t postConfig(httpd_req_t* request) {
  if (!sameOriginRequest(request)) return jsonError(request, "403 Forbidden", "Недопустимый адрес страницы.");
  char token[40] = {}, contentType[80] = {};
  if (httpd_req_get_hdr_value_str(request, "X-Neural-Token", token, sizeof(token)) != ESP_OK ||
      strlen(token) != strlen(csrfToken)) return jsonError(request, "403 Forbidden", "Обнови страницу и повтори.");
  uint8_t difference = 0;
  for (size_t i = 0; i < strlen(csrfToken); ++i) difference |= token[i] ^ csrfToken[i];
  if (difference) return jsonError(request, "403 Forbidden", "Обнови страницу и повтори.");
  if (httpd_req_get_hdr_value_str(request, "Content-Type", contentType, sizeof(contentType)) != ESP_OK ||
      strncmp(contentType, "application/x-www-form-urlencoded", 33))
    return jsonError(request, "415 Unsupported Media Type", "Неверный формат настроек.");
  if (request->content_len == 0 || request->content_len > 1024)
    return jsonError(request, "413 Payload Too Large", "Настройки слишком длинные.");
  char body[1025] = {};
  size_t received = 0;
  while (received < request->content_len) {
    const int count = httpd_req_recv(request, body + received, request->content_len - received);
    if (count <= 0) return jsonError(request, "408 Request Timeout", "Не удалось получить настройки.");
    received += count;
  }
  // Reject embedded NUL rather than accepting a valid prefix and ignoring the rest.
  if (memchr(body, '\0', received)) return jsonError(request, "400 Bad Request", "Неверные настройки.");
  Config next;
  if (!parseSettings(body, next)) return jsonError(request, "400 Bad Request", "Проверь Wi-Fi, GPIO, число LED и подтверждение подключения.");
  portENTER_CRITICAL(&stateMux);
  const bool busy = pending;
  if (!busy) { pendingConfiguration = next; pending = true; }
  portEXIT_CRITICAL(&stateMux);
  if (busy) return jsonError(request, "409 Conflict", "Настройки уже сохраняются. Подожди секунду.");
  responseHeaders(request, "application/json; charset=utf-8");
  httpd_resp_set_status(request, "202 Accepted");
  return httpd_resp_sendstr(request, "{\"accepted\":true}");
}
void startHttpServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.max_open_sockets = 3;
  config.max_uri_handlers = 4;
  config.stack_size = 6144;
  config.recv_wait_timeout = 3;
  config.send_wait_timeout = 3;
  config.lru_purge_enable = true;
  if (httpd_start(&httpServer, &config) != ESP_OK) {
    strlcpy(runtimeError, "Веб-настройка не запустилась. Нажми RESET.", sizeof(runtimeError));
    Serial.println("HTTP server failed to start."); return;
  }
  const httpd_uri_t routes[] = {
    {"/", HTTP_GET, rootPage, nullptr}, {"/api/config", HTTP_GET, getConfig, nullptr},
    {"/api/status", HTTP_GET, getStatus, nullptr}, {"/api/config", HTTP_POST, postConfig, nullptr}
  };
  for (const auto& route : routes) httpd_register_uri_handler(httpServer, &route);
}
void updateNetwork(uint32_t now) {
  const bool connected = WiFi.status() == WL_CONNECTED;
  if (connected && !wifiWasConnected) {
    connecting = false; connectedSinceMs = now;
    if (stripReady) runtimeError[0] = '\0';
    if (!mdnsStarted) { mdnsStarted = MDNS.begin(hostname); if (mdnsStarted) MDNS.addService("http", "tcp", 80); }
    Serial.printf("Wi-Fi connected. Controller IP: %s | DDP UDP 4048\n", WiFi.localIP().toString().c_str());
  }
  if (!connected && wifiWasConnected) {
    blackout(); connecting = true; connectStartedMs = now;
    if (mdnsStarted) { MDNS.end(); mdnsStarted = false; }
  }
  if (!connected && connecting && static_cast<uint32_t>(now - connectStartedMs) >= kConnectTimeoutMs) {
    connecting = false;
    // An ordinary Wi-Fi outage must recover automatically. Explicit USB SETUP
    // remains a separate maintenance mode that requires confirming settings.
    startAccessPoint(false);
    strlcpy(runtimeError, "Не удалось подключиться к Wi-Fi. Проверь имя и пароль сети.", sizeof(runtimeError));
    Serial.println("Home Wi-Fi unavailable. Recovery AP started; use INFO for its password.");
  }
  if (connected && apActive && !maintenance && static_cast<uint32_t>(now - connectedSinceMs) >= kApGraceMs) {
    WiFi.softAPdisconnect(true); apActive = false; WiFi.mode(WIFI_STA);
    Serial.println("Setup AP closed. Configuration remains available at the controller IP.");
  }
  wifiWasConnected = connected;
}
void drainFrames(uint32_t now) {
  if (!udpStarted) return;
  // Both a packet budget and a time budget prevent UDP floods starving settings/watchdog.
  const uint32_t startedUs = micros();
  for (uint8_t i = 0; i < 16 && static_cast<uint32_t>(micros() - startedUs) < 2500; ++i) {
    const int length = udp.parsePacket();
    if (!length) break;
    if (!stripReady || maintenance || WiFi.status() != WL_CONNECTED) { udp.flush(); continue; }
    if (length > static_cast<int>(sizeof(packet))) { ++oversizedPackets; udp.flush(); continue; }
    const IPAddress incomingIp = udp.remoteIP();
    const uint16_t incomingPort = udp.remotePort();
    if (sourceLocked && static_cast<uint32_t>(now - lastSourceMs) >= kStreamTimeoutMs) {
      blackout(); // A new sender never inherits the previous sender's assembly/history.
    }
    if (sourceLocked && (incomingIp != sourceIp || incomingPort != sourcePort)) {
      ++foreignPackets; udp.flush(); continue;
    }
    const int size = udp.read(packet, sizeof(packet));
    if (size != length) { ++oversizedPackets; continue; }
    const auto result = receiver.ingest(packet, size, now);
    if (result != neural::IngestResult::Rejected) {
      if (!sourceLocked) { sourceIp = incomingIp; sourcePort = incomingPort; sourceLocked = true; }
      lastSourceMs = now;
    }
  }
}
void showFrame(uint32_t now) {
  if (!stripReady || maintenance) return;
  receiver.expire(now, kStreamTimeoutMs);
  if (!receiver.ready()) return;
  const uint32_t currentUs = micros();
  if (static_cast<uint32_t>(currentUs - lastShowUs) < kFrameIntervalUs) return;
  const uint8_t* pixels = receiver.data();
  for (uint16_t i = 0; i < configuration.count; ++i) {
    const size_t offset = static_cast<size_t>(i) * 3;
    // Apply an explicit local ceiling once, without destructively rescaling the input buffer.
    strip.setPixelColor(i, static_cast<uint16_t>(pixels[offset]) * configuration.limit / 100,
      static_cast<uint16_t>(pixels[offset + 1]) * configuration.limit / 100,
      static_cast<uint16_t>(pixels[offset + 2]) * configuration.limit / 100);
  }
  strip.show(); // WS2812 wire time is ~30 us/LED; long strips cannot physically reach 60 FPS.
  receiver.consume();
  lastShowUs = currentUs;
  ++displayed; ++showWindowCount;
}
void refreshSnapshot(uint32_t now) {
  if (static_cast<uint32_t>(now - rateWindowMs) >= 1000) {
    outputFps = static_cast<uint16_t>((showWindowCount * 1000UL) / (now - rateWindowMs));
    showWindowCount = 0; rateWindowMs = now;
  }
  if (static_cast<uint32_t>(now - lastSnapshotMs) < 100) return;
  lastSnapshotMs = now;
  Snapshot s;
  s.connected = WiFi.status() == WL_CONNECTED; s.connecting = connecting;
  s.outputEnabled = stripReady && !maintenance && s.connected; s.apActive = apActive;
  strlcpy(s.ip, WiFi.localIP().toString().c_str(), sizeof(s.ip));
  strlcpy(s.error, runtimeError, sizeof(s.error));
  const auto& stats = receiver.stats();
  s.received = stats.frames; s.displayed = displayed;
  s.dropped = stats.abandonedFrames + stats.supersededFrames;
  s.malformed = stats.malformed + oversizedPackets;
  s.fps = outputFps;
  portENTER_CRITICAL(&stateMux); snapshot = s; portEXIT_CRITICAL(&stateMux);
}
void pollSerial() {
  static char command[24] = {};
  static uint8_t used = 0;
  static bool overflow = false;
  for (uint8_t i = 0; i < 32 && Serial.available(); ++i) {
    const char value = Serial.read();
    if (value == '\r' || value == '\n') {
      command[used] = '\0';
      if (!overflow && used) {
        if (!strcasecmp(command, "INFO")) serialInfo();
        else if (!strcasecmp(command, "SETUP")) { startAccessPoint(true); serialInfo(); }
        else Serial.println("Commands: INFO, SETUP");
      }
      used = 0; overflow = false;
    } else if (used + 1 < sizeof(command)) command[used++] = value;
    else overflow = true;
  }
}
} // namespace

void setup() {
  Serial.begin(115200);
  WiFi.persistent(false); // Credentials are stored only in our versioned NVS configuration.
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  const uint32_t suffix = static_cast<uint32_t>(ESP.getEfuseMac() & 0xffffff);
  snprintf(hostname, sizeof(hostname), "neural-light-%06x", suffix);
  snprintf(apName, sizeof(apName), "NEURAL-LIGHT-%06X", suffix);
  randomHex(csrfToken, 16);
  if (!preferences.begin("neural-light", false)) {
    Serial.println("NVS unavailable; configuration cannot be saved.");
    strlcpy(runtimeError, "Не удалось открыть память настроек.", sizeof(runtimeError));
  }
  String savedApPassword = preferences.getString("apPass", "");
  if (savedApPassword.length() == 16) strlcpy(apPassword, savedApPassword.c_str(), sizeof(apPassword));
  else {
    randomHex(apPassword, 8);
    preferences.putString("apPass", apPassword);
  }
  if (preferences.getBytesLength("config") == sizeof(configuration)) {
    Config saved;
    preferences.getBytes("config", &saved, sizeof(saved));
    if (validConfig(saved)) configuration = saved;
  }
  if (validConfig(configuration)) { maintenance = !prepareStrip(); beginStation(); }
  else { maintenance = true; startAccessPoint(true); serialInfo(); }
  udpStarted = udp.begin(kUdpPort) == 1;
  if (!udpStarted) strlcpy(runtimeError, "Не удалось открыть UDP-порт 4048.", sizeof(runtimeError));
  lastSnapshotMs = millis() - 100;
  refreshSnapshot(millis());
  startHttpServer();
  Serial.println("Type INFO + Enter for setup Wi-Fi details. No LED output until configuration is saved.");
}
void loop() {
  pollSerial();
  applyPendingConfig();
  const uint32_t now = millis();
  updateNetwork(now);
  drainFrames(now);
  showFrame(now);
  refreshSnapshot(now);
  delay(1); // Yield to the Wi-Fi, HTTP and watchdog tasks.
}
