/* Dev-only check (not part of the deliverable page).
 * Loads app.js against a stub DOM and verifies:
 *   1. every in-scope sample validates with zero errors and is fully editable,
 *   2. tags derived from functions match the tags the samples ship,
 *   3. serialize -> parse is lossless,
 *   4. breakout samples are refused,
 *   5. a config authored through the UI code path matches the sample shape.
 * Run: node tools/roundtrip-test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SAMPLES = path.join(ROOT, 'docs', 'samples');

/* ---------- stub DOM ---------- */
const cache = new Map();
function fakeEl(sel) {
  const el = {
    sel, dataset: {}, style: {}, value: '', textContent: '', innerHTML: '', checked: false, files: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
    setPointerCapture() {}, focus() {}, select() {}, click() {},
    querySelector() { return fakeEl(sel + ' *'); },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }; },
    closest() { return null; }
  };
  return el;
}
function q(sel) {
  if (!cache.has(sel)) cache.set(sel, fakeEl(sel));
  return cache.get(sel);
}
global.document = {
  querySelector: q,
  querySelectorAll: () => [],
  createElement: () => fakeEl('created'),
  addEventListener() {},
  body: fakeEl('body'),
  elementFromPoint: () => null
};
global.window = global;
global.addEventListener = () => {};
global.requestAnimationFrame = () => {};
Object.defineProperty(global, 'navigator', { value: { clipboard: { writeText: () => Promise.resolve() } }, configurable: true });
global.confirm = () => true;
global.prompt = () => null;
global.Blob = class {};
global.URL = { createObjectURL: () => '', revokeObjectURL: () => {} };
global.FileReader = class {};

/* ---------- load app.js ---------- */
const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8')
  + '\nglobalThis.__api = { validate, computeWarnings, deriveTags, applyTags, serialize, state, '
  + 'emptyConfig, addProfile, assignPort, assignPortGroup, createConnection, setPath, getPath, portToCell, FN, '
  + 'occupants, anchorNumOf, memberNumsOf, portLabel, sheetEndLabel, portHtml, connHtml, roReason, profileUsage, '
  + 'connIndicesForCage, cageName, cageTitle, cagesOfConnection, dragObjectForCage, revalidate, '
  + 'outsideOf, setOutside, renameOutside, outsideMap, X_KEY, layoutOutside };\n';
new Function(src)();
const A = globalThis.__api;

/* ---------- helpers ---------- */
let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '\n       ' + extra : '')); }
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = sortKeys(v[k]);
    return o;
  }
  return v;
}
const norm = v => JSON.stringify(sortKeys(v));

const IN_SCOPE = [
  'passthrough_single_symmetric', 'passthrough_single_translation', 'passthrough_single_non_vlan',
  'passthrough_qinq_symmetric', 'passthrough_qinq_asymmetric', 'passthrough_qinq_partial_strip',
  'encap_single_vlan_vxlan', 'encap_single_vlan_nvgre',
  'encap_double_vxlan_vxlan', 'encap_double_vxlan_nvgre', 'encap_double_nvgre_nvgre'
];
const BREAKOUT = ['breakout_4x100g', 'breakout_4x25g', 'breakout_4x10g'];

function loadSample(name) {
  return JSON.parse(fs.readFileSync(path.join(SAMPLES, name, name + '.json'), 'utf8'));
}

/* ---------- 1. in-scope samples ---------- */
console.log('\nIn-scope samples');
for (const name of IN_SCOPE) {
  const cfg = loadSample(name);
  const v = A.validate(cfg);
  ok(v.errors.length === 0, name + ': validates', v.errors.join('\n       '));
  ok(v.meta.readOnly.size === 0, name + ': all connections editable in the UI');

  A.state.config = cfg;
  A.state.meta = v.meta;

  const before = (cfg.connections || []).map(c => JSON.stringify((c.endpoints || []).map(e => e.tags || null)));
  (cfg.connections || []).forEach(c => A.applyTags(c));
  const after = (cfg.connections || []).map(c => JSON.stringify((c.endpoints || []).map(e => e.tags || null)));
  ok(norm(before) === norm(after), name + ': derived tags equal the sample tags',
    'before ' + before.join(' | ') + '\n       after  ' + after.join(' | '));

  const again = JSON.parse(A.serialize(cfg));
  ok(norm(again) === norm(loadSample(name)), name + ': serialize/parse is lossless');

  const w = A.computeWarnings(cfg, v.meta);
  ok(Array.isArray(w), name + ': warnings computed (' + w.length + ')');
}

