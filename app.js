'use strict';
/* UHD Connect Visualizer
 * Authors and visualizes UHD Connect JSON configs. Offline only: no device calls.
 * The parsed JSON object is the single source of truth and is mutated in place,
 * so fields this UI does not author (mirror_to, PFC, pause, ...) survive edits.
 */

/* ------------------------------------------------------------------ model tables */

const PORT_COUNT = 32;
const COLS = 16;
const ROWS = 2;

const NAME_RE = /^[\sa-zA-Z0-9\-_()><\[\]]+$/;
const MAC_RE = /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/;
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(\/\d{1,2})?$/;
const IPV6_RE = /^[0-9a-fA-F:]{2,}(\/\d{1,3})?$/;

const SPEEDS = ['speed_10_gbps', 'speed_25_gbps', 'speed_100_gbps', 'speed_200_gbps', 'speed_400_gbps'];
const SPEED_LABEL = {
  speed_10_gbps: '10G', speed_25_gbps: '25G', speed_100_gbps: '100G',
  speed_200_gbps: '200G', speed_400_gbps: '400G'
};
const FECS = ['none', 'reed_solomon', 'firecode'];
const FEC_LABEL = { none: 'no FEC', reed_solomon: 'Reed Solomon', firecode: 'Firecode' };
const L1_CHOICES = ['autonegotiation', 'manual'];

/* Function types. `authored` types can be created and edited here; others (connect_ip)
 * are preserved in JSON and shown read-only. tag1/tag2 drive endpoint tag derivation. */
const FN = {
  connect_ethernet: { label: 'Ethernet', nameLabel: 'Ethernet', short: 'Eth', cls: 't-eth', authored: true, tag1: null, tag2: null,
    blurb: 'Passthrough, VLAN translation or untagged. Samples: passthrough_single_symmetric / _translation / _non_vlan.' },
  connect_arp: { label: 'ARP', nameLabel: 'ARP', short: 'ARP', cls: 't-arp', authored: true, tag1: 'vlan', tag2: 'vlan',
    blurb: 'ARP bypass. Add a second ARP function for Q-in-Q. Samples: passthrough_qinq_symmetric / _asymmetric / _partial_strip.' },
  connect_vlan_vxlan: { label: 'VLAN \u2194 VXLAN', nameLabel: 'VLAN to VXLAN', short: 'VXLAN', cls: 't-vxlan', authored: true, tag1: 'vlan', tag2: 'vxlan',
    blurb: 'Re-encapsulate VLAN as VXLAN. Samples: encap_single_vlan_vxlan, encap_double_vxlan_vxlan.' },
  connect_vlan_nvgre: { label: 'VLAN \u2194 NVGRE', nameLabel: 'VLAN to NVGRE', short: 'NVGRE', cls: 't-nvgre', authored: true, tag1: 'vlan', tag2: 'nvgre',
    blurb: 'Re-encapsulate VLAN as NVGRE. Samples: encap_single_vlan_nvgre, encap_double_nvgre_nvgre.' },
  connect_ip: { label: 'IP', nameLabel: 'IP', short: 'IP', cls: 't-ip', authored: false, tag1: null, tag2: null,
    blurb: 'Not authored here (no sample uses it). Preserved in JSON.' }
};
const FN_CHOICES = Object.keys(FN);
const AUTHORED_FNS = FN_CHOICES.filter(k => FN[k].authored);

/* Placeholders come from docs/samples so the expected format is always a real example:
 * vx from encap_single_vlan_vxlan, nv from encap_single_vlan_nvgre. */
const SAMPLE = {
  profileName: 'manual_400g_rs',
  vlan: '101', ethertype: '65535', udpDstPort: 4789, mac: '80:09:02:01:00:02',
  vx: { sample: 'encap_single_vlan_vxlan', id: '7001', srcMac: '80:09:02:01:00:02', dstMac: '00:50:f2:88:00:01', srcIp: '225.3.0.1', dstIp: '225.0.0.3' },
  nv: { sample: 'encap_single_vlan_nvgre', id: '8001', srcMac: '80:09:02:01:00:03', dstMac: '00:50:f2:88:00:02', srcIp: '225.4.0.1', dstIp: '225.0.0.4', flowId: '0' }
};

/* Port block as a percentage of the chassis image, measured from the openings in
 * UHDSchematic.png (32 openings, 16 columns, 2 rows).
 * padX/padY inset each cage inside its cell; the cages are drawn a little larger
 * than the openings so they are comfortable click targets.
 * cropTop/cropH are image pixels: only the faceplate band is shown, not the lid.
 * Adjust any of it live with the "Align grid" toggle. */
const IMG_W = 976, IMG_H = 508;
const GEOM = { x: 8.99, y: 51.92, w: 86.2, h: 13.62, padX: 8, padY: 12, cropTop: 244, cropH: 110 };
const WRAP_MAX = 1180, WRAP_MIN = 640;
const ZOOM_MIN = 0.75, ZOOM_MAX = 2.5, ZOOM_STEP = 0.25;

/* ------------------------------------------------------------------ tiny helpers */

const $ = sel => document.querySelector(sel);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const isObj = o => o !== null && typeof o === 'object' && !Array.isArray(o);

function getPath(root, path) {
  let cur = root;
  for (const seg of String(path).split('.')) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}
function setPath(root, path, value) {
  const segs = String(path).split('.');
  let cur = root;
  for (let i = 0; i < segs.length - 1; i++) {
    if (!isObj(cur[segs[i]]) && !Array.isArray(cur[segs[i]])) cur[segs[i]] = {};
    cur = cur[segs[i]];
  }
  cur[segs[segs.length - 1]] = value;
}
function delPath(root, path) {
  const segs = String(path).split('.');
  let cur = root;
  for (let i = 0; i < segs.length - 1; i++) {
    cur = cur[segs[i]];
    if (cur == null) return;
  }
  delete cur[segs[segs.length - 1]];
}
function serialize(cfg) { return JSON.stringify(cfg, null, 2) + '\n'; }
function emptyConfig() { return { profiles: { layer_1_profiles: [] }, front_panel_ports: [], connections: [] }; }

/* Column-paired numbering: column 1 is port 1 (top) / 2 (bottom), column 16 is 31/32. */
function portToCell(n) { return { col: Math.floor((n - 1) / 2), row: (n - 1) % 2 }; }

/* ------------------------------------------------------------------ state */

const state = {
  config: emptyConfig(),
  jsonValid: true,
  jsonErrors: [],
  meta: null,
  warnings: [],
  sel: { kind: 'none' },
  hover: null,
  draft: null,     // { p1, p2, choice, data }
  drag: null,      // { fromNum, x, y }
  fileName: null,
  dirty: false,
  scratch: false,  // user dismissed the empty state
  align: false,
  showNames: true,
  showOutside: true,
  connQuery: '',
  connShown: null,     // null = every connection; Set of indices otherwise
  connMenuOpen: false,
  groupPick: null,     // { nums, profileName, groupName, newProfile } while picking group members
  zoom: 1
};

/* ------------------------------------------------------------------ derivations */

function profiles() { return getPath(state.config, 'profiles.layer_1_profiles') || []; }
function ports() { return state.config.front_panel_ports || []; }
function connections() { return state.config.connections || []; }

/* ------------------------------------------------------------------ outside entities
 * What a port connects to outside the box. The UHDConnect schema has nowhere to put
 * this, so overrides live under one clearly marked top-level key that the device
 * config ignores. The key is written only when something is actually customised, and
 * removed again when the last override goes, so untouched files stay byte-identical. */

const X_KEY = 'x_visualizer';
const X_NOTE = 'Display-only metadata from the UHD Connect Visualizer. The UHD ignores it.';
const OUTSIDE_KINDS = ['', 'nic', 'server', 'switch', 'router', 'tester', 'appliance'];
const OUTSIDE_KIND_LABEL = {
  '': 'unspecified', nic: 'NIC', server: 'server', switch: 'switch',
  router: 'router', tester: 'test port', appliance: 'appliance'
};
/* short form for the tag drawn in the box, where width is scarce */
const OUTSIDE_KIND_TAG = {
  nic: 'nic', server: 'srv', switch: 'sw', router: 'rtr', tester: 'test', appliance: 'appl'
};

function outsideMap() {
  const x = state.config[X_KEY];
  const m = isObj(x) && isObj(x.outside) ? x.outside : null;
  return m || {};
}
/* The box as drawn: the stored override on top of the port name it defaults to. */
function outsideOf(name) {
  const raw = outsideMap()[name];
  const o = isObj(raw) ? raw : {};
  const custom = isObj(raw) && (typeof o.label === 'string' || typeof o.kind === 'string' || o.hidden === true);
  return {
    name,
    label: typeof o.label === 'string' && o.label.trim() ? o.label : name,
    kind: OUTSIDE_KINDS.includes(o.kind) ? o.kind : '',
    hidden: o.hidden === true,
    note: typeof o.note === 'string' ? o.note : '',
    custom
  };
}
function setOutside(name, patch) {
  if (!isObj(state.config[X_KEY])) state.config[X_KEY] = { _comment: X_NOTE };
  const x = state.config[X_KEY];
  if (!isObj(x.outside)) x.outside = {};
  const cur = isObj(x.outside[name]) ? x.outside[name] : {};
  const next = Object.assign({}, cur, patch);
  for (const k of Object.keys(next)) {
    const v = next[k];
    if (v === '' || v === null || v === undefined || v === false) delete next[k];
  }
  if (Object.keys(next).length) x.outside[name] = next;
  else delete x.outside[name];
  pruneOutside();
}
function renameOutside(from, to) {
  const m = outsideMap();
  if (!isObj(m[from])) return;
  const x = state.config[X_KEY];
  x.outside[to] = x.outside[from];
  delete x.outside[from];
}
function pruneOutside() {
  const x = state.config[X_KEY];
  if (!isObj(x)) return;
  if (isObj(x.outside) && !Object.keys(x.outside).length) delete x.outside;
  const left = Object.keys(x).filter(k => k !== '_comment');
  if (!left.length) delete state.config[X_KEY];
}

/* Cage / object identity. A cage can be a plain port, the first port of a group
 * (the anchor, where connections attach), or a further member of a group - and with
 * overlapping groups it can be several of those at once. */
function idx() {
  if (!state.meta || !state.meta.objByName) revalidate();
  return state.meta;
}
function objInfo(name) { return idx().objByName.get(name) || null; }
function occupants(num) { return idx().cages.get(num) || []; }
function isAssigned(num) { return occupants(num).length > 0; }
function primaryOccupant(num) { return occupants(num)[0] || null; }
function portEntryByNum(n) {
  const o = occupants(n).find(x => x.kind === 'port');
  return o ? o.entry : null;
}
/* The cage a connection endpoint attaches to: for a group, its first port. */
function anchorNumOf(name) {
  const o = objInfo(name);
  return o ? o.anchorNum : null;
}
function memberNumsOf(name) {
  const o = objInfo(name);
  return o ? o.memberNums : [];
}
/* "P25" for a plain port, "P11+12" for a group: the main port first, the rest mentioned. */
function portLabel(name) {
  const o = objInfo(name);
  if (!o || !o.memberNums.length) return name || '?';
  return 'P' + o.memberNums.join('+');
}
/* Connection-sheet cell: cage numbers plus the group name, so two groups
 * that share cages (or reverse each other) stay distinguishable. */
function sheetEndLabel(name) {
  const ports = portLabel(name);
  return isGroup(name) ? ports + '  ' + name : ports;
}
/* Names go into the JSON, so they must stay inside the API's name pattern (no '+'). */
function safeLabel(num) { return 'P' + num; }
function isGroup(name) {
  const o = objInfo(name);
  return !!o && o.kind === 'group';
}
function groupOf(name) {
  const o = objInfo(name);
  return o && o.kind === 'group' ? o : null;
}
function connIndicesForObject(name) {
  const out = [];
  connections().forEach((c, i) => {
    if ((c.endpoints || []).some(ep => ep && ep.port_name === name)) out.push(i);
  });
  return out;
}
/* Every connection that touches this cage, through a plain port or through any group. */
function connIndicesForCage(num) {
  const names = new Set(occupants(num).map(o => o.name));
  if (!names.size) return [];
  const out = [];
  connections().forEach((c, i) => {
    if ((c.endpoints || []).some(ep => ep && names.has(ep.port_name))) out.push(i);
  });
  return out;
}
/* Which object a drag from this cage should use as its endpoint. */
function dragObjectForCage(num) {
  const o = primaryOccupant(num);
  return o ? o.name : null;
}
/* Every cage a connection lights up, groups expanded. */
function cagesOfConnection(c) {
  const out = [];
  for (const ep of (c && c.endpoints) || []) {
    for (const n of memberNumsOf(ep && ep.port_name)) out.push(n);
  }
  return out;
}

function deriveTags(conn) {
  const t1 = [], t2 = [];
  for (const fn of conn.functions || []) {
    const d = FN[fn && fn.choice];
    if (!d) continue;
    if (d.tag1) t1.push(d.tag1);
    if (d.tag2) t2.push(d.tag2);
  }
  return [t1, t2];
}
/* Applied only to a connection the UI just edited. */
function applyTags(conn) {
  const eps = conn.endpoints || [];
  if (eps.length !== 2) return;
  const [t1, t2] = deriveTags(conn);
  [t1, t2].forEach((tags, i) => {
    if (!eps[i]) return;
    if (tags.length) eps[i].tags = tags; else delete eps[i].tags;
  });
}

function vlanText(v) {
  if (!v || !v.choice || v.choice === 'non_vlan') return 'untagged';
  if (v.choice === 'vlan') return v.vlan == null ? 'VLAN \u2014' : 'VLAN ' + v.vlan;
  if (v.choice === 'vlan_range') {
    const r = v.vlan_range || {};
    return 'VLAN ' + (r.start == null ? '\u2014' : r.start) + (r.count ? '+' + r.count : '');
  }
  return 'untagged';
}
function idText(o, single, range, word) {
  if (!o || !o.choice) return word + ' \u2014';
  if (o.choice === single) return word + ' ' + (o[single] == null ? '\u2014' : o[single]);
  const r = o[range] || {};
  return word + ' ' + (r.start == null ? '\u2014' : r.start) + (r.count ? '+' + r.count : '');
}

function fnSegment(fn) {
  const c = fn && fn.choice, b = (fn && fn[c]) || {};
  if (c === 'connect_ethernet') {
    const a = vlanText(getPath(b, 'vlan_endpoint_settings_port1.vlan'));
    const z = vlanText(getPath(b, 'vlan_endpoint_settings_port2.vlan'));
    const et = Array.isArray(b.ethertypes) && b.ethertypes.length ? ' [ethertype ' + b.ethertypes.join(', ') + ']' : '';
    return 'Eth ' + a + ' \u2192 ' + z + et;
  }
  if (c === 'connect_arp') {
    return 'ARP ' + vlanText(getPath(b, 'vlan_endpoint_settings_port1.vlan')) + ' \u2192 ' + vlanText(getPath(b, 'vlan_endpoint_settings_port2.vlan'));
  }
  if (c === 'connect_vlan_vxlan') {
    return vlanText(getPath(b, 'vlan_endpoint_settings.vlan')) + ' \u2192 VXLAN ' + idText(getPath(b, 'vxlan_endpoint_settings.vni'), 'vni', 'vni_range', 'VNI');
  }
  if (c === 'connect_vlan_nvgre') {
    return vlanText(getPath(b, 'vlan_endpoint_settings.vlan')) + ' \u2192 NVGRE ' + idText(getPath(b, 'nvgre_endpoint_settings.vsid'), 'vsid', 'vsid_range', 'VSID');
  }
  if (c === 'connect_ip') {
    return 'IP ' + vlanText(getPath(b, 'vlan_endpoint_settings_port1.vlan')) + ' \u2192 ' + vlanText(getPath(b, 'vlan_endpoint_settings_port2.vlan'));
  }
  return c || 'unknown function';
}
function pipelineHtml(conn) {
  const eps = conn.endpoints || [];
  const a = eps[0] ? portLabel(eps[0].port_name) : '?';
  const z = eps.length > 2
    ? eps.slice(1).map(e => portLabel(e.port_name)).join(' + ')
    : (eps[1] ? portLabel(eps[1].port_name) : '?');
  const segs = (conn.functions || []).map(f => esc(fnSegment(f)))
    .join('<span class="arw"> + </span>');
  return '<span class="p">' + esc(a) + '</span> <span class="arw">\u00b7</span> '
    + (segs || '<span class="arw">no functions</span>')
    + ' <span class="arw">\u00b7</span> <span class="p">' + esc(z) + '</span>';
}

