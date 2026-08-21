# Single-VLAN passthrough

Three scenarios, one function type. A `connect_ethernet` function bridges two ports and, if you give
it VLAN settings, decides which tag each port expects. Because the two ports are configured
independently, the same function covers passing a tag through untouched, renumbering it, and
stripping it — the only difference is what you put in the two settings blocks.

Covers `passthrough_single_symmetric`, `passthrough_single_translation` and
`passthrough_single_non_vlan`.

## The base every scenario shares

All three samples use one 400G profile and two ports, cages 25 and 26. Build this first; the
scenarios only differ in the function body.

The one thing that varies is the port *names*: each sample picks its own, so the connection blocks
below say `scenario4_*`, `scenario5_*` and `scenario_non_vlan_*` respectively. If you are following
along on a single base, keep whichever pair of names you declared and change the `port_name` values
to match. An endpoint naming a port that does not exist is a hard error, and the visualizer will say
so.

```json
{
  "profiles": {
    "layer_1_profiles": [
      {
        "name": "manual_400g_rs",
        "choice": "manual",
        "link_speed": "speed_400_gbps",
        "manual": { "fec_mode": "reed_solomon" }
      }
    ]
  },
  "front_panel_ports": [
    {
      "name": "scenario4_ingress",
      "choice": "front_panel_port",
      "front_panel_port": { "front_panel_port": 25, "channel": 1, "layer_1_profile_name": "manual_400g_rs" }
    },
    {
      "name": "scenario4_egress",
      "choice": "front_panel_port",
      "front_panel_port": { "front_panel_port": 26, "channel": 1, "layer_1_profile_name": "manual_400g_rs" }
    }
  ],
  "connections": []
}
```

### On the UI

1. Press **+ New profile** at the bottom left and accept the defaults, which are already
   `manual_400g_rs` / 400G / manual / Reed Solomon. Press **Create profile**.
2. Click cage 25. In **Assign front-panel port 25**, set **Port name** to `scenario4_ingress` and
   press **Assign port**.
3. Click cage 26 and do the same with `scenario4_egress`.
4. Drag from cage 25 to cage 26. **Start the drag on 25** — the cage you start on becomes port1, and
   all three scenarios below put port 25's tag in the port1 block.
5. In **Connect P25 → P26**, click **Ethernet**. The connection appears immediately; there is no
   draft step, because Ethernet has no required fields.

That gives you a working connection with `ethertypes: []` and no VLAN settings, which passes all
traffic untouched. Everything below is filling in its two VLAN blocks.

Select the new connection — click its wire, or its row in the **Connections** list — and the
inspector shows one function card titled **Ethernet** holding **VLAN on port1**, **VLAN on port2**
and **Ethertypes**. Both VLAN dropdowns read **Untagged**, which is how the UI displays "no setting
written". That is where every scenario below picks up.

<a id="symmetric"></a>

## Symmetric — the same VLAN on both ports

*Sample: `passthrough_single_symmetric`*

VLAN 101 arrives on port 25 and leaves port 26 still tagged 101. The most common bump-in-the-wire
case: the device is transparent to the tag.

```json
{
  "name": "Scenario 4 - Single VLAN passthrough symmetric",
  "endpoints": [
    { "port_name": "scenario4_ingress" },
    { "port_name": "scenario4_egress" }
  ],
  "functions": [
    {
      "choice": "connect_ethernet",
      "connect_ethernet": {
        "ethertypes": [65535],
        "vlan_endpoint_settings_port1": { "vlan": { "choice": "vlan", "vlan": 101 } },
        "vlan_endpoint_settings_port2": { "vlan": { "choice": "vlan", "vlan": 101 } }
      }
    }
  ]
}
```

Note the endpoints carry no `tags` key. `connect_ethernet` contributes no role tags, so an
Ethernet-only connection has none — this is correct, not an omission.

### On the UI