/* ---------- 2. breakout refusal ---------- */
console.log('\nBreakout samples (must be refused)');
for (const name of BREAKOUT) {
  const cfg = loadSample(name);
  const v = A.validate(cfg);
  ok(v.errors.length > 0 && v.meta.breakout === true, name + ': refused as breakout',
    'errors: ' + v.errors.length + ' breakout flag: ' + v.meta.breakout);
  ok(v.errors.some(e => /breakout/i.test(e)), name + ': error message names breakout');
}

/* ---------- 3. authoring path reproduces a sample ---------- */
console.log('\nUI authoring path vs passthrough_single_symmetric');
A.state.config = A.emptyConfig();
A.state.meta = A.validate(A.state.config).meta;
A.addProfile({ name: 'manual_400g_rs', choice: 'manual', link_speed: 'speed_400_gbps', manual: { fec_mode: 'reed_solomon' } });
A.assignPort(25, 'manual_400g_rs', 'scenario4_ingress');
A.assignPort(26, 'manual_400g_rs', 'scenario4_egress');
A.createConnection(25, 26, 'connect_ethernet');
const built = A.state.config;
const base = 'connections.0.functions.0.connect_ethernet';
A.setPath(built, base + '.ethertypes', [65535]);
A.setPath(built, base + '.vlan_endpoint_settings_port1.vlan', { choice: 'vlan', vlan: 101 });
A.setPath(built, base + '.vlan_endpoint_settings_port2.vlan', { choice: 'vlan', vlan: 101 });
A.applyTags(built.connections[0]);

const target = loadSample('passthrough_single_symmetric');
built.connections[0].name = target.connections[0].name; // auto-name differs by design
ok(norm(built) === norm(target), 'authored config matches the sample',
  '\n       built:  ' + norm(built) + '\n       target: ' + norm(target));
const bv = A.validate(built);
ok(bv.errors.length === 0, 'authored config validates', bv.errors.join('; '));

/* ---------- 4. tag derivation for encap / qinq via the UI path ---------- */
console.log('\nTag derivation on UI-authored connections');
const qinq = { name: 'Q', endpoints: [{ port_name: 'a' }, { port_name: 'b' }], functions: [{ choice: 'connect_arp', connect_arp: {} }, { choice: 'connect_arp', connect_arp: {} }] };
A.applyTags(qinq);
ok(norm(qinq.endpoints.map(e => e.tags)) === norm([['vlan', 'vlan'], ['vlan', 'vlan']]), 'two ARP functions give [vlan,vlan] on both ends');
const mixed = { name: 'M', endpoints: [{ port_name: 'a' }, { port_name: 'b' }], functions: [{ choice: 'connect_vlan_vxlan', connect_vlan_vxlan: {} }, { choice: 'connect_vlan_nvgre', connect_vlan_nvgre: {} }] };
A.applyTags(mixed);
ok(norm(mixed.endpoints.map(e => e.tags)) === norm([['vlan', 'vlan'], ['vxlan', 'nvgre']]), 'vxlan+nvgre give [vlan,vlan] / [vxlan,nvgre]');
const eth = { name: 'E', endpoints: [{ port_name: 'a', tags: ['vlan'] }, { port_name: 'b' }], functions: [{ choice: 'connect_ethernet', connect_ethernet: {} }] };
A.applyTags(eth);
ok(eth.endpoints[0].tags === undefined && eth.endpoints[1].tags === undefined, 'Ethernet-only connection carries no tags');

