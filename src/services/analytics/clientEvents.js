'use strict';

/*
  Events the mobile app reports about itself (screen opened, login, ...).

  They are only counted, per event name, in the Prometheus metric app_client_events_total (visible
  in Grafana). Nothing from the event body is stored and nobody can attach data to a user. The app
  is untrusted, so names are checked and the number of different names is capped, to stop anyone
  from filling the metrics with endless labels.
*/

const promClient = require('prom-client');
const { register } = require('../../routes/metrics');

const NAME_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const MAX_DISTINCT_NAMES = 60;
const MAX_EVENTS_PER_REQUEST = 50;

const counter = new promClient.Counter({
  name: 'app_client_events_total',
  help: 'Events reported by the mobile app, by event name',
  labelNames: ['name'],
  registers: [register],
});

const seenNames = new Set();

function nameOf(event) {
  if (typeof event === 'string') return event;
  if (!event || typeof event !== 'object') return null;
  const raw = event.name ?? event.type ?? event.event ?? event.action;
  return typeof raw === 'string' ? raw : null;
}

/** Accepts one event, an array, or { events: [...] }. Returns how many were counted. */
function recordClientEvents(body) {
  let list;
  if (Array.isArray(body)) list = body;
  else if (body && Array.isArray(body.events)) list = body.events;
  else list = [body];

  let accepted = 0;
  for (const event of list.slice(0, MAX_EVENTS_PER_REQUEST)) {
    const name = nameOf(event);
    if (!name || !NAME_RE.test(name)) continue;

    let label = name;
    if (!seenNames.has(name)) {
      if (seenNames.size >= MAX_DISTINCT_NAMES) label = 'other';
      else seenNames.add(name);
    }
    counter.inc({ name: label });
    accepted += 1;
  }
  return accepted;
}

module.exports = { recordClientEvents, MAX_EVENTS_PER_REQUEST, MAX_DISTINCT_NAMES };
