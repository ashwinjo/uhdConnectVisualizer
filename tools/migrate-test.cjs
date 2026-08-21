/* Dev-only check (not part of the deliverable page).
 * Loads migrate.js and verifies it matches uhd_migration.py:
 *   1. the Python --selftest fixtures,
 *   2. hard failures (internal endpoints, bad JSON, missing vlan_double parts),
 *   3. .http head/tail kept verbatim.
 * Run: node tools/migrate-test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIGRATE_JS = path.join(ROOT, 'migrate.js');

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '\n       ' + extra : '')); }
}

console.log('migrate.js');

if (!fs.existsSync(MIGRATE_JS)) {
  ok(false, 'migrate.js exists');
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(1);
}
ok(true, 'migrate.js exists');

/* Loaded via Function, not require: a parent folder's package.json has
 * "type": "module", which would make Node treat migrate.js as ESM. */
new Function(fs.readFileSync(MIGRATE_JS, 'utf8'))();
const M = globalThis.UHDMigrate;
ok(!!M && typeof M.migrateConfig === 'function', 'UHDMigrate attached');

const oldDouble = {
  connections: [{
    name: 'vxlan_over_vxlan',
    functions: [
      { choice: 'connect_vlan_vxlan', connect_vlan_vxlan: {
        vxlan_endpoint_settings: { vni: { choice: 'vni', vni: 100 }, udp_src_port: 1234 },
        vlan_endpoint_settings: { outgoing_vxlan_header: { src_ip: { choice: 'ipv4', ipv4: '221.1.0.0' } } } } },
      { choice: 'connect_vlan_vxlan', connect_vlan_vxlan: {
        vxlan_endpoint_settings: { vni: { choice: 'vni', vni: 200 }, udp_src_port: 1234 },
        vlan_endpoint_settings: { outgoing_vxlan_header: { src_ip: { choice: 'ipv4', ipv4: '121.1.0.0' } } } } }
    ],
    endpoints: [
      { choice: 'front_panel', front_panel: { port_name: 'client1' }, tags: ['vxlan', 'function_0'] },
      { choice: 'front_panel', front_panel: { port_name: 'client1' }, tags: ['vxlan', 'function_1'] },
      { choice: 'front_panel', front_panel: { port_name: 'client5', vlan: { choice: 'vlan', vlan: 100 } }, tags: ['vlan', 'function_0'] },
      { choice: 'front_panel', front_panel: { port_name: 'client5', vlan: { choice: 'vlan', vlan: 200 } }, tags: ['vlan', 'function_1'] }
    ]
  }]
};

const oldQinq = {
  connections: [{
    name: 'Q-in-Q ARP Bypass',
    functions: [{ choice: 'connect_arp', connect_arp: {} }],
    endpoints: [
      { choice: 'front_panel', front_panel: { port_name: 'cloud_port_1', vlan: {
        choice: 'vlan_double', vlan_double: { outer: { start: 100, count: 1 }, inner: { start: 200, count: 1 } } } }, tags: ['vlan'] },
      { choice: 'front_panel', front_panel: { port_name: 'dut_port_1', vlan: {
        choice: 'vlan_double', vlan_double: { outer: { start: 100, count: 1 }, inner: { start: 200, count: 1 } } } }, tags: ['vlan'] }
    ]
  }]
};

const allVlans = {
  connections: [{
    name: 'x',
    functions: [{ choice: 'connect_arp', connect_arp: {} }],
    endpoints: [{ choice: 'front_panel', front_panel: { port_name: 'p1', vlan: { choice: 'all_vlans' } }, tags: ['vlan'] }]
  }]
};

const wideRange = {
  connections: [{
    name: 'x',
    functions: [{ choice: 'connect_arp', connect_arp: {} }],
    endpoints: [{ choice: 'front_panel', front_panel: {
      port_name: 'p1',
      vlan: { choice: 'vlan_range', vlan_range: { start: 10, count: 5, step: 2 } }
    }, tags: ['vlan'] }]
  }]
};

let rep = new M.Report();
const got = M.migrateConfig(oldDouble, rep).connections[0];
ok(JSON.stringify(got.endpoints) === JSON.stringify([
  { port_name: 'client5', tags: ['vlan', 'vlan'] },
  { port_name: 'client1', tags: ['vxlan', 'vxlan'] }
]), 'double-encap endpoints');
const f0 = got.functions[0].connect_vlan_vxlan;
ok('outgoing_vxlan_header' in f0.vxlan_endpoint_settings, 'header moved to tunnel side');
ok(!('outgoing_vxlan_header' in f0.vlan_endpoint_settings), 'header gone from vlan side');
ok(f0.vxlan_endpoint_settings.outgoing_vxlan_header.udp_src_port === 1234, 'udp_src_port folded into header');
ok(!('udp_src_port' in f0.vxlan_endpoint_settings), 'udp_src_port off the settings block');
ok(JSON.stringify(f0.vlan_endpoint_settings.vlan) === JSON.stringify({ choice: 'vlan', vlan: 100 }), 'function VLAN');
ok(JSON.stringify(got.functions[1].connect_vlan_vxlan.vlan_endpoint_settings.vlan)
  === JSON.stringify({ choice: 'vlan', vlan: 200 }), 'second function VLAN');

