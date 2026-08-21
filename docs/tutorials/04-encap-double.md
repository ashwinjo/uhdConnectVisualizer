# Double encapsulation

Two encapsulation layers on one connection. Same mechanism as Q-in-Q — a second function is a second
layer — but each layer here carries a full tunnel definition of its own rather than just a tag.

Covers `encap_double_vxlan_vxlan`, `encap_double_nvgre_nvgre` and `encap_double_vxlan_nvgre`.

Read [Single encapsulation](03-encap-single.md) first. Everything about one encap function — the
role-based settings blocks, the four required header addresses, the draft flow in the visualizer,
ranges, routing methods — applies unchanged to each layer here. This page is only about stacking.

The base is the same too: one `manual_400g_rs` profile and two ports on cages 25 and 26. These three
samples name them `scenario3_*`, `scenario1_*` and `scenario_mixed_*`, so adjust the `port_name`
values to whatever you declared.

## What stacking adds

Each function is a complete, independent encapsulation: its own VLAN on the VLAN side, its own tunnel
ID on the tunnel side, and its own outgoing header. Two functions means two of everything.

| | `functions[0]` | `functions[1]` |
| --- | --- | --- |
| Layer | outer | inner |
| VLAN side | its own `vlan_endpoint_settings.vlan` | its own `vlan_endpoint_settings.vlan` |
| Tunnel side | its own tunnel ID and outgoing header | its own tunnel ID and outgoing header |

Tags grow to one per function on both endpoints. On the VLAN side that is `["vlan", "vlan"]`; on the
tunnel side it names each layer's type in order, so a VXLAN-over-NVGRE stack reads
`["vxlan", "nvgre"]`. That tag list is the only thing in the JSON that records which layer is which
type, which makes it worth reading carefully when reviewing someone else's config.

The two layers do not have to be the same type, and their tunnel IDs, headers and VLANs are entirely
independent — nothing forces the tidy `9001`/`9002` numbering the samples use.

## Building one in the visualizer

Two moves, and they work differently from each other. All three scenarios below share this shape, so
only the values change.