1. Set the **VLAN on port1** dropdown to **Single VLAN**. A number box appears below it; type `101`.
2. Do the same for **VLAN on port2**: **Single VLAN**, then `101`.
3. To match the sample exactly, put `65535` in **Ethertypes**. Leaving it empty is the better choice
   for real use — see [About `ethertypes`](#about-ethertypes) below.

Watch the JSON pane as you go: each field lands as you type it. If you want to name the connection,
use **Name** at the top of the **Endpoints** section.

<a id="translation"></a>

## Translation — a different VLAN on each port

*Sample: `passthrough_single_translation`*

VLAN 101 arrives on port 25 and leaves port 26 tagged 1001. Use this when two networks number the
same traffic differently and you need the device to rewrite the tag in both directions.

Only `vlan_endpoint_settings_port2` differs from the symmetric case:

```json
{
  "name": "Scenario 5 - Single VLAN passthrough translation",
  "endpoints": [
    { "port_name": "scenario5_ingress" },
    { "port_name": "scenario5_egress" }
  ],
  "functions": [
    {
      "choice": "connect_ethernet",
      "connect_ethernet": {
        "ethertypes": [65535],
        "vlan_endpoint_settings_port1": { "vlan": { "choice": "vlan", "vlan": 101 } },
        "vlan_endpoint_settings_port2": { "vlan": { "choice": "vlan", "vlan": 1001 } }
      }
    }
  ]
}
```

There is no "translation" function type to look for. Two different VLAN values on the two ports *is*
the translation, and the mapping applies in both directions — traffic tagged 1001 arriving on port 26
leaves port 25 tagged 101.

Because the two blocks are addressed as port1 and port2 rather than by name, which value applies to
which cage depends entirely on endpoint order. If the tag comes out on the wrong side, use **Swap
ends** in the inspector rather than editing the numbers; it moves the settings with the ports.

### On the UI

Identical to the symmetric case apart from one number:

1. **VLAN on port1** → **Single VLAN** → `101`.
2. **VLAN on port2** → **Single VLAN** → `1001`.

Check which cage is which before trusting it. The **Endpoints** section names **port1** and **port2**
explicitly, so if `port1` reads `P26` you started the drag from the wrong cage. Press **Swap ends**
and the two settings blocks move with the endpoints, so `101` follows port 25 rather than staying
where you typed it.

<a id="untagged"></a>

## Untagged on one side

*Sample: `passthrough_single_non_vlan`*

VLAN 101 arrives on port 25 and leaves port 26 with the tag removed. In the other direction,
untagged traffic on port 26 leaves port 25 tagged 101. This is how you connect a VLAN-aware network
to equipment that expects clean untagged frames.

```json
{
  "name": "Single VLAN passthrough, one port untagged",
  "endpoints": [
    { "port_name": "scenario_non_vlan_ingress" },
    { "port_name": "scenario_non_vlan_egress" }
  ],
  "functions": [
    {
      "choice": "connect_ethernet",
      "connect_ethernet": {
        "ethertypes": [65535],
        "vlan_endpoint_settings_port1": { "vlan": { "choice": "vlan", "vlan": 101 } },
        "vlan_endpoint_settings_port2": { "vlan": { "choice": "non_vlan" } }
      }
    }
  ]
}
```

`{"choice": "non_vlan"}` means untagged. Leaving `vlan_endpoint_settings_port2` out entirely has the
same effect, but writing `non_vlan` explicitly documents the intent, and it is what the sample does.

### On the UI

1. **VLAN on port1** → **Single VLAN** → `101`.
2. Leave **VLAN on port2** alone and you already have working behaviour: no port2 block means
   untagged.
3. To write the explicit `non_vlan` the sample uses, you have to move the port2 dropdown *away* from
   **Untagged** and back — set it to **Single VLAN**, then back to **Untagged**. Re-picking the value
   a dropdown already displays fires no change, so the fresh connection's **Untagged** is a display
   of absence rather than something written.

Both give the same forwarding behaviour, and the JSON pane shows you which one you have.

This sample is also the reason a stray character in a connection name is only a warning in the
visualizer rather than a hard error: its name contains a comma, which is outside the documented
pattern, and the device accepts it.

## About `ethertypes`

`ethertypes` is a filter, not a required field. An empty list means allow every ethertype, and that
is what the visualizer seeds a new Ethernet connection with.

All three samples pin it to `[65535]`. Treat that as the samples' choice rather than a magic
"everything" value — if you want all traffic, use `[]`. Values must be integers from 0 to 65535, and
the visualizer takes them as a comma-separated list in the **Ethertypes** field.

## When to reach for ARP instead

`connect_arp` carries the same `vlan_endpoint_settings_port1` and `_port2` blocks and is configured
identically. The reason to choose it is Q-in-Q: the shipped double-tag scenarios all use two stacked
`connect_arp` functions, covered in [Q-in-Q ARP bypass](02-passthrough-qinq.md). Unlike Ethernet,
ARP does contribute tags — `vlan` on both ends.

## Things that will bite you

**Do not mix VLAN settings with `dst_mac` settings.** `connect_ethernet` also accepts
`dst_mac_endpoint_settings_port1` and `_port2` for forwarding by destination MAC. The schema makes
those mutually exclusive with `vlan_endpoint_settings_port1`/`_port2` anywhere in the same
connection, so pick one scheme per connection.

**`dst_mac` settings are restrictive, not additive.** If you do use them, only traffic matching a
configured address is forwarded on that port and everything else is dropped.

**Two connections on one port must not claim the same VLAN.** The visualizer warns when it spots
overlapping VLANs on a port; the device needs each connection on a port to carry distinct traffic.

**Port order is not cosmetic here.** Unlike the encapsulation functions, which find their ends by
tag, passthrough functions address ports positionally. Reordering `endpoints` without moving the
settings silently swaps which network gets which tag.
