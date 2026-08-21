'use strict';
/* Migrate a UHD Connect config from the OLD API schema to the NEW one.
 * Browser + Node. Standard library / no dependencies. Pair of uhd_migration.py;
 * the Node check in tools/migrate-test.cjs requires the two to agree.
 *
 *   UHDMigrate.migrateText(raw, { fileName })
 *   UHDMigrate.migrateConfig(obj, report)
 */
(function (root) {

const TUNNEL_FUNCS = { connect_vlan_vxlan: 'vxlan', connect_vlan_nvgre: 'nvgre' };
const PASSTHROUGH_FUNCS = { connect_arp: 1, connect_ip: 1, connect_ethernet: 1 };
const DROPPED_VLAN_CHOICES = { all_vlans: 1, all_vlans_and_non_vlan: 1 };
const ROUTING_KEYS = ['routing_method', 'ip_routing', 'mac_routing', 'vni_routing'];
const FUNC_TAG = /^function_(\d+)$/;
const HTTP_FIRST_LINE = /^[A-Z]+\s+\S+\s+HTTP\/\d/;

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function isObj(o) { return o !== null && typeof o === 'object' && !Array.isArray(o); }
function pyRepr(v) {
  if (typeof v === 'string') return "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  if (v == null) return 'None';
  return String(v);
}

class MigrationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MigrationError';
  }
}

class Report {
  constructor() {
    this.changes = [];
    this.problems = [];
  }
  changed(msg) { this.changes.push(msg); }
  problem(msg) { this.problems.push(msg); }
  render() {
    const out = [];
    if (this.changes.length) {
      out.push('changes applied:');
      for (const c of this.changes) out.push('  - ' + c);
    } else {
      out.push('no changes: input already looks like the new schema');
    }
    if (this.problems.length) {
      out.push('');
      out.push('COULD NOT MAP:');
      for (const p of this.problems) out.push('  ! ' + p);
    }
    return out.join('\n');
  }
}

function rangeToVlanIdOption(rng, where, rep) {
  const start = rng.start;
  const count = Number(rng.count || 0);
  const step = Number(rng.step || 1);
  if (start == null) throw new MigrationError(where + ': VLAN range has no \'start\'');
  if (count <= 1) return { choice: 'vlan', vlan: start };
  rep.changed(where + ': vlan range start=' + start + ' count=' + count + ' step=' + step);
  return { choice: 'vlan_range', vlan_range: { start: start, count: count, step: step } };
}

function splitVlanDouble(vlan, where, rep) {
  const dbl = vlan.vlan_double || {};
  const outer = dbl.outer, inner = dbl.inner;
  if (outer == null || inner == null) {
    throw new MigrationError(where + ': vlan_double needs both \'outer\' and \'inner\'');
  }
  return [
    rangeToVlanIdOption(outer, where + '.outer', rep),
    rangeToVlanIdOption(inner, where + '.inner', rep)
  ];
}

function normaliseVlan(vlan, where, rep) {
  if (vlan == null) return [];
  if (!isObj(vlan)) throw new MigrationError(where + ': VLAN is not an object');
  const choice = vlan.choice;
  if (DROPPED_VLAN_CHOICES[choice]) {
    rep.problem(
      where + ': VLAN choice \'' + choice + '\' was DELETED from the schema and has '
      + 'no replacement. Decide explicitly what this connection should match '
      + '(a specific vlan, a vlan_range, or non_vlan) and edit it by hand.');
    return [{ choice: 'non_vlan', __UNMAPPED__: choice }];
  }
  if (choice === 'vlan_double') {
    rep.changed(where + ': vlan_double -> two stacked functions (outer first)');
    return splitVlanDouble(vlan, where, rep);
  }
  if (choice === 'vlan_range') return [rangeToVlanIdOption(vlan.vlan_range || {}, where, rep)];
  if (choice === 'vlan' || choice === 'non_vlan') return [clone(vlan)];
  throw new MigrationError(where + ': unknown VLAN choice ' + pyRepr(choice));
}

