#!/usr/bin/env node
/**
 * A tiny scripted Home Assistant for tests and local demos.
 *
 * It speaks just enough of the Home Assistant WebSocket API for Homeframe:
 * auth, ping, the area/device/entity registries, get_states, state_changed
 * subscriptions, recorder statistics and call_service. Data is synthetic but
 * shaped like a real Danish home: sun.sun, a weather entity, an Energi Data
 * Service-style price sensor with 24 hourly prices, and an energy meter with
 * hourly statistics.
 *
 *   node scripts/fake-home-assistant.mjs            # listens on :8123
 *   FAKE_HA_PORT=8124 FAKE_HA_WEATHER=snowy node scripts/fake-home-assistant.mjs
 *   FAKE_HA_STATES='{"sensor.living_room_temperature":"23.4"}' node scripts/fake-home-assistant.mjs
 *
 * Then start the runtime against it:
 *
 *   HOMEFRAME_HA_URL=http://127.0.0.1:8123 HOMEFRAME_HA_TOKEN=demo npm start
 *
 * No dependencies: the WebSocket framing is implemented inline (text frames,
 * server→client unmasked, client→server masked), which is all this needs.
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const HOUR = 60 * 60 * 1000;
const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** Deterministic 0..1 noise so every run shows the same "home". */
function noise(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** A household load curve: low at night, morning bump, big evening peak. */
function householdKwh(time) {
  const date = new Date(time);
  const hour = date.getHours();
  const base = 0.28;
  const morning = hour >= 6 && hour <= 8 ? 0.55 : 0;
  const evening = hour >= 17 && hour <= 21 ? 1.1 - Math.abs(hour - 19) * 0.25 : 0;
  return Number((base + morning + evening + noise(time / HOUR) * 0.25).toFixed(3));
}

/** A Danish-looking spot price curve in DKK/kWh, cheapest around 03:00. */
function spotPrice(hour) {
  const night = hour >= 1 && hour <= 5 ? -0.55 : 0;
  const peak = hour >= 17 && hour <= 20 ? 1.35 : 0;
  const morning = hour >= 7 && hour <= 9 ? 0.45 : 0;
  return Number((1.25 + night + peak + morning + noise(hour + 7) * 0.2).toFixed(4));
}

/**
 * Sun position from the local clock with a fixed 07:30–17:00 day, close
 * enough to a Danish late-October day for demos. FAKE_HA_SUN_ELEVATION pins it.
 */
function sunState(now) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const rise = today.getTime() + 7.5 * HOUR;
  const set = today.getTime() + 17 * HOUR;
  const t = now.getTime();

  const pinned = process.env.FAKE_HA_SUN_ELEVATION;
  let elevation;
  if (pinned !== undefined) {
    elevation = Number(pinned);
  } else if (t >= rise && t < set) {
    elevation = Math.sin(((t - rise) / (set - rise)) * Math.PI) * 22;
  } else {
    const nightProgress = ((t - set + 24 * HOUR) % (24 * HOUR)) / (24 * HOUR - (set - rise));
    elevation = -Math.sin(nightProgress * Math.PI) * 40;
  }

  // Rising from solar midnight until solar noon.
  const solarNoon = (rise + set) / 2;
  const sinceSolarMidnight = (((t - (solarNoon - 12 * HOUR)) % (24 * HOUR)) + 24 * HOUR) % (24 * HOUR);
  const rising =
    pinned !== undefined ? process.env.FAKE_HA_SUN_RISING === "true" : sinceSolarMidnight < 12 * HOUR;
  const nextRising = t < rise ? rise : rise + 24 * HOUR;
  const nextSetting = t < set ? set : set + 24 * HOUR;

  return {
    state: elevation > 0 ? "above_horizon" : "below_horizon",
    attributes: {
      friendly_name: "Sun",
      elevation: Number(elevation.toFixed(2)),
      rising,
      next_rising: new Date(nextRising).toISOString(),
      next_setting: new Date(nextSetting).toISOString(),
    },
  };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * A small synthetic camera still: dusky sky, a lit horizon and dark ground,
 * tinted per camera so two cards are distinguishable. Real PNG bytes, so the
 * runtime's image-type checks are exercised for real.
 */
function cameraPng(entityId, width = 320, height = 180) {
  const tint = entityId.length % 3;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    const t = y / height;
    for (let x = 0; x < width; x += 1) {
      const sky = t < 0.62;
      const glow = sky ? Math.max(0, 1 - Math.abs(t - 0.6) * 4) : 0;
      const r = sky ? 30 + glow * 150 + tint * 10 : 26 + (x % 40 < 2 ? 20 : 0);
      const g = sky ? 42 + glow * 90 : 30;
      const b = sky ? 70 + (1 - t) * 60 : 28;
      row.set([r, g, b].map((value) => Math.min(255, Math.round(value))), 1 + x * 3);
    }
    rows.push(row);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Five days of plausible late-autumn Danish weather. */
function forecast(now) {
  const conditions = ["partlycloudy", "rainy", "cloudy", "sunny", "windy"];
  return conditions.map((condition, index) => {
    const day = new Date(now);
    day.setHours(12, 0, 0, 0);
    day.setDate(day.getDate() + index);
    return {
      datetime: day.toISOString(),
      condition,
      temperature: Number((9 + noise(index + 3) * 4).toFixed(1)),
      templow: Number((3 + noise(index + 11) * 3).toFixed(1)),
      precipitation: condition === "rainy" ? 4.2 : 0,
      precipitation_probability: condition === "rainy" ? 80 : 10,
    };
  });
}

function calendarEvents(now) {
  const at = (days, hour, minute = 0) => {
    const date = new Date(now);
    date.setDate(date.getDate() + days);
    date.setHours(hour, minute, 0, 0);
    return date.toISOString();
  };
  const dateOnly = (days) => {
    const date = new Date(now);
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  };
  return {
    "calendar.family": {
      events: [
        { start: at(0, 16, 30), end: at(0, 17, 30), summary: "Football practice", location: "Sports hall" },
        { start: at(1, 8, 15), end: at(1, 9, 0), summary: "Dentist" },
        { start: dateOnly(3), end: dateOnly(4), summary: "Grandma's birthday" },
      ],
    },
    "calendar.waste": {
      events: [{ start: dateOnly(2), end: dateOnly(3), summary: "Bins: paper & plastic" }],
    },
  };
}

/** Services that return data, keyed like Home Assistant's response map. */
function serviceResponse(message, now) {
  const target = message.target?.entity_id;
  const entities = Array.isArray(target) ? target : target ? [target] : [];

  if (message.domain === "weather" && message.service === "get_forecasts") {
    return Object.fromEntries(entities.map((id) => [id, { forecast: forecast(now) }]));
  }
  if (message.domain === "calendar" && message.service === "get_events") {
    const all = calendarEvents(now);
    return Object.fromEntries(entities.map((id) => [id, all[id] ?? { events: [] }]));
  }
  return undefined;
}

function buildHome(now, overrides = {}) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const isoNow = now.toISOString();

  const raw_today = Array.from({ length: 24 }, (_, hour) => ({
    hour: new Date(today.getTime() + hour * HOUR).toISOString(),
    price: spotPrice(hour),
  }));
  const currentPrice = spotPrice(now.getHours());

  const entity = (entity_id, state, attributes = {}, registry = {}) => ({
    registry: { entity_id, name: null, area_id: null, device_id: null, ...registry },
    state: {
      entity_id,
      state: String(state),
      attributes,
      last_changed: isoNow,
      last_updated: isoNow,
    },
  });

  const sun = sunState(now);
  const weather = process.env.FAKE_HA_WEATHER ?? "partlycloudy";

  const entities = [
    entity("sensor.living_room_temperature", 21.8, { device_class: "temperature", unit_of_measurement: "°C", friendly_name: "Living room temperature" }, { area_id: "living_room" }),
    entity("sensor.living_room_humidity", 46, { device_class: "humidity", unit_of_measurement: "%", friendly_name: "Living room humidity" }, { area_id: "living_room" }),
    entity("light.living_room_ceiling", "on", { friendly_name: "Ceiling" }, { area_id: "living_room" }),
    entity("light.living_room_lamp", "on", { friendly_name: "Lamp" }, { area_id: "living_room" }),
    entity("climate.living_room", "heat", { friendly_name: "Living room", current_temperature: 21.6, temperature: 22, hvac_action: "heating" }, { area_id: "living_room" }),
    entity("sensor.kitchen_temperature", 21.1, { device_class: "temperature", unit_of_measurement: "°C", friendly_name: "Kitchen temperature" }, { area_id: "kitchen" }),
    entity("light.kitchen", "off", { friendly_name: "Kitchen" }, { area_id: "kitchen" }),
    entity("climate.kitchen", "heat", { friendly_name: "Kitchen", current_temperature: 21.2, temperature: 21.5, hvac_action: "idle" }, { area_id: "kitchen" }),
    entity("sensor.bedroom_temperature", 19.4, { device_class: "temperature", unit_of_measurement: "°C", friendly_name: "Bedroom temperature" }, { area_id: "bedroom" }),
    entity("sensor.bedroom_humidity", 51, { device_class: "humidity", unit_of_measurement: "%", friendly_name: "Bedroom humidity" }, { area_id: "bedroom" }),
    entity("light.bedroom", "off", { friendly_name: "Bedroom" }, { area_id: "bedroom" }),
    entity("sensor.home_power", 1460 + Math.round(noise(now.getMinutes()) * 300), { device_class: "power", unit_of_measurement: "W", state_class: "measurement", friendly_name: "Home power" }),
    entity("sensor.home_energy", 18452300, { device_class: "energy", unit_of_measurement: "Wh", state_class: "total_increasing", friendly_name: "Home energy" }),
    entity("sensor.energi_data_service", currentPrice, { unit_of_measurement: "DKK/kWh", friendly_name: "Energi Data Service", current_price: currentPrice, raw_today, raw_tomorrow: [] }),
    entity("sensor.washing_machine_state", "Rinsing", { friendly_name: "Washing machine" }, { area_id: "utility" }),
    entity("vacuum.robot", "docked", { friendly_name: "Robot vacuum" }),
    entity("lock.front_door", "locked", { friendly_name: "Front door" }),
    entity("sun.sun", sun.state, sun.attributes),
    entity("camera.front_door", "idle", { friendly_name: "Front door" }),
    entity("camera.driveway", "recording", { friendly_name: "Driveway" }),
    entity("calendar.family", "off", { friendly_name: "Family" }),
    entity("calendar.waste", "off", { friendly_name: "Waste collection" }),
    entity("person.anna", "home", { friendly_name: "Anna" }),
    entity("person.ben", "not_home", { friendly_name: "Ben" }),
    entity("weather.home", weather, { friendly_name: "Home", temperature: Number(process.env.FAKE_HA_TEMPERATURE ?? 8.4), temperature_unit: "°C", humidity: 87 }),
  ];

  // Tests and demos pin or change single states (see setState).
  for (const item of entities) {
    if (item.state.entity_id in overrides) item.state.state = String(overrides[item.state.entity_id]);
  }

  return {
    areas: [
      { area_id: "living_room", name: "Living room" },
      { area_id: "kitchen", name: "Kitchen" },
      { area_id: "bedroom", name: "Bedroom" },
      { area_id: "utility", name: "Utility room" },
    ],
    devices: [],
    entities: entities.map((item) => item.registry),
    states: entities.map((item) => item.state),
  };
}

/** Hourly (or 5-minute / monthly) statistics rows for the energy meter. */
/**
 * Like Home Assistant, the meter records in its own unit (Wh here) and only
 * converts when the caller asks for `units: { energy: "kWh" }`. That keeps the
 * smoke test honest about Homeframe requesting kWh.
 */
function statistics({ start_time, end_time, statistic_ids, period, types, units }, now) {
  const energyScale = units?.energy === "kWh" ? 1 : 1000;
  const start = Date.parse(start_time);
  const end = end_time ? Date.parse(end_time) : now.getTime();
  const result = {};

  for (const id of statistic_ids) {
    const rows = [];

    if (period === "month") {
      const cursor = new Date(start);
      while (cursor.getTime() < end) {
        const monthStart = cursor.getTime();
        const daysSoFar = cursor.getMonth() === now.getMonth() ? now.getDate() : 30;
        rows.push({ start: monthStart, end: monthStart + 30 * 24 * HOUR, change: Number((daysSoFar * 11.4 * energyScale).toFixed(2)) });
        cursor.setMonth(cursor.getMonth() + 1);
      }
    } else {
      const step = period === "5minute" ? 5 * 60 * 1000 : HOUR;
      // Statistics only cover completed buckets, like Home Assistant.
      for (let bucket = start; bucket + step <= end; bucket += step) {
        const hourly = householdKwh(bucket - (bucket % HOUR));
        const kwh = period === "5minute" ? hourly / 12 : hourly;
        const row = { start: bucket, end: bucket + step };
        if (types.includes("change")) row.change = Number((kwh * energyScale).toFixed(4));
        if (types.includes("mean")) row.mean = Number((kwh * 1000).toFixed(1));
        rows.push(row);
      }
    }

    result[id] = rows;
  }

  return result;
}

function encodeFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x81, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

/** Pull complete client frames out of `buffer`; returns texts and the remainder. */
function decodeFrames(buffer) {
  const messages = [];
  let offset = 0;

  while (buffer.length - offset >= 2) {
    const opcode = buffer[offset] & 0x0f;
    const masked = (buffer[offset + 1] & 0x80) !== 0;
    let length = buffer[offset + 1] & 0x7f;
    let cursor = offset + 2;

    if (length === 126) {
      if (buffer.length < cursor + 2) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (buffer.length < cursor + 8) break;
      length = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }

    const maskLength = masked ? 4 : 0;
    if (buffer.length < cursor + maskLength + length) break;

    const mask = masked ? buffer.subarray(cursor, cursor + 4) : undefined;
    cursor += maskLength;
    const payload = Buffer.from(buffer.subarray(cursor, cursor + length));
    if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];

    if (opcode === 0x8) messages.push({ close: true });
    else if (opcode === 0x1) messages.push({ text: payload.toString("utf8") });
    offset = cursor + length;
  }

  return { messages, rest: buffer.subarray(offset) };
}