function fnChips(conn) {
  const counts = new Map();
  for (const f of conn.functions || []) {
    const k = f && f.choice;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const out = [];
  for (const [k, n] of counts) {
    const d = FN[k];
    out.push({ text: (d ? d.short : String(k)) + (n > 1 ? '\u00d7' + n : ''), unknown: !d });
  }
  return out;
}
function wireBadge(conn) { return fnChips(conn).map(c => c.text).join('+'); }
function wireClass(conn) {
  const first = (conn.functions || []).find(f => f && FN[f.choice]);
  return first ? FN[first.choice].cls : 't-eth';
}

/* ------------------------------------------------------------------ validation */

function validate(cfg) {
  const errors = [];
  const meta = {
    profileNames: new Set(), portByName: new Map(), portByNum: new Map(),
    readOnly: new Set(), breakout: false, connNames: new Set(),
    nameIssues: [],
    /* objByName: every front_panel_ports entry, plain port or group, keyed by the name
     * connections reference. cages: front-panel port number -> what occupies that cage. */
    objByName: new Map(), cages: new Map()
  };
  const claim = (num, occ) => {
    if (!Number.isInteger(num)) return;
    if (!meta.cages.has(num)) meta.cages.set(num, []);
    meta.cages.get(num).push(occ);
  };
  if (!isObj(cfg)) {
    errors.push('Top level must be a JSON object with profiles, front_panel_ports and connections.');
    return { errors, meta };
  }

  const pr = cfg.profiles;
  if (pr !== undefined) {
    if (!isObj(pr)) errors.push('profiles must be an object.');
    else if (pr.layer_1_profiles !== undefined) {
      if (!Array.isArray(pr.layer_1_profiles)) errors.push('profiles.layer_1_profiles must be an array.');
      else pr.layer_1_profiles.forEach((p, i) => {
        const at = 'profiles.layer_1_profiles[' + i + ']';
        if (!isObj(p)) { errors.push(at + ' must be an object.'); return; }
        if (typeof p.name !== 'string' || !p.name.trim()) errors.push(at + '.name is required.');
        else if (meta.profileNames.has(p.name)) errors.push(at + '.name "' + p.name + '" is used by another profile.');
        else meta.profileNames.add(p.name);
        if (p.link_speed !== undefined && !SPEEDS.includes(p.link_speed)) errors.push(at + '.link_speed "' + p.link_speed + '" is not a supported speed.');
        if (p.choice !== undefined && !L1_CHOICES.includes(p.choice)) errors.push(at + '.choice must be autonegotiation or manual.');
        L1_CHOICES.forEach(k => {
          const blk = p[k];
          if (isObj(blk) && blk.fec_mode !== undefined && !FECS.includes(blk.fec_mode)) errors.push(at + '.' + k + '.fec_mode "' + blk.fec_mode + '" is not a supported FEC mode.');
        });
      });
    }
  }

  const fps = cfg.front_panel_ports;
  if (fps !== undefined) {
    if (!Array.isArray(fps)) errors.push('front_panel_ports must be an array.');
    else fps.forEach((e, i) => {
      const at = 'front_panel_ports[' + i + ']';
      if (!isObj(e)) { errors.push(at + ' must be an object.'); return; }
      if (typeof e.name !== 'string' || !e.name.trim()) errors.push(at + '.name is required.');
      else if (meta.portByName.has(e.name)) errors.push(at + '.name "' + e.name + '" is used by another port.');
      else if (!NAME_RE.test(e.name)) meta.nameIssues.push(at + '.name "' + e.name + '" uses characters outside the documented name pattern.');
      const choice = e.choice || 'front_panel_port';
      if (!['front_panel_port', 'port_group'].includes(choice)) errors.push(at + '.choice must be front_panel_port or port_group.');
      if (choice === 'port_group') {
        if (typeof e.name === 'string') meta.portByName.set(e.name, { entry: e, index: i, group: true });
        const g = e.port_group;
        if (!isObj(g)) { errors.push(at + '.port_group must be an object.'); return; }
        if (g.ingress_distribution !== undefined && !['split', 'copy'].includes(g.ingress_distribution)) {
          errors.push(at + '.port_group.ingress_distribution must be split or copy.');
        }
        if (!Array.isArray(g.ports) || g.ports.length === 0) {
          errors.push(at + '.port_group.ports must be an array with at least one port.');
          return;
        }
        const nums = [];
        g.ports.forEach((m, k) => {
          const mat = at + '.port_group.ports[' + k + ']';
          if (!isObj(m)) { errors.push(mat + ' must be an object.'); return; }
          const n = m.front_panel_port;
          if (!Number.isInteger(n) || n < 1 || n > PORT_COUNT) errors.push(mat + '.front_panel_port must be an integer from 1 to 32.');
          if (typeof m.layer_1_profile_name !== 'string' || !m.layer_1_profile_name) errors.push(mat + ' needs a layer_1_profile_name.');
          else if (!meta.profileNames.has(m.layer_1_profile_name)) errors.push(mat + '.layer_1_profile_name "' + m.layer_1_profile_name + '" does not match any Layer 1 profile.');
          if (m.channel !== undefined && m.channel !== 1) {
            meta.breakout = true;
            errors.push(mat + ': channel ' + m.channel + ' is a breakout channel. This tool does not support breakout.');
          }
          if (m.num_channels !== undefined && m.num_channels !== 0) {
            meta.breakout = true;
            errors.push(mat + ': num_channels ' + m.num_channels + ' is a breakout setting. This tool does not support breakout.');
          }
          if (!Number.isInteger(n)) return;
          if (nums.includes(n)) { errors.push(mat + ': front-panel port ' + n + ' is already in this group.'); return; }
          nums.push(n);
          claim(n, { name: e.name, kind: k === 0 ? 'anchor' : 'member', entry: e, index: i, memberIndex: k, rank: k === 0 ? 1 : 2 });
        });
        if (typeof e.name === 'string') {
          meta.objByName.set(e.name, {
            name: e.name, kind: 'group', entry: e, index: i,
            anchorNum: nums[0] == null ? null : nums[0], memberNums: nums
          });
        }
        return;
      }
      const fp = e.front_panel_port;
      if (!isObj(fp)) { errors.push(at + '.front_panel_port must be an object.'); return; }
      const n = fp.front_panel_port;
      if (!Number.isInteger(n) || n < 1 || n > PORT_COUNT) errors.push(at + '.front_panel_port.front_panel_port must be an integer from 1 to 32.');
      if (typeof fp.layer_1_profile_name !== 'string' || !fp.layer_1_profile_name) errors.push(at + ' needs a layer_1_profile_name.');
      else if (!meta.profileNames.has(fp.layer_1_profile_name)) errors.push(at + '.layer_1_profile_name "' + fp.layer_1_profile_name + '" does not match any Layer 1 profile.');
      if (fp.channel !== undefined && fp.channel !== 1) {
        meta.breakout = true;
        errors.push(at + ': channel ' + fp.channel + ' is a breakout channel. This tool does not support breakout.');
      }
      if (fp.num_channels !== undefined && fp.num_channels !== 0) {
        meta.breakout = true;
        errors.push(at + ': num_channels ' + fp.num_channels + ' is a breakout setting. This tool does not support breakout.');
      }
      if (Number.isInteger(n)) {
        if (meta.portByNum.has(n)) {
          meta.breakout = true;
          errors.push(at + ': front-panel port ' + n + ' is already used by "' + meta.portByNum.get(n).entry.name + '". Several entries on one port is breakout, which this tool does not support.');
        } else meta.portByNum.set(n, { entry: e, index: i });
      }
      if (typeof e.name === 'string') {
        meta.portByName.set(e.name, { entry: e, index: i, num: n });
        meta.objByName.set(e.name, {
          name: e.name, kind: 'port', entry: e, index: i,
          anchorNum: Number.isInteger(n) ? n : null, memberNums: Number.isInteger(n) ? [n] : []
        });
        claim(n, { name: e.name, kind: 'port', entry: e, index: i, rank: 0 });
      }
    });
    for (const occ of meta.cages.values()) occ.sort((a, b) => a.rank - b.rank);
  }

  const cs = cfg.connections;
  if (cs !== undefined) {
    if (!Array.isArray(cs)) errors.push('connections must be an array.');
    else cs.forEach((c, i) => {
      const at = 'connections[' + i + ']';
      if (!isObj(c)) { errors.push(at + ' must be an object.'); return; }
      if (typeof c.name !== 'string' || !c.name.trim()) errors.push(at + '.name is required.');
      else if (meta.connNames.has(c.name)) errors.push(at + '.name "' + c.name + '" is used by another connection.');
      else {
        if (!NAME_RE.test(c.name)) meta.nameIssues.push(at + '.name "' + c.name + '" uses characters outside the documented name pattern.');
        meta.connNames.add(c.name);
      }

      let ro = false;
      const eps = c.endpoints;
      if (!Array.isArray(eps) || eps.length < 2) {
        errors.push(at + '.endpoints must be an array of at least two endpoints.');
        ro = true;
      } else {
        if (eps.length > 2) ro = true;
        eps.forEach((ep, j) => {
          if (!isObj(ep)) { errors.push(at + '.endpoints[' + j + '] must be an object.'); ro = true; return; }
          if (typeof ep.port_name !== 'string' || !ep.port_name) { errors.push(at + '.endpoints[' + j + '].port_name is required.'); ro = true; return; }
          const p = meta.objByName.get(ep.port_name);
          if (!p) { errors.push(at + '.endpoints[' + j + '].port_name "' + ep.port_name + '" does not match any front_panel_ports entry.'); ro = true; }
          else if (p.anchorNum == null) ro = true;   // nothing to anchor the wire to
          if (ep.tags !== undefined && !Array.isArray(ep.tags)) { errors.push(at + '.endpoints[' + j + '].tags must be an array.'); ro = true; }
        });
      }

      const fns = c.functions;
      if (!Array.isArray(fns) || fns.length === 0) {
        errors.push(at + '.functions must be an array with at least one function.');
        ro = true;
      } else fns.forEach((f, j) => {
        const fat = at + '.functions[' + j + ']';
        if (!isObj(f)) { errors.push(fat + ' must be an object.'); ro = true; return; }
        if (!FN_CHOICES.includes(f.choice)) { errors.push(fat + '.choice "' + f.choice + '" is not a known function type.'); ro = true; return; }
        if (!FN[f.choice].authored) ro = true;
        const b = f[f.choice];
        if (b !== undefined && !isObj(b)) { errors.push(fat + '.' + f.choice + ' must be an object.'); ro = true; return; }
        if (f.choice === 'connect_vlan_vxlan') {
          if (!isObj(b) || !isObj(b.vlan_endpoint_settings)) errors.push(fat + '.connect_vlan_vxlan.vlan_endpoint_settings is required.');
          if (!isObj(b) || !isObj(b.vxlan_endpoint_settings)) errors.push(fat + '.connect_vlan_vxlan.vxlan_endpoint_settings is required.');
          else if (!isObj(b.vxlan_endpoint_settings.vni)) errors.push(fat + '.connect_vlan_vxlan.vxlan_endpoint_settings.vni is required.');
        }
        if (f.choice === 'connect_vlan_nvgre') {
          if (!isObj(b) || !isObj(b.vlan_endpoint_settings)) errors.push(fat + '.connect_vlan_nvgre.vlan_endpoint_settings is required.');
          if (!isObj(b) || !isObj(b.nvgre_endpoint_settings)) errors.push(fat + '.connect_vlan_nvgre.nvgre_endpoint_settings is required.');
          else if (!isObj(b.nvgre_endpoint_settings.vsid)) errors.push(fat + '.connect_vlan_nvgre.nvgre_endpoint_settings.vsid is required.');
        }
      });
      if (ro) meta.readOnly.add(i);
    });
  }
  return { errors, meta };
}

function vlanKey(v) {
  if (!v || !v.choice || v.choice === 'non_vlan') return 'untagged traffic';
  if (v.choice === 'vlan') return 'VLAN ' + v.vlan;
  const r = v.vlan_range || {};
  return 'VLAN range ' + r.start + ' +' + (r.count || 0);
}
/* Match key for a tunnel id, phrased for the warning that prints it. */
function tunnelKey(label, v, single) {
  if (!v || !v.choice) return label + ' unset';
  if (v.choice === single) return label + ' ' + v[single];
  const r = v[v.choice] || {};
  return label + ' range ' + r.start + ' +' + (r.count || 0);
}

function computeWarnings(cfg, meta) {
  const w = [];
  for (const issue of meta.nameIssues || []) {
    w.push({ text: issue + ' The device may still accept it (docs/samples/passthrough_single_non_vlan does this), so it is not blocked \u2014 but names created here stay inside the pattern.', sel: null });
  }
  // the visualizer's own display key: never fatal, but say when it does not line up
  const x = cfg[X_KEY];
  if (x !== undefined && !isObj(x)) {
    w.push({ text: X_KEY + ' is display-only metadata this tool writes and expects to be an object. It is ignored and left in the file untouched.', sel: null });
  } else if (isObj(x) && x.outside !== undefined && !isObj(x.outside)) {
    w.push({ text: X_KEY + '.outside should be an object keyed by port name. It is ignored and left in the file untouched.', sel: null });
  } else if (isObj(x) && isObj(x.outside)) {
    for (const key of Object.keys(x.outside)) {
      if (!meta.objByName.has(key)) {
        w.push({ text: 'Outside box "' + key + '" is saved under ' + X_KEY + ' but no front_panel_ports entry has that name, so no box is drawn. It stays in the file.', sel: null });
      }
    }
  }
  const usedProfiles = profileUsage();
  for (const p of profiles()) {
    if (p && p.name && !usedProfiles.has(p.name)) {
      w.push({ text: 'Layer 1 profile "' + p.name + '" is not used by any port.', sel: { kind: 'profile', name: p.name } });
    }
  }
  const conns = connections();
  const usedObjects = new Set();
  conns.forEach(c => (c.endpoints || []).forEach(ep => { if (ep && ep.port_name) usedObjects.add(ep.port_name); }));
  for (const o of meta.objByName.values()) {
    if (usedObjects.has(o.name) || o.anchorNum == null) continue;
    const what = o.kind === 'group'
      ? 'Port group "' + o.name + '" (' + o.memberNums.map(n => 'P' + n).join(' + ') + ')'
      : 'Port ' + o.anchorNum + ' ("' + o.name + '")';
    w.push({ text: what + ' is assigned but not used by any connection.', sel: { kind: 'port', num: o.anchorNum } });
  }
  for (const [num, occ] of meta.cages) {
    if (occ.some(o => o.kind === 'port') && occ.some(o => o.kind !== 'port')) {
      w.push({
        text: 'Port ' + num + ' is claimed both directly by "' + occ.find(o => o.kind === 'port').name
          + '" and by port group "' + occ.find(o => o.kind !== 'port').name + '". The device expects one owner per front-panel port.',
        sel: { kind: 'port', num }
      });
    }
  }
  // overlapping match keys on the same port
  const perPort = new Map();
  conns.forEach((c, ci) => {
    const eps = c.endpoints || [];
    if (eps.length !== 2) return;
    (c.functions || []).forEach(f => {
      if (!f || !FN[f.choice]) return;
      const b = f[f.choice] || {};
      let k1, k2;
      if (f.choice === 'connect_vlan_vxlan') {
        k1 = f.choice + '|' + vlanKey(getPath(b, 'vlan_endpoint_settings.vlan'));
        k2 = f.choice + '|' + tunnelKey('VNI', getPath(b, 'vxlan_endpoint_settings.vni'), 'vni');
      } else if (f.choice === 'connect_vlan_nvgre') {
        k1 = f.choice + '|' + vlanKey(getPath(b, 'vlan_endpoint_settings.vlan'));
        k2 = f.choice + '|' + tunnelKey('VSID', getPath(b, 'nvgre_endpoint_settings.vsid'), 'vsid');
      } else {
        k1 = f.choice + '|' + vlanKey(getPath(b, 'vlan_endpoint_settings_port1.vlan'));
        k2 = f.choice + '|' + vlanKey(getPath(b, 'vlan_endpoint_settings_port2.vlan'));
      }
      [[eps[0], k1], [eps[1], k2]].forEach(([ep, k]) => {
        if (!ep || !ep.port_name) return;
        if (!perPort.has(ep.port_name)) perPort.set(ep.port_name, new Map());
        const m = perPort.get(ep.port_name);
        if (!m.has(k)) m.set(k, new Set());
        m.get(k).add(ci);
      });
    });
  });
  for (const [pname, m] of perPort) {
    for (const [k, set] of m) {
      if (set.size > 1) {
        const names = [...set].map(i => '"' + (conns[i] && conns[i].name) + '"').join(' and ');
        w.push({
          text: portLabel(pname) + ' ("' + pname + '"): ' + k.split('|')[1]
            + ' is matched by ' + set.size + ' connections (' + names + '). The device needs each connection on a port to carry unique traffic.',
          sel: { kind: 'connection', idx: [...set][0] }
        });
      }
    }
  }
  conns.forEach((c, i) => {
    if (meta.readOnly.has(i)) {
      const eps = (c.endpoints || []).length;
      let why = [];
      if (eps > 2) why.push(eps + ' endpoints');
      if ((c.endpoints || []).some(ep => ep && !meta.objByName.has(ep.port_name))) why.push('a port name with no matching front_panel_ports entry');
      if ((c.endpoints || []).some(ep => { const o = meta.objByName.get(ep && ep.port_name); return o && o.anchorNum == null; })) why.push('a port group with no valid front-panel port');
      if ((c.functions || []).some(f => f && FN[f.choice] && !FN[f.choice].authored)) why.push('a ' + (c.functions.find(f => f && FN[f.choice] && !FN[f.choice].authored).choice) + ' function');
      w.push({ text: 'Connection "' + c.name + '" uses ' + (why.join(' and ') || 'a shape this UI cannot author') + '. It is read-only here \u2014 edit it in the JSON pane.', sel: { kind: 'connection', idx: i } });
    } else {
      const [t1, t2] = deriveTags(c);
      const eps = c.endpoints || [];
      const cur1 = (eps[0] && eps[0].tags) || [], cur2 = (eps[1] && eps[1].tags) || [];
      if (JSON.stringify(cur1) !== JSON.stringify(t1) || JSON.stringify(cur2) !== JSON.stringify(t2)) {
        w.push({
          text: 'Connection "' + c.name + '" has endpoint tags that differ from the tags its functions imply ('
            + (t1.length ? '[' + t1.join(', ') + '] / [' + t2.join(', ') + ']' : 'no tags')
            + '). Editing this connection here will rewrite them.',
          sel: { kind: 'connection', idx: i }
        });
      }
    }
    (c.functions || []).forEach(f => {
      if (!f || !FN[f.choice]) return;
      const b = f[f.choice] || {};
      ['vlan_endpoint_settings_port1.vlan', 'vlan_endpoint_settings_port2.vlan', 'vlan_endpoint_settings.vlan'].forEach(p => {
        const v = getPath(b, p);
        if (v && v.choice === 'vlan' && v.vlan == null) {
          w.push({ text: 'Connection "' + c.name + '": ' + p + ' is set to a single VLAN but has no VLAN ID.', sel: { kind: 'connection', idx: i } });
        }
      });
    });
  });
  return w;
}

/* ------------------------------------------------------------------ JSON <-> canvas sync */

let jsonTimer = null;
const jsonEl = () => $('#jsonText');

function revalidate() {
  const v = validate(state.config);
  state.meta = v.meta;
  state.warnings = v.errors.length ? [] : computeWarnings(state.config, v.meta);
  return v;
}

/* Called after any UI-driven mutation: rewrite JSON text from the config. */
function commit(markDirty) {
  if (markDirty !== false) state.dirty = true;
  revalidate();
  state.jsonValid = true;
  state.jsonErrors = [];
  render(true);
}

function onJsonInput() {
  clearTimeout(jsonTimer);
  jsonTimer = setTimeout(applyJsonText, 220);
}

function applyJsonText() {
  const text = jsonEl().value;
  state.dirty = true;
  if (state.groupPick) state.groupPick = null;
  if (!text.trim()) {
    state.jsonValid = false;
    state.jsonErrors = ['The JSON pane is empty. Paste a config, or click "Revert JSON to canvas".'];
    render(false);
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    state.jsonValid = false;
    state.jsonErrors = ['Cannot parse JSON: ' + err.message];
    render(false);
    return;
  }
  const v = validate(parsed);
  if (v.errors.length) {
    state.jsonValid = false;
    state.jsonErrors = v.errors;
    state.breakoutBlocked = v.meta.breakout;
    render(false);
    return;
  }
  state.config = parsed;
  state.jsonValid = true;
  state.jsonErrors = [];
  state.breakoutBlocked = false;
  state.draft = null;
  state.groupPick = null;
  state.meta = v.meta;
  state.warnings = computeWarnings(parsed, v.meta);
  clampSelection();
  if (hasContent()) state.scratch = true;
  render(false);
}

function clampSelection() {
  const s = state.sel;
  if (s.kind === 'profile' && !profiles().some(p => p && p.name === s.name)) state.sel = { kind: 'none' };
  if (s.kind === 'port' && !isAssigned(s.num)) state.sel = { kind: 'none' };
  if (s.kind === 'connection' && !connections()[s.idx]) state.sel = { kind: 'none' };
  clampConnFilter();
}
function resetConnFilter() {
  state.connQuery = '';
  state.connShown = null;
  state.connMenuOpen = false;
}
function clampConnFilter() {
  if (state.connShown == null) return;
  const n = connections().length;
  const next = new Set([...state.connShown].filter(i => i >= 0 && i < n));
  state.connShown = next.size === n ? null : next;
}
function connMatchesQuery(c) {
  const q = (state.connQuery || '').trim().toLowerCase();
  if (!q) return true;
  const eps = c.endpoints || [];
  const ends = eps.map(e => portLabel(e && e.port_name) + ' ' + (e && e.port_name || '')).join(' ');
  const fns = fnChips(c).map(ch => ch.text).join(' ');
  return (c.name || '').toLowerCase().includes(q) || ends.toLowerCase().includes(q) || fns.toLowerCase().includes(q);
}
function connChecked(i) {
  return state.connShown == null || state.connShown.has(i);
}
function connIsVisible(i) {
  if (state.sel.kind === 'connection' && state.sel.idx === i) return true;
  const c = connections()[i];
  if (!c) return false;
  return connChecked(i) && connMatchesQuery(c);
}
function setConnChecked(i, on) {
  const n = connections().length;
  let set = state.connShown == null ? new Set([...Array(n).keys()]) : new Set(state.connShown);
  if (on) set.add(i); else set.delete(i);
  state.connShown = set.size === n ? null : set;
}
function includeNewConnection(i) {
  if (state.connShown == null) return;
  state.connShown = new Set(state.connShown);
  state.connShown.add(i);
}
function hasContent() {
  return profiles().length > 0 || ports().length > 0 || connections().length > 0;
}

/* ------------------------------------------------------------------ render: shell */

function render(writeJson) {
  if (writeJson !== false) {
    const ta = jsonEl();
    const text = serialize(state.config);
    if (ta.value !== text) {
      const keep = ta.scrollTop;
      ta.value = text;
      ta.scrollTop = keep;
    }
  }
  renderToolbar();
  renderProfiles();
  renderChassis();
  renderList();
  renderInspector();
  renderJsonMsg();
  renderDevice();          // keeps the "on canvas" marks beside the device port list honest
  requestAnimationFrame(renderWires);
}

function renderToolbar() {
  const f = $('#fileLabel');
  f.textContent = state.fileName || 'Untitled';
  f.classList.toggle('dirty', state.dirty);
  const pill = $('#statusPill');
  const span = pill.querySelector('span');
  pill.classList.remove('bad', 'warn');
  if (!state.jsonValid) {
    pill.classList.add('bad');
    span.textContent = state.jsonErrors.length + ' JSON error' + (state.jsonErrors.length === 1 ? '' : 's');
  } else if (state.warnings.length) {
    pill.classList.add('warn');
    span.textContent = state.warnings.length + ' warning' + (state.warnings.length === 1 ? '' : 's');
  } else if (!hasContent()) {
    span.textContent = 'Empty';
  } else {
    span.textContent = 'Valid';
  }
  $('#alignToggle').checked = state.align;
  $('#namesToggle').checked = state.showNames;
  $('#outsideToggle').checked = state.showOutside;
  $('#alignBar').classList.toggle('hidden', !state.align);
  if (state.align) renderAlignBar();
  const gpBar = $('#groupPickBar');
  if (gpBar) {
    gpBar.classList.toggle('hidden', !state.groupPick);
    if (state.groupPick) renderGroupPickBar();
  }
  applyZoom();
}

function snapZoom(z) {
  const n = Math.round(z / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(n * 100) / 100));
}
function applyZoom() {
  const wrap = $('#chassisWrap');
  const sc = $('#chassisScroll');
  const z = state.zoom || 1;
  if (wrap) {
    wrap.style.width = (100 * z) + '%';
    wrap.style.maxWidth = (WRAP_MAX * z) + 'px';
    wrap.style.minWidth = Math.round(WRAP_MIN * z) + 'px';
    if (typeof wrap.style.setProperty === 'function') wrap.style.setProperty('--zoom', String(z));
  }
  if (sc) sc.classList.toggle('zoomed', z > 1.001);
  const lab = $('#zoomLabel');
  if (lab) lab.textContent = Math.round(z * 100) + '%';
  const zi = document.querySelector('[data-act="zoomIn"]');
  const zo = document.querySelector('[data-act="zoomOut"]');
  if (zi) zi.disabled = z >= ZOOM_MAX - 0.001;
  if (zo) zo.disabled = z <= ZOOM_MIN + 0.001;
}
function setZoom(next) {
  const z = snapZoom(next);
  if (Math.abs(z - (state.zoom || 1)) < 0.001) { applyZoom(); return; }
  const sc = $('#chassisScroll');
  let cx = 0, cy = 0, ratio = 1;
  if (sc) {
    cx = sc.scrollLeft + sc.clientWidth / 2;
    cy = sc.scrollTop + sc.clientHeight / 2;
    ratio = z / (state.zoom || 1);
  }
  state.zoom = z;
  applyZoom();
  if (sc) {
    sc.scrollLeft = cx * ratio - sc.clientWidth / 2;
    sc.scrollTop = cy * ratio - sc.clientHeight / 2;
  }
  requestAnimationFrame(renderWires);
}

function renderProfiles() {
  const list = profiles();
  $('#profCount').textContent = list.length ? String(list.length) : '';
  const sel = $('#profileSelect');
  if (!sel) return;
  const usage = profileUsage();
  const current = state.sel.kind === 'profile' ? state.sel.name : '';
  if (!list.length) {
    sel.innerHTML = '<option value="">No profiles yet</option>';
    sel.disabled = true;
  } else {
    sel.disabled = false;
    sel.innerHTML = '<option value="">' + list.length + ' profile' + (list.length === 1 ? '' : 's') + '</option>'
      + list.map(p => {
        const mode = p.choice || 'autonegotiation';
        const fec = getPath(p, mode + '.fec_mode') || 'reed_solomon';
        const n = (usage.get(p.name) || []).length;
        const label = p.name + ' \u2014 ' + (SPEED_LABEL[p.link_speed] || p.link_speed || '400G')
          + ' \u00b7 ' + (mode === 'manual' ? 'manual' : 'autoneg')
          + ' \u00b7 ' + (FEC_LABEL[fec] || fec)
          + (n ? ' \u00b7 ' + n + ' port' + (n === 1 ? '' : 's') : ' \u00b7 unused');
        return '<option value="' + esc(p.name) + '"' + (p.name === current ? ' selected' : '') + '>' + esc(label) + '</option>';
      }).join('');
  }
}

/* profile name -> [{objectName, num}] across plain ports and group members. */
function profileUsage() {
  const usage = new Map();
  const add = (name, rec) => {
    if (!name) return;
    if (!usage.has(name)) usage.set(name, []);
    usage.get(name).push(rec);
  };
  for (const e of ports()) {
    if (!isObj(e)) continue;
    if ((e.choice || 'front_panel_port') === 'port_group') {
      const list = (e.port_group && e.port_group.ports) || [];
      list.forEach(m => { if (isObj(m)) add(m.layer_1_profile_name, { objectName: e.name, num: m.front_panel_port }); });
    } else {
      const fp = e.front_panel_port;
      if (isObj(fp)) add(fp.layer_1_profile_name, { objectName: e.name, num: fp.front_panel_port });
    }
  }
  return usage;
}