function parseOldEndpoint(ep, idx) {
  const where = 'endpoints[' + idx + ']';
  if ('port_name' in ep && !('front_panel' in ep) && !('choice' in ep)) {
    return { port_name: ep.port_name, vlan: null, tags: (ep.tags || []).slice(), already_new: true };
  }
  const choice = ep.choice;
  if (choice === 'internal' || ('internal' in ep)) {
    throw new MigrationError(
      where + ': \'internal\' endpoints were removed from the schema and '
      + 'have no equivalent; this connection needs redesigning by hand.');
  }
  const fp = ep.front_panel;
  if (!isObj(fp)) throw new MigrationError(where + ': expected a \'front_panel\' object');
  const portName = fp.port_name;
  if (!portName) throw new MigrationError(where + ': front_panel has no \'port_name\'');
  return { port_name: portName, vlan: fp.vlan, tags: (ep.tags || []).slice(), already_new: false };
}

function splitTags(tags) {
  const roles = [];
  let fidx = null;
  for (const t of tags) {
    const m = FUNC_TAG.exec(t);
    if (m) fidx = parseInt(m[1], 10);
    else roles.push(t);
  }
  return { roles: roles, function_index: fidx };
}

function migrateTunnelFunction(body, kind, where, rep) {
  body = clone(body);
  const tunKey = kind + '_endpoint_settings';
  const hdrKey = 'outgoing_' + kind + '_header';
  if (!isObj(body[tunKey])) body[tunKey] = {};
  if (!isObj(body.vlan_endpoint_settings)) body.vlan_endpoint_settings = {};
  const tun = body[tunKey];
  const vlanSide = body.vlan_endpoint_settings;

  let header = null;
  for (const srcKey of [hdrKey, hdrKey + '_v6']) {
    if (srcKey in vlanSide) {
      header = vlanSide[srcKey];
      delete vlanSide[srcKey];
      if (srcKey.endsWith('_v6')) {
        rep.changed(where + ': ' + srcKey + ' -> ' + tunKey + '.' + hdrKey
          + ' (the _v6 sibling schema is gone; the IP family is '
          + 'already the choice on src_ip/dst_ip)');
      } else {
        rep.changed(where + ': vlan_endpoint_settings.' + srcKey
          + ' -> ' + tunKey + '.' + hdrKey);
      }
    }
  }
  if ((hdrKey in tun) && header != null) {
    rep.problem(where + ': ' + hdrKey + ' present on BOTH sides; kept the '
      + 'tunnel-side one and discarded the vlan-side copy');
    header = tun[hdrKey];
  }
  if (header != null) tun[hdrKey] = header;

  for (const portKey of ['udp_src_port', 'udp_dst_port']) {
    if (portKey in tun) {
      const value = tun[portKey];
      delete tun[portKey];
      if (tun[hdrKey] == null) {
        rep.problem(where + ': ' + portKey + '=' + value + ' has nowhere to go -- it '
          + 'now lives inside ' + hdrKey + ', but this function has '
          + 'no outgoing header. Dropped.');
        continue;
      }
      tun[hdrKey][portKey] = value;
      rep.changed(where + ': ' + tunKey + '.' + portKey + ' -> ' + hdrKey + '.' + portKey);
    }
  }

  if (!Object.keys(vlanSide).length) body.vlan_endpoint_settings = {};
  return body;
}

function functionKind(fn, where) {
  let choice = fn.choice;
  if (!choice) {
    const candidates = Object.keys(fn).filter(k => k.indexOf('connect_') === 0);
    if (candidates.length !== 1) {
      throw new MigrationError(
        where + ': function has no \'choice\' discriminator and it cannot '
        + 'be inferred (found ' + (candidates.length ? candidates : 'no connect_* key') + ')');
    }
    choice = candidates[0];
  }
  if (!(choice in fn)) {
    throw new MigrationError(where + ': choice=' + pyRepr(choice) + ' but no matching '
      + '\'' + choice + '\' body');
  }
  return { choice: choice, body: fn[choice] };
}

function cleanVlan(vlan) {
  const o = {};
  for (const k of Object.keys(vlan)) {
    if (k !== '__UNMAPPED__') o[k] = vlan[k];
  }
  return o;
}

