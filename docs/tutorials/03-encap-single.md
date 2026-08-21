# Single encapsulation

One port speaks VLAN, the other speaks a tunnel, and the device re-encapsulates between them in both
directions. Use this to put VLAN-only equipment on a VXLAN or NVGRE fabric without changing the
equipment.

Covers `encap_single_vlan_vxlan` and `encap_single_vlan_nvgre`.

Both samples sit on the same base as the passthrough scenarios — one `manual_400g_rs` profile and two
ports on cages 25 and 26, shown in
[Single-VLAN passthrough](01-passthrough-single.md#the-base-every-scenario-shares). They name those
ports `scenario1_*` and `scenario2_*` respectively, so change the `port_name` values below to match
whatever you declared.

## How an encap function is shaped

Unlike the passthrough functions, an encap function does not address its ports as port1 and port2.
It has one settings block per *role*, and the endpoint tags decide which physical port fills each
role:

```json
{
  "choice": "connect_vlan_vxlan",
  "connect_vlan_vxlan": {
    "vlan_endpoint_settings":  { "vlan": { "choice": "vlan", "vlan": 101 } },
    "vxlan_endpoint_settings": { "vni":  { "choice": "vni",  "vni": 7001 } }
  }
}
```

One endpoint must be tagged `vlan` and the other `vxlan` (or `nvgre`). The VLAN ID of traffic on the
VLAN side determines the tunnel ID on the tunnel side, and the tunnel ID of traffic arriving on the
tunnel side determines the VLAN ID going out the other way. It is one mapping used in both
directions, not two rules.

Because the ends are found by tag, endpoint order does not change behaviour here — though the
visualizer writes the VLAN end first by convention, and following it keeps the JSON readable.

### What the API requires

An encap function is rejected unless it has all of:

- `vlan_endpoint_settings.vlan` — the VLAN side's tag
- the tunnel ID: `vxlan_endpoint_settings.vni` or `nvgre_endpoint_settings.vsid`
- the outgoing header's four address fields: `src_mac`, `dst_mac`, `src_ip`, `dst_ip`

The header is the outer envelope the device builds when it encapsulates, so those four fields have to
describe a real path across your underlay: source MAC and IP that belong to the device's tunnel
endpoint, destination MAC of the next hop, destination IP of the far tunnel endpoint.

This is why VXLAN and NVGRE are the only two types in the visualizer that open a **draft** on drop.
The connection is drawn on the chassis in amber and deliberately kept out of the JSON until all of
the above is filled in, so a half-finished tunnel is never posted. The inspector lists exactly what
is still missing, and the placeholder text in each field shows the value the matching sample uses.

Only `udp_dst_port` is prefilled, at 4789, because that is the schema's own default.

<a id="vxlan"></a>

## VLAN to VXLAN

*Sample: `encap_single_vlan_vxlan`*

VLAN 101 on cage 25 becomes VNI 7001 on cage 26, and back again.

```json
{
  "name": "Scenario 1 - VLAN to VXLAN",
  "endpoints": [
    { "port_name": "scenario1_ingress", "tags": ["vlan"] },
    { "port_name": "scenario1_egress",  "tags": ["vxlan"] }
  ],
  "functions": [
    {
      "choice": "connect_vlan_vxlan",
      "connect_vlan_vxlan": {
        "vlan_endpoint_settings": {
          "vlan": { "choice": "vlan", "vlan": 101 }
        },
        "vxlan_endpoint_settings": {
          "vni": { "choice": "vni", "vni": 7001 },
          "protocols": {},
          "outgoing_vxlan_header": {
            "src_mac": { "choice": "mac",  "mac":  "80:09:02:01:00:02" },
            "dst_mac": { "choice": "mac",  "mac":  "00:50:f2:88:00:01" },
            "src_ip":  { "choice": "ipv4", "ipv4": "225.3.0.1" },
            "dst_ip":  { "choice": "ipv4", "ipv4": "225.0.0.3" },
            "udp_dst_port": 4789
          }
        }
      }
    }
  ]
}
```

### On the UI

On top of the usual profile and two named ports:

1. Drag from cage 25 to cage 26 and click **VLAN ↔ VXLAN**. No connection appears in the JSON pane
   or the **Connections** list. Instead the wire is drawn in amber and the inspector shows an amber
   banner, **Draft — not in the JSON yet**, naming which port is port1 and which is port2.
2. Under **Encapsulation**, fill the two IDs. The labels name the actual cages:

   | Field | Value |
   | --- | --- |
   | VLAN on P25 | `101` |
   | VNI on P26 | `7001` |

3. Under **Outer header**, fill the four addresses:

   | Field | Value |
   | --- | --- |
   | Source MAC | `80:09:02:01:00:02` |
   | Next-hop MAC | `00:50:f2:88:00:01` |
   | Source IP | `225.3.0.1` |
   | Destination IP | `225.0.0.3` |

   **UDP dst port** is already `4789` and needs no attention. The greyed text in every empty field is
   the value this sample uses, so you can read the expected format straight off it. A malformed MAC or
   IP outlines the field in red as you type.
4. The line above the buttons tracks what is **Still needed** and shrinks as you fill fields. When it
   reads **Ready**, press **Create connection**. The connection lands in the JSON pane and the wire
   turns white.

`Esc` or **Discard draft** throws the whole draft away; nothing partial is ever written.

Selecting the finished connection shows the same values in a different layout — **VLAN endpoint
(port1)**, **VXLAN endpoint (port2)** and **Outgoing VXLAN header** — plus two fields the draft does
not offer, **TOS / DSCP** and the **Range** option on the VNI.

`udp_dst_port` defaults to 4789 and `udp_src_port` to 0, which tells the device to compute the source
port as a hash of the inner addresses and protocol — normal practice, since it gives the underlay
something to load-balance on. Set it explicitly only if you need a fixed source port.

<a id="nvgre"></a>

## VLAN to NVGRE

*Sample: `encap_single_vlan_nvgre`*

Structurally identical, with three substitutions: the block is `nvgre_endpoint_settings`, the tunnel
ID is a `vsid` rather than a `vni`, and the header is `outgoing_nvgre_header` with a `flow_id`
instead of UDP ports.

```json
{
  "name": "Scenario 2 - VLAN to NVGRE",
  "endpoints": [
    { "port_name": "scenario2_ingress", "tags": ["vlan"] },
    { "port_name": "scenario2_egress",  "tags": ["nvgre"] }
  ],
  "functions": [
    {
      "choice": "connect_vlan_nvgre",
      "connect_vlan_nvgre": {
        "vlan_endpoint_settings": {
          "vlan": { "choice": "vlan", "vlan": 101 }
        },
        "nvgre_endpoint_settings": {
          "vsid": { "choice": "vsid", "vsid": 8001 },
          "protocols": {},
          "outgoing_nvgre_header": {
            "src_mac": { "choice": "mac",  "mac":  "80:09:02:01:00:03" },
            "dst_mac": { "choice": "mac",  "mac":  "00:50:f2:88:00:02" },
            "src_ip":  { "choice": "ipv4", "ipv4": "225.4.0.1" },
            "dst_ip":  { "choice": "ipv4", "ipv4": "225.0.0.4" },
            "flow_id": 0
          }
        }
      }
    }
  ]
}
```

NVGRE has no UDP header, so there is nothing corresponding to `udp_src_port` or `udp_dst_port`.
`flow_id` fills a comparable role for the underlay and defaults to 0.

The tunnel-side tag must be `nvgre`, not `vxlan`. The visualizer sets it from the function type, so
the only way to get this wrong is by hand-editing.

### On the UI

The same draft flow, reached by clicking **VLAN ↔ NVGRE** instead:

| Field | Value |
| --- | --- |
| VLAN on P25 | `101` |
| VSID on P26 | `8001` |
| Source MAC | `80:09:02:01:00:03` |
| Next-hop MAC | `00:50:f2:88:00:02` |
| Source IP | `225.4.0.1` |
| Destination IP | `225.0.0.4` |

The tunnel ID field is labelled **VSID** rather than **VNI**, and where VXLAN has a prefilled **UDP
dst port** this has an empty **Flow ID**. Flow ID is not required, so leaving it empty still lets you
press **Create connection** — the sample's `"flow_id": 0` is an explicit zero, which you get by
typing `0`.

## Side-by-side

| | VXLAN | NVGRE |
| --- | --- | --- |
| Function | `connect_vlan_vxlan` | `connect_vlan_nvgre` |
| Tunnel settings | `vxlan_endpoint_settings` | `nvgre_endpoint_settings` |
| Tunnel ID | `vni` / `vni_range`, 0–16777215 | `vsid` / `vsid_range`, 0–16777215 |
| Header | `outgoing_vxlan_header` | `outgoing_nvgre_header` |
| Transport field | `udp_src_port`, `udp_dst_port` (4789) | `flow_id` (0) |
| Tunnel-side tag | `vxlan` | `nvgre` |

Everything else — the VLAN block, the four header addresses, `tos`, `protocols`, the routing options
below — is the same in both.

## Ranges: many VLANs through one function

Every ID and address field in an encap function has a range form, so one function can cover a block
of VLANs instead of one:

```json
"vlan_endpoint_settings": {
  "vlan": { "choice": "vlan_range", "vlan_range": { "start": 101, "count": 8, "step": 1 } }
},
"vxlan_endpoint_settings": {
  "vni": { "choice": "vni_range", "vni_range": { "start": 7001 } }
}
```

The ranges line up position by position, so VLAN 101 maps to VNI 7001, 102 to 7002, and so on. A
range used as a destination needs only `start` — its count is taken from the VLAN count on the other
side. The same applies to `mac_range` and `ipv4_range` in the outgoing header, which is how one
function can give each VLAN its own source address.

At least one range in the connection must have a non-zero `count`, otherwise nothing establishes how
many entries to generate.

## Optional controls worth knowing

**`protocols`** filters on the inner packet with an `accept` or `reject` list — one or the other, not
both. An empty object, as in the samples, accepts everything. Entries look like `icmp`, `bgp`, `tcp`
or `tcp:179`.

**`protocol_id`, `src_port`, `dst_port`** filter by IP protocol number and L4 port. `protocol_id`
takes precedence over `protocols` if you set both, and the port fields only apply when the protocol
is TCP (6) or UDP (17).

**`routing_method`** decides what the device keys on. The default is `vni_routing` on the tunnel side
and `vlan_routing` on the VLAN side — the tunnel-ID-to-VLAN mapping described above. Switch it to
`ip_routing` or `mac_routing` and you must supply the matching block: `ip_routing.destination_ips` or
`mac_routing.destination_macs` on the tunnel side, `ip_routing.source_ips` or
`mac_routing.source_macs` on the VLAN side.

**`tos`** sets the DSCP byte on the outer IPv4 header, or the Traffic Class byte for an IPv6
underlay.

## Things that will bite you

**Keep the outer header on the tunnel side.** `outgoing_vxlan_header` belongs inside
`vxlan_endpoint_settings`. It used to live under `vlan_endpoint_settings`, and configs written before
July 2026 have it there. The device will not apply it from the old position — run those through **Convert**.

**`udp_src_port` and `udp_dst_port` go inside the header**, not on `vxlan_endpoint_settings`
alongside `vni`. Same schema break, same fix.

**Both IPs must be the same family.** `src_ip` and `dst_ip` have to be both IPv4 or both IPv6; the
`choice` on each is what selects the underlay family. There is no separate `_v6` header any more.

**`routing_method` must sit on the settings block.** Nesting it inside `protocols` is accepted with
HTTP 200 and then silently ignored, leaving the connection on the `vni_routing` default. Convert
hoists it if it finds it misplaced.

**Two connections on one port need distinct tunnel IDs.** Reusing a VNI on the same port group is a
warning in the visualizer and a real conflict on the device.