/* Short label drawn inside the cage. Groups show the group name on every member
 * cage, so the whole span of the group is visible on the faceplate. */
function cageName(num, occ) {
  if (state.groupPick && state.groupPick.nums.includes(num)) return state.groupPick.groupName;
  occ = occ || occupants(num);
  return occ.length ? occ[0].name : '';
}
function cageTitle(num, occ) {
  if (state.groupPick) {
    const gi = state.groupPick.nums.indexOf(num);
    if (gi >= 0) {
      const members = state.groupPick.nums.map(n => 'P' + n).join(' + ');
      return 'Port ' + num + '\n' + state.groupPick.groupName + ' \u2014 group ' + members
        + (gi === 0 ? ' (main port, connections attach here)' : ' (member, main is P' + state.groupPick.nums[0] + ')');
    }
    occ = occ || occupants(num);
    if (occ.length) return 'Port ' + num + ' is already assigned. A cage is a regular port or a group member, not both.';
    return 'Port ' + num + ' \u2014 click to add to the group';
  }
  occ = occ || occupants(num);
  if (!occ.length) return 'Port ' + num + ' \u2014 unassigned (click to assign)';
  const lines = occ.map(o => {
    if (o.kind === 'port') return o.name;
    const g = groupOf(o.name);
    const members = g ? g.memberNums.map(n => 'P' + n).join(' + ') : '';
    return o.name + ' \u2014 group ' + members + (o.kind === 'anchor' ? ' (main port, connections attach here)' : ' (member, main is P' + (g ? g.anchorNum : '?') + ')');
  });
  return 'Port ' + num + '\n' + lines.join('\n');
}

function renderChassis() {
  const layer = $('#portLayer');
  const crop = $('#chassisCrop');
  if (crop) {
    crop.style.aspectRatio = IMG_W + ' / ' + GEOM.cropH;
    $('#chassisImgBox').style.top = (-GEOM.cropTop / GEOM.cropH * 100).toFixed(3) + '%';
  }
  let html = '';
  for (let n = 1; n <= PORT_COUNT; n++) {
    const { col, row } = portToCell(n);
    const cellL = GEOM.x + col * (GEOM.w / COLS);
    const cellT = GEOM.y + row * (GEOM.h / ROWS);
    const cellW = GEOM.w / COLS, cellH = GEOM.h / ROWS;
    const padX = cellW * GEOM.padX / 100, padY = cellH * GEOM.padY / 100;
    const occ = occupants(n);
    const primary = occ[0] || null;
    const gp = state.groupPick;
    const gi = gp ? gp.nums.indexOf(n) : -1;
    const cls = ['cage'];
    if (primary) cls.push('assigned');
    if (primary && primary.kind === 'anchor') cls.push('anchor');
    if (primary && primary.kind === 'member') cls.push('member');
    if (gi === 0) { if (!primary) cls.push('assigned'); cls.push('anchor'); }
    else if (gi > 0) { if (!primary) cls.push('assigned'); cls.push('member'); }
    else if (gp) cls.push(primary ? 'gpickno' : 'gpickok');
    if (occ.length > 1) cls.push('multi');   // corner dot: this cage serves more than one object
    if (state.align) cls.push('aligning');
    if (state.sel.kind === 'port' && state.sel.num === n) cls.push('sel');
    if (state.sel.kind === 'connection') {
      const c = connections()[state.sel.idx];
      if (c && cagesOfConnection(c).includes(n)) cls.push('inconn');
    }
    if (state.drag) {
      if (state.drag.fromNum === n) cls.push('dragsrc');
      else if (!primary) cls.push('dragno');
    }
    html += '<button class="' + cls.join(' ') + '" data-num="' + n + '" title="' + esc(cageTitle(n, occ)) + '" style="left:'
      + (cellL + padX).toFixed(3) + '%;top:' + (cellT + padY).toFixed(3) + '%;width:'
      + (cellW - padX * 2).toFixed(3) + '%;height:' + (cellH - padY * 2).toFixed(3) + '%">'
      + '<span class="cn">' + n + '</span>'
      + '<span class="cnm" data-full="' + esc(cageName(n, occ)) + '"></span>'
      + '</button>';
  }
  layer.innerHTML = html;
  layer.classList.toggle('locked', !state.jsonValid);
  layer.classList.toggle('noNames', !state.showNames);
  $('#chassisWell').classList.toggle('picking', !!state.groupPick);

  const showEmpty = !hasContent() && !state.scratch && state.jsonValid;
  $('#emptyState').classList.toggle('hidden', !showEmpty);
  $('#lockBanner').classList.toggle('hidden', state.jsonValid);
  if (!state.jsonValid) {
    $('#lockMsg').textContent = state.breakoutBlocked
      ? 'This config uses breakout channels. This tool is whole-port only (one cage = one port), so it will not draw it. Fix the JSON, or open a non-breakout config.'
      : 'The chassis still shows the last valid configuration. Fix the JSON below, or revert it to what the canvas holds.';
  }
  $('#chassisMeta').innerHTML = legendHtml();
}

function legendHtml() {
  const dash = { 't-eth': '', 't-vxlan': 'stroke-dasharray="7 4"', 't-nvgre': 'stroke-dasharray="1.6 3.4"', 't-ip': 'stroke-dasharray="12 3 2 3"' };
  const item = (label, cls, dbl) =>
    '<span class="k"><svg width="34" height="10">'
    + '<path d="M0 ' + (dbl ? 3 : 5) + ' H34" stroke="#fff" stroke-width="1.5" fill="none" ' + (dash[cls] || '') + '></path>'
    + (dbl ? '<path d="M0 7 H34" stroke="#fff" stroke-width="1.5" fill="none"></path>' : '')
    + '</svg>' + label + '</span>';
  const swatch = (style, label) => '<span class="k"><i class="sw" style="' + style + '"></i>' + label + '</span>';
  return item('Ethernet', 't-eth') + item('VXLAN', 't-vxlan') + item('NVGRE', 't-nvgre') + item('ARP', 't-arp', true)
    + '<span class="k"><svg width="34" height="10"><path d="M0 5 H34" stroke="#ff415a" stroke-width="2.4" fill="none"></path></svg>selected</span>'
    + (state.groupPick || (idx().cages.size && [...idx().objByName.values()].some(o => o.kind === 'group'))
      ? swatch('border:1px solid #fff;box-shadow:inset 2px 0 0 0 var(--red-soft)', 'group main port')
        + swatch('border:1px dashed #ffffff7a', 'group member')
      : '')
    + (state.showOutside && idx().cages.size
      ? swatch('border:1px solid #ffffff4a;background:linear-gradient(#17171b,#101013)', 'outside the box \u2014 click to label it')
      : '')
    + '<span class="k" style="margin-left:auto">Column pairs: port 1 top-left, 2 below it, 31/32 far right</span>';
}

/* ------------------------------------------------------------------ render: wires */

function cageEl(n) { return $('#portLayer .cage[data-num="' + n + '"]'); }

/* Cage text scales with the rendered cage, and the name line drops out when the
 * cage gets too short for two lines to be legible. Names too long for the cage are
 * cut in the middle: with names like snic1_port_group_2 the tail is what tells
 * them apart, and the full name is in the tooltip and the inspector. */
function sizeCageText() {
  const layer = $('#portLayer');
  const one = cageEl(1);
  if (!layer || !one) return;
  const r = one.getBoundingClientRect();
  if (!r.height) return;
  const clamp = (lo, v, hi) => Math.max(lo, Math.min(hi, v));
  const z = state.zoom || 1;
  const numPx = clamp(7, r.height * 0.30, 11 * z);
  const nmPx = clamp(6, r.height * 0.27, 9.5 * z);
  layer.style.setProperty('--cage-num', numPx.toFixed(1) + 'px');
  layer.style.setProperty('--cage-nm', nmPx.toFixed(1) + 'px');
  layer.classList.toggle('tiny', r.height < 17);
  const lines = clamp(1, Math.floor((r.height - numPx * 1.05 - 3) / (nmPx * 1.05)), 2);
  layer.style.setProperty('--cage-lines', String(lines));
  const perLine = Math.max(3, Math.floor((r.width - 4) / (nmPx * 0.62)));
  layer.querySelectorAll('.cnm').forEach(el => {
    el.textContent = ellipsizeMiddle(el.dataset.full || '', perLine * lines);
  });
}
function ellipsizeMiddle(s, max) {
  if (s.length <= max) return s;
  const tail = Math.min(s.length - 1, Math.ceil((max - 1) * 0.55));
  return s.slice(0, Math.max(1, max - 1 - tail)) + '\u2026' + s.slice(s.length - tail);
}

/* ------------------------------------------------------------------ render: outside rail */

/* One box per front_panel_ports entry, sitting over the columns it owns. Boxes are
 * packed into as few rows as they fit in, closest row to the chassis first, so short
 * configs get a single tidy row. */
const OBOX_MAX_W = 178;

function layoutOutside(cropRect) {
  const boxes = [];
  if (!state.showOutside || !cropRect.width) return { boxes, rows: 0 };
  const cellW = cropRect.width * (GEOM.w / 100) / COLS;
  const colX = col => cropRect.width * (GEOM.x / 100) + (col + 0.5) * cellW;
  for (const o of idx().objByName.values()) {
    if (!o.memberNums.length) continue;
    const out = outsideOf(o.name);
    if (out.hidden) continue;
    const cages = o.memberNums.map(n => ({ num: n, cell: portToCell(n) }));
    const cx = cages.reduce((s, c) => s + colX(c.cell.col), 0) / cages.length;
    const label = out.label;
    const chip = 'P' + o.memberNums.join('+');
    // mono text, so width is predictable enough to pack without measuring every box;
    // capped so one long name cannot push the whole rail into extra rows
    const chars = label.length + chip.length + (out.kind ? OUTSIDE_KIND_TAG[out.kind].length + 3 : 0);
    const maxW = OBOX_MAX_W * (state.zoom || 1);
    const charW = 6.25 * (state.zoom || 1);
    const w = Math.max(cellW, Math.min(maxW, 21 * (state.zoom || 1) + chars * charW));
    boxes.push({ obj: o, out, label, chip, cx, w, cages });
  }
  boxes.sort((a, b) => a.cx - b.cx || a.obj.name.localeCompare(b.obj.name));
  const rows = [];
  const gap = 5;
  const drift = cellW * 1.2;   // how far a box may slide off its column to share a row
  for (const b of boxes) {
    const home = Math.max(0, Math.min(cropRect.width - b.w, b.cx - b.w / 2));
    let r = 0;
    for (; ; r++) {
      if (!rows[r]) { rows[r] = []; b.x = home; break; }
      // slide right past whatever already sits in this row, if that stays near its column
      let x = home;
      for (const o of rows[r]) {
        if (x < o.x + o.w + gap && o.x < x + b.w + gap) x = o.x + o.w + gap;
      }
      if (x + b.w <= cropRect.width && x - home <= drift) { b.x = x; break; }
    }
    rows[r].push(b);
    rows[r].sort((p, q) => p.x - q.x);
    b.row = r;
  }
  return { boxes, rows: rows.length };
}

function renderOutsideRail(cropRect) {
  const rail = $('#outsideRail');
  if (!rail) return null;
  const L = layoutOutside(cropRect);
  const z = state.zoom || 1;
  const boxH = 21 * z, gap = 5, lead = 14;
  const railH = L.rows ? L.rows * boxH + (L.rows - 1) * gap + lead : 0;
  rail.classList.toggle('hidden', !railH);
  rail.style.height = railH + 'px';
  if (!railH) { rail.innerHTML = ''; return L; }
  rail.innerHTML = L.boxes.map(b => {
    const top = (L.rows - 1 - b.row) * (boxH + gap);
    const sel = state.sel.kind === 'port' && b.obj.memberNums.includes(state.sel.num);
    const cls = ['obox'];
    if (sel) cls.push('sel');
    if (b.out.custom) cls.push('custom');
    const title = b.label + '\n' + (b.out.kind ? OUTSIDE_KIND_LABEL[b.out.kind] + '\n' : '')
      + 'connects to ' + b.obj.name + ' \u2014 ' + b.chip
      + (b.out.note ? '\n' + b.out.note : '')
      + '\nclick to open it in the inspector';
    return '<div class="' + cls.join(' ') + '" data-oname="' + esc(b.obj.name) + '" title="' + esc(title) + '"'
      + ' style="left:' + b.x.toFixed(1) + 'px;top:' + top + 'px;width:' + b.w.toFixed(1) + 'px">'
      + (b.out.kind ? '<span class="ok">' + esc(OUTSIDE_KIND_TAG[b.out.kind]) + '</span>' : '')
      + '<span class="ol">' + esc(b.label) + '</span>'
      + '<span class="op">' + esc(b.chip) + '</span>'
      + '</div>';
  }).join('');
  return L;
}

/* Leader lines run from each box down to its cages. They stay in the gaps between
 * columns and in the gap between the two rows, so they never cross a cage or its name. */
function renderLeaders(L, svgRect, cropRect) {
  const svg = $('#leaderSvg');
  if (!svg) return;
  if (!L || !L.boxes.length) { svg.innerHTML = ''; return; }
  const faceTop = cropRect.top - svgRect.top;
  const cellPx = cropRect.width * (GEOM.w / 100) / COLS;
  const r = 4;
  let out = '';
  for (const b of L.boxes) {
    const box = $('#outsideRail .obox[data-oname="' + cssEsc(b.obj.name) + '"]');
    if (!box) continue;
    const br = box.getBoundingClientRect();
    const from = { x: br.left + br.width / 2 - svgRect.left, y: br.bottom - svgRect.top };
    const sel = state.sel.kind === 'port' && b.obj.memberNums.includes(state.sel.num);
    let paths = '';
    for (const c of b.cages) {
      const el = cageEl(c.num);
      if (!el) continue;
      const cr = el.getBoundingClientRect();
      const to = { x: cr.left + cr.width / 2 - svgRect.left, y: cr.top - svgRect.top };
      const gapX = to.x + (c.cell.col === 0 ? cellPx * 0.5 : -cellPx * 0.5);
      const d = c.cell.row === 0
        ? elbowV(from, to, Math.min(from.y + 7, faceTop - 4), r)
        : elbowV(from, { x: gapX, y: to.y - 5 }, Math.min(from.y + 7, faceTop - 4), r)
        + elbowH({ x: gapX, y: to.y - 5 }, to, r);
      paths += '<path d="' + d + '"></path>';
    }
    out += '<g class="' + (sel ? 'hl' : '') + '" data-oname="' + esc(b.obj.name) + '">'
      + paths + '<circle cx="' + from.x.toFixed(1) + '" cy="' + from.y.toFixed(1) + '" r="1.6"></circle></g>';
  }
  svg.innerHTML = out;
}
/* down, across at midY, down again */
function elbowV(a, b, midY, r) {
  if (Math.abs(a.x - b.x) < 1) return 'M ' + a.x + ' ' + a.y + ' L ' + b.x + ' ' + b.y;
  const dir = b.x > a.x ? 1 : -1;
  const rr = Math.min(r, Math.abs(b.x - a.x) / 2, Math.abs(midY - a.y), Math.abs(b.y - midY));
  return 'M ' + a.x + ' ' + a.y
    + ' L ' + a.x + ' ' + (midY - rr)
    + ' Q ' + a.x + ' ' + midY + ' ' + (a.x + dir * rr) + ' ' + midY
    + ' L ' + (b.x - dir * rr) + ' ' + midY
    + ' Q ' + b.x + ' ' + midY + ' ' + b.x + ' ' + (midY + rr)
    + ' L ' + b.x + ' ' + b.y;
}
/* across, then down into the cage */
function elbowH(a, b, r) {
  if (Math.abs(a.x - b.x) < 1) return 'M ' + a.x + ' ' + a.y + ' L ' + b.x + ' ' + b.y;
  const dir = b.x > a.x ? 1 : -1;
  const rr = Math.min(r, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y));
  return 'M ' + a.x + ' ' + a.y
    + ' L ' + (b.x - dir * rr) + ' ' + a.y
    + ' Q ' + b.x + ' ' + a.y + ' ' + b.x + ' ' + (a.y + rr)
    + ' L ' + b.x + ' ' + b.y;
}
function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

function renderWires() {
  const svg = $('#wireSvg');
  const well = $('#chassisWell');
  const imgBox = $('#chassisCrop');
  if (!svg || !well || !imgBox) return;

  const conns = connections();
  const drawable = [];
  conns.forEach((c, i) => {
    if (!connIsVisible(i)) return;
    const eps = c.endpoints || [];
    if (eps.length < 2) return;
    const a = anchorNumOf(eps[0].port_name);
    const b = anchorNumOf(eps[1].port_name);
    if (a == null || b == null) return;
    drawable.push({ idx: i, conn: c, a, b, ro: state.meta && state.meta.readOnly.has(i) });
  });
  well.classList.toggle('dragging', !!state.drag);
  const draft = state.draft;
  const lanes = Math.max(1, drawable.length + (draft ? 1 : 0));
  const laneGap = 18;
  well.style.paddingBottom = (20 + Math.min(lanes, 9) * laneGap) + 'px';

  // the rail sits above the faceplate in normal flow, so it has to be sized first
  const L = renderOutsideRail(imgBox.getBoundingClientRect());
  const svgRect = svg.getBoundingClientRect();
  const imgRect = imgBox.getBoundingClientRect();
  const baseY = imgRect.bottom - svgRect.top;
  const cellPx = imgRect.width * (GEOM.w / 100) / COLS;
  sizeCageText();
  renderLeaders(L, svgRect, imgRect);
  const anchor = n => {
    const el = cageEl(n);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - svgRect.left, y: r.bottom - svgRect.top };
  };

  let out = '', badges = '';
  const emit = (item, lane, isDraft) => {
    const A = anchor(item.a), B = anchor(item.b);
    if (!A || !B) return;
    const laneY = baseY + 12 + (lane % 9) * laneGap;
    const off = ((lane % 3) - 1) * 2.5;
    const d = wireD(A, B, laneY, off, cellPx);
    const x1 = A.x, x2 = B.x;
    const badge = isDraft ? 'draft' : wireBadge(item.conn);
    const cls = ['conn'];
    if (isDraft) cls.push('draft');
    if (!isDraft && state.sel.kind === 'connection' && state.sel.idx === item.idx) cls.push('sel');
    if (!isDraft && state.hover && state.hover.kind === 'connection' && state.hover.idx === item.idx) cls.push('hl');
    if (item.ro) cls.push('ro');
    const wcls = isDraft ? 't-eth' : wireClass(item.conn);
    const dbl = !isDraft && (item.conn.functions || []).some(f => f && f.choice === 'connect_arp');
    const bw = Math.max(26, badge.length * 6 + 10);
    const bx = (x1 + x2) / 2, by = laneY;
    const g = '<g class="' + cls.join(' ') + '"' + (isDraft ? '' : ' data-idx="' + item.idx + '"') + '>';
    out += g
      + '<path class="halo" stroke-width="4" d="' + d + '"></path>'
      + '<path class="wire ' + wcls + '" d="' + d + '"></path>'
      + (dbl ? '<path class="wire2" transform="translate(0,2.6)" d="' + d + '"></path>' : '')
      + '<path class="hit" d="' + d + '"></path>'
      + '</g>';
    // Badges go in a second pass so a later wire cannot paint over an earlier label.
    badges += g.replace('class="' + cls.join(' ') + '"', 'class="' + cls.concat('badgeg').join(' ') + '"')
      + '<rect class="badgebg" x="' + (bx - bw / 2) + '" y="' + (by - 7) + '" width="' + bw + '" height="14" rx="3"></rect>'
      + '<text class="badge" x="' + bx + '" y="' + (by + 0.5) + '">' + esc(badge) + '</text>'
      + '</g>';
  };
  drawable.forEach((item, i) => emit(item, i, false));
  if (draft) {
    const a = anchorNumOf(draft.p1), b = anchorNumOf(draft.p2);
    if (a != null && b != null) emit({ a, b, conn: null, idx: -1 }, drawable.length, true);
  }
  if (state.drag && state.drag.x != null) {
    const A = anchor(state.drag.fromNum);
    if (A) out += '<path id="rubber" d="M ' + A.x + ' ' + A.y + ' L ' + (state.drag.x - svgRect.left) + ' ' + (state.drag.y - svgRect.top) + '"></path>';
  }
  svg.innerHTML = out + badges;
  applyHover();
}

/* Wires leave the bottom of a cage, drop to a lane under the faceplate and come back up.
 * Ports in one column (25 above 26, as in every sample) would otherwise run straight
 * through the lower cage, so those wires jog sideways first. */
function wireD(A, B, laneY, off, cellPx) {
  const r = 6, lead = 13;
  const sameCol = Math.abs(A.x - B.x) < cellPx * 0.5;
  const jog = sameCol ? cellPx * 0.5 : 0;
  const x1 = A.x + off - jog, x2 = B.x - off + jog;
  const y1 = sameCol ? A.y + lead : A.y;
  const y2 = sameCol ? B.y + lead : B.y;
  let d = 'M ' + A.x + ' ' + A.y;
  if (sameCol) d += ' C ' + A.x + ' ' + (A.y + 7) + ' ' + x1 + ' ' + (A.y + 4) + ' ' + x1 + ' ' + y1;
  const dx = x2 - x1;
  if (Math.abs(dx) < r * 2 + 1) {
    d += ' L ' + x1 + ' ' + laneY + ' L ' + x2 + ' ' + laneY + ' L ' + x2 + ' ' + y2;
  } else {
    const dir = dx > 0 ? 1 : -1;
    d += ' L ' + x1 + ' ' + (laneY - r)
      + ' Q ' + x1 + ' ' + laneY + ' ' + (x1 + dir * r) + ' ' + laneY
      + ' L ' + (x2 - dir * r) + ' ' + laneY
      + ' Q ' + x2 + ' ' + laneY + ' ' + x2 + ' ' + (laneY - r)
      + ' L ' + x2 + ' ' + y2;
  }
  if (sameCol) d += ' C ' + x2 + ' ' + (B.y + 4) + ' ' + B.x + ' ' + (B.y + 7) + ' ' + B.x + ' ' + B.y;
  return d;
}

