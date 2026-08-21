# UHD Connect configuration tutorials

One tutorial per scenario shipped in `docs/samples`. Each one tells you what the scenario does, how
to build it in the visualizer, what the resulting JSON looks like, which fields the API requires, and
the mistakes that produce a config the device accepts but does not act on.

Read this page once. It covers the structure every scenario shares, so the tutorials themselves can
stay focused on what makes each scenario different.

These pages also read inside the visualizer itself, under the **Tutorials** button in the toolbar,
where each JSON block can be copied and the complete ones can be loaded straight onto the chassis.

## Which tutorial do I want?

| I want to... | Tutorial | Sample |
| --- | --- | --- |
| Pass one VLAN straight through, same ID on both ports | [Single-VLAN passthrough](01-passthrough-single.md#symmetric) | `passthrough_single_symmetric` |
| Pass one VLAN through and renumber it on the far port | [Single-VLAN passthrough](01-passthrough-single.md#translation) | `passthrough_single_translation` |
| Pass one VLAN in and hand it out untagged | [Single-VLAN passthrough](01-passthrough-single.md#untagged) | `passthrough_single_non_vlan` |
| Pass Q-in-Q traffic through, both tags unchanged | [Q-in-Q ARP bypass](02-passthrough-qinq.md#symmetric) | `passthrough_qinq_symmetric` |
| Pass Q-in-Q through, renumbering both tags | [Q-in-Q ARP bypass](02-passthrough-qinq.md#asymmetric) | `passthrough_qinq_asymmetric` |
| Pass Q-in-Q in, hand out a single tag | [Q-in-Q ARP bypass](02-passthrough-qinq.md#partial-strip) | `passthrough_qinq_partial_strip` |
| Turn a VLAN into VXLAN and back | [Single encapsulation](03-encap-single.md#vxlan) | `encap_single_vlan_vxlan` |
| Turn a VLAN into NVGRE and back | [Single encapsulation](03-encap-single.md#nvgre) | `encap_single_vlan_nvgre` |
| Stack two VXLAN layers | [Double encapsulation](04-encap-double.md#vxlan-vxlan) | `encap_double_vxlan_vxlan` |
| Stack two NVGRE layers | [Double encapsulation](04-encap-double.md#nvgre-nvgre) | `encap_double_nvgre_nvgre` |
| Stack VXLAN over NVGRE | [Double encapsulation](04-encap-double.md#vxlan-nvgre) | `encap_double_vxlan_nvgre` |
| Split one cage into four sub-ports | [Breakout ports](05-breakout.md) | `breakout_4x100g`, `_4x25g`, `_4x10g` |

## The three sections of every config

A config is one JSON object with three top-level keys, and they are strictly ordered by dependency:
ports name a profile, connections name ports.

```json
{
  "profiles": { "layer_1_profiles": [] },
  "front_panel_ports": [],
  "connections": []
}
```

**`profiles.layer_1_profiles`** are the physical link settings — speed, autonegotiation or manual,
and FEC — under a name that ports refer to. Every non-breakout sample uses a single profile called
`manual_400g_rs`:

```json
{
  "name": "manual_400g_rs",
  "choice": "manual",
  "link_speed": "speed_400_gbps",
  "manual": { "fec_mode": "reed_solomon" }
}
```

`link_speed` is one of `speed_10_gbps`, `speed_25_gbps`, `speed_100_gbps`, `speed_200_gbps` or
`speed_400_gbps`. `choice` is `manual` or `autonegotiation`, and the matching sub-object carries
`fec_mode`, which is `none`, `reed_solomon` or `firecode`.

**`front_panel_ports`** give a physical cage a name that connections can reference. The `name` is
yours to choose; `front_panel_port` is the printed cage number from 1 to 32:

```json
{
  "name": "scenario4_ingress",
  "choice": "front_panel_port",
  "front_panel_port": {
    "front_panel_port": 25,
    "channel": 1,
    "layer_1_profile_name": "manual_400g_rs"
  }
}
```

**`connections`** each join two named ports and describe what to do with the traffic. This is where
all the scenario differences live, and it always has the same two parts:

```json
{
  "name": "Two ports, one function",
  "endpoints": [
    { "port_name": "scenario4_ingress" },
    { "port_name": "scenario4_egress" }
  ],
  "functions": [
    { "choice": "connect_ethernet", "connect_ethernet": {} }
  ]
}
```

`endpoints` say *which two ports*. `functions` say *what to do*. Nothing else. That skeleton is a
complete, valid connection — it passes all traffic between the two ports untouched. Every scenario in
these tutorials is that shape with the function body filled in.

## Endpoints hold no settings

An endpoint is a port name and a list of tags, and that is all it may contain. Every VLAN, VNI, MAC
and IP lives on a function.

This is the one thing worth internalising, because it changed in the July 2026 schema break. If you
are copying from an older config you will see endpoints shaped like
`{"choice": "front_panel", "front_panel": {"port_name": "p1", "vlan": {...}}}`. That form is gone.
Run such a config through `uhd_migration.py` in the repo root rather than editing it by hand.

Endpoint order is meaningful and permanent. `endpoints[0]` is **port1** and `endpoints[1]` is
**port2**, and the passthrough functions address them by those names. *Swap ends* in the inspector
reverses the pair and moves the settings with it.

## Where the VLAN goes depends on the function family

There are two families of function and they attach VLANs in genuinely different places. Putting the
VLAN in the wrong one is the most common authoring mistake.

**Passthrough functions** (`connect_ethernet`, `connect_arp`) are symmetric — traffic flows both
ways between two ports of the same kind — so each function carries one VLAN setting *per port*:

```json
{
  "choice": "connect_ethernet",
  "connect_ethernet": {
    "vlan_endpoint_settings_port1": { "vlan": { "choice": "vlan", "vlan": 101 } },
    "vlan_endpoint_settings_port2": { "vlan": { "choice": "vlan", "vlan": 101 } }
  }
}
```

Setting the two to different values is what VLAN translation *is*. There is no separate translation
function.

**Encapsulation functions** (`connect_vlan_vxlan`, `connect_vlan_nvgre`) are asymmetric — one end
speaks VLAN and the other speaks a tunnel — so instead of port1/port2 they have one settings block
per *role*:

```json
{
  "choice": "connect_vlan_vxlan",
  "connect_vlan_vxlan": {
    "vlan_endpoint_settings": { "vlan": { "choice": "vlan", "vlan": 101 } },
    "vxlan_endpoint_settings": { "vni": { "choice": "vni", "vni": 7001 } }
  }
}
```

Which physical port plays which role is decided by the endpoint tags, not by position. So for encap
you can reorder the endpoints freely, and for passthrough you cannot.

A `vlan` value is a `choice` object with three forms:

| Form | Meaning |
| --- | --- |
| `{"choice": "vlan", "vlan": 101}` | Exactly VLAN 101 |
| `{"choice": "vlan_range", "vlan_range": {"start": 101, "count": 8, "step": 1}}` | Eight VLANs from 101 |
| `{"choice": "non_vlan"}` | Untagged traffic on this port |

Omitting the block entirely means the same as `non_vlan`. A range with `count` of 0 or 1 is one
VLAN, so prefer the scalar form when you mean one.

## Tags are positional, and getting them wrong fails silently

`tags[i]` is that endpoint's role for `functions[i]`. Every endpoint carries exactly one tag per
function, in the same order as `functions`.

A connection with one `connect_vlan_vxlan` function has one tag per end:

```json
"endpoints": [
  { "port_name": "scenario1_ingress", "tags": ["vlan"] },
  { "port_name": "scenario1_egress",  "tags": ["vxlan"] }
]
```

Stack a second function and both lists grow to two:

```json
"endpoints": [
  { "port_name": "scenario_mixed_ingress", "tags": ["vlan", "vlan"] },
  { "port_name": "scenario_mixed_egress",  "tags": ["vxlan", "nvgre"] }
]
```

Each function type contributes a fixed pair:

| Function | port1 tag | port2 tag |
| --- | --- | --- |
| `connect_ethernet` | none | none |
| `connect_arp` | `vlan` | `vlan` |
| `connect_vlan_vxlan` | `vlan` | `vxlan` |
| `connect_vlan_nvgre` | `vlan` | `nvgre` |

Ethernet-only connections carry no `tags` key at all.

**Do not hand-write these.** A tag list shorter than `functions` is the worst failure mode in the
API: the device answers HTTP 200, returns your config unchanged, and forwards nothing. The
visualizer derives tags from the functions on every edit, so if you author in the canvas they are
correct by construction. If you must edit JSON directly, count them.

## Two functions means two stacked layers

Nothing in the schema is called "Q-in-Q" or "double encap". Both are the same mechanism: **one
connection carrying two functions.** That is why the type picker offers only single-layer types —
you create the connection, then add the second function to it.

Ordering is fixed: **`functions[0]` is the outer layer, `functions[1]` is the inner.** The shipped
Q-in-Q samples follow it (outer VLAN 100 in `functions[0]`, inner VLAN 200 in `functions[1]`), and
it is the order `uhd_migration.py` produces when it expands a legacy `vlan_double` endpoint.

The two functions do not have to be the same type. `encap_double_vxlan_nvgre` stacks a
`connect_vlan_vxlan` over a `connect_vlan_nvgre`, which is why its tunnel-side tags read
`["vxlan", "nvgre"]`.

## Building a scenario in the visualizer

Every tutorial's UI steps assume what is in this section, so read it once and the per-scenario steps
stay short.

### The parts of the page

| Area | What it holds |
| --- | --- |
| Left, **Layer 1 Profiles** | One card per profile, and the `+ New profile` button. |
| Centre, the chassis | 32 cages in column pairs — port 1 top-left, port 2 below it, through to 31/32 on the far right. Connections are drawn as wires between cages. |
| Centre bottom, **Connections** | One row per connection. Click a row to select it. |
| Right top, **Inspector** | Everything about whatever is selected. This is where you edit. |
| Right bottom, **Configuration JSON** | The same document as text, live in both directions. |

Nothing is selected when you start, so the inspector shows an overview with a three-box progress
strip — **1. Profiles**, **2. Ports**, **3. Connections** — with a count in each and the next step
you need highlighted. The order is enforced: you cannot name a port without a profile, or draw a
connection from a cage that has no port.

### Step 1 — create the Layer 1 profile

Press **+ New profile** at the bottom left. The dialog defaults to exactly what every non-breakout
sample uses, so for these tutorials you can accept it as-is:

| Field | Default |
| --- | --- |
| Name | `manual_400g_rs` |
| Link speed | 400G |
| Mode | manual |
| FEC | Reed Solomon |

Press **Create profile**. The profile appears as a card on the left. Breakout is the one family that
needs different values here — see [Breakout ports](05-breakout.md).

### Step 2 — name your ports

Click a dark cage. The **Assign front-panel port N** dialog asks for two things: which Layer 1
profile to use (**Use existing** is preselected once one exists) and a **Port name**, which defaults
to `Port 25` and is the string every connection will reference. Replace it with the name you want —
the samples use names like `scenario1_ingress` — and press **Assign port**.

Do that for both cages. An assigned cage draws brighter and shows its name, and a labelled box
appears above the chassis with a leader line down to it.

Two things you can change afterwards, by clicking an assigned cage: **Name** renames the port and
updates every connection that references it, and **Clear port N** frees the cage, blocked while a
connection still uses it.

### Step 3 — connect them

Drag from one assigned cage to the other. **The cage you start the drag on becomes port1**, which
matters for every passthrough scenario. On drop, the **Connect P25 → P26** dialog offers four types,
and they behave differently:

| Type | What happens on click |
| --- | --- |
| **Ethernet** | Created immediately, with `ethertypes: []` and no VLAN settings. Passes everything untouched. |
| **ARP** | Created immediately, with no settings at all. |
| **VLAN ↔ VXLAN** | Opens a **draft**. |
| **VLAN ↔ NVGRE** | Opens a **draft**. |

Ethernet and ARP are safe to create empty, because an empty one is still a valid, meaningful
connection. The two encapsulation types are not: the API needs a tunnel ID and a full outer header
before the connection does anything. So they open a draft instead — drawn on the chassis in amber,
listed in the inspector under **Draft — not in the JSON yet**, and deliberately kept out of the
document until it is complete. The inspector names what is **Still needed** and greys the **Create
connection** button until nothing is. **Discard draft** or `Esc` throws it away.

Once a connection exists, select it (click its wire or its row in the **Connections** list) and the
inspector shows it in full: a pipeline summary at the top, then **Endpoints**, then **Functions**.

### Adding a second layer

The type picker offers only single-layer types on purpose — Q-in-Q and double encapsulation are one
connection with *two functions*, not a different type of connection. So you build them in two moves:
create the connection, then in the **Functions** section press one of the `+ Ethernet`, `+ ARP`,
`+ VLAN ↔ VXLAN`, `+ VLAN ↔ NVGRE` buttons.

The inspector lists functions top to bottom in array order, so **the top card is `functions[0]`, the
outer layer**. Endpoint tags are recalculated the moment you add or remove a function.

One asymmetry to know about: a second function is added **straight into the JSON**, empty. Unlike a
draft, nothing holds it back until you fill it, and an encapsulation function with no VLAN, no tunnel
ID and no header addresses is not an error — the config still saves and still posts. Finish filling
it in the same sitting.

### Where each field lives

| JSON | Where in the UI |
| --- | --- |
| `profiles.layer_1_profiles[]` | Left panel; click a card to edit it |
| `front_panel_ports[].name` | Assign dialog → **Port name**; later **Name** on the port |
| `front_panel_ports[].front_panel_port.*` | Set by which cage you clicked; not editable as text |
| `connections[].name` | **Endpoints** → **Name** |
| endpoint order | **Endpoints** → **port1** / **port2**, and the **Swap ends** button |
| `endpoints[].tags` | Shown under **Tags**, read-only — always derived from the functions |
| `connect_ethernet` / `connect_arp` VLANs | **VLAN on port1** and **VLAN on port2**, each a dropdown of **Single VLAN** / **VLAN range** / **Untagged** |
| `connect_ethernet.ethertypes` | **Ethertypes**, as a comma-separated list; empty means all |
| encap VLAN side | **VLAN endpoint (port1)** → **VLAN** |
| `vxlan_endpoint_settings.vni` | **VXLAN endpoint (port2)** → **VNI**, switchable to **Range** |
| `nvgre_endpoint_settings.vsid` | **NVGRE endpoint (port2)** → **VSID**, switchable to **Range** |
| the outgoing header | **Outgoing VXLAN/NVGRE header** → **Source MAC**, **Next-hop MAC**, **Source IP**, **Destination IP**, then **UDP dst port** or **Flow ID**, and **TOS / DSCP** |
| a second function | The `+` buttons under **Functions** |

Every field writes to the JSON as you type. Placeholder text in a field is the value the matching
sample uses, shown as a format hint rather than a default — an empty field stays absent from the
JSON.

### What the canvas will not author

These are all readable and editable in the JSON pane; the canvas simply has no control for them:

- **MAC and IP *ranges*.** Single addresses have fields; a range shows as `MAC range — edit in the
  JSON pane` with its start value.
- **`protocols`, `protocol_id`, `src_port`, `dst_port`, `routing_method`** and the `ip_routing` /
  `mac_routing` blocks. They are preserved untouched through canvas edits.
- **`connect_ip`.** No sample uses it, so there was nothing to author from. A connection using it is
  marked read-only in the inspector, with the reason given.
- **Breakout.** Refused outright, canvas locked. See [Breakout ports](05-breakout.md).
- **More or fewer than two endpoints.** The canvas draws two ends; anything else is read-only.

A read-only connection says so in a red banner that names the specific reason, and nothing you do
elsewhere in the inspector will rewrite it.

### Errors, warnings and the lock

Editing the JSON pane re-renders the canvas as soon as the text parses. If it does not parse, or
breaks a rule, the canvas locks and keeps the last good drawing on screen so you do not lose your
place — with **Revert JSON to canvas** to go back. **Save is refused while the JSON is invalid**, so
a locked canvas can never quietly save you the older config it is still showing.

Errors block, warnings do not. Bad enums, out-of-range port numbers, missing profile or port
references and dangling endpoints all lock the canvas. Overlapping VLANs on one port, unused
profiles, assigned ports with no connection, and names outside the documented character pattern only
warn — they appear under **Warnings** in the inspector and in amber under the JSON pane, each with a
**show** link that selects what it is talking about.

Connection names are limited to letters, digits, spaces and `-_()><[]`. A forward slash is outside
the pattern and only warns, but it is worth avoiding.

## Applying and checking a config

Post the file to the device:

```bash
curl -k -X POST -H "Content-Type: application/json" \
  -d @docs/samples/encap_single_vlan_vxlan/encap_single_vlan_vxlan.json \
  https://<unit>/connect/api/v1/config
```

Then read the per-port counters, which is how you confirm traffic is actually moving rather than
just accepted:

```bash
curl -k -X POST -H "Content-Type: application/json" \
  https://<unit>/connect/api/v1/metrics/operations/query

curl -k -X POST -H "Content-Type: application/json" \
  https://<unit>/connect/api/v1/metrics/operations/clear
```

A HTTP 200 means the config parsed, not that it forwards. Clear the counters, send traffic, query
again. Zero on the egress port with a valid config almost always means positional tags — see above.

Before posting, you can check a config against the same rules the visualizer enforces with
`node tools/roundtrip-test.cjs`, or just open it in the page and look for a red banner.

## Reference

- `docs/openapi.json` — the authoritative schema. Field descriptions there beat anything here.
- `docs/samples/` — the scenario JSON these tutorials walk through.
- `docs/samples/README.txt` — the vendor's own curl instructions.
- `uhd_migration.py` — converts pre-July-2026 configs to the current schema. `--selftest` proves it
  still works, `--diff` shows what it would change.
- `../../README.md` — the visualizer's own behaviour in detail, including port groups.