/**
 * `states` pins entity states (`{ "sensor.x": "21.5" }`). The returned handle
 * can change a state live (`setState`, sent to subscribers like a real
 * state_changed event), drop every connection without stopping the server
 * (`dropConnections`, like a network blip) and stop answering pings
 * (`ignorePings = true`, like a frozen host) so reconnect logic can be tested.
 */
export function startFakeHomeAssistant({ port = 8123, host = "127.0.0.1", token, states = {} } = {}) {
  const serviceCalls = [];
  const sockets = new Set();
  const overrides = { ...states };
  /** Sockets with a state_changed subscription: send function -> subscription id. */
  const subscribers = new Map();
  const control = { ignorePings: false };
  const cameraRequests = [];
  const server = createServer((request, response) => {
    // REST camera proxy, both as Core serves it and behind the Supervisor.
    const match = /^\/(?:core\/)?api\/camera_proxy\/(camera\.[a-z0-9_]+)/.exec(request.url ?? "");
    if (request.method === "GET" && match) {
      const authorized = token === undefined || request.headers.authorization === `Bearer ${token}`;
      cameraRequests.push({ url: request.url, authorized });
      if (!authorized) {
        response.writeHead(401).end();
        return;
      }
      response.writeHead(200, { "content-type": "image/png" });
      response.end(cameraPng(match[1]));
      return;
    }
    response.writeHead(404).end();
  });

  server.on("upgrade", (request, socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    // /core/websocket is the Supervisor's proxy path for add-ons.
    if (request.url !== "/api/websocket" && request.url !== "/core/websocket") {
      socket.destroy();
      return;
    }

    const accept = createHash("sha1")
      .update(`${request.headers["sec-websocket-key"]}${WEBSOCKET_GUID}`)
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );

    const send = (value) => socket.write(encodeFrame(JSON.stringify(value)));
    let pending = Buffer.alloc(0);
    let authenticated = false;

    send({ type: "auth_required", ha_version: "2026.10.0" });

    socket.on("data", (chunk) => {
      const { messages, rest } = decodeFrames(Buffer.concat([pending, chunk]));
      pending = rest;

      for (const frame of messages) {
        if (frame.close) {
          socket.end();
          return;
        }

        const message = JSON.parse(frame.text);
        const now = new Date();

        if (message.type === "auth") {
          authenticated = token === undefined || message.access_token === token;
          send(authenticated ? { type: "auth_ok", ha_version: "2026.10.0" } : { type: "auth_invalid", message: "Invalid access token" });
          continue;
        }
        if (!authenticated) continue;

        const home = buildHome(now, overrides);
        const reply = (result) => send({ id: message.id, type: "result", success: true, result });

        switch (message.type) {
          case "config/area_registry/list":
            reply(home.areas);
            break;
          case "config/device_registry/list":
            reply(home.devices);
            break;
          case "config/entity_registry/list":
            reply(home.entities);
            break;
          case "get_states":
            reply(home.states);
            break;
          case "subscribe_events":
            subscribers.set(send, message.id);
            reply(null);
            break;
          case "ping":
            if (!control.ignorePings) send({ id: message.id, type: "pong" });
            break;
          case "recorder/statistics_during_period":
            reply(statistics(message, now));
            break;
          case "call_service": {
            serviceCalls.push(message);
            const response = message.return_response ? serviceResponse(message, now) : undefined;
            reply({ context: { id: `fake-${serviceCalls.length}` }, ...(response ? { response } : {}) });
            break;
          }
          default:
            send({ id: message.id, type: "result", success: false, error: { code: "unknown_command", message: `Unknown command ${message.type}` } });
        }
      }
    });

    socket.on("close", () => subscribers.delete(send));
    socket.on("error", () => socket.destroy());
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      resolve({
        url: `http://${host}:${server.address().port}`,
        port: server.address().port,
        serviceCalls,
        cameraRequests,
        get ignorePings() {
          return control.ignorePings;
        },
        set ignorePings(value) {
          control.ignorePings = value;
        },
        /** Change one entity's state and tell every subscriber, like Home Assistant does. */
        setState(entityId, state) {
          overrides[entityId] = state;
          const newState = buildHome(new Date(), overrides).states.find((item) => item.entity_id === entityId);
          for (const [send, id] of subscribers) {
            send({ id, type: "event", event: { event_type: "state_changed", data: { entity_id: entityId, new_state: newState } } });
          }
        },
        /** Cut every WebSocket abruptly but keep listening, like a network blip. */
        dropConnections() {
          for (const socket of sockets) socket.destroy();
        },
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
          }),
        server,
      });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.FAKE_HA_PORT ?? 8123);
  const fake = await startFakeHomeAssistant({
    port,
    host: process.env.FAKE_HA_HOST ?? "127.0.0.1",
    states: process.env.FAKE_HA_STATES ? JSON.parse(process.env.FAKE_HA_STATES) : {},
  });
  console.log(`Fake Home Assistant listening at ${fake.url} (any token is accepted)`);
}