/* ------------------------------------------------------------------ render: connection list */

function renderList() {
  const conns = connections();
  const visible = conns.filter((c, i) => connIsVisible(i)).length;
  $('#connCount').textContent = conns.length ? String(conns.length) : '';
  const trigger = $('#connTrigger');
  const menu = $('#connMenu');
  const filter = $('#connFilter');
  if (trigger) {
    trigger.classList.toggle('open', !!state.connMenuOpen);
    if (!conns.length) trigger.innerHTML = 'No connections';
    else if (state.connQuery.trim() && visible !== conns.length) {
      trigger.innerHTML = esc(visible + ' of ' + conns.length + ' matching “' + state.connQuery.trim() + '”');
    } else if (state.connShown == null) {
      trigger.innerHTML = 'All ' + conns.length + ' connection' + (conns.length === 1 ? '' : 's');
    } else {
      trigger.innerHTML = esc(visible + ' of ' + conns.length + ' shown');
    }
  }
  if (menu) menu.classList.toggle('hidden', !state.connMenuOpen);
  if (filter && filter.value !== state.connQuery) filter.value = state.connQuery;
  const body = $('#listBody');
  if (!body) return;
  if (!conns.length) {
    body.innerHTML = '<div class="empty-note" style="padding:14px">No connections yet. Assign two cages, then drag from one to the other \u2014 the cage you start on becomes <code style="font-family:var(--mono)">port1</code>.</div>';
    return;
  }
  const warnByConn = new Map();
  state.warnings.forEach(w => {
    if (w.sel && w.sel.kind === 'connection') warnByConn.set(w.sel.idx, (warnByConn.get(w.sel.idx) || 0) + 1);
  });
  const q = (state.connQuery || '').trim();
  let rows = '';
  let listed = 0;
  conns.forEach((c, i) => {
    if (q && !connMatchesQuery(c)) return;
    listed++;
    const eps = c.endpoints || [];
    const ends = eps.length === 2
      ? sheetEndLabel(eps[0] && eps[0].port_name) + ' \u2194 ' + sheetEndLabel(eps[1] && eps[1].port_name)
      : eps.map(e => sheetEndLabel(e && e.port_name)).join(' \u00b7 ');
    const chips = fnChips(c).map(ch => '<span class="chip' + (ch.unknown ? ' amber' : '') + '">' + esc(ch.text) + '</span>').join('');
    const ro = state.meta && state.meta.readOnly.has(i);
    const nw = warnByConn.get(i) || 0;
    const on = connChecked(i);
    rows += '<tr class="row' + (state.sel.kind === 'connection' && state.sel.idx === i ? ' sel' : '') + (on ? '' : ' off') + '" data-idx="' + i + '">'
      + '<td><input type="checkbox" data-act="toggleConnVis" data-idx="' + i + '"' + (on ? ' checked' : '') + '></td>'
      + '<td class="nm">' + esc(c.name || '(unnamed)') + '</td>'
      + '<td class="ends">' + esc(ends) + '</td>'
      + '<td>' + chips + '</td>'
      + '<td>' + (ro ? '<span class="chip amber">JSON only</span>' : '') + (nw ? '<span class="chip amber">' + nw + ' warning' + (nw === 1 ? '' : 's') + '</span>' : '') + '</td>'
      + '</tr>';
  });
  if (!listed) {
    body.innerHTML = '<div class="empty-note" style="padding:14px">No connections match “' + esc(q) + '”.</div>';
    return;
  }
  body.innerHTML = '<table class="tbl"><thead><tr><th></th><th>Name</th><th>Ports</th><th>Functions</th><th>Notes</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function applyHover() {
  const h = state.hover;
  document.querySelectorAll('#portLayer .cage.hl').forEach(el => el.classList.remove('hl'));
  document.querySelectorAll('#listBody tr.row').forEach(el => el.classList.toggle('hlrow', false));
  if (!h) return;
  if (h.kind === 'connection') {
    const c = connections()[h.idx];
    if (!c) return;
    // Groups light up every member cage, not just the one the wire lands on.
    cagesOfConnection(c).forEach(n => {
      const el = cageEl(n);
      if (el) el.classList.add('hl');
    });
  }
}
/* Hovering an outside box lights its cages and its leader lines. */
function setOutsideHover(name) {
  document.querySelectorAll('#outsideRail .obox.hl').forEach(el => el.classList.remove('hl'));
  document.querySelectorAll('#leaderSvg g.hover').forEach(el => el.classList.remove('hover'));
  applyHover();   // hands the cage highlight back to whatever else is hovered
  if (!name) return;
  const box = $('#outsideRail .obox[data-oname="' + cssEsc(name) + '"]');
  if (box) box.classList.add('hl');
  const g = $('#leaderSvg g[data-oname="' + cssEsc(name) + '"]');
  if (g) g.classList.add('hover');
  memberNumsOf(name).forEach(n => {
    const el = cageEl(n);
    if (el) el.classList.add('hl');
  });
}

function setHover(h) {
  state.hover = h;
  document.querySelectorAll('#wireSvg g.conn').forEach(g => {
    g.classList.toggle('hl', !!h && h.kind === 'connection' && String(h.idx) === g.dataset.idx);
  });
  applyHover();
}

/* ------------------------------------------------------------------ render: inspector */

function renderInspector() {
  const body = $('#inspectorBody');
  const title = $('#inspTitle'), sub = $('#inspSub');
  if (state.groupPick) { title.textContent = 'New port group'; sub.textContent = 'pick members'; body.innerHTML = groupPickHtml(); return; }
  if (state.draft) { title.textContent = 'New connection'; sub.textContent = 'draft'; body.innerHTML = draftHtml(); return; }
  const s = state.sel;
  if (s.kind === 'profile') { title.textContent = 'Layer 1 profile'; sub.textContent = s.name; body.innerHTML = profileHtml(s.name); return; }
  if (s.kind === 'port') { title.textContent = 'Front-panel port ' + s.num; sub.textContent = ''; body.innerHTML = portHtml(s.num); return; }
  if (s.kind === 'connection') { title.textContent = 'Connection'; sub.textContent = '#' + (s.idx + 1); body.innerHTML = connHtml(s.idx); return; }
  title.textContent = 'Inspector'; sub.textContent = '';
  body.innerHTML = overviewHtml();
}

function stepperHtml() {
  const np = profiles().length, nports = idx().cages.size, nc = connections().length;
  const st = (n, label, value, done, next) =>
    '<div class="st' + (done ? ' done' : '') + (next ? ' next' : '') + '"><span class="n">' + n + '. ' + label + '</span><span class="v">' + value + '</span></div>';
  return '<div class="stepper">'
    + st(1, 'Profiles', np, np > 0, np === 0)
    + st(2, 'Ports', nports, nports > 0, np > 0 && nports === 0)
    + st(3, 'Connections', nc, nc > 0, nports >= 2 && nc === 0)
    + '</div>';
}

function warningsHtml() {
  if (!state.warnings.length) return '';
  return '<div class="sec"><h3>Warnings <span class="mini">' + state.warnings.length + '</span></h3>'
    + '<ul class="warnlist">' + state.warnings.map((w, i) =>
      '<li><span class="b">!</span><span>' + esc(w.text)
      + (w.sel ? ' <a class="linkish" data-act="gotoWarn" data-i="' + i + '">show</a>' : '') + '</span></li>').join('')
    + '</ul><div class="mini" style="margin-top:8px">Warnings do not block saving. The device or your apply tool has the final say.</div></div>';
}

function overviewHtml() {
  const np = profiles().length, nports = idx().cages.size;
  let next;
  if (np === 0) next = 'Create a Layer 1 profile from the Layer 1 menu above the chassis. The samples use one profile named <code>manual_400g_rs</code> \u2014 400G, manual, Reed Solomon.';
  else if (nports === 0) next = 'Click a dark cage on the chassis to assign it as a regular port or a port group. The samples assign ports 25 and 26.';
  else if (nports < 2) next = 'Assign a second cage, then drag between the two to connect them.';
  else next = 'Drag from one assigned cage to another to create a connection. The cage you start the drag on becomes <code>port1</code>.';
  return stepperHtml()
    + '<div class="banner"><b>Next:</b> ' + next + '</div>'
    + '<div class="sec"><h3>How this maps to the JSON</h3><div class="hint">'
    + 'A Layer 1 profile becomes an entry in <code>profiles.layer_1_profiles</code>. Assigning a cage adds a <code>front_panel_ports</code> entry with <code>front_panel_port</code> and <code>layer_1_profile_name</code>. '
    + 'A drag between two cages adds a <code>connections</code> entry with two <code>endpoints</code> and one or more <code>functions</code>. '
    + 'Endpoint <code>tags</code> are derived from the functions, exactly as in the samples.'
    + '</div></div>'
    + warningsHtml();
}

function selOpts(values, current, labels) {
  return values.map(v => '<option value="' + esc(v) + '"' + (v === current ? ' selected' : '') + '>' + esc(labels ? labels[v] || v : v) + '</option>').join('');
}

function profileHtml(name) {
  const i = profiles().findIndex(p => p && p.name === name);
  if (i < 0) return '<div class="hint">Profile not found.</div>';
  const p = profiles()[i];
  const base = 'profiles.layer_1_profiles.' + i;
  const mode = p.choice || 'autonegotiation';
  const fec = getPath(p, mode + '.fec_mode') || 'reed_solomon';
  const users = profileUsage().get(name) || [];
  const canDelete = users.length === 0;
  return '<div class="sec"><h3>Profile</h3><div class="kv">'
    + '<label>Name</label><input type="text" value="' + esc(p.name) + '" data-act="renameProfile" data-i="' + i + '">'
    + '<label>Link speed</label><select data-path="' + base + '.link_speed" data-type="str">' + selOpts(SPEEDS, p.link_speed || 'speed_400_gbps', SPEED_LABEL) + '</select>'
    + '<label>Mode</label><select data-act="profileMode" data-i="' + i + '">' + selOpts(L1_CHOICES, mode, { autonegotiation: 'autonegotiation', manual: 'manual' }) + '</select>'
    + '<label>FEC</label><select data-path="' + base + '.' + mode + '.fec_mode" data-type="str">' + selOpts(FECS, fec, FEC_LABEL) + '</select>'
    + (mode === 'autonegotiation'
      ? '<label>Advertise FEC</label><select data-path="' + base + '.autonegotiation.advertise_fec" data-type="bool">' + selOpts(['true', 'false'], String(getPath(p, 'autonegotiation.advertise_fec') !== false)) + '</select>'
      : '')
    + '</div></div>'
    + '<div class="sec"><h3>Used by</h3>'
    + (users.length
      ? users.map(u => '<div class="card" data-act="selPortNum" data-num="' + esc(u.num) + '"><div class="nm">' + esc(u.objectName) + '</div><div class="sub">Port ' + esc(u.num) + (isGroup(u.objectName) ? ' \u00b7 group member' : '') + '</div></div>').join('')
      : '<div class="hint">No ports use this profile yet.</div>')
    + '</div>'
    + '<div class="sec"><button class="btn danger" data-act="delProfile" data-i="' + i + '"' + (canDelete ? '' : ' disabled') + '>Delete profile</button>'
    + (canDelete ? '' : '<div class="hint" style="margin-top:6px">Blocked: ' + users.length + ' port' + (users.length === 1 ? '' : 's') + ' reference this profile. Point them at another profile first.</div>')
    + '</div>';
}

const KNOWN_FP_KEYS = ['front_panel_port', 'channel', 'num_channels', 'layer_1_profile_name'];

/* The outside box for one port or group: what the cable on this port runs to. */
function outsideHtml(name) {
  const o = outsideOf(name);
  const info = objInfo(name);
  const chip = info && info.memberNums.length ? 'P' + info.memberNums.join('+') : 'no port';
  return '<div class="sec"><h3>Outside</h3><div class="kv">'
    + '<label>Box label</label><input type="text" value="' + esc(o.label) + '" placeholder="' + esc(name) + '" data-act="outLabel" data-name="' + esc(name) + '">'
    + '<label>Kind</label><select data-act="outKind" data-name="' + esc(name) + '">' + selOpts(OUTSIDE_KINDS, o.kind, OUTSIDE_KIND_LABEL) + '</select>'
    + '<label>Note</label><input type="text" value="' + esc(o.note) + '" placeholder="shown in the box tooltip" data-act="outNote" data-name="' + esc(name) + '">'
    + '<label>Show box</label><select data-act="outHidden" data-name="' + esc(name) + '">' + selOpts(['true', 'false'], String(!o.hidden)) + '</select>'
    + '</div>'
    + '<div class="hint" style="margin-top:8px">The box above the chassis says what this port connects to outside the UHD, drawn over ' + esc(chip) + '. '
    + 'The UHDConnect schema has no field for it, so anything you change here is saved in the same file under <code>' + X_KEY + '</code>, which the device ignores. '
    + 'Left at defaults, nothing is written.</div>'
    + (o.custom ? '<div style="margin-top:8px"><button class="btn sm" data-act="outReset" data-name="' + esc(name) + '">Reset to port name</button></div>' : '')
    + '</div>';
}

function connCardsHtml(conns, emptyText) {
  if (!conns.length) return '<div class="hint">' + emptyText + '</div>';
  return conns.map(ci => '<div class="card" data-act="selConn" data-idx="' + ci + '"><div class="nm">' + esc(connections()[ci].name)
    + '</div><div class="sub">' + esc(fnChips(connections()[ci]).map(c => c.text).join(' + ')) + '</div></div>').join('');
}

function portHtml(num) {
  const occ = occupants(num);
  if (!occ.length) {
    return '<div class="banner"><b>Port ' + num + ' is not assigned.</b> Click the cage to give it a Layer 1 profile and a name. Until then it cannot take a connection.</div>'
      + '<div class="sec"><button class="btn primary" data-act="assign" data-num="' + num + '">Assign port ' + num + '</button></div>';
  }
  let html = occ.length > 1
    ? '<div class="banner amber"><b>Port ' + num + ' belongs to ' + occ.length + ' objects.</b> Connections attach to whichever one they name.</div>'
    : '';
  html += occ.map(o => o.kind === 'port' ? plainPortHtml(num, o) : groupHtml(num, o)).join('');
  return html;
}

function plainPortHtml(num, o) {
  const e = o.entry, i = o.index;
  const base = 'front_panel_ports.' + i;
  const fp = e.front_panel_port || {};
  const extras = Object.keys(fp).filter(k => !KNOWN_FP_KEYS.includes(k));
  const conns = connIndicesForObject(e.name);
  const canClear = conns.length === 0;
  return '<div class="sec"><h3>Port</h3><div class="kv">'
    + '<label>Cage</label><div class="mini" style="font-family:var(--mono)">Front-panel port ' + num + '</div>'
    + '<label>Name</label><input type="text" value="' + esc(e.name) + '" data-act="renamePort" data-i="' + i + '">'
    + '<label>Layer 1 profile</label><select data-path="' + base + '.front_panel_port.layer_1_profile_name" data-type="str">'
    + selOpts(profiles().map(p => p.name), fp.layer_1_profile_name) + '</select>'
    + '</div></div>'
    + (extras.length
      ? '<div class="banner amber"><b>' + extras.length + ' field' + (extras.length === 1 ? '' : 's') + ' this UI does not edit:</b> '
      + esc(extras.join(', ')) + '. They stay in the JSON untouched.</div>'
      : '')
    + outsideHtml(e.name)
    + '<div class="sec"><h3>Connections on this port</h3>'
    + connCardsHtml(conns, 'None. Drag from this cage to another assigned cage to create one.')
    + '</div>'
    + '<div class="sec"><button class="btn danger" data-act="clearPort" data-i="' + i + '"' + (canClear ? '' : ' disabled') + '>Clear port ' + num + '</button>'
    + (canClear ? '' : '<div class="hint" style="margin-top:6px">Blocked: ' + conns.length + ' connection' + (conns.length === 1 ? '' : 's') + ' use this port. Delete ' + (conns.length === 1 ? 'it' : 'them') + ' first.</div>')
    + '</div>';
}

function groupHtml(num, o) {
  const e = o.entry, i = o.index;
  const g = e.port_group || {};
  const info = groupOf(e.name) || { memberNums: [], anchorNum: null };
  const list = g.ports || [];
  const conns = connIndicesForObject(e.name);
  const canDelete = conns.length === 0;
  const dist = g.ingress_distribution || 'split';
  const members = list.map((m, k) => {
    const mn = m && m.front_panel_port;
    const isMain = k === 0;
    return '<div class="card' + (mn === num ? ' sel' : '') + '"' + (mn === num ? '' : ' data-act="selPortNum" data-num="' + esc(mn) + '"') + '>'
      + '<div class="nm">Port ' + esc(mn) + (isMain ? ' \u00b7 main' : '') + '</div>'
      + '<div class="sub" style="display:flex;align-items:center;gap:6px;margin-top:4px">Layer 1'
      + '<select data-path="front_panel_ports.' + i + '.port_group.ports.' + k + '.layer_1_profile_name" data-type="str">'
      + selOpts(profiles().map(p => p.name), m && m.layer_1_profile_name) + '</select></div>'
      + '</div>';
  }).join('');
  return '<div class="sec"><h3>Port group</h3><div class="kv">'
    + '<label>Name</label><input type="text" value="' + esc(e.name) + '" data-act="renamePort" data-i="' + i + '">'
    + '<label>Ports</label><div class="mini" style="font-family:var(--mono)">' + esc(info.memberNums.map(n => 'P' + n).join(' + ') || 'none') + '</div>'
    + '<label>Ingress</label><select data-path="front_panel_ports.' + i + '.port_group.ingress_distribution" data-type="str">'
    + selOpts(['split', 'copy'], dist) + '</select>'
    + '</div>'
    + '<div class="hint" style="margin-top:8px">'
    + (info.anchorNum == null
      ? 'This group has no valid front-panel port, so it cannot be drawn.'
      : 'On the chassis this group draws from its first port, <b>P' + info.anchorNum + '</b>'
      + (info.memberNums.length > 1 ? ', and every member cage lights up with it.' : '.')
      + ' Ingress <b>' + esc(dist) + '</b> means arriving configuration is '
      + (dist === 'copy' ? 'copied to every port in the group (LAG style).' : 'split evenly across the ports in the group.'))
    + '</div></div>'
    + '<div class="sec"><h3>Ports in this group</h3>' + (members || '<div class="hint">No ports in this group.</div>') + '</div>'
    + outsideHtml(e.name)
    + '<div class="sec"><h3>Connections on this group</h3>'
    + connCardsHtml(conns, 'None. Drag from a cage of this group to another assigned cage to create one.')
    + '</div>'
    + '<div class="sec"><button class="btn danger" data-act="delPortObj" data-i="' + i + '"' + (canDelete ? '' : ' disabled') + '>Delete group</button>'
    + (canDelete ? '' : '<div class="hint" style="margin-top:6px">Blocked: ' + conns.length + ' connection' + (conns.length === 1 ? '' : 's') + ' use this group. Delete ' + (conns.length === 1 ? 'it' : 'them') + ' first.</div>')
    + '</div>';
}

function vlanEditor(base, path, label) {
  const v = getPath(state.config, base + '.' + path) || {};
  const choice = v.choice || 'non_vlan';
  const p = base + '.' + path;
  let inner = '';
  if (choice === 'vlan') {
    inner = '<input type="number" min="1" max="4094" placeholder="' + SAMPLE.vlan + '" value="' + esc(v.vlan == null ? '' : v.vlan) + '" data-path="' + p + '.vlan" data-type="int" data-optional="1">';
  } else if (choice === 'vlan_range') {
    inner = '<div class="rowline">'
      + '<input type="number" min="1" max="4094" placeholder="start" value="' + esc(getPath(v, 'vlan_range.start') == null ? '' : getPath(v, 'vlan_range.start')) + '" data-path="' + p + '.vlan_range.start" data-type="int" data-optional="1">'
      + '<input type="number" min="0" placeholder="count" value="' + esc(getPath(v, 'vlan_range.count') == null ? '' : getPath(v, 'vlan_range.count')) + '" data-path="' + p + '.vlan_range.count" data-type="int" data-optional="1">'
      + '<input type="number" min="1" placeholder="step" value="' + esc(getPath(v, 'vlan_range.step') == null ? '' : getPath(v, 'vlan_range.step')) + '" data-path="' + p + '.vlan_range.step" data-type="int" data-optional="1">'
      + '</div>';
  }
  return '<label>' + esc(label) + '</label><div>'
    + '<select data-act="vlanChoice" data-p="' + p + '">'
    + selOpts(['vlan', 'vlan_range', 'non_vlan'], choice, { vlan: 'Single VLAN', vlan_range: 'VLAN range', non_vlan: 'Untagged' })
    + '</select>' + (inner ? '<div style="margin-top:5px">' + inner + '</div>' : '') + '</div>';
}

function idEditor(base, path, single, range, label, placeholder, max) {
  const o = getPath(state.config, base + '.' + path) || {};
  const choice = o.choice || single;
  const p = base + '.' + path;
  let inner;
  if (choice === single) {
    inner = '<input type="number" min="0" max="' + max + '" placeholder="' + esc(placeholder) + '" value="' + esc(o[single] == null ? '' : o[single]) + '" data-path="' + p + '.' + single + '" data-type="int" data-optional="1">';
  } else {
    inner = '<div class="rowline">'
      + '<input type="number" min="0" placeholder="start" value="' + esc(getPath(o, range + '.start') == null ? '' : getPath(o, range + '.start')) + '" data-path="' + p + '.' + range + '.start" data-type="int" data-optional="1">'
      + '<input type="number" min="0" placeholder="count" value="' + esc(getPath(o, range + '.count') == null ? '' : getPath(o, range + '.count')) + '" data-path="' + p + '.' + range + '.count" data-type="int" data-optional="1">'
      + '<input type="number" min="1" placeholder="step" value="' + esc(getPath(o, range + '.step') == null ? '' : getPath(o, range + '.step')) + '" data-path="' + p + '.' + range + '.step" data-type="int" data-optional="1">'
      + '</div>';
  }
  return '<label>' + esc(label) + '</label><div>'
    + '<select data-act="idChoice" data-p="' + p + '" data-single="' + single + '" data-range="' + range + '">'
    + selOpts([single, range], choice, { [single]: 'Single', [range]: 'Range' }) + '</select>'
    + '<div style="margin-top:5px">' + inner + '</div></div>';
}