function vlanForFunction(parsed, vlanLists, fi, repI, doubleWidth, roleWanted) {
  for (let idx = 0; idx < parsed.length; idx++) {
    const p = parsed[idx];
    if (p.roles.indexOf(roleWanted) < 0) continue;
    if (doubleWidth > 1) {
      const opts = vlanLists[idx] || [];
      if (repI < opts.length) return cleanVlan(opts[repI]);
      continue;
    }
    if (p.function_index != null && p.function_index !== fi) continue;
    const opts = vlanLists[idx] || [];
    if (opts.length) return cleanVlan(opts[0]);
  }
  return null;
}

function passthroughEndpoints(parsed) {
  const seen = {}, out = [];
  for (const p of parsed) {
    if (!seen[p.port_name]) {
      seen[p.port_name] = 1;
      out.push(p);
    }
  }
  return out;
}

function collapseEndpoints(parsed, newFns, whereC, rep) {
  const n = newFns.length;
  const byPort = {};
  for (const p of parsed) {
    if (!byPort[p.port_name]) byPort[p.port_name] = [];
    byPort[p.port_name].push(p);
  }
  const portNames = Object.keys(byPort);
  if (portNames.length > 2) {
    rep.problem(
      whereC + ': ' + portNames.length + ' distinct ports across the endpoints, but a '
      + 'connection has exactly two ends. Emitted all of them -- check this '
      + 'one by hand.');
  }

  const out = [];
  for (const portName of portNames) {
    const entries = byPort[portName];
    let tags = [];
    for (let fi = 0; fi < n; fi++) {
      let role = null;
      for (const e of entries) {
        if (e.function_index === fi) {
          role = e.roles.length ? e.roles[0] : null;
          break;
        }
      }
      if (role == null) {
        const roles = [];
        for (const e of entries) for (const r of e.roles) roles.push(r);
        role = roles.length ? roles[0] : 'vlan';
      }
      tags.push(role);
    }
    if (n === 0) {
      tags = [];
      for (const e of entries) {
        if (e.roles.length) { tags.push(e.roles[0]); break; }
      }
      if (!tags.length) tags = ['vlan'];
    }
    out.push({ port_name: portName, tags: tags });
  }

  if (parsed.length !== out.length) {
    rep.changed(whereC + ': ' + parsed.length + ' endpoints -> ' + out.length
      + ' (one per port; function_N marker tags removed)');
  }
  for (const ep of out) {
    rep.changed(whereC + ': endpoint ' + ep.port_name + ' tags=' + JSON.stringify(ep.tags).replace(/"/g, "'")
      + ' (one per function, positional)');
  }

  function key(ep) {
    return ep.tags.every(t => t === 'vlan') ? 0 : 1;
  }
  if (out.some(e => key(e))) out.sort((a, b) => key(a) - key(b));
  return out;
}

function migrateConnection(conn, cidx, rep) {
  const whereC = 'connections[' + cidx + '] (' + pyRepr(conn.name || 'unnamed') + ')';
  const oldEps = conn.endpoints || [];
  const oldFns = conn.functions || [];

  const parsed = oldEps.map((ep, i) => parseOldEndpoint(ep, i));
  if (parsed.length && parsed.every(p => p.already_new)
      && !parsed.some(p => p.tags.some(t => t.indexOf('function_') >= 0))) {
    rep.changed(whereC + ': endpoints already flat, left alone');
  }

  for (const p of parsed) {
    const s = splitTags(p.tags);
    p.roles = s.roles;
    p.function_index = s.function_index;
  }

  const vlanLists = {};
  for (let i = 0; i < parsed.length; i++) {
    vlanLists[i] = normaliseVlan(parsed[i].vlan, whereC + '.endpoints[' + i + ']', rep);
  }
  let doubleWidth = 1;
  for (const k of Object.keys(vlanLists)) {
    if (vlanLists[k].length > doubleWidth) doubleWidth = vlanLists[k].length;
  }
  if (doubleWidth > 1 && oldFns.length !== 1) {
    throw new MigrationError(
      whereC + ': a vlan_double endpoint expands one function into two, '
      + 'but this connection has ' + oldFns.length + ' functions. Split it by hand.');
  }

  const newFns = [];
  for (let fi = 0; fi < oldFns.length; fi++) {
    const fn = oldFns[fi];
    const whereF = whereC + '.functions[' + fi + ']';
    const kinded = functionKind(fn, whereF);
    const choice = kinded.choice, body = kinded.body;
    const reps = doubleWidth > 1 ? doubleWidth : 1;
    for (let repI = 0; repI < reps; repI++) {
      const whereR = reps === 1 ? whereF : whereF + '#' + repI;
      let newBody;
      if (TUNNEL_FUNCS[choice]) {
        const kind = TUNNEL_FUNCS[choice];
        newBody = migrateTunnelFunction(body, kind, whereR, rep);
        const vlan = vlanForFunction(parsed, vlanLists, fi, repI, doubleWidth, 'vlan');
        if (vlan != null) {
          if (!isObj(newBody.vlan_endpoint_settings)) newBody.vlan_endpoint_settings = {};
          newBody.vlan_endpoint_settings.vlan = vlan;
          rep.changed(whereR + ': endpoint VLAN -> vlan_endpoint_settings.vlan');
        }
      } else if (PASSTHROUGH_FUNCS[choice]) {
        newBody = clone(body);
        const ports = passthroughEndpoints(parsed);
        for (let slot = 0; slot < Math.min(ports.length, 2); slot++) {
          const p = ports[slot];
          const idx = parsed.indexOf(p);
          const opts = vlanLists[idx] || [];
          const vlan = (repI < opts.length) ? opts[repI] : (opts.length ? opts[0] : null);
          if (vlan == null) continue;
          const key = 'vlan_endpoint_settings_port' + (slot + 1);
          if (!isObj(newBody[key])) newBody[key] = {};
          newBody[key].vlan = cleanVlan(vlan);
          rep.changed(whereR + ': endpoints[' + idx + '] VLAN -> ' + key + '.vlan');
        }
      } else {
        throw new MigrationError(whereR + ': unknown function type ' + pyRepr(choice));
      }
      const wrapped = { choice: choice };
      wrapped[choice] = newBody;
      newFns.push(wrapped);
    }
  }

  const newEps = collapseEndpoints(parsed, newFns, whereC, rep);
  const out = {};
  for (const k of Object.keys(conn)) {
    if (k !== 'endpoints' && k !== 'functions') out[k] = conn[k];
  }
  out.endpoints = newEps;
  out.functions = newFns;
  return out;
}

function hoistRoutingOutOfProtocols(out, rep) {
  let moved = 0;
  const conns = out.connections || [];
  for (let ci = 0; ci < conns.length; ci++) {
    const fns = conns[ci].functions || [];
    for (let fi = 0; fi < fns.length; fi++) {
      const fn = fns[fi];
      for (const fkey of Object.keys(fn)) {
        const fval = fn[fkey];
        if (!isObj(fval)) continue;
        for (const skey of Object.keys(fval)) {
          const settings = fval[skey];
          if (!(isObj(settings) && /_endpoint_settings$/.test(skey))) continue;
          const pr = settings.protocols;
          if (!isObj(pr)) continue;
          for (const k of ROUTING_KEYS) {
            if (!(k in pr)) continue;
            if (k in settings) {
              rep.problem(
                'connections[' + ci + '].functions[' + fi + '].' + fkey + '.'
                + skey + ': \'' + k + '\' present both inside '
                + '`protocols` and on the parent; left alone');
              continue;
            }
            settings[k] = pr[k];
            delete pr[k];
            moved += 1;
          }
          if (!Object.keys(pr).length) delete settings.protocols;
        }
      }
    }
  }
  if (moved) {
    rep.changed('hoisted ' + moved + ' routing key(s) out of `protocols` onto '
      + 'their endpoint settings (UHD silently ignores them where '
      + 'they were)');
  }
}

function migrateMirrorTo(out, rep) {
  const fps = out.front_panel_ports;
  if (!Array.isArray(fps)) return;

  function numOf(entry) {
    const fp = entry.front_panel_port;
    return isObj(fp) ? fp.front_panel_port : null;
  }

  const byNum = {};
  for (const e of fps) {
    const n = numOf(e);
    if (typeof n === 'number' && Number.isInteger(n) && !(n in byNum)) byNum[n] = e.name;
  }
  const taken = {};
  for (const e of fps) taken[e.name] = 1;

  const added = [];
  let rewired = 0;
  for (const e of fps.slice()) {
    const fp = e.front_panel_port;
    if (!isObj(fp)) continue;
    const mt = fp.mirror_to;
    if (!isObj(mt)) continue;
    const n = mt.front_panel_port;
    if (!Number.isInteger(n)) {
      rep.problem('front_panel_ports \'' + e.name + '\': mirror_to is an '
        + 'object with no front_panel_port; left alone');
      continue;
    }
    if (n in byNum) {
      fp.mirror_to = byNum[n];
      rewired += 1;
      continue;
    }
    let name = !(('IxN' + n) in taken) ? ('IxN' + n) : ('mirror_target_' + n);
    while (name in taken) name += '_';
    const profile = fp.layer_1_profile_name;
    const entry = { name: name, choice: 'front_panel_port', front_panel_port: { front_panel_port: n } };
    if (profile) entry.front_panel_port.layer_1_profile_name = profile;
    for (const k of ['channel', 'num_channels']) {
      if (k in mt) entry.front_panel_port[k] = mt[k];
    }
    taken[name] = 1;
    byNum[n] = name;
    added.push([name, n, profile]);
    fp.mirror_to = name;
    rewired += 1;
    fps.push(entry);
  }

  if (rewired) {
    rep.changed('rewrote ' + rewired + ' mirror_to object(s) to port-name references');
  }
  for (const row of added) {
    rep.changed('declared mirror target \'' + row[0] + '\' (front panel port ' + row[1]
      + ', l1 profile \'' + row[2] + '\' inherited from the mirror source)');
  }
}

function migrateConfig(cfg, rep) {
  if (!isObj(cfg)) throw new MigrationError('top level of the config is not a JSON object');
  const out = clone(cfg);
  migrateMirrorTo(out, rep);
  if (out.connections == null) {
    rep.problem('no \'connections\' key -- nothing to migrate');
    return out;
  }
  out.connections = out.connections.map((c, i) => migrateConnection(c, i, rep));
  hoistRoutingOutOfProtocols(out, rep);
  return out;
}

function looksLikeHttp(text) {
  return HTTP_FIRST_LINE.test(String(text).replace(/^\s+/, '').split('\n', 1)[0]);
}

function splitLinesKeep(text) {
  const lines = [];
  const re = /[^\n]*\n|[^\n]+/g;
  let m;
  while ((m = re.exec(text))) lines.push(m[0]);
  return lines;
}

function splitHttp(text) {
  const lines = splitLinesKeep(text);
  let start = 0;
  while (start < lines.length
      && (!lines[start].trim() || lines[start].replace(/^\s+/, '').indexOf('###') === 0)) {
    start += 1;
  }
  if (start >= lines.length) throw new MigrationError('`.http` file has no request line');

  let bodyAt = null;
  for (let i = start + 1; i < lines.length; i++) {
    if (!lines[i].trim()) { bodyAt = i + 1; break; }
  }
  if (bodyAt == null) {
    throw new MigrationError('`.http` file has no blank line separating headers from the body');
  }

  let end = lines.length;
  for (let i = bodyAt; i < lines.length; i++) {
    const stripped = lines[i].replace(/^\s+/, '');
    if (stripped.indexOf('###') === 0 || HTTP_FIRST_LINE.test(stripped)) {
      end = i;
      break;
    }
  }
  return {
    head: lines.slice(0, bodyAt).join(''),
    body: lines.slice(bodyAt, end).join(''),
    tail: lines.slice(end).join('')
  };
}

const WIDTH = 150;
const DEPTH = 3;
const SIMILARITY = 0.3;

function lit(v) { return JSON.stringify(v); }

function nesting(v) {
  if (isObj(v)) {
    const vals = Object.keys(v).map(k => nesting(v[k]));
    return 1 + (vals.length ? Math.max.apply(null, vals) : 0);
  }
  if (Array.isArray(v)) {
    const vals = v.map(nesting);
    return 1 + (vals.length ? Math.max.apply(null, vals) : 0);
  }
  return 0;
}

function flat(v) {
  if (isObj(v)) {
    return '{' + Object.keys(v).map(k => lit(k) + ': ' + flat(v[k])).join(', ') + '}';
  }
  if (Array.isArray(v)) return '[' + v.map(flat).join(', ') + ']';
  return lit(v);
}

function table(values, col) {
  if (values.length < 2 || !values.every(v => isObj(v) && Object.keys(v).length)) return null;
  const keys = values.map(v => Object.keys(v));
  const union = {};
  for (const ks of keys) for (const k of ks) union[k] = 1;
  const unionN = Object.keys(union).length;
  let inter = keys[0].filter(k => keys.every(ks => ks.indexOf(k) >= 0));
  if (inter.length / unionN < SIMILARITY) return null;

  const rows = values.map(v => Object.keys(v).map(k => lit(k) + ': ' + flat(v[k])));
  const width = [];
  for (const r of rows) {
    for (let i = 0; i < r.length; i++) width[i] = Math.max(width[i] || 0, r[i].length);
  }
  const out = [];
  for (const r of rows) {
    let s = '';
    for (let i = 0; i < r.length; i++) {
      s += r[i];
      if (i !== r.length - 1) s += ',' + ' '.repeat(width[i] - r[i].length + 1);
    }
    out.push(s);
  }
  const span = Math.max.apply(null, out.map(s => s.length));
  if (col + span + 2 > WIDTH) return null;
  return out.map(s => '{' + s + ' '.repeat(span - s.length) + '}');
}

function fmt(v, col, ind) {
  const rowsOfObjects = Array.isArray(v) && v.length > 1 && v.every(isObj);
  if (!rowsOfObjects) {
    const f = flat(v);
    if (col + f.length <= WIDTH && nesting(v) <= DEPTH) return f;
  }
  const step = ind + '    ';
  if (isObj(v)) {
    const keys = Object.keys(v);
    const pad = Math.max.apply(null, keys.map(k => lit(k).length));
    const cells = table(keys.map(k => v[k]), step.length + pad + 2);
    const body = keys.map((k, i) => {
      const x = v[k];
      return step + lit(k) + ' '.repeat(pad - lit(k).length) + ': '
        + (cells ? cells[i] : fmt(x, step.length + pad + 2, step));
    });
    return '{\n' + body.join(',\n') + '\n' + ind + '}';
  }
  if (Array.isArray(v)) {
    const cells = table(v, step.length);
    const body = v.map((x, i) => step + (cells ? cells[i] : fmt(x, step.length, step)));
    return '[\n' + body.join(',\n') + '\n' + ind + ']';
  }
  return flat(v);
}

function dumps(cfg) { return fmt(cfg, 0, ''); }

function migrateText(raw, opts) {
  opts = opts || {};
  const fileName = opts.fileName || '';
  raw = String(raw || '').replace(/^\uFEFF/, '');
  const report = new Report();
  const isHttp = looksLikeHttp(raw) || /\.http$/i.test(fileName);
  try {
    let jsonText;
    let newText;
    if (isHttp) {
      const parts = splitHttp(raw);
      const cfg = JSON.parse(parts.body);
      jsonText = dumps(migrateConfig(cfg, report)) + '\n';
      newText = parts.head + jsonText;
      if (parts.tail.trim()) {
        report.changed('trailing request(s) after the config POST kept verbatim');
        newText += parts.tail;
      }
    } else {
      const cfg = JSON.parse(raw);
      jsonText = dumps(migrateConfig(cfg, report)) + '\n';
      newText = jsonText;
    }
    return { ok: true, text: newText, jsonText: jsonText, report: report, isHttp: isHttp, error: null };
  } catch (e) {
    let error;
    if (e instanceof MigrationError) error = e.message;
    else if (e instanceof SyntaxError) error = 'not valid JSON: ' + e.message;
    else error = String(e && e.message ? e.message : e);
    return { ok: false, text: '', jsonText: '', report: report, isHttp: isHttp, error: error };
  }
}

const api = {
  migrateConfig: migrateConfig,
  migrateText: migrateText,
  dumps: dumps,
  looksLikeHttp: looksLikeHttp,
  splitHttp: splitHttp,
  Report: Report,
  MigrationError: MigrationError
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.UHDMigrate = api;

})(typeof globalThis !== 'undefined' ? globalThis : this);