1. Create the profile and name your two cages as usual.
2. Drag between them and pick the **outer** layer's type — **VLAN ↔ VXLAN** or **VLAN ↔ NVGRE**.
   This opens a draft, exactly as on the [single encapsulation](03-encap-single.md#on-the-ui) page.
   Fill it completely — VLAN, tunnel ID, four header addresses — and press **Create connection**.
   That function becomes `functions[0]`, the outer layer.
3. With the connection selected, press **+ VLAN ↔ VXLAN** or **+ VLAN ↔ NVGRE** under **Functions**
   for the inner layer. Pick by the *inner* layer's type; the two do not have to match.
4. A second card appears below the first. Fill in **VLAN endpoint (port1)** → **VLAN**, the tunnel ID
   under **VXLAN/NVGRE endpoint (port2)**, and the four addresses under **Outgoing … header**.

The **Tags** line under **Endpoints** goes to two per endpoint the moment you press the `+` button,
and it tracks the function types in order — that is what turns a mixed stack's tunnel side into
`["vxlan", "nvgre"]`.

### The second layer is not protected the way the first one is

This is the one thing to watch on this page. The draft gate only guards the connection you create by
dragging. A function added with a `+` button goes **straight into the JSON, empty**, and an
encapsulation function with no VLAN, no tunnel ID and no header addresses is **not** a validation
error here — no red banner, no lock, no warning, and **Save** will happily write it.

So the danger window is between pressing `+` and finishing the card. The visualizer will not remind
you, and a config with a hollow second layer is the classic one that posts with HTTP 200 and then
forwards nothing. Fill the card immediately, and read the second half of the JSON pane before you
save.

<a id="vxlan-vxlan"></a>

## VXLAN over VXLAN

*Sample: `encap_double_vxlan_vxlan`*

Two `connect_vlan_vxlan` functions. VLAN 201 with VNI 9001 outside, VLAN 202 with VNI 9002 inside,
each with its own outer header.

```json
{
  "name": "Scenario 3 - VLAN to VXLAN-VXLAN",
  "endpoints": [
    { "port_name": "scenario3_ingress", "tags": ["vlan", "vlan"] },
    { "port_name": "scenario3_egress",  "tags": ["vxlan", "vxlan"] }
  ],
  "functions": [
    {
      "choice": "connect_vlan_vxlan",
      "connect_vlan_vxlan": {
        "vlan_endpoint_settings": { "vlan": { "choice": "vlan", "vlan": 201 } },
        "vxlan_endpoint_settings": {
          "vni": { "choice": "vni", "vni": 9001 },
          "protocols": {},
          "outgoing_vxlan_header": {
            "src_mac": { "choice": "mac",  "mac":  "80:09:02:01:00:04" },
            "dst_mac": { "choice": "mac",  "mac":  "00:50:f2:88:00:03" },
            "src_ip":  { "choice": "ipv4", "ipv4": "225.5.0.1" },
            "dst_ip":  { "choice": "ipv4", "ipv4": "225.0.0.5" },
            "udp_dst_port": 4789
          }
        }
      }
    },
    {
      "choice": "connect_vlan_vxlan",
      "connect_vlan_vxlan": {
        "vlan_endpoint_settings": { "vlan": { "choice": "vlan", "vlan": 202 } },
        "vxlan_endpoint_settings": {
          "vni": { "choice": "vni", "vni": 9002 },
          "protocols": {},
          "outgoing_vxlan_header": {
            "src_mac": { "choice": "mac",  "mac":  "80:09:02:01:00:05" },
            "dst_mac": { "choice": "mac",  "mac":  "00:50:f2:88:00:04" },
            "src_ip":  { "choice": "ipv4", "ipv4": "225.6.0.1" },
            "dst_ip":  { "choice": "ipv4", "ipv4": "225.0.0.6" },
            "udp_dst_port": 4789
          }
        }
      }
    }
  ]
}
```

Both layers use the default `udp_dst_port` of 4789 and distinct source and destination addresses, so
each envelope is independently addressable on the underlay.

### On the UI

Pick **VLAN ↔ VXLAN** on the drag, then **+ VLAN ↔ VXLAN** for the second card.

| Field | Outer (draft, then top card) | Inner (second card) |
| --- | --- | --- |
| VLAN | `201` | `202` |
| VNI | `9001` | `9002` |
| Source MAC | `80:09:02:01:00:04` | `80:09:02:01:00:05` |
| Next-hop MAC | `00:50:f2:88:00:03` | `00:50:f2:88:00:04` |
| Source IP | `225.5.0.1` | `225.6.0.1` |
| Destination IP | `225.0.0.5` | `225.0.0.6` |
| UDP dst port | `4789`, prefilled | `4789`, prefilled |

The tunnel-side tags become `["vxlan", "vxlan"]` on their own.

<a id="nvgre-nvgre"></a>

## NVGRE over NVGRE

*Sample: `encap_double_nvgre_nvgre`*

The same shape with `connect_vlan_nvgre` twice: `vsid` in place of `vni`, `outgoing_nvgre_header` in
place of `outgoing_vxlan_header`, and `flow_id` in place of the UDP ports.

```json
{
  "name": "Phase3 - Double encap VLAN to NVGRE-NVGRE",
  "endpoints": [
    { "port_name": "scenario1_ingress", "tags": ["vlan", "vlan"] },
    { "port_name": "scenario1_egress",  "tags": ["nvgre", "nvgre"] }
  ],
  "functions": [
    {
      "choice": "connect_vlan_nvgre",
      "connect_vlan_nvgre": {
        "vlan_endpoint_settings": { "vlan": { "choice": "vlan", "vlan": 301 } },
        "nvgre_endpoint_settings": {
          "vsid": { "choice": "vsid", "vsid": 10001 },
          "outgoing_nvgre_header": {
            "src_mac": { "choice": "mac",  "mac":  "80:09:02:01:00:07" },
            "dst_mac": { "choice": "mac",  "mac":  "00:50:f2:88:00:06" },
            "src_ip":  { "choice": "ipv4", "ipv4": "225.7.0.1" },
            "dst_ip":  { "choice": "ipv4", "ipv4": "225.0.0.7" },
            "flow_id": 1
          }
        }
      }
    },
    {
      "choice": "connect_vlan_nvgre",
      "connect_vlan_nvgre": {
        "vlan_endpoint_settings": { "vlan": { "choice": "vlan", "vlan": 302 } },
        "nvgre_endpoint_settings": {
          "vsid": { "choice": "vsid", "vsid": 10002 },
          "outgoing_nvgre_header": {
            "src_mac": { "choice": "mac",  "mac":  "80:09:02:01:00:08" },
            "dst_mac": { "choice": "mac",  "mac":  "00:50:f2:88:00:07" },
            "src_ip":  { "choice": "ipv4", "ipv4": "225.8.0.1" },
            "dst_ip":  { "choice": "ipv4", "ipv4": "225.0.0.8" },
            "flow_id": 2
          }
        }
      }
    }
  ]
}
```

This sample omits `protocols` entirely, where the VXLAN ones set it to `{}`. Both mean "accept
everything" — `protocols` is optional, and an empty object is the same as leaving it out. Do not read
anything into the difference.

The two layers use different `flow_id` values, 1 and 2. Distinct IDs per layer give the underlay
something to distinguish the two envelopes by, in the same way the distinct source addresses do.

### On the UI

Pick **VLAN ↔ NVGRE** on the drag, then **+ VLAN ↔ NVGRE**.

| Field | Outer (draft, then top card) | Inner (second card) |
| --- | --- | --- |
| VLAN | `301` | `302` |
| VSID | `10001` | `10002` |
| Source MAC | `80:09:02:01:00:07` | `80:09:02:01:00:08` |
| Next-hop MAC | `00:50:f2:88:00:06` | `00:50:f2:88:00:07` |
| Source IP | `225.7.0.1` | `225.8.0.1` |
| Destination IP | `225.0.0.7` | `225.0.0.8` |
| Flow ID | `1` | `2` |

**Flow ID** is empty rather than prefilled in both cards, and it is not required, so type the values
in deliberately. Your result will carry `"protocols": {}` on both layers where this sample omits the
key — the same thing, as noted above.

<a id="vxlan-nvgre"></a>

## VXLAN over NVGRE

*Sample: `encap_double_vxlan_nvgre`*

The interesting one: the two layers are different types. `connect_vlan_vxlan` on the outside,
`connect_vlan_nvgre` on the inside.

```json
{
  "name": "VLAN to VXLAN-NVGRE",
  "endpoints": [
    { "port_name": "scenario_mixed_ingress", "tags": ["vlan", "vlan"] },
    { "port_name": "scenario_mixed_egress",  "tags": ["vxlan", "nvgre"] }
  ],
  "functions": [
    {
      "choice": "connect_vlan_vxlan",
      "connect_vlan_vxlan": {
        "vlan_endpoint_settings": { "vlan": { "choice": "vlan", "vlan": 401 } },
        "vxlan_endpoint_settings": {
          "vni": { "choice": "vni", "vni": 11001 },
          "protocols": {},
          "outgoing_vxlan_header": {
            "src_mac": { "choice": "mac",  "mac":  "80:09:02:01:00:09" },
            "dst_mac": { "choice": "mac",  "mac":  "00:50:f2:88:00:08" },
            "src_ip":  { "choice": "ipv4", "ipv4": "225.9.0.1" },
            "dst_ip":  { "choice": "ipv4", "ipv4": "225.0.0.9" },
            "udp_dst_port": 4789
          }
        }
      }
    },
    {
      "choice": "connect_vlan_nvgre",
      "connect_vlan_nvgre": {
        "vlan_endpoint_settings": { "vlan": { "choice": "vlan", "vlan": 402 } },
        "nvgre_endpoint_settings": {
          "vsid": { "choice": "vsid", "vsid": 11002 },
          "protocols": {},
          "outgoing_nvgre_header": {
            "src_mac": { "choice": "mac",  "mac":  "80:09:02:01:00:0a" },
            "dst_mac": { "choice": "mac",  "mac":  "00:50:f2:88:00:09" },
            "src_ip":  { "choice": "ipv4", "ipv4": "225.10.0.1" },
            "dst_ip":  { "choice": "ipv4", "ipv4": "225.0.0.10" },
            "flow_id": 3
          }
        }
      }
    }
  ]
}
```

The tunnel-side tags `["vxlan", "nvgre"]` are what tie each layer to its type, positionally. Swap the
two functions and you must swap those tags too — the visualizer does it for you, a hand edit does
not.

Note that the VLAN-side tags stay `["vlan", "vlan"]`. Both layers present as VLAN on that end
regardless of what the tunnel side does, so a mixed stack is only visible in the tunnel-side list.

### On the UI

The only scenario where the two picks differ: **VLAN ↔ VXLAN** on the drag, then **+ VLAN ↔ NVGRE**
for the second card. Choose in that order — swapping them builds NVGRE-over-VXLAN, which is a
different config that posts just as successfully.

| Field | Outer, VXLAN (draft, then top card) | Inner, NVGRE (second card) |
| --- | --- | --- |
| VLAN | `401` | `402` |
| Tunnel ID | **VNI** `11001` | **VSID** `11002` |
| Source MAC | `80:09:02:01:00:09` | `80:09:02:01:00:0a` |
| Next-hop MAC | `00:50:f2:88:00:08` | `00:50:f2:88:00:09` |
| Source IP | `225.9.0.1` | `225.10.0.1` |
| Destination IP | `225.0.0.9` | `225.0.0.10` |
| Transport | **UDP dst port** `4789`, prefilled | **Flow ID** `3` |

The two cards are visibly different — one says **VXLAN endpoint (port2)** and **Outgoing VXLAN
header**, the other **NVGRE endpoint (port2)** and **Outgoing NVGRE header** — so the stack order is
readable off the inspector without opening the JSON.

## Things that will bite you

**Order defines outer versus inner.** Both orderings are structurally valid and both post
successfully, so nothing will tell you that you built the stack inside out. Confirm against a capture
rather than assuming.

**Every layer needs its own complete header.** Four addresses per function, not four for the
connection. Nothing in the visualizer enforces this on a second layer: a `functions[1]` missing its
`dst_ip`, or missing every field, validates clean and saves. Only the first function — the one the
drag created — is held back by the draft gate.

**Give each layer distinct addresses.** The samples use a different source MAC, source IP and
destination IP for every layer. Reusing one address pair across both layers makes the two envelopes
indistinguishable on the underlay.

**Tags must match the function types in order.** `["nvgre", "vxlan"]` on a
VXLAN-then-NVGRE stack is accepted by the device and forwards incorrectly. This is the single easiest
mistake to make when copying a config by hand, and the reason to author stacks in the canvas.

**Watch tunnel ID reuse across connections.** Two connections on one port claiming the same VNI is a
warning in the visualizer and a conflict on the device. With two layers per connection there are
twice as many IDs to keep unique.