function macEditor(base, path, label, placeholder) {
  const o = getPath(state.config, base + '.' + path) || {};
  const p = base + '.' + path;
  if (o.choice === 'mac_range') {
    return '<label>' + esc(label) + '</label><div class="mini">MAC range \u2014 edit in the JSON pane. Start ' + esc(getPath(o, 'mac_range.start') || '\u2014') + '</div>';
  }
  const bad = o.mac && !MAC_RE.test(o.mac);
  return '<label>' + esc(label) + '</label><input type="text" class="' + (bad ? 'bad' : '') + '" placeholder="' + esc(placeholder) + '" value="' + esc(o.mac || '') + '" data-path="' + p + '.mac" data-type="mac">';
}

function ipEditor(base, path, label, placeholder) {
  const o = getPath(state.config, base + '.' + path) || {};
  const p = base + '.' + path;
  const c = o.choice || 'ipv4';
  if (c === 'ipv4_range' || c === 'ipv6_range') {
    return '<label>' + esc(label) + '</label><div class="mini">IP range \u2014 edit in the JSON pane. Start ' + esc(getPath(o, c + '.start') || '\u2014') + '</div>';
  }
  const val = o[c] || '';
  const bad = val && !(c === 'ipv4' ? IPV4_RE.test(val) : IPV6_RE.test(val));
  return '<label>' + esc(label) + '</label><input type="text" class="' + (bad ? 'bad' : '') + '" placeholder="' + esc(placeholder) + '" value="' + esc(val) + '" data-path="' + p + '.' + c + '" data-type="' + c + '">';
}

function fnEditorHtml(ci, fi) {
  const c = connections()[ci];
  const f = c.functions[fi];
  const d = FN[f.choice];
  const base = 'connections.' + ci + '.functions.' + fi + '.' + f.choice;
  const nfn = c.functions.length;
  let body = '';
  if (!d || !d.authored) {
    body = '<div class="hint">' + esc((d && d.blurb) || 'Unknown function type.') + ' Its fields are preserved as-is.</div>';
  } else if (f.choice === 'connect_ethernet' || f.choice === 'connect_arp') {
    const ets = getPath(state.config, base + '.ethertypes');
    body = '<div class="kv">'
      + vlanEditor(base, 'vlan_endpoint_settings_port1.vlan', 'VLAN on port1')
      + vlanEditor(base, 'vlan_endpoint_settings_port2.vlan', 'VLAN on port2')
      + (f.choice === 'connect_ethernet'
        ? '<label>Ethertypes</label><input type="text" placeholder="empty = all, sample uses ' + SAMPLE.ethertype + '" value="' + esc(Array.isArray(ets) ? ets.join(', ') : '') + '" data-path="' + base + '.ethertypes" data-type="intlist">'
        : '')
      + '</div>'
      + (f.choice === 'connect_arp' && nfn < 2
        ? '<div class="hint" style="margin-top:8px">Add a second ARP function for Q-in-Q, as in <code>passthrough_qinq_symmetric</code>.</div>' : '');
  } else if (f.choice === 'connect_vlan_vxlan') {
    body = '<div class="subh">VLAN endpoint (port1)</div><div class="kv">'
      + vlanEditor(base, 'vlan_endpoint_settings.vlan', 'VLAN')
      + '</div>'
      + '<div class="subh">VXLAN endpoint (port2)</div><div class="kv">'
      + idEditor(base, 'vxlan_endpoint_settings.vni', 'vni', 'vni_range', 'VNI', SAMPLE.vx.id, 16777215)
      + '</div>'
      + '<div class="subh">Outgoing VXLAN header</div><div class="kv">'
      + macEditor(base, 'vxlan_endpoint_settings.outgoing_vxlan_header.src_mac', 'Source MAC', SAMPLE.vx.srcMac)
      + macEditor(base, 'vxlan_endpoint_settings.outgoing_vxlan_header.dst_mac', 'Next-hop MAC', SAMPLE.vx.dstMac)
      + ipEditor(base, 'vxlan_endpoint_settings.outgoing_vxlan_header.src_ip', 'Source IP', SAMPLE.vx.srcIp)
      + ipEditor(base, 'vxlan_endpoint_settings.outgoing_vxlan_header.dst_ip', 'Destination IP', SAMPLE.vx.dstIp)
      + '<label>UDP dst port</label><input type="number" min="0" max="65535" placeholder="' + SAMPLE.udpDstPort + '" value="' + esc(getPath(state.config, base + '.vxlan_endpoint_settings.outgoing_vxlan_header.udp_dst_port') ?? '') + '" data-path="' + base + '.vxlan_endpoint_settings.outgoing_vxlan_header.udp_dst_port" data-type="int" data-optional="1">'
      + '<label>TOS / DSCP</label><input type="number" min="0" max="255" placeholder="0" value="' + esc(getPath(state.config, base + '.vxlan_endpoint_settings.outgoing_vxlan_header.tos') ?? '') + '" data-path="' + base + '.vxlan_endpoint_settings.outgoing_vxlan_header.tos" data-type="int" data-optional="1">'
      + '</div>';
  } else if (f.choice === 'connect_vlan_nvgre') {
    body = '<div class="subh">VLAN endpoint (port1)</div><div class="kv">'
      + vlanEditor(base, 'vlan_endpoint_settings.vlan', 'VLAN')
      + '</div>'
      + '<div class="subh">NVGRE endpoint (port2)</div><div class="kv">'
      + idEditor(base, 'nvgre_endpoint_settings.vsid', 'vsid', 'vsid_range', 'VSID', SAMPLE.nv.id, 16777215)
      + '</div>'
      + '<div class="subh">Outgoing NVGRE header</div><div class="kv">'
      + macEditor(base, 'nvgre_endpoint_settings.outgoing_nvgre_header.src_mac', 'Source MAC', SAMPLE.nv.srcMac)
      + macEditor(base, 'nvgre_endpoint_settings.outgoing_nvgre_header.dst_mac', 'Next-hop MAC', SAMPLE.nv.dstMac)
      + ipEditor(base, 'nvgre_endpoint_settings.outgoing_nvgre_header.src_ip', 'Source IP', SAMPLE.nv.srcIp)
      + ipEditor(base, 'nvgre_endpoint_settings.outgoing_nvgre_header.dst_ip', 'Destination IP', SAMPLE.nv.dstIp)
      + '<label>Flow ID</label><input type="number" min="0" placeholder="' + SAMPLE.nv.flowId + '" value="' + esc(getPath(state.config, base + '.nvgre_endpoint_settings.outgoing_nvgre_header.flow_id') ?? '') + '" data-path="' + base + '.nvgre_endpoint_settings.outgoing_nvgre_header.flow_id" data-type="int" data-optional="1">'
      + '<label>TOS / DSCP</label><input type="number" min="0" max="255" placeholder="0" value="' + esc(getPath(state.config, base + '.nvgre_endpoint_settings.outgoing_nvgre_header.tos') ?? '') + '" data-path="' + base + '.nvgre_endpoint_settings.outgoing_nvgre_header.tos" data-type="int" data-optional="1">'
      + '</div>';
  }
  return '<div class="fnblock"><div class="fh"><span class="t">' + esc(d ? d.label : f.choice) + '</span>'
    + '<button class="btn sm danger" data-act="delFn" data-ci="' + ci + '" data-fi="' + fi + '">'
    + (nfn > 1 ? 'Remove' : 'Remove (deletes connection)') + '</button></div>'
    + '<div class="fb">' + body + '</div></div>';
}

/* Why a connection is JSON-only, in the terms of this config rather than a generic list. */
function roReason(c) {
  const eps = c.endpoints || [];
  const bits = [];
  if (eps.length !== 2) bits.push('it has ' + eps.length + ' endpoints and this UI draws two');
  const missing = eps.filter(ep => !objInfo(ep && ep.port_name)).map(ep => '"' + ((ep && ep.port_name) || '') + '"');
  if (missing.length) bits.push(missing.join(', ') + ' does not match any front_panel_ports entry');
  const dangling = eps.filter(ep => { const o = objInfo(ep && ep.port_name); return o && o.anchorNum == null; });
  if (dangling.length) bits.push('a port group with no valid front-panel port');
  const unauth = (c.functions || []).filter(f => f && FN[f.choice] && !FN[f.choice].authored).map(f => f.choice);
  if (unauth.length) bits.push('it uses ' + [...new Set(unauth)].join(' and ') + ', which has no sample to author from');
  const unknown = (c.functions || []).filter(f => f && !FN[f.choice]);
  if (unknown.length) bits.push('it uses a function type this build does not know');
  return bits.length ? 'This connection is JSON-only because ' + bits.join('; ') + '.' : 'This connection uses a shape this UI does not author.';
}

function connHtml(ci) {
  const c = connections()[ci];
  if (!c) return '<div class="hint">Connection not found.</div>';
  const ro = state.meta && state.meta.readOnly.has(ci);
  const eps = c.endpoints || [];
  const extras = Object.keys(c).filter(k => !['name', 'endpoints', 'functions'].includes(k));
  let html = '<div class="sec"><div class="pipeline">' + pipelineHtml(c) + '</div></div>';
  if (ro) {
    html += '<div class="banner red"><b>Read-only here.</b> ' + esc(roReason(c)) + ' Edit it in the JSON pane; nothing here will rewrite it.</div>';
  }
  const endRow = ep => {
    const name = (ep && ep.port_name) || '';
    const g = groupOf(name);
    let s = portLabel(name) + ' \u2014 ' + name;
    if (g) s += '\n' + 'group of ' + g.memberNums.length + ': ' + g.memberNums.map(n => 'P' + n).join(' + ')
      + (g.anchorNum == null ? '' : ' \u00b7 main P' + g.anchorNum)
      + ' \u00b7 ingress ' + ((g.entry.port_group && g.entry.port_group.ingress_distribution) || 'split');
    return '<div class="mini" style="font-family:var(--mono);white-space:pre-line">' + esc(s) + '</div>';
  };
  html += '<div class="sec"><h3>Endpoints</h3><div class="kv">'
    + '<label>Name</label><input type="text" value="' + esc(c.name || '') + '" data-act="renameConn" data-ci="' + ci + '"' + (ro ? ' disabled' : '') + '>'
    + '<label>port1</label>' + endRow(eps[0])
    + '<label>port2</label>' + (eps.length === 2 ? endRow(eps[1])
      : '<div class="mini" style="font-family:var(--mono)">' + esc(eps.slice(1).map(e => portLabel(e && e.port_name)).join(', ')) + '</div>')
    + '<label>Tags</label><div class="mini" style="font-family:var(--mono)">'
    + esc(eps.map(e => '[' + ((e && e.tags) || []).join(', ') + ']').join(' / ')) + ' <span style="color:var(--muted-2)">derived from functions</span></div>'
    + '</div>'
    + (ro ? '' : '<div style="margin-top:8px"><button class="btn sm" data-act="swapEnds" data-ci="' + ci + '">Swap ends</button>'
      + ' <span class="mini">port1 gets port1 settings; swapping moves them.</span></div>')
    + '</div>';
  html += '<div class="sec"><h3>Functions <span class="mini">' + (c.functions || []).length + '</span></h3>'
    + (c.functions || []).map((f, fi) => fnEditorHtml(ci, fi)).join('')
    + (ro ? '' : '<div class="rowline" style="margin-top:6px;flex-wrap:wrap">'
      + AUTHORED_FNS.map(k => '<button class="btn sm" data-act="addFn" data-ci="' + ci + '" data-choice="' + k + '">+ ' + esc(FN[k].label) + '</button>').join(' ')
      + '</div>')
    + '</div>';
  if (extras.length) {
    html += '<div class="banner amber"><b>Extra keys kept as-is:</b> ' + esc(extras.join(', ')) + '</div>';
  }
  html += '<div class="sec"><button class="btn danger" data-act="delConn" data-ci="' + ci + '">Delete connection</button>'
    + '<div class="hint" style="margin-top:6px">Deleting a connection never touches ports or profiles.</div></div>';
  return html;
}

/* ------------------------------------------------------------------ draft (tunnel types) */

function draftMissing(d) {
  const miss = [];
  const b = d.data;
  const need = (path, label, test) => {
    const v = getPath(b, path);
    if (v == null || v === '' || (test && !test(v))) miss.push(label);
  };
  if (d.choice === 'connect_vlan_vxlan') {
    need('vlan_endpoint_settings.vlan.vlan', 'VLAN ID');
    need('vxlan_endpoint_settings.vni.vni', 'VNI');
    need('vxlan_endpoint_settings.outgoing_vxlan_header.src_mac.mac', 'source MAC', v => MAC_RE.test(v));
    need('vxlan_endpoint_settings.outgoing_vxlan_header.dst_mac.mac', 'next-hop MAC', v => MAC_RE.test(v));
    need('vxlan_endpoint_settings.outgoing_vxlan_header.src_ip.ipv4', 'source IP', v => IPV4_RE.test(v));
    need('vxlan_endpoint_settings.outgoing_vxlan_header.dst_ip.ipv4', 'destination IP', v => IPV4_RE.test(v));
  } else {
    need('vlan_endpoint_settings.vlan.vlan', 'VLAN ID');
    need('nvgre_endpoint_settings.vsid.vsid', 'VSID');
    need('nvgre_endpoint_settings.outgoing_nvgre_header.src_mac.mac', 'source MAC', v => MAC_RE.test(v));
    need('nvgre_endpoint_settings.outgoing_nvgre_header.dst_mac.mac', 'next-hop MAC', v => MAC_RE.test(v));
    need('nvgre_endpoint_settings.outgoing_nvgre_header.src_ip.ipv4', 'source IP', v => IPV4_RE.test(v));
    need('nvgre_endpoint_settings.outgoing_nvgre_header.dst_ip.ipv4', 'destination IP', v => IPV4_RE.test(v));
  }
  return miss;
}

function draftField(path, label, placeholder, kind) {
  const v = getPath(state.draft.data, path);
  const val = v == null ? '' : v;
  let bad = false;
  if (val !== '') {
    if (kind === 'mac') bad = !MAC_RE.test(val);
    else if (kind === 'ipv4') bad = !IPV4_RE.test(val);
  }
  const type = kind === 'int' ? 'number' : 'text';
  return '<label>' + esc(label) + '</label><input type="' + type + '" class="' + (bad ? 'bad' : '') + '" placeholder="' + esc(placeholder) + '" value="' + esc(val) + '" data-dpath="' + path + '" data-dkind="' + kind + '">';
}

function groupPickHtml() {
  const gp = state.groupPick;
  const ready = gp.nums.length >= 2;
  const members = gp.nums.map((n, k) =>
    '<div class="card"><div class="nm">Port ' + n + (k === 0 ? ' \u00b7 main' : '') + '</div>'
    + '<div class="sub">' + (k === 0 ? 'Wires attach here. Clicking it does not remove it.' : 'Click the cage again to remove it.') + '</div></div>'
  ).join('');
  return '<div class="banner amber"><b>Not in the JSON yet.</b> Click empty cages on the chassis to add them. '
    + 'A cage is a regular port or a group member, not both. Ingress will be <code>copy</code>.</div>'
    + '<div class="sec"><h3>Group</h3><div class="kv">'
    + '<label>Name</label><div class="mini" style="font-family:var(--mono)">' + esc(gp.groupName) + '</div>'
    + '<label>Layer 1</label><div class="mini">' + esc(gp.profileName) + '</div>'
    + '<label>Ports</label><div class="mini" style="font-family:var(--mono)">' + esc(gp.nums.map(n => 'P' + n).join(' + ')) + '</div>'
    + '</div></div>'
    + '<div class="sec"><h3>Members</h3>' + members + '</div>'
    + '<div class="sec"><button class="btn primary" data-act="finishGroupPick"' + (ready ? '' : ' disabled') + '>Create group</button> '
    + '<button class="btn" data-act="cancelGroupPick">Cancel</button>'
    + (ready ? '' : '<div class="hint" style="margin-top:6px">Need at least two cages.</div>')
    + '</div>';
}

function draftHtml() {
  const d = state.draft;
  const isVx = d.choice === 'connect_vlan_vxlan';
  const S = isVx ? SAMPLE.vx : SAMPLE.nv;
  const miss = draftMissing(d);
  const hdr = isVx ? 'vxlan_endpoint_settings.outgoing_vxlan_header' : 'nvgre_endpoint_settings.outgoing_nvgre_header';
  let html = '<div class="banner amber"><b>Draft \u2014 not in the JSON yet.</b> '
    + esc(FN[d.choice].label) + ' from <b>' + esc(portLabel(d.p1)) + '</b> (port1) to <b>' + esc(portLabel(d.p2)) + '</b> (port2). '
    + 'It is added to the config once the required fields are filled.</div>';
  html += '<div class="sec"><h3>Encapsulation</h3><div class="kv">'
    + draftField('vlan_endpoint_settings.vlan.vlan', 'VLAN on ' + portLabel(d.p1), SAMPLE.vlan, 'int')
    + draftField(isVx ? 'vxlan_endpoint_settings.vni.vni' : 'nvgre_endpoint_settings.vsid.vsid',
      (isVx ? 'VNI on ' : 'VSID on ') + portLabel(d.p2), S.id, 'int')
    + '</div></div>';
  html += '<div class="sec"><h3>Outer header</h3><div class="kv">'
    + draftField(hdr + '.src_mac.mac', 'Source MAC', S.srcMac, 'mac')
    + draftField(hdr + '.dst_mac.mac', 'Next-hop MAC', S.dstMac, 'mac')
    + draftField(hdr + '.src_ip.ipv4', 'Source IP', S.srcIp, 'ipv4')
    + draftField(hdr + '.dst_ip.ipv4', 'Destination IP', S.dstIp, 'ipv4')
    + (isVx
      ? draftField(hdr + '.udp_dst_port', 'UDP dst port', SAMPLE.udpDstPort, 'int')
      : draftField(hdr + '.flow_id', 'Flow ID', S.flowId, 'int'))
    + '</div><div class="hint" style="margin-top:8px">Greyed values are the ones <code>' + S.sample + '</code> uses, shown as a format hint. Only the UDP port is prefilled (4789 is the API default).</div></div>';
  html += '<div class="sec"><div id="draftStatus" class="' + (miss.length ? 'banner' : 'banner') + '">'
    + (miss.length ? 'Still needed: <b>' + esc(miss.join(', ')) + '</b>' : '<b>Ready.</b> Press Create connection, or just leave the last field.')
    + '</div>'
    + '<div class="rowline"><button class="btn primary" data-act="commitDraft"' + (miss.length ? ' disabled' : '') + '>Create connection</button>'
    + '<button class="btn" data-act="cancelDraft">Discard draft</button></div></div>';
  return html;
}

function draftToFunction(d) {
  const data = clone(d.data);
  if (d.choice === 'connect_vlan_vxlan') {
    setPath(data, 'vlan_endpoint_settings.vlan.choice', 'vlan');
    setPath(data, 'vxlan_endpoint_settings.vni.choice', 'vni');
    if (!isObj(data.vxlan_endpoint_settings.protocols)) data.vxlan_endpoint_settings.protocols = {};
    const h = data.vxlan_endpoint_settings.outgoing_vxlan_header;
    h.src_mac.choice = 'mac'; h.dst_mac.choice = 'mac'; h.src_ip.choice = 'ipv4'; h.dst_ip.choice = 'ipv4';
    // keep sample key order: vni, protocols, outgoing_vxlan_header
    data.vxlan_endpoint_settings = {
      vni: data.vxlan_endpoint_settings.vni,
      protocols: data.vxlan_endpoint_settings.protocols,
      outgoing_vxlan_header: h
    };
  } else {
    setPath(data, 'vlan_endpoint_settings.vlan.choice', 'vlan');
    setPath(data, 'nvgre_endpoint_settings.vsid.choice', 'vsid');
    if (!isObj(data.nvgre_endpoint_settings.protocols)) data.nvgre_endpoint_settings.protocols = {};
    const h = data.nvgre_endpoint_settings.outgoing_nvgre_header;
    h.src_mac.choice = 'mac'; h.dst_mac.choice = 'mac'; h.src_ip.choice = 'ipv4'; h.dst_ip.choice = 'ipv4';
    data.nvgre_endpoint_settings = {
      vsid: data.nvgre_endpoint_settings.vsid,
      protocols: data.nvgre_endpoint_settings.protocols,
      outgoing_nvgre_header: h
    };
  }
  return { choice: d.choice, [d.choice]: data };
}

function commitDraft() {
  const d = state.draft;
  if (!d || draftMissing(d).length) return;
  const conn = {
    name: uniqueConnName(FN[d.choice].nameLabel + ' (' + portLabel(d.p1) + ' <> ' + portLabel(d.p2) + ')'),
    endpoints: [{ port_name: d.p1 }, { port_name: d.p2 }],
    functions: [draftToFunction(d)]
  };
  applyTags(conn);
  if (!Array.isArray(state.config.connections)) state.config.connections = [];
  state.config.connections.push(conn);
  includeNewConnection(state.config.connections.length - 1);
  state.draft = null;
  state.sel = { kind: 'connection', idx: state.config.connections.length - 1 };
  commit();
}

/* ------------------------------------------------------------------ JSON pane messages */

function renderJsonMsg() {
  const box = $('#jsonMsg');
  if (!state.jsonValid) {
    box.classList.remove('hidden', 'warnonly');
    box.innerHTML = state.jsonErrors.slice(0, 40).map(e => '<span class="ln">' + esc(e) + '</span>').join('')
      + (state.jsonErrors.length > 40 ? '<span class="ln">\u2026 and ' + (state.jsonErrors.length - 40) + ' more</span>' : '');
    return;
  }
  if (state.warnings.length) {
    box.classList.remove('hidden');
    box.classList.add('warnonly');
    box.innerHTML = state.warnings.slice(0, 12).map(w => '<span class="ln">! ' + esc(w.text) + '</span>').join('')
      + (state.warnings.length > 12 ? '<span class="ln">\u2026 and ' + (state.warnings.length - 12) + ' more</span>' : '');
    return;
  }
  box.classList.add('hidden');
  box.innerHTML = '';
}

/* ------------------------------------------------------------------ mutations */