rep = new M.Report();
const got2 = M.migrateConfig(oldQinq, rep).connections[0];
ok(got2.functions.length === 2, 'vlan_double -> 2 functions');
ok(JSON.stringify(got2.endpoints) === JSON.stringify([
  { port_name: 'cloud_port_1', tags: ['vlan', 'vlan'] },
  { port_name: 'dut_port_1', tags: ['vlan', 'vlan'] }
]), 'qinq endpoints');
ok(JSON.stringify(got2.functions[0].connect_arp.vlan_endpoint_settings_port1.vlan)
  === JSON.stringify({ choice: 'vlan', vlan: 100 }), 'outer VLAN on functions[0] port1');
ok(JSON.stringify(got2.functions[1].connect_arp.vlan_endpoint_settings_port2.vlan)
  === JSON.stringify({ choice: 'vlan', vlan: 200 }), 'inner VLAN on functions[1] port2');

rep = new M.Report();
M.migrateConfig(allVlans, rep);
ok(rep.problems.some(p => p.includes('all_vlans')), 'all_vlans reported as unmappable');

rep = new M.Report();
const wide = M.migrateConfig(wideRange, rep);
ok(JSON.stringify(wide.connections[0].functions[0].connect_arp.vlan_endpoint_settings_port1.vlan)
  === JSON.stringify({ choice: 'vlan_range', vlan_range: { start: 10, count: 5, step: 2 } }),
  'real sweep stays a range');

rep = new M.Report();
const already = M.migrateConfig({
  connections: [{
    name: 'flat',
    functions: [{ choice: 'connect_ethernet', connect_ethernet: {} }],
    endpoints: [
      { port_name: 'a', tags: ['vlan'] },
      { port_name: 'b', tags: ['vlan'] }
    ]
  }]
}, rep);
ok(already.connections[0].endpoints[0].port_name === 'a'
  && already.connections[0].endpoints[1].port_name === 'b',
  'already-flat endpoints kept');
ok(rep.changes.some(c => /already flat/.test(c)), 'already-flat noted in the report');

let threw = false;
try {
  M.migrateConfig({
    connections: [{
      name: 'x',
      functions: [{ choice: 'connect_arp', connect_arp: {} }],
      endpoints: [{ choice: 'internal', internal: { port_name: 'x' }, tags: ['vlan'] }]
    }]
  }, new M.Report());
} catch (e) {
  threw = e instanceof M.MigrationError && /internal/.test(e.message);
}
ok(threw, 'internal endpoint is a hard failure');

threw = false;
try {
  M.migrateConfig({
    connections: [{
      name: 'x',
      functions: [{ choice: 'connect_arp', connect_arp: {} }],
      endpoints: [{ choice: 'front_panel', front_panel: {
        port_name: 'p1',
        vlan: { choice: 'vlan_double', vlan_double: { outer: { start: 1 } } }
      }, tags: ['vlan'] }]
    }]
  }, new M.Report());
} catch (e) {
  threw = e instanceof M.MigrationError && /vlan_double needs both/.test(e.message);
}
ok(threw, 'incomplete vlan_double is a hard failure');

ok(typeof M.migrateText === 'function', 'migrateText exported');
const bad = M.migrateText('{not json');
ok(bad.ok === false && /JSON/.test(bad.error), 'migrateText reports invalid JSON');

const httpIn = [
  'POST /api/config HTTP/1.1',
  'Content-Type: application/json',
  '',
  JSON.stringify(oldQinq),
  '',
  '###',
  'GET /api/status HTTP/1.1',
  '',
  '{}'
].join('\n');
const httpOut = M.migrateText(httpIn, { fileName: 'old.http' });
ok(httpOut.ok && httpOut.isHttp, 'migrateText accepts .http');
ok(httpOut.text.startsWith('POST /api/config HTTP/1.1\n'), 'http head kept');
ok(/GET \/api\/status/.test(httpOut.text), 'trailing http request kept');
ok(!/"choice": "front_panel"/.test(httpOut.text) && /"port_name": "cloud_port_1"/.test(httpOut.text),
  'http body is the new schema');
ok(httpOut.jsonText && httpOut.jsonText.charAt(0) === '{', 'jsonText is JSON only');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