/* ---------- 5. schema rejections ---------- */
console.log('\nSchema rejections');
const bad = [
  [{ front_panel_ports: [{ name: 'p', front_panel_port: { front_panel_port: 33, layer_1_profile_name: 'x' } }] }, 'port number above 32'],
  [{ front_panel_ports: [{ name: 'p', front_panel_port: { front_panel_port: 1, layer_1_profile_name: 'missing' } }] }, 'unknown profile reference'],
  [{ connections: [{ name: 'c', endpoints: [{ port_name: 'nope' }, { port_name: 'nope2' }], functions: [{ choice: 'connect_ethernet', connect_ethernet: {} }] }] }, 'unknown port reference'],
  [{ connections: [{ name: 'c', endpoints: [], functions: [] }] }, 'no endpoints and no functions'],
  [{ connections: [{ name: 'dup', endpoints: [{ port_name: 'a' }, { port_name: 'b' }], functions: [{ choice: 'connect_ethernet' }] }, { name: 'dup', endpoints: [{ port_name: 'a' }, { port_name: 'b' }], functions: [{ choice: 'connect_ethernet' }] }] }, 'duplicate connection names'],
  [{ connections: [{ name: 'c', endpoints: [{ port_name: 'a' }, { port_name: 'b' }], functions: [{ choice: 'connect_vlan_vxlan', connect_vlan_vxlan: { vlan_endpoint_settings: {} } }] }] }, 'VXLAN function with no vxlan_endpoint_settings']
];
for (const [cfg, label] of bad) {
  ok(A.validate(cfg).errors.length > 0, 'rejects ' + label);
}
ok(A.validate({ profiles: {}, front_panel_ports: [], connections: [] }).errors.length === 0, 'accepts an empty config');

// Names outside the documented pattern warn instead of locking the canvas (a shipped sample does this).
const oddName = loadSample('passthrough_single_non_vlan');
const onv = A.validate(oddName);
A.state.config = oddName;
ok(onv.errors.length === 0, 'a comma in a connection name does not lock the canvas');
ok(A.computeWarnings(oddName, onv.meta).some(w => /name pattern/.test(w.text)), 'a comma in a connection name warns instead');

/* ---------- 6. port groups ---------- */
console.log('\nPort groups');
const GP = 'p400';
const groupCfg = () => ({
  profiles: { layer_1_profiles: [{ name: GP, choice: 'manual', link_speed: 'speed_200_gbps', manual: { fec_mode: 'reed_solomon' } }] },
  front_panel_ports: [
    {
      name: 'grp_a', choice: 'port_group',
      port_group: {
        ingress_distribution: 'copy',
        ports: [{ front_panel_port: 11, layer_1_profile_name: GP }, { front_panel_port: 12, layer_1_profile_name: GP }]
      }
    },
    {
      name: 'grp_b', choice: 'port_group',
      port_group: {
        ingress_distribution: 'copy',
        ports: [{ front_panel_port: 12, layer_1_profile_name: GP }, { front_panel_port: 11, layer_1_profile_name: GP }]
      }
    },
    { name: 'plain17', choice: 'front_panel_port', front_panel_port: { front_panel_port: 17, layer_1_profile_name: GP } }
  ],
  connections: [{
    name: 'grp conn',
    endpoints: [{ port_name: 'plain17', tags: ['vlan'] }, { port_name: 'grp_a', tags: ['vxlan'] }],
    functions: [{
      choice: 'connect_vlan_vxlan',
      connect_vlan_vxlan: {
        vlan_endpoint_settings: { vlan: { choice: 'vlan', vlan: 7 } },
        vxlan_endpoint_settings: {
          vni: { choice: 'vni', vni: 7 },
          outgoing_vxlan_header: {
            src_mac: { choice: 'mac', mac: '80:09:02:01:00:01' }, dst_mac: { choice: 'mac', mac: '00:44:44:44:44:44' },
            src_ip: { choice: 'ipv4', ipv4: '221.1.0.1' }, dst_ip: { choice: 'ipv4', ipv4: '221.0.0.1' }
          }
        }
      }
    }]
  }]
});
let g = groupCfg();
let gv = A.validate(g);
A.state.config = g; A.state.meta = gv.meta;
ok(gv.errors.length === 0, 'a port-group config validates', gv.errors.join('; '));
ok(gv.meta.readOnly.size === 0, 'a connection on a port group is editable, not read-only');
ok(A.anchorNumOf('grp_a') === 11 && A.anchorNumOf('grp_b') === 12, 'the first port of a group is the anchor');
ok(norm(A.memberNumsOf('grp_a')) === norm([11, 12]), 'group members keep declaration order');
ok(A.portLabel('grp_a') === 'P11+12', 'a group is labelled with its main port first');
ok(A.portLabel('plain17') === 'P17', 'a plain port is still labelled PN');
ok(A.sheetEndLabel('grp_a') === 'P11+12  grp_a', 'the connection sheet names the group next to its cages');
ok(A.sheetEndLabel('plain17') === 'P17', 'a plain port sheet label stays PN');
ok(norm(A.cagesOfConnection(g.connections[0])) === norm([17, 11, 12]), 'a group connection lights up every member cage');
ok(A.occupants(11).length === 2 && A.occupants(11)[0].kind === 'anchor', 'a cage in two groups reports both, anchor first');
ok(A.occupants(12)[0].name === 'grp_b' && A.occupants(12)[0].kind === 'anchor', 'the reversed group anchors on the other cage');
ok(A.cageName(11) === 'grp_a', 'the cage label is the primary object name');
ok(/grp_a[\s\S]*grp_b/.test(A.cageTitle(11)), 'the cage tooltip lists every object on that cage');
ok(norm(A.connIndicesForCage(12)) === norm([0]), 'a member cage finds the connection through its group');
ok((A.profileUsage().get(GP) || []).length === 5, 'group members count as profile users');
ok(A.dragObjectForCage(17) === 'plain17' && A.dragObjectForCage(11) === 'grp_a', 'a drag uses the cage\'s primary object');
const gwarn = A.computeWarnings(g, gv.meta);
ok(!gwarn.some(w => /JSON-only/.test(w.text)), 'groups no longer warn as JSON-only');
ok(gwarn.some(w => /grp_b/.test(w.text) && /not used/.test(w.text)), 'an unused group is still flagged');
ok(/group/.test(A.portHtml(11)) && /main/.test(A.portHtml(11)), 'the port inspector shows group details');
ok(/group of 2/.test(A.connHtml(0)), 'the connection inspector spells out the group');
ok(!/Read-only here/.test(A.connHtml(0)), 'no read-only banner for a group connection');