function uniqueName(base, taken) {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(base + ' ' + i)) i++;
  return base + ' ' + i;
}
function uniqueConnName(base) {
  return uniqueName(base, new Set(connections().map(c => c && c.name)));
}
function uniquePortName(base) {
  return uniqueName(base, new Set(ports().map(p => p && p.name)));
}

function addProfile(p) {
  if (!isObj(state.config.profiles)) state.config.profiles = {};
  if (!Array.isArray(state.config.profiles.layer_1_profiles)) state.config.profiles.layer_1_profiles = [];
  state.config.profiles.layer_1_profiles.push(p);
}

function assignPort(num, profileName, portName) {
  const entry = {
    name: portName,
    choice: 'front_panel_port',
    front_panel_port: {
      front_panel_port: num,
      channel: 1,
      layer_1_profile_name: profileName
    }
  };
  if (!Array.isArray(state.config.front_panel_ports)) state.config.front_panel_ports = [];
  state.config.front_panel_ports.push(entry);
  state.sel = { kind: 'port', num };
  commit();
}

function assignPortGroup(nums, profileName, groupName) {
  const entry = {
    name: groupName,
    choice: 'port_group',
    port_group: {
      ingress_distribution: 'copy',
      ports: nums.map(n => ({
        front_panel_port: n,
        layer_1_profile_name: profileName
      }))
    }
  };
  if (!Array.isArray(state.config.front_panel_ports)) state.config.front_panel_ports = [];
  state.config.front_panel_ports.push(entry);
  state.sel = { kind: 'port', num: nums[0] };
  commit();
}

function createConnection(num1, num2, choice) {
  // A cage can host a plain port and/or group members; take the highest-priority one.
  const n1 = dragObjectForCage(num1), n2 = dragObjectForCage(num2);
  if (!n1 || !n2 || n1 === n2) return;
  const e1 = { name: n1 }, e2 = { name: n2 };
  if (choice === 'connect_vlan_vxlan' || choice === 'connect_vlan_nvgre') {
    // Only the schema's own default is seeded; everything else is left for the user.
    const seed = {};
    if (choice === 'connect_vlan_vxlan') {
      setPath(seed, 'vxlan_endpoint_settings.outgoing_vxlan_header.udp_dst_port', SAMPLE.udpDstPort);
    }
    state.draft = { p1: e1.name, p2: e2.name, choice, data: seed };
    state.sel = { kind: 'none' };
    render(true);
    return;
  }
  const body = choice === 'connect_ethernet' ? { ethertypes: [] } : {};
  const conn = {
    name: uniqueConnName(FN[choice].nameLabel + ' (P' + num1 + ' <> P' + num2 + ')'),
    endpoints: [{ port_name: e1.name }, { port_name: e2.name }],
    functions: [{ choice, [choice]: body }]
  };
  applyTags(conn);
  if (!Array.isArray(state.config.connections)) state.config.connections = [];
  state.config.connections.push(conn);
  includeNewConnection(state.config.connections.length - 1);
  state.sel = { kind: 'connection', idx: state.config.connections.length - 1 };
  commit();
}

function defaultFnBody(choice) {
  if (choice === 'connect_ethernet') return { ethertypes: [] };
  if (choice === 'connect_arp') return {};
  if (choice === 'connect_vlan_vxlan') {
    return {
      vlan_endpoint_settings: { vlan: { choice: 'vlan' } },
      vxlan_endpoint_settings: { vni: { choice: 'vni' }, protocols: {}, outgoing_vxlan_header: { src_mac: { choice: 'mac' }, dst_mac: { choice: 'mac' }, src_ip: { choice: 'ipv4' }, dst_ip: { choice: 'ipv4' }, udp_dst_port: SAMPLE.udpDstPort } }
    };
  }
  return {
    vlan_endpoint_settings: { vlan: { choice: 'vlan' } },
    nvgre_endpoint_settings: { vsid: { choice: 'vsid' }, protocols: {}, outgoing_nvgre_header: { src_mac: { choice: 'mac' }, dst_mac: { choice: 'mac' }, src_ip: { choice: 'ipv4' }, dst_ip: { choice: 'ipv4' } } }
  };
}

/* ------------------------------------------------------------------ modals */

let modalCleanup = null;
function openModal(html, onMount) {
  const back = $('#modalBack');
  back.innerHTML = html;
  back.classList.remove('hidden');
  if (onMount) onMount(back);
  const first = back.querySelector('input,select,button');
  if (first) first.focus();
  modalCleanup = () => { back.classList.add('hidden'); back.innerHTML = ''; modalCleanup = null; };
}
function closeModal() { if (modalCleanup) modalCleanup(); }

function profileFormHtml(idPrefix) {
  return '<div class="kv">'
    + '<label>Name</label><input type="text" id="' + idPrefix + 'Name" value="' + SAMPLE.profileName + '">'
    + '<label>Link speed</label><select id="' + idPrefix + 'Speed">' + selOpts(SPEEDS, 'speed_400_gbps', SPEED_LABEL) + '</select>'
    + '<label>Mode</label><select id="' + idPrefix + 'Mode">' + selOpts(L1_CHOICES, 'manual') + '</select>'
    + '<label>FEC</label><select id="' + idPrefix + 'Fec">' + selOpts(FECS, 'reed_solomon', FEC_LABEL) + '</select>'
    + '</div>'
    + '<div class="hint" style="margin-top:8px">Every in-scope sample uses one profile: <code>manual_400g_rs</code> \u2014 400G, manual, Reed Solomon.</div>';
}
function readProfileForm(back, idPrefix) {
  const name = back.querySelector('#' + idPrefix + 'Name').value.trim();
  const speed = back.querySelector('#' + idPrefix + 'Speed').value;
  const mode = back.querySelector('#' + idPrefix + 'Mode').value;
  const fec = back.querySelector('#' + idPrefix + 'Fec').value;
  if (!name) return { err: 'A profile needs a name.' };
  if (profiles().some(p => p && p.name === name)) return { err: 'A profile named "' + name + '" already exists.' };
  const p = { name, choice: mode, link_speed: speed };
  p[mode] = { fec_mode: fec };
  return { profile: p };
}

function openNewProfile() {
  openModal('<div class="modal"><header><h2>New Layer 1 profile</h2><span class="sub">profiles.layer_1_profiles</span></header>'
    + '<div class="body">' + profileFormHtml('np') + '<div class="errline" id="npErr"></div></div>'
    + '<footer><button class="btn" data-act="closeModal">Cancel</button><button class="btn primary" data-act="createProfile">Create profile</button></footer></div>');
}

function openAssign(num) {
  const list = profiles();
  const canPick = list.length > 0;
  openModal('<div class="modal"><header><h2>Assign front-panel port ' + num + '</h2><span class="sub">front_panel_ports</span></header>'
    + '<div class="body">'
    + '<div class="subh">Assign as</div>'
    + '<div class="radiorow"><label class="on"><input type="radio" name="akind" value="port" checked> Port</label>'
    + '<label><input type="radio" name="akind" value="group"> Port group</label></div>'
    + '<div class="subh">Layer 1 profile</div>'
    + (canPick
      ? '<div class="radiorow"><label class="on"><input type="radio" name="pmode" value="pick" checked> Use existing</label>'
      + '<label><input type="radio" name="pmode" value="new"> Create new</label></div>'
      + '<div id="pickBox"><select id="apProfile">' + selOpts(list.map(p => p.name), list[0].name) + '</select></div>'
      + '<div id="newBox" class="hidden" style="margin-top:8px">' + profileFormHtml('ap') + '</div>'
      : '<div class="banner">No profiles exist yet, so this creates the first one.</div>' + profileFormHtml('ap'))
    + '<div class="subh" style="margin-top:14px" id="apNameLab">Port name</div>'
    + '<input type="text" id="apPortName" data-auto="1" value="' + esc(uniquePortName('Port ' + num)) + '">'
    + '<div class="hint" style="margin-top:6px" id="apNameHint">This is the <code>name</code> other objects reference. Samples use names like <code>scenario1_ingress</code>.</div>'
    + '<div class="errline" id="apErr"></div>'
    + '</div>'
    + '<footer><button class="btn" data-act="closeModal">Cancel</button>'
    + '<button class="btn primary" id="apGo" data-act="doAssign" data-num="' + num + '">Assign port</button></footer></div>',
    back => {
      const paintRadios = () => {
        back.querySelectorAll('.radiorow label').forEach(l => l.classList.toggle('on', l.querySelector('input').checked));
      };
      const syncKind = () => {
        const isGroup = back.querySelector('input[name=akind]:checked').value === 'group';
        const nameEl = back.querySelector('#apPortName');
        if (nameEl.dataset.auto !== '0') {
          nameEl.value = uniquePortName(isGroup ? 'Port group ' + num : 'Port ' + num);
          nameEl.dataset.auto = '1';
        }
        back.querySelector('#apNameLab').textContent = isGroup ? 'Group name' : 'Port name';
        back.querySelector('#apNameHint').innerHTML = isGroup
          ? 'Connections will reference this name, not the individual cages. Ingress is <code>copy</code>; change it to split in the inspector after creating the group.'
          : 'This is the <code>name</code> other objects reference. Samples use names like <code>scenario1_ingress</code>.';
        const go = back.querySelector('#apGo');
        go.textContent = isGroup ? 'Pick members' : 'Assign port';
        go.dataset.act = isGroup ? 'startGroupPick' : 'doAssign';
        paintRadios();
      };
      back.querySelectorAll('input[name=pmode]').forEach(r => r.addEventListener('change', () => {
        const isNew = back.querySelector('input[name=pmode]:checked').value === 'new';
        back.querySelector('#pickBox').classList.toggle('hidden', isNew);
        back.querySelector('#newBox').classList.toggle('hidden', !isNew);
        paintRadios();
      }));
      back.querySelectorAll('input[name=akind]').forEach(r => r.addEventListener('change', syncKind));
      back.querySelector('#apPortName').addEventListener('input', () => {
        back.querySelector('#apPortName').dataset.auto = '0';
      });
    });
}

function readAssignDialog(back) {
  const isGroup = (back.querySelector('input[name=akind]:checked') || {}).value === 'group';
  const modeRadio = back.querySelector('input[name=pmode]:checked');
  const wantNew = !modeRadio || modeRadio.value === 'new';
  let profileName, newProfile = null;
  if (wantNew) {
    const r = readProfileForm(back, 'ap');
    if (r.err) return { err: r.err };
    newProfile = r.profile;
    profileName = r.profile.name;
  } else {
    profileName = back.querySelector('#apProfile').value;
    if (!profileName) return { err: 'Pick a Layer 1 profile.' };
  }
  const pname = back.querySelector('#apPortName').value.trim();
  if (!pname) return { err: isGroup ? 'The group needs a name.' : 'The port needs a name.' };
  if (!NAME_RE.test(pname)) return { err: 'Name may only use letters, digits, space and - _ ( ) < > [ ]' };
  if (ports().some(p => p && p.name === pname)) return { err: (isGroup ? 'A group' : 'A port') + ' named "' + pname + '" already exists.' };
  return { profileName, newProfile, pname, isGroup };
}

function openTypePicker(num1, num2) {
  const o1 = dragObjectForCage(num1), o2 = dragObjectForCage(num2);
  const side = (num, name) => 'P' + num + ' = ' + name + (isGroup(name) ? ' (group ' + portLabel(name) + ')' : '');
  openModal('<div class="modal"><header><h2>Connect P' + num1 + ' \u2192 P' + num2 + '</h2>'
    + '<span class="sub">port1: ' + esc(side(num1, o1)) + ' \u00b7 port2: ' + esc(side(num2, o2)) + '</span></header>'
    + '<div class="body"><div class="typegrid">'
    + AUTHORED_FNS.map(k => '<button class="typebtn" data-act="pickType" data-choice="' + k + '" data-a="' + num1 + '" data-b="' + num2 + '">'
      + '<span class="t">' + esc(FN[k].label) + '</span><span class="d">' + esc(FN[k].blurb) + '</span></button>').join('')
    + '</div>'
    + '<div class="hint" style="margin-top:12px">Ethernet and ARP are created straight away. VXLAN and NVGRE open a draft first, because the API needs a VNI/VSID and an outer header before the config is usable.</div>'
    + '</div>'
    + '<footer><button class="btn" data-act="closeModal">Cancel</button></footer></div>');
}

/* ------------------------------------------------------------------ files */

function markSaved(name) {
  state.fileName = name;
  state.dirty = false;
  renderToolbar();
}
function doSave(asNew) {
  if (!state.jsonValid) { toast('Fix the JSON errors before saving.'); return; }
  let name = state.fileName;
  if (!name || asNew) {
    name = prompt('Save as file name', name || 'uhd-connect-config.json');
    if (!name) return;
    if (!/\.json$/i.test(name)) name += '.json';
  }
  const blob = new Blob([serialize(state.config)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  markSaved(name);
}
function confirmDiscard() {
  return !state.dirty || confirm('This configuration has unsaved changes. Discard them?');
}
function loadText(text, fileName) {
  jsonEl().value = text;
  jsonEl().scrollTop = 0;
  applyJsonText();
  state.fileName = fileName || null;
  state.dirty = false;
  if (state.jsonValid) {
    state.sel = { kind: 'none' };
    state.scratch = true;
    resetConnFilter();
    render(true);
    toast(fileName ? 'Loaded ' + fileName : 'Configuration loaded');
  } else {
    render(false);
  }
}
function openFile(file) {
  const r = new FileReader();
  r.onload = () => loadText(String(r.result), file.name);
  r.readAsText(file);
}

let toastTimer = null;
function toast(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 2600);
}

/* ------------------------------------------------------------------ align mode */

function renderAlignBar() {
  const b = $('#alignBar');
  const f = (k, label, step) => '<span class="grp">' + label + ' <button class="btn sm" data-act="nudge" data-k="' + k + '" data-d="' + (-step) + '">\u2212</button>'
    + '<code>' + GEOM[k].toFixed(1) + '</code><button class="btn sm" data-act="nudge" data-k="' + k + '" data-d="' + step + '">+</button></span>';
  b.innerHTML = '<b>Align grid</b>' + f('x', 'left', 0.5) + f('y', 'top', 0.5) + f('w', 'width', 0.5) + f('h', 'height', 0.5)
    + f('padX', 'gap X', 1) + f('padY', 'gap Y', 1) + f('cropTop', 'crop top', 2) + f('cropH', 'crop height', 2)
    + '<button class="btn sm" data-act="copyGeom">Copy values</button>'
    + '<span style="opacity:.8">Nudge until the outlines sit on the QSFP cages, then paste the values into <code>GEOM</code> in app.js.</span>';
}

function renderGroupPickBar() {
  const gp = state.groupPick;
  if (!gp) return;
  const ready = gp.nums.length >= 2;
  const ports = gp.nums.map((n, k) => 'P' + n + (k === 0 ? ' main' : '')).join(' \u00b7 ');
  $('#groupPickBar').innerHTML = '<b>Creating port group</b><code>' + esc(gp.groupName) + '</code>'
    + '<span>' + esc(ports) + '</span>'
    + '<span style="opacity:.85">Click empty cages to add. A cage is a regular port or a group member, not both.</span>'
    + '<span class="spacer"></span>'
    + '<button class="btn sm primary" data-act="finishGroupPick"' + (ready ? '' : ' disabled') + '>Create group</button>'
    + '<button class="btn sm" data-act="cancelGroupPick">Cancel</button>';
}

function cancelGroupPick() {
  state.groupPick = null;
  render(true);
}

function toggleGroupPickCage(num) {
  const gp = state.groupPick;
  if (!gp) return;
  const i = gp.nums.indexOf(num);
  if (i === 0) {
    toast('P' + num + ' is the main port. Cancel to start over.');
    return;
  }
  if (i > 0) {
    gp.nums.splice(i, 1);
    render(true);
    return;
  }
  if (isAssigned(num)) {
    toast('Port ' + num + ' is already assigned. A cage is a regular port or a group member, not both.');
    return;
  }
  gp.nums.push(num);
  render(true);
}

function finishGroupPick() {
  const gp = state.groupPick;
  if (!gp || gp.nums.length < 2) {
    toast('A port group needs at least two cages.');
    return;
  }
  if (gp.nums.some(n => isAssigned(n))) {
    toast('A selected cage is already assigned. Remove it, or cancel and start over.');
    return;
  }
  if (ports().some(p => p && p.name === gp.groupName)) {
    toast('A port named "' + gp.groupName + '" already exists.');
    return;
  }
  if (gp.newProfile) addProfile(gp.newProfile);
  const nums = gp.nums.slice(), profileName = gp.profileName, groupName = gp.groupName;
  state.groupPick = null;
  assignPortGroup(nums, profileName, groupName);
}

/* ------------------------------------------------------------------ events */

function onAct(act, el, ev) {
  const cfg = state.config;
  switch (act) {
    case 'new':
      if (!confirmDiscard()) return;
      state.config = emptyConfig();
      state.sel = { kind: 'none' };
      state.draft = null;
      state.groupPick = null;
      state.fileName = null;
      state.scratch = false;
      state.jsonValid = true;
      state.jsonErrors = [];
      resetConnFilter();
      commit(false);
      state.dirty = false;
      renderToolbar();
      return;
    case 'open':
      if (!confirmDiscard()) return;
      $('#fileInput').click();
      return;
    case 'save': doSave(false); return;
    case 'saveas': doSave(true); return;
    case 'pasteJson':
      state.scratch = true;
      render(true);
      jsonEl().focus();
      jsonEl().select();
      toast('Paste your UHD Connect JSON in the pane on the right, then it renders here.');
      return;
    case 'scratch': state.scratch = true; render(true); return;
    case 'zoomIn': setZoom((state.zoom || 1) + ZOOM_STEP); return;
    case 'zoomOut': setZoom((state.zoom || 1) - ZOOM_STEP); return;
    case 'zoomReset': setZoom(1); return;
    case 'revertJson':
      jsonEl().value = serialize(state.config);
      state.jsonValid = true;
      state.jsonErrors = [];
      revalidate();
      render(false);
      toast('JSON reverted to the configuration on the canvas.');
      return;
    case 'copyJson':
      navigator.clipboard.writeText(jsonEl().value).then(() => toast('JSON copied.'), () => toast('Copy failed.'));
      return;
    case 'formatJson':
      if (!state.jsonValid) { toast('Cannot format: the JSON does not parse.'); return; }
      jsonEl().value = serialize(state.config);
      toast('Formatted.');
      return;
    case 'tutOpen': openTutorials(null, null); return;
    case 'tutClose': closeTutorials(); return;
    case 'tutGo':
      if (el.dataset.file && el.dataset.file !== (tutPage(tut.id) || {}).file) {
        openTutorials(el.dataset.file, el.dataset.anchor || null);
      } else if (!tutScrollTo(el.dataset.anchor)) {
        $('#tutDoc').scrollTop = 0;
      }
      return;
    case 'tutJump': tutScrollTo(el.dataset.anchor); return;
    case 'tutCopy': {
      const c = tut.codes[Number(el.dataset.i)];
      if (!c) return;
      navigator.clipboard.writeText(c.body + '\n').then(() => toast('Copied.'), () => toast('Copy failed.'));
      return;
    }
    case 'tutLoad': {
      const c = tut.codes[Number(el.dataset.i)];
      if (!c) return;
      let obj;
      try { obj = JSON.parse(c.body); }
      catch (e) { toast('That block is a fragment, not a whole config. Use Copy instead.'); return; }
      if (!confirmDiscard()) return;
      closeTutorials();
      loadText(serialize(obj), null);
      return;
    }
    case 'devOpen': openDevice(); return;
    case 'devClose': closeDevice(); return;
    case 'devConnect':
    case 'devRefresh': devReadMetrics(); return;
    case 'devPoll': devTogglePoll(); return;
    case 'devClear': devAskClear(); return;
    case 'devClearGo': devClearCounters(); return;
    case 'devClearNo': $('#devClearConfirm').classList.add('hidden'); return;
    case 'devPull': devPull(); return;
    case 'devLoadPulled': devLoadPulled(); return;
    case 'devPush': devAskPush(); return;
    case 'devPushGo': devPush(); return;
    case 'devPushNo': $('#devCfgConfirm').classList.add('hidden'); return;
    case 'devWatch':
      if (el.checked) dev.watch.add(el.dataset.name); else dev.watch.delete(el.dataset.name);
      devSavePrefs();
      renderDevPorts();
      renderDevMetrics();
      return;
    case 'devWatchAll':
      dev.ports.forEach(n => dev.watch.add(n));
      devSavePrefs();
      renderDevPorts();
      renderDevMetrics();
      return;
    case 'devWatchNone':
      dev.watch.clear();
      devSavePrefs();
      renderDevPorts();
      renderDevMetrics();
      return;
    case 'newProfile': openNewProfile(); return;
    case 'closeModal': closeModal(); return;
    case 'createProfile': {
      const back = $('#modalBack');
      const r = readProfileForm(back, 'np');
      if (r.err) { back.querySelector('#npErr').textContent = r.err; return; }
      addProfile(r.profile);
      state.sel = { kind: 'profile', name: r.profile.name };
      closeModal();
      commit();
      return;
    }
    case 'selProfile': state.sel = { kind: 'profile', name: el.dataset.name }; render(true); return;
    case 'pickProfile': {
      const name = el.value;
      if (!name) return;
      state.sel = { kind: 'profile', name };
      render(true);
      return;
    }
    case 'toggleConnMenu':
      state.connMenuOpen = !state.connMenuOpen;
      renderList();
      if (state.connMenuOpen) {
        const q = $('#connFilter');
        if (q) q.focus();
      }
      return;
    case 'toggleConnVis':
      setConnChecked(Number(el.dataset.idx), el.checked);
      render(true);
      return;
    case 'connShowAll':
      state.connShown = null;
      render(true);
      return;
    case 'connShowNone': {
      const q = (state.connQuery || '').trim();
      if (q) {
        const keep = new Set();
        connections().forEach((c, i) => { if (!connMatchesQuery(c)) keep.add(i); });
        state.connShown = keep;
      } else {
        state.connShown = new Set();
      }
      render(true);
      return;
    }
    case 'selPortNum': state.sel = { kind: 'port', num: Number(el.dataset.num) }; render(true); return;
    case 'selConn': state.sel = { kind: 'connection', idx: Number(el.dataset.idx) }; render(true); return;
    case 'assign': openAssign(Number(el.dataset.num)); return;
    case 'doAssign': {
      const back = $('#modalBack');
      const num = Number(el.dataset.num);
      const errEl = back.querySelector('#apErr');
      const r = readAssignDialog(back);
      if (r.err) { errEl.textContent = r.err; return; }
      if (r.newProfile) addProfile(r.newProfile);
      closeModal();
      assignPort(num, r.profileName, r.pname);
      return;
    }
    case 'startGroupPick': {
      const back = $('#modalBack');
      const num = Number(el.dataset.num);
      const errEl = back.querySelector('#apErr');
      const r = readAssignDialog(back);
      if (r.err) { errEl.textContent = r.err; return; }
      closeModal();
      state.groupPick = { nums: [num], profileName: r.profileName, groupName: r.pname, newProfile: r.newProfile };
      state.scratch = true;
      state.sel = { kind: 'none' };
      render(true);
      return;
    }
    case 'cancelGroupPick': cancelGroupPick(); return;
    case 'finishGroupPick': finishGroupPick(); return;
    case 'pickType': {
      const a = Number(el.dataset.a), b = Number(el.dataset.b);
      closeModal();
      createConnection(a, b, el.dataset.choice);
      return;
    }
    case 'renameProfile': {
      const i = Number(el.dataset.i);
      const p = profiles()[i];
      const v = el.value.trim();
      if (!v) { toast('A profile needs a name.'); render(true); return; }
      if (v !== p.name && profiles().some(q => q && q.name === v)) { toast('That profile name is taken.'); render(true); return; }
      const old = p.name;
      p.name = v;
      ports().forEach(e => {
        if (getPath(e, 'front_panel_port.layer_1_profile_name') === old) e.front_panel_port.layer_1_profile_name = v;
        ((e && e.port_group && e.port_group.ports) || []).forEach(m => {
          if (isObj(m) && m.layer_1_profile_name === old) m.layer_1_profile_name = v;
        });
      });
      state.sel = { kind: 'profile', name: v };
      commit();
      return;
    }
    case 'profileMode': {
      const i = Number(el.dataset.i);
      const p = profiles()[i];
      const to = el.value, from = to === 'manual' ? 'autonegotiation' : 'manual';
      const fec = getPath(p, from + '.fec_mode') || getPath(p, to + '.fec_mode') || 'reed_solomon';
      delete p[from];
      p.choice = to;
      p[to] = Object.assign({}, p[to], { fec_mode: fec });
      commit();
      return;
    }
    case 'delProfile': {
      const i = Number(el.dataset.i);
      const p = profiles()[i];
      if ((profileUsage().get(p.name) || []).length) { toast('Still in use.'); return; }
      profiles().splice(i, 1);
      state.sel = { kind: 'none' };
      commit();
      return;
    }
    case 'renamePort': {
      const i = Number(el.dataset.i);
      const e = ports()[i];
      const v = el.value.trim();
      if (!v) { toast('A port needs a name.'); render(true); return; }
      if (!NAME_RE.test(v)) { toast('Name may only use letters, digits, space and - _ ( ) < > [ ]'); render(true); return; }
      if (v !== e.name && ports().some(q => q && q.name === v)) { toast('That port name is taken.'); render(true); return; }
      const old = e.name;
      e.name = v;
      connections().forEach(c => (c.endpoints || []).forEach(ep => { if (ep && ep.port_name === old) ep.port_name = v; }));
      renameOutside(old, v);
      commit();
      return;
    }
    case 'outLabel': {
      const name = el.dataset.name;
      const v = el.value.trim();
      setOutside(name, { label: v && v !== name ? v : '' });
      commit();
      return;
    }
    case 'outKind': {
      setOutside(el.dataset.name, { kind: el.value });
      commit();
      return;
    }
    case 'outNote': {
      setOutside(el.dataset.name, { note: el.value.trim() });
      commit();
      return;
    }
    case 'outHidden': {
      setOutside(el.dataset.name, { hidden: el.value === 'false' });
      commit();
      return;
    }
    case 'outReset': {
      const m = outsideMap();
      if (isObj(m[el.dataset.name])) { delete state.config[X_KEY].outside[el.dataset.name]; pruneOutside(); }
      commit();
      return;
    }
    case 'clearPort':
    case 'delPortObj': {
      const i = Number(el.dataset.i);
      const e = ports()[i];
      if (!e) return;
      if (connIndicesForObject(e.name).length) { toast('Still used by a connection.'); return; }
      ports().splice(i, 1);
      const m = outsideMap();
      if (isObj(m[e.name])) { delete state.config[X_KEY].outside[e.name]; pruneOutside(); }
      state.sel = { kind: 'none' };
      commit();
      return;
    }
    case 'renameConn': {
      const ci = Number(el.dataset.ci);
      const c = connections()[ci];
      const v = el.value.trim();
      if (!v) { toast('A connection needs a name.'); render(true); return; }
      if (!NAME_RE.test(v)) { toast('Name may only use letters, digits, space and - _ ( ) < > [ ]'); render(true); return; }
      if (v !== c.name && connections().some(q => q && q.name === v)) { toast('That connection name is taken.'); render(true); return; }
      c.name = v;
      commit();
      return;
    }
    case 'swapEnds': {
      const c = connections()[Number(el.dataset.ci)];
      if (!c || (c.endpoints || []).length !== 2) return;
      c.endpoints.reverse();
      (c.functions || []).forEach(f => {
        const b = f && f[f.choice];
        if (!isObj(b)) return;
        const a = b.vlan_endpoint_settings_port1, z = b.vlan_endpoint_settings_port2;
        if (a !== undefined || z !== undefined) {
          if (z === undefined) delete b.vlan_endpoint_settings_port1; else b.vlan_endpoint_settings_port1 = z;
          if (a === undefined) delete b.vlan_endpoint_settings_port2; else b.vlan_endpoint_settings_port2 = a;
        }
        const m = b.dst_mac_endpoint_settings_port1, n = b.dst_mac_endpoint_settings_port2;
        if (m !== undefined || n !== undefined) {
          if (n === undefined) delete b.dst_mac_endpoint_settings_port1; else b.dst_mac_endpoint_settings_port1 = n;
          if (m === undefined) delete b.dst_mac_endpoint_settings_port2; else b.dst_mac_endpoint_settings_port2 = m;
        }
      });
      applyTags(c);
      commit();
      return;
    }
    case 'addFn': {
      const ci = Number(el.dataset.ci);
      const c = connections()[ci];
      const choice = el.dataset.choice;
      c.functions.push({ choice, [choice]: defaultFnBody(choice) });
      applyTags(c);
      commit();
      return;
    }
    case 'delFn': {
      const ci = Number(el.dataset.ci), fi = Number(el.dataset.fi);
      const c = connections()[ci];
      if (c.functions.length <= 1) {
        if (!confirm('A connection must have at least one function. Remove the whole connection "' + c.name + '"?')) return;
        connections().splice(ci, 1);
        state.sel = { kind: 'none' };
        commit();
        return;
      }
      c.functions.splice(fi, 1);
      applyTags(c);
      commit();
      return;
    }
    case 'delConn': {
      const ci = Number(el.dataset.ci);
      connections().splice(ci, 1);
      state.sel = { kind: 'none' };
      commit();
      return;
    }
    case 'vlanChoice': {
      const p = el.dataset.p, v = el.value;
      const cur = getPath(cfg, p) || {};
      let next;
      if (v === 'non_vlan') next = { choice: 'non_vlan' };
      else if (v === 'vlan') next = cur.vlan != null ? { choice: 'vlan', vlan: cur.vlan } : { choice: 'vlan' };
      else next = { choice: 'vlan_range', vlan_range: cur.vlan_range || (cur.vlan != null ? { start: cur.vlan } : {}) };
      setPath(cfg, p, next);
      afterFieldEdit(p);
      return;
    }
    case 'idChoice': {
      const p = el.dataset.p, single = el.dataset.single, range = el.dataset.range;
      const cur = getPath(cfg, p) || {};
      let next;
      if (el.value === single) next = cur[single] != null ? { choice: single, [single]: cur[single] } : { choice: single };
      else next = { choice: range, [range]: cur[range] || (cur[single] != null ? { start: cur[single] } : {}) };
      setPath(cfg, p, next);
      afterFieldEdit(p);
      return;
    }
    case 'commitDraft': commitDraft(); return;
    case 'cancelDraft': state.draft = null; render(true); return;
    case 'gotoWarn': {
      const w = state.warnings[Number(el.dataset.i)];
      if (w && w.sel) { state.sel = w.sel; render(true); }
      return;
    }
    case 'nudge': {
      const k = el.dataset.k;
      GEOM[k] = Math.round((GEOM[k] + Number(el.dataset.d)) * 10) / 10;
      render(true);
      return;
    }
    case 'copyGeom': {
      const txt = 'const GEOM = { x: ' + GEOM.x + ', y: ' + GEOM.y + ', w: ' + GEOM.w + ', h: ' + GEOM.h
        + ', padX: ' + GEOM.padX + ', padY: ' + GEOM.padY + ', cropTop: ' + GEOM.cropTop + ', cropH: ' + GEOM.cropH + ' };';
      navigator.clipboard.writeText(txt).then(() => toast('Geometry copied: ' + txt), () => toast(txt));
      return;
    }
  }
}

/* Path edits from the inspector: mutate in place, derive tags for the touched connection. */
function afterFieldEdit(path) {
  const m = /^connections\.(\d+)\b/.exec(path);
  if (m) {
    const c = connections()[Number(m[1])];
    if (c && !(state.meta && state.meta.readOnly.has(Number(m[1])))) applyTags(c);
  }
  commit();
}

function onFieldChange(el) {
  const path = el.dataset.path;
  const type = el.dataset.type;
  const optional = el.dataset.optional === '1';
  let raw = el.value;
  if (type === 'int') {
    if (raw.trim() === '') { if (optional) delPath(state.config, path); else setPath(state.config, path, 0); }
    else {
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n)) { toast('Not a number.'); render(true); return; }
      setPath(state.config, path, n);
    }
  } else if (type === 'bool') {
    setPath(state.config, path, raw === 'true');
  } else if (type === 'intlist') {
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    const nums = [];
    for (const p of parts) {
      const n = parseInt(p, 10);
      if (!Number.isFinite(n) || n < 0 || n > 65535) { toast('Ethertypes must be numbers from 0 to 65535.'); render(true); return; }
      nums.push(n);
    }
    setPath(state.config, path, nums);
  } else if (type === 'mac') {
    if (!raw.trim()) delPath(state.config, path);
    else if (!MAC_RE.test(raw.trim())) { toast('MAC must look like ' + SAMPLE.mac); setPath(state.config, path, raw.trim()); }
    else setPath(state.config, path, raw.trim());
  } else if (type === 'ipv4' || type === 'ipv6') {
    if (!raw.trim()) delPath(state.config, path);
    else setPath(state.config, path, raw.trim());
  } else {
    if (!raw.trim() && optional) delPath(state.config, path);
    else setPath(state.config, path, raw);
  }
  afterFieldEdit(path);
}

function onDraftInput(el) {
  const path = el.dataset.dpath, kind = el.dataset.dkind;
  const raw = el.value.trim();
  if (raw === '') delPath(state.draft.data, path);
  else if (kind === 'int') {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n)) setPath(state.draft.data, path, n);
  } else setPath(state.draft.data, path, raw);
  const miss = draftMissing(state.draft);
  const box = $('#draftStatus');
  if (box) {
    box.innerHTML = miss.length
      ? 'Still needed: <b>' + esc(miss.join(', ')) + '</b>'
      : '<b>Ready.</b> Press Create connection, or just leave the last field.';
  }
  const btn = document.querySelector('[data-act="commitDraft"]');
  if (btn) btn.disabled = miss.length > 0;
  el.classList.toggle('bad', raw !== '' && (kind === 'mac' ? !MAC_RE.test(raw) : kind === 'ipv4' ? !IPV4_RE.test(raw) : false));
}

/* ------------------------------------------------------------------ tutorials
 *
 * Pages are the markdown in docs/tutorials, bundled into tutorials.js by
 * tools/build-tutorials.cjs. They are bundled rather than fetched because the
 * page is opened over file://, where fetching a sibling file is blocked. After
 * editing the markdown, re-run that script.
 *
 * Only the subset of markdown those pages use is rendered: headings, paragraphs,
 * lists, tables, fenced code, inline emphasis and code, and links to another
 * page or an anchor. */

/* Same rule as slug() in tools/build-tutorials.cjs, so a heading and the
 * sidebar entry pointing at it agree on the id. */
const TUT_SLUG = s => String(s).toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/\s+/g, '-');

const tut = { open: false, id: null, codes: [] };

const tutPages = () => (Array.isArray(window.TUTORIALS) ? window.TUTORIALS : []);
const tutPage = id => tutPages().find(p => p.id === id) || tutPages()[0] || null;