A.state.config = A.emptyConfig();
A.addProfile({ name: 'autoneg_200G', choice: 'autonegotiation', link_speed: 'speed_200_gbps' });
A.assignPort(25, 'autoneg_200G', 'plain25');
A.assignPortGroup([11, 12], 'autoneg_200G', 'snic1_port_group_1');
ok(A.state.config.front_panel_ports[1].choice === 'port_group', 'assignPortGroup writes choice port_group');
ok(A.state.config.front_panel_ports[1].port_group.ingress_distribution === 'copy', 'UI groups default to copy');
ok(A.dragObjectForCage(11) === 'snic1_port_group_1' && A.dragObjectForCage(12) === 'snic1_port_group_1',
  'a drag from either group cage names the group');
ok(A.dragObjectForCage(25) === 'plain25', 'a drag from a regular port still names the port');
A.createConnection(11, 25, 'connect_ethernet');
const ug = A.state.config.connections[0];
ok(ug.endpoints[0].port_name === 'snic1_port_group_1' && ug.endpoints[1].port_name === 'plain25',
  'connecting a group cage to a regular port names both objects');
ok(A.validate(A.state.config).errors.length === 0, 'UI-authored port-to-group connection validates');

// group shapes that must be refused
const gbad = [
  ['a group with no ports', cfg => { cfg.front_panel_ports[0].port_group.ports = []; }],
  ['a group member on port 33', cfg => { cfg.front_panel_ports[0].port_group.ports[0].front_panel_port = 33; }],
  ['a group member with an unknown profile', cfg => { cfg.front_panel_ports[0].port_group.ports[0].layer_1_profile_name = 'nope'; }],
  ['the same port twice in one group', cfg => { cfg.front_panel_ports[0].port_group.ports[1].front_panel_port = 11; }],
  ['a bad ingress_distribution', cfg => { cfg.front_panel_ports[0].port_group.ingress_distribution = 'roundrobin'; }],
  ['a breakout channel inside a group', cfg => { cfg.front_panel_ports[0].port_group.ports[0].channel = 2; }]
];
for (const [label, mutate] of gbad) {
  const c = groupCfg();
  mutate(c);
  ok(A.validate(c).errors.length > 0, 'rejects ' + label);
}

// a group with no drawable port stays read-only, with a reason that says so
const noAnchor = groupCfg();
noAnchor.front_panel_ports[0].port_group.ports = [{ layer_1_profile_name: GP }];
const nav = A.validate(noAnchor);
ok(nav.meta.readOnly.has(0), 'a group with no valid front-panel port keeps its connection read-only');
A.state.config = noAnchor; A.state.meta = nav.meta;
ok(/port group with no valid front-panel port/.test(A.roReason(noAnchor.connections[0])),
  'the read-only reason names the actual problem');