function mdInline(s) {
  // inline code is pulled out first so emphasis and links never fire inside it
  const spans = [];
  s = String(s).replace(/`([^`]+)`/g, (m, c) => { spans.push(c); return '\u0001' + (spans.length - 1) + '\u0001'; });
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, href) => {
    const link = /^([A-Za-z0-9_.-]+\.md)?(?:#([A-Za-z0-9-]+))?$/.exec(href.trim());
    const file = link && link[1];
    const anchor = link && link[2];
    // a link this reader cannot follow is shown as plain text rather than as a dead one
    if (!link || (file && !tutPages().some(p => p.file === file))) return text;
    return '<a class="xref" data-act="tutGo"'
      + (file ? ' data-file="' + esc(file) + '"' : '')
      + (anchor ? ' data-anchor="' + esc(anchor) + '"' : '') + '>' + text + '</a>';
  });
  // bold first, allowing single asterisks inside so nested italic survives to the next pass
  s = s.replace(/\*\*((?:[^*]|\*(?!\*))+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  return s.replace(/\u0001(\d+)\u0001/g, (m, i) => '<code>' + esc(spans[Number(i)]) + '</code>');
}

/* A block is worth a "Load" button only if it is a whole config that declares at
 * least one port and that this app would actually accept -- which rules out
 * fragments, the empty skeleton, and the breakout pages the canvas refuses. */
function tutLoadable(c) {
  if (c.lang !== 'json') return false;
  let obj;
  try { obj = JSON.parse(c.body); } catch (e) { return false; }
  if (!isObj(obj) || !Array.isArray(obj.front_panel_ports) || !obj.front_panel_ports.length) return false;
  return validate(obj).errors.length === 0;
}

/* Enough JSON colouring to tell a key from a value at a glance. Tokens are taken
 * from the raw text and escaped as they are emitted, so nothing in a block can
 * inject markup. */
function tutHl(src) {
  const re = /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g;
  let out = '', last = 0, m;
  while ((m = re.exec(src)) !== null) {
    out += esc(src.slice(last, m.index));
    if (m[1]) out += m[2] ? '<i class="k">' + esc(m[1]) + '</i>' + esc(m[2]) : '<i class="s">' + esc(m[1]) + '</i>';
    else if (m[3]) out += '<i class="b">' + esc(m[3]) + '</i>';
    else out += '<i class="n">' + esc(m[4]) + '</i>';
    last = re.lastIndex;
  }
  return out + esc(src.slice(last));
}

function tutCodeHtml(c, i) {
  const load = tutLoadable(c)
    ? '<button class="btn sm" data-act="tutLoad" data-i="' + i + '">Load into canvas</button>'
    : '';
  return '<div class="tutcode"><div class="ch"><span class="lang">' + esc(c.lang) + '</span>'
    + '<span class="acts">' + load
    + '<button class="btn sm ghost" data-act="tutCopy" data-i="' + i + '">Copy</button>'
    + '</span></div><pre><code>' + (c.lang === 'json' ? tutHl(c.body) : esc(c.body)) + '</code></pre></div>';
}

function mdToHtml(md) {
  const codes = [];
  md = String(md).replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, body) => {
    codes.push({ lang: lang || 'text', body: body.replace(/\s+$/, '') });
    return '\u0000' + (codes.length - 1) + '\u0000';
  });

  const lines = md.split('\n');
  const out = [];
  let para = [], list = null;
  // "On the UI" repeats once per scenario, so ids get a counter to stay unique
  const seen = new Map();
  const headId = text => {
    const base = TUT_SLUG(text);
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : base + '-' + n;
  };
  const flushPara = () => { if (para.length) { out.push('<p>' + mdInline(para.join(' ')) + '</p>'); para = []; } };
  const flushList = () => {
    if (!list) return;
    // a table or note between steps ends the <ol>, so carry the authored number over
    const open = list.tag === 'ol' && list.start > 1 ? '<ol start="' + list.start + '">' : '<' + list.tag + '>';
    out.push(open + list.items.map(t => '<li>' + mdInline(t) + '</li>').join('') + '</' + list.tag + '>');
    list = null;
  };
  const flush = () => { flushPara(); flushList(); };
  const cells = row => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(x => x.trim());

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) { flush(); continue; }

    let m = /^<a id="([A-Za-z0-9-]+)"><\/a>$/.exec(t);
    if (m) { flush(); out.push('<a id="' + esc(m[1]) + '"></a>'); continue; }

    m = /^\u0000(\d+)\u0000$/.exec(t);
    if (m) { flush(); out.push(tutCodeHtml(codes[Number(m[1])], Number(m[1]))); continue; }

    m = /^(#{1,6})\s+(.*)$/.exec(t);
    if (m) {
      flush();
      const lvl = m[1].length, text = m[2].trim();
      out.push('<h' + lvl + ' id="' + esc(headId(text)) + '">' + mdInline(text) + '</h' + lvl + '>');
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(t)) { flush(); out.push('<hr>'); continue; }

    if (t.startsWith('|') && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      flush();
      const head = cells(t);
      const body = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) { body.push(cells(lines[i])); i++; }
      i--;
      out.push('<table><thead><tr>' + head.map(x => '<th>' + mdInline(x) + '</th>').join('')
        + '</tr></thead><tbody>'
        + body.map(r => '<tr>' + r.map(x => '<td>' + mdInline(x) + '</td>').join('') + '</tr>').join('')
        + '</tbody></table>');
      continue;
    }

    m = /^[-*]\s+(.*)$/.exec(t);
    if (m) {
      flushPara();
      if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; }
      list.items.push(m[1]);
      continue;
    }
    m = /^(\d+)\.\s+(.*)$/.exec(t);
    if (m) {
      flushPara();
      if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [], start: Number(m[1]) }; }
      list.items.push(m[2]);
      continue;
    }

    // a wrapped continuation line belongs to whatever block is still open
    if (list) { list.items[list.items.length - 1] += ' ' + t; continue; }
    para.push(t);
  }
  flush();
  return { html: out.join('\n'), codes };
}

function tutScrollTo(anchor) {
  const doc = $('#tutDoc'), body = $('#tutBody');
  if (!doc || !body || !anchor) return false;
  const el = body.querySelector('[id="' + String(anchor).replace(/["\\]/g, '') + '"]');
  if (!el) return false;
  doc.scrollTop += el.getBoundingClientRect().top - doc.getBoundingClientRect().top - 12;
  return true;
}

function renderTutorials(anchor) {
  const pages = tutPages();
  const page = tutPage(tut.id);
  const nav = $('#tutNav'), body = $('#tutBody');
  if (!nav || !body) return;
  if (!page) {
    nav.innerHTML = '';
    body.innerHTML = '<h1>Tutorials unavailable</h1><p>The bundled pages did not load. '
      + 'Run <code>node tools/build-tutorials.cjs</code> to regenerate '
      + '<code>tutorials.js</code>, then reload this page.</p>';
    return;
  }
  tut.id = page.id;
  $('#tutSub').textContent = 'docs/tutorials/' + page.file;
  nav.innerHTML = pages.map(p => {
    const on = p.id === page.id;
    return '<button class="np' + (on ? ' on' : '') + '" data-act="tutGo" data-file="' + esc(p.file) + '">'
      + esc(p.nav) + '<span class="c">' + esc(p.file) + '</span></button>'
      + (on && p.toc.length
        ? '<div class="ns">' + p.toc.map(s => '<a data-act="tutJump" data-anchor="' + esc(s.anchor) + '">'
          + esc(s.text) + '</a>').join('') + '</div>'
        : '');
  }).join('');
  const r = mdToHtml(page.md);
  tut.codes = r.codes;
  body.innerHTML = r.html;
  if (!(anchor && tutScrollTo(anchor))) $('#tutDoc').scrollTop = 0;
}

function openTutorials(file, anchor) {
  const page = (file && tutPages().find(p => p.file === file)) || tutPage(tut.id);
  tut.open = true;
  tut.id = page ? page.id : null;
  $('#tutBack').classList.remove('hidden');
  renderTutorials(anchor);          // after unhiding, so anchor offsets measure correctly
}

function closeTutorials() {
  tut.open = false;
  $('#tutBack').classList.add('hidden');
}

/* ------------------------------------------------------------------ device
 * The only part of the app that talks to a live UHD. Everything else stays a file
 * editor, and a config crosses between the box and the canvas only when someone
 * presses Pull or Push — never as a side effect of opening this panel. */

const DEV_PREFS_KEY = 'uhd_device';
const DEV_POLL_MS = 3000;
const DEV_API = '/connect/api/v1';

const DEV_METRICS = [
  ['link_status', 'Link status'],
  ['frames_received_all', 'Frames RX (all)'],
  ['frames_received_unicast', 'Frames RX (unicast)'],
  ['frames_transmitted_all', 'Frames TX (all)'],
  ['frames_transmitted_unicast', 'Frames TX (unicast)'],
  ['frames_dropped_egress', 'Frames dropped (egress)']
];

const dev = {
  open: false,
  ip: '',
  ports: [],         // port names, as the device last reported them
  watch: new Set(),  // the ones the table shows
  timer: null,
  last: null,        // last metrics payload
  pulled: null,      // last config read off the box
  reach: null,       // null not tried yet, true reachable, false not
  msg: null          // { bad, text } under the counter buttons
};

/* localStorage is unavailable on some file:// setups and throws rather than
 * returning null, so every access goes through here. */
function devStore(fn) {
  try { return fn(); } catch (e) { return null; }
}

function devLoadPrefs() {
  const raw = devStore(() => localStorage.getItem(DEV_PREFS_KEY));
  if (!raw) return;
  let o;
  try { o = JSON.parse(raw); } catch (e) { return; }
  if (!isObj(o)) return;
  if (typeof o.ip === 'string') dev.ip = o.ip;
  if (Array.isArray(o.watch)) dev.watch = new Set(o.watch.filter(n => typeof n === 'string'));
}

function devSavePrefs() {
  const body = JSON.stringify({ ip: dev.ip, watch: [...dev.watch] });
  devStore(() => localStorage.setItem(DEV_PREFS_KEY, body));
}

/* ---------------- requests ---------------- */

async function devCall(path, body) {
  if (!dev.ip) throw new Error('NO_IP');
  const init = body === undefined
    ? { method: 'GET' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  let res;
  try {
    res = await fetch('https://' + dev.ip + DEV_API + path, init);
  } catch (e) {
    // fetch rejects the same way for a refused connection and an untrusted
    // certificate, so the message has to cover both
    dev.reach = false;
    throw new Error('UNREACHABLE');
  }
  const text = await res.text();
  let data = text;
  if (text) { try { data = JSON.parse(text); } catch (e) { /* not JSON: keep the text */ } }
  if (!res.ok) {
    const err = new Error('HTTP ' + res.status + ' ' + res.statusText);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  dev.reach = true;
  return data;
}

function devErrText(e) {
  if (e.message === 'NO_IP') return 'Enter the device address first.';
  if (e.message === 'UNREACHABLE') {
    return 'Cannot reach https://' + dev.ip + '\n\n'
      + 'A UHD serves its API over HTTPS with a certificate the browser will not trust until you '
      + 'accept it by hand. Open https://' + dev.ip + ' in a new tab, accept the warning, then come '
      + 'back and retry.\n\n'
      + 'If you have already done that, check the address and that the box answers from this machine.';
  }
  if (e.status) return e.message + (e.data ? '\n\n' + devText(e.data) : '');
  return e.message;
}

function devText(v) {
  return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
}

function devPortName(e) {
  const fp = e && e.meta ? e.meta.front_panel_port : null;
  return (e && e.port_name) || 'port ' + (fp == null ? '?' : fp);
}

function devWatched() {
  return dev.ports.filter(n => dev.watch.has(n));
}

/* ---------------- render ---------------- */

function renderDevice() {
  if (!dev.open) return;
  renderDevPill();
  renderDevCert();
  renderDevPorts();
  renderDevMetrics();
}

function renderDevPill() {
  const pill = $('#devPill');
  if (!pill) return;
  const span = pill.querySelector('span');
  pill.classList.remove('bad', 'warn', 'off');
  if (dev.reach === true) {
    span.textContent = dev.timer ? 'Polling' : 'Connected';
  } else if (dev.reach === false) {
    pill.classList.add('bad');
    span.textContent = 'Unreachable';
  } else {
    pill.classList.add('off');
    span.textContent = 'Not connected';
  }
  $('#devSub').textContent = dev.ip ? 'https://' + dev.ip + DEV_API : 'no address set';
}

function renderDevCert() {
  const b = $('#devCert');
  if (!b) return;
  const show = !!dev.ip && dev.reach !== true;
  b.classList.toggle('hidden', !show);
  if (!show) return;
  const url = 'https://' + esc(dev.ip);
  b.innerHTML = 'The UHD presents a self-signed certificate. If a call fails with a network error, '
    + 'open <a class="linkish" href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a> '
    + 'once, accept the warning, then come back.';
}

function renderDevPorts() {
  const wrap = $('#devPorts');
  if (!wrap) return;
  const count = $('#devPortCount');
  if (count) count.textContent = dev.ports.length ? dev.watch.size + ' of ' + dev.ports.length : '';
  if (!dev.ports.length) {
    wrap.innerHTML = '<div class="hint">No ports read yet. Press <b>Connect</b> to ask the device what it has.</div>';
    return;
  }
  wrap.innerHTML = dev.ports.map(n =>
    '<label><input type="checkbox" data-act="devWatch" data-name="' + esc(n) + '"'
    + (dev.watch.has(n) ? ' checked' : '') + '>'
    + '<span class="nm">' + esc(n) + '</span>'
    + (objInfo(n) ? '<span class="tag">on canvas</span>' : '')
    + '</label>').join('');
}

function renderDevMsg() {
  const el = $('#devMetricsMsg');
  if (!el) return;
  if (!dev.msg) { el.innerHTML = ''; return; }
  el.innerHTML = dev.msg.bad
    ? '<div class="banner red" style="white-space:pre-wrap;margin-bottom:9px">' + esc(dev.msg.text) + '</div>'
    : '<div class="mini" style="margin-bottom:9px">' + esc(dev.msg.text) + '</div>';
}

function renderDevMetrics() {
  renderDevMsg();
  const wrap = $('#devMetrics');
  if (!wrap) return;
  if (!dev.last) {
    wrap.innerHTML = '<div class="hint">Nothing read yet. <b>Refresh</b> takes one reading, '
      + '<b>Start polling</b> keeps it live every ' + (DEV_POLL_MS / 1000) + 's.</div>';
    return;
  }
  const shown = devWatched();
  if (!shown.length) {
    wrap.innerHTML = '<div class="hint">No ports chosen. Tick the ones you want to watch on the left.</div>';
    return;
  }
  const by = {};
  const list = (dev.last.port_metrics && dev.last.port_metrics.metrics) || [];
  for (const e of list) by[devPortName(e)] = e.metrics || {};

  let h = '<table><thead><tr><th class="rl">Metric</th>'
    + shown.map(n => '<th>' + esc(n) + '</th>').join('')
    + '</tr></thead><tbody>';
  for (const [key, label] of DEV_METRICS) {
    h += '<tr><td class="rl">' + esc(label) + '</td>'
      + shown.map(n => '<td>' + devCell(key, (by[n] || {})[key]) + '</td>').join('')
      + '</tr>';
  }
  wrap.innerHTML = h + '</tbody></table>';
}

function devCell(key, v) {
  if (v == null) return '<span class="chip mute">n/a</span>';
  if (key === 'link_status') {
    const up = v === 'link_up';
    return '<span class="chip ' + (up ? 'ok' : 'red') + '">' + (up ? 'up' : 'down') + '</span>';
  }
  const n = Number(v);
  return esc(typeof v !== 'boolean' && v !== '' && Number.isFinite(n) ? n.toLocaleString('en-US') : v);
}

function devShowOut(o) {
  const box = $('#devCfgOut');
  if (!box) return;
  if (!o) { box.className = 'devout hidden'; box.innerHTML = ''; return; }
  box.className = 'devout' + (o.bad ? ' bad' : '');
  box.innerHTML = '<div class="oh"><span class="t">' + esc(o.title) + '</span>'
    + (o.canLoad ? '<button class="btn sm" data-act="devLoadPulled">Load into canvas</button>' : '')
    + '</div><pre>' + esc(o.text) + '</pre>';
}

/* ---------------- counters ---------------- */

async function devReadMetrics() {
  try {
    const data = await devCall('/metrics/operations/query', { port_metrics: {} });
    dev.last = data;
    const names = ((data.port_metrics && data.port_metrics.metrics) || []).map(devPortName);
    names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    const firstRead = dev.ports.length === 0;
    dev.ports = names;
    // a first read with nothing remembered shows everything rather than an empty table
    if (firstRead && dev.watch.size === 0) {
      names.forEach(n => dev.watch.add(n));
      devSavePrefs();
    }
    dev.msg = { bad: false, text: 'Read at ' + new Date().toLocaleTimeString() + ' \u00b7 ' + names.length + ' ports reported' };
  } catch (e) {
    dev.msg = { bad: true, text: devErrText(e) };
  }
  renderDevice();
}

function devTogglePoll() {
  if (dev.timer) { devStopPoll(); return; }
  if (!dev.ip) { toast('Enter the device address first.'); return; }
  dev.timer = setInterval(devReadMetrics, DEV_POLL_MS);
  const b = $('#devPollBtn');
  if (b) { b.textContent = 'Stop polling'; b.classList.add('primary'); }
  devReadMetrics();
}

function devStopPoll() {
  if (dev.timer) clearInterval(dev.timer);
  dev.timer = null;
  const b = $('#devPollBtn');
  if (b) { b.textContent = 'Start polling'; b.classList.remove('primary'); }
  renderDevPill();
}

function devAskClear() {
  const row = $('#devClearConfirm');
  if (!row) return;
  const n = devWatched().length;
  row.classList.remove('hidden');
  row.innerHTML = '<span>' + (n
    ? 'Zero the counters on the ' + n + ' watched port' + (n === 1 ? '' : 's') + '?'
    : 'No ports are watched \u2014 zero the counters on every port?') + '</span>'
    + '<span class="rowline"><button class="btn sm primary" data-act="devClearGo">Clear</button>'
    + '<button class="btn sm" data-act="devClearNo">Cancel</button></span>';
}

async function devClearCounters() {
  const row = $('#devClearConfirm');
  if (row) row.classList.add('hidden');
  const names = devWatched();
  try {
    await devCall('/metrics/operations/clear', names.length
      ? { port_metrics: { port_names: names } }
      : { port_metrics: {} });
    await devReadMetrics();
    dev.msg = { bad: false, text: names.length ? 'Cleared ' + names.length + ' port' + (names.length === 1 ? '' : 's') + '.' : 'Cleared every port.' };
    renderDevMsg();
  } catch (e) {
    dev.msg = { bad: true, text: devErrText(e) };
    renderDevice();
  }
}

/* ---------------- config pull and push ---------------- */

async function devPull() {
  devShowOut({ title: 'Pulling', text: 'Reading the configuration off ' + dev.ip + '\u2026' });
  try {
    const cfg = await devCall('/config');
    dev.pulled = cfg;
    devShowOut({
      title: 'Configuration on the device',
      text: devText(cfg),
      canLoad: isObj(cfg)
    });
  } catch (e) {
    dev.pulled = null;
    devShowOut({ bad: true, title: 'Pull failed', text: devErrText(e) });
  }
  renderDevPill();
  renderDevCert();
}

function devLoadPulled() {
  if (!isObj(dev.pulled)) { toast('The device did not return a configuration object.'); return; }
  if (!confirmDiscard()) return;
  closeDevice();
  loadText(serialize(dev.pulled), null);
}

function devAskPush() {
  if (!dev.ip) { toast('Enter the device address first.'); return; }
  if (!state.jsonValid) { toast('Fix the JSON errors before pushing.'); return; }
  const row = $('#devCfgConfirm');
  if (!row) return;
  row.classList.remove('hidden');
  row.innerHTML = '<span>Replace the configuration on ' + esc(dev.ip) + ' with the canvas?'
    + (X_KEY in state.config ? ' <code>' + X_KEY + '</code> is left out of what is sent.' : '') + '</span>'
    + '<span class="rowline"><button class="btn sm primary" data-act="devPushGo">Push</button>'
    + '<button class="btn sm" data-act="devPushNo">Cancel</button></span>';
}

async function devPush() {
  const row = $('#devCfgConfirm');
  if (row) row.classList.add('hidden');
  // the display-only key is ours, not the schema's: never send it to the box
  const body = clone(state.config);
  delete body[X_KEY];
  devShowOut({ title: 'Pushing', text: 'Applying the canvas to ' + dev.ip + '\u2026' });
  try {
    const out = await devCall('/config', body);
    devShowOut({
      title: 'Push accepted',
      text: out === '' || out == null ? 'The device accepted the configuration.' : devText(out)
    });
    toast('Configuration pushed to ' + dev.ip + '.');
  } catch (e) {
    devShowOut({ bad: true, title: 'Push failed', text: devErrText(e) });
  }
  renderDevPill();
  renderDevCert();
}

/* ---------------- open and close ---------------- */

function openDevice() {
  dev.open = true;
  $('#devBack').classList.remove('hidden');
  const ip = $('#devIp');
  if (ip) {
    ip.value = dev.ip;
    if (!dev.ip) ip.focus();
  }
  renderDevice();
}

function closeDevice() {
  devStopPoll();          // no requests keep running behind a closed panel
  dev.open = false;
  $('#devBack').classList.add('hidden');
}

/* ---------------- wiring ---------------- */

function initEvents() {
  document.addEventListener('click', ev => {
    if (state.connMenuOpen && !ev.target.closest('#connPick')) {
      state.connMenuOpen = false;
      renderList();
    }
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    if (el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
    ev.preventDefault();
    onAct(el.dataset.act, el, ev);
  });
  document.addEventListener('change', ev => {
    const el = ev.target;
    if (el.dataset && el.dataset.act && (el.tagName === 'SELECT' || el.tagName === 'INPUT')) { onAct(el.dataset.act, el, ev); return; }
    if (el.dataset && el.dataset.path) { onFieldChange(el); return; }
    if (el.dataset && el.dataset.dpath) { onDraftInput(el); return; }
  });
  document.addEventListener('input', ev => {
    const el = ev.target;
    if (el.id === 'connFilter') {
      state.connQuery = el.value;
      renderList();
      requestAnimationFrame(renderWires);
      return;
    }
    if (el.id === 'devIp') {
      dev.ip = el.value.trim();
      dev.reach = null;            // a new address has not been proven yet
      devSavePrefs();
      renderDevPill();
      renderDevCert();
      return;
    }
    if (el.dataset && el.dataset.dpath) onDraftInput(el);
  });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
      if (dev.open) { closeDevice(); return; }
      if (tut.open) { closeTutorials(); return; }
      if (!$('#modalBack').classList.contains('hidden')) { closeModal(); return; }
      if (state.connMenuOpen) { state.connMenuOpen = false; renderList(); return; }
      if (state.groupPick) { cancelGroupPick(); return; }
      if (state.draft) { state.draft = null; render(true); return; }
      if (state.sel.kind !== 'none') { state.sel = { kind: 'none' }; render(true); }
    }
    if (ev.key === 'Enter' && ev.target.tagName === 'INPUT' && ev.target.closest('#modalBack')) {
      const go = $('#modalBack').querySelector('.btn.primary');
      if (go) go.click();
    }
    if (ev.key === 'Enter' && ev.target.id === 'devIp') devReadMetrics();
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) || ev.target.isContentEditable;
    if (!typing && (ev.key === '+' || ev.key === '=')) { ev.preventDefault(); setZoom((state.zoom || 1) + ZOOM_STEP); }
    if (!typing && ev.key === '-') { ev.preventDefault(); setZoom((state.zoom || 1) - ZOOM_STEP); }
    if ((ev.key === '0' || ev.key === 'Digit0') && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); setZoom(1); }
  });
  $('#modalBack').addEventListener('mousedown', ev => { if (ev.target.id === 'modalBack') closeModal(); });
  $('#tutBack').addEventListener('mousedown', ev => { if (ev.target.id === 'tutBack') closeTutorials(); });
  $('#devBack').addEventListener('mousedown', ev => { if (ev.target.id === 'devBack') closeDevice(); });

  $('#jsonText').addEventListener('input', onJsonInput);
  $('#alignToggle').addEventListener('change', e => {
    if (e.target.checked && state.groupPick) {
      e.target.checked = false;
      toast('Finish or cancel the port group first.');
      return;
    }
    state.align = e.target.checked;
    render(true);
  });
  $('#namesToggle').addEventListener('change', e => { state.showNames = e.target.checked; render(true); });
  $('#outsideToggle').addEventListener('change', e => { state.showOutside = e.target.checked; render(true); });

  // outside boxes: click selects the port or group they hang off
  const rail = $('#outsideRail');
  rail.addEventListener('click', ev => {
    const box = ev.target.closest('.obox');
    if (!box) return;
    const num = anchorNumOf(box.dataset.oname);
    if (num == null) return;
    state.sel = { kind: 'port', num };
    render(true);
  });
  rail.addEventListener('mouseover', ev => {
    const box = ev.target.closest('.obox');
    setOutsideHover(box ? box.dataset.oname : null);
  });
  rail.addEventListener('mouseleave', () => setOutsideHover(null));
  $('#fileInput').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (f) openFile(f);
    e.target.value = '';
  });

  // chassis: click to select/assign, drag to connect
  const layer = $('#portLayer');
  layer.addEventListener('pointerdown', ev => {
    const cage = ev.target.closest('.cage');
    if (!cage || state.align || state.groupPick) return;
    const num = Number(cage.dataset.num);
    if (!isAssigned(num)) return;                  // unassigned: click handled on pointerup
    state.drag = { fromNum: num, x: ev.clientX, y: ev.clientY, moved: false };
    cage.setPointerCapture(ev.pointerId);
    renderChassis();
    renderWires();
  });
  layer.addEventListener('pointermove', ev => {
    if (!state.drag) return;
    state.drag.x = ev.clientX;
    state.drag.y = ev.clientY;
    if (!state.drag.moved) state.drag.moved = true;
    const over = document.elementFromPoint(ev.clientX, ev.clientY);
    const cage = over && over.closest ? over.closest('.cage') : null;
    document.querySelectorAll('.cage.dragok').forEach(c => c.classList.remove('dragok'));
    if (cage) {
      const n = Number(cage.dataset.num);
      if (n !== state.drag.fromNum && isAssigned(n)) cage.classList.add('dragok');
    }
    renderWires();
  });
  layer.addEventListener('pointerup', ev => {
    const drag = state.drag;
    const cage = ev.target.closest('.cage');
    const num = cage ? Number(cage.dataset.num) : null;
    if (drag) {
      state.drag = null;
      const over = document.elementFromPoint(ev.clientX, ev.clientY);
      const target = over && over.closest ? over.closest('.cage') : null;
      const tnum = target ? Number(target.dataset.num) : null;
      if (drag.moved && tnum != null && tnum !== drag.fromNum) {
        if (!isAssigned(tnum)) {
          toast('Port ' + tnum + ' is not assigned yet. Click it to give it a profile and a name first.');
          render(true);
          return;
        }
        if (dragObjectForCage(drag.fromNum) === dragObjectForCage(tnum)) {
          toast('Both cages belong to "' + dragObjectForCage(tnum) + '". A connection needs two different ports.');
          render(true);
          return;
        }
        openTypePicker(drag.fromNum, tnum);
        render(true);
        return;
      }
      state.sel = { kind: 'port', num: drag.fromNum };
      render(true);
      return;
    }
    if (num == null) return;
    if (state.groupPick) { toggleGroupPickCage(num); return; }
    if (isAssigned(num)) { state.sel = { kind: 'port', num }; render(true); }
    else openAssign(num);
  });
  layer.addEventListener('pointercancel', () => { if (state.drag) { state.drag = null; render(true); } });

  layer.addEventListener('mouseover', ev => {
    const cage = ev.target.closest('.cage');
    if (!cage || state.drag) return;
    const n = Number(cage.dataset.num);
    const idxs = connIndicesForCage(n).filter(i => connIsVisible(i));
    setHover(idxs.length ? { kind: 'connection', idx: idxs[0] } : null);
  });
  layer.addEventListener('mouseleave', () => { if (!state.drag) setHover(null); });

  // wires
  $('#wireSvg').addEventListener('click', ev => {
    const g = ev.target.closest('g.conn');
    if (!g || !g.dataset.idx) return;
    state.sel = { kind: 'connection', idx: Number(g.dataset.idx) };
    render(true);
  });
  $('#wireSvg').addEventListener('mouseover', ev => {
    const g = ev.target.closest('g.conn');
    if (g && g.dataset.idx) setHover({ kind: 'connection', idx: Number(g.dataset.idx) });
  });
  $('#wireSvg').addEventListener('mouseleave', () => setHover(null));

  // connection list
  $('#listBody').addEventListener('click', ev => {
    if (ev.target.closest('input[type=checkbox]')) return;
    const row = ev.target.closest('tr.row');
    if (!row) return;
    state.sel = { kind: 'connection', idx: Number(row.dataset.idx) };
    render(true);
  });
  $('#listBody').addEventListener('mouseover', ev => {
    const row = ev.target.closest('tr.row');
    setHover(row ? { kind: 'connection', idx: Number(row.dataset.idx) } : null);
  });
  $('#listBody').addEventListener('mouseleave', () => setHover(null));

  // sashes
  dragSash($('#vsash'), 'x', dx => {
    const r = $('#right');
    const w = Math.min(Math.max(300, r.getBoundingClientRect().width - dx), window.innerWidth - 520);
    r.style.flex = '0 0 ' + w + 'px';
    r.style.width = w + 'px';
    renderWires();
  });
  dragSash($('#hsash'), 'y', dy => {
    const p = $('#jsonPane');
    const h = Math.min(Math.max(120, p.getBoundingClientRect().height - dy), window.innerHeight - 220);
    p.style.flex = '0 0 ' + h + 'px';
  });

  // file drop
  let veil = null;
  window.addEventListener('dragover', ev => {
    if (!ev.dataTransfer || ![...ev.dataTransfer.types].includes('Files')) return;
    ev.preventDefault();
    if (!veil) {
      veil = document.createElement('div');
      veil.id = 'dropveil';
      veil.textContent = 'Drop a UHD Connect .json file to load it';
      document.body.appendChild(veil);
    }
  });
  window.addEventListener('dragleave', ev => {
    if (ev.clientX === 0 && ev.clientY === 0 && veil) { veil.remove(); veil = null; }
  });
  window.addEventListener('drop', ev => {
    if (!ev.dataTransfer || !ev.dataTransfer.files.length) return;
    ev.preventDefault();
    if (veil) { veil.remove(); veil = null; }
    if (!confirmDiscard()) return;
    openFile(ev.dataTransfer.files[0]);
  });

  window.addEventListener('beforeunload', ev => {
    if (state.dirty) { ev.preventDefault(); ev.returnValue = ''; }
  });
  window.addEventListener('resize', () => renderWires());
  const img = $('#chassisImg');
  if (img) img.addEventListener('load', () => renderWires());
  const sc = $('#chassisScroll');
  if (sc) {
    sc.addEventListener('wheel', ev => {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      ev.preventDefault();
      setZoom((state.zoom || 1) + (ev.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
    }, { passive: false });
  }
}

function dragSash(el, axis, onMove) {
  el.addEventListener('mousedown', ev => {
    ev.preventDefault();
    el.classList.add('on');
    const start = axis === 'x' ? ev.clientX : ev.clientY;
    const move = e => onMove((axis === 'x' ? e.clientX : e.clientY) - start);
    const up = () => {
      el.classList.remove('on');
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      renderWires();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

/* ------------------------------------------------------------------ boot */

devLoadPrefs();
initEvents();
revalidate();
render(true);