// the real migrated config the user brought in
const REAL = path.join(ROOT, 'old.new.json');
if (fs.existsSync(REAL)) {
  const real = JSON.parse(fs.readFileSync(REAL, 'utf8'));
  const rv = A.validate(real);
  A.state.config = real; A.state.meta = rv.meta;
  ok(rv.errors.length === 0, 'old.new.json validates', rv.errors.join('\n       '));
  ok(rv.meta.readOnly.size === 0, 'every connection in old.new.json is editable');
  const drawn = (real.connections || []).filter(c =>
    (c.endpoints || []).length === 2 && (c.endpoints || []).every(e => A.anchorNumOf(e.port_name) != null));
  ok(drawn.length === real.connections.length, 'all ' + real.connections.length + ' connections in old.new.json are drawable');
  ok(norm(JSON.parse(A.serialize(real))) === norm(JSON.parse(fs.readFileSync(REAL, 'utf8'))), 'old.new.json round-trips losslessly');
}

/* ---------- 7. outside entities (display-only extra key) ---------- */
console.log('\nOutside entities');
A.state.config = groupCfg();
A.state.meta = A.validate(A.state.config).meta;
const clean = A.serialize(A.state.config);
ok(A.outsideOf('grp_a').label === 'grp_a' && !A.outsideOf('grp_a').custom,
  'a box defaults to the port name and counts as untouched');
ok(A.serialize(A.state.config) === clean, 'reading boxes writes nothing to the file');

A.setOutside('grp_a', { label: 'SNIC 9', kind: 'nic' });
ok(A.state.config[A.X_KEY].outside.grp_a.label === 'SNIC 9', 'a label is stored under the extra key',
  JSON.stringify(A.state.config[A.X_KEY]));
ok(typeof A.state.config[A.X_KEY]._comment === 'string', 'the extra key carries a note saying it is display-only');
ok(A.outsideOf('grp_a').custom === true, 'an edited box is marked custom');
ok(A.validate(A.state.config).errors.length === 0, 'the extra key does not lock the canvas');
ok(A.outsideOf('plain17').label === 'plain17', 'other ports keep their default label');

A.setOutside('grp_a', { kind: '' });
ok(A.state.config[A.X_KEY].outside.grp_a.kind === undefined, 'clearing a field drops it');
A.setOutside('grp_a', { label: '' });
ok(A.state.config[A.X_KEY] === undefined, 'the extra key is removed once the last override goes');
ok(A.serialize(A.state.config) === clean, 'a reset config is byte-identical to before');

A.setOutside('grp_a', { label: 'SNIC 9' });
A.renameOutside('grp_a', 'grp_z');
ok(A.state.config[A.X_KEY].outside.grp_z.label === 'SNIC 9' && !A.state.config[A.X_KEY].outside.grp_a,
  'renaming a port moves its box with it');
A.state.config.front_panel_ports[0].name = 'grp_z';
A.state.config.connections[0].endpoints[1].port_name = 'grp_z';
let ov = A.validate(A.state.config);
A.state.meta = ov.meta;
ok(A.computeWarnings(A.state.config, ov.meta).every(x => !/no front_panel_ports entry has that name/.test(x.text)),
  'a migrated box raises no stale warning');

A.state.config[A.X_KEY].outside.ghost = { label: 'gone' };
ov = A.validate(A.state.config);
ok(ov.errors.length === 0, 'a box for a port that does not exist is not an error');
ok(A.computeWarnings(A.state.config, ov.meta).some(x => /"ghost"/.test(x.text)), 'but it warns, and says it stays in the file');
A.state.config[A.X_KEY] = 'nonsense';
ov = A.validate(A.state.config);
ok(ov.errors.length === 0 && A.computeWarnings(A.state.config, ov.meta).some(x => new RegExp(A.X_KEY).test(x.text)),
  'a malformed extra key warns instead of locking the canvas');

/* ---------- 8. column-pair numbering ---------- */
console.log('\nColumn-pair numbering');
const cells = [[1, 0, 0], [2, 0, 1], [3, 1, 0], [4, 1, 1], [31, 15, 0], [32, 15, 1]];
for (const [n, col, row] of cells) {
  const c = A.portToCell(n);
  ok(c.col === col && c.row === row, 'port ' + n + ' -> column ' + col + ', row ' + row, JSON.stringify(c));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
