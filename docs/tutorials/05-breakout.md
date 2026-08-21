# Breakout ports

Splitting one physical cage into four independent sub-ports, for a breakout cable. This is a
Layer 1 concern only: it changes what ports *exist*, not what happens to traffic.

Covers `breakout_4x100g`, `breakout_4x25g` and `breakout_4x10g`.

## Author these in JSON, not the canvas

The visualizer does not support breakout, by design. One cage is one whole port there, so it refuses
any config with a `channel` other than 1, a non-zero `num_channels`, or two plain entries on the same
front-panel port.

### What the UI actually does

Load a breakout config and the canvas locks. You get a red box over the chassis reading **Canvas
locked — JSON is not valid**, and underneath it:

> This config uses breakout channels. This tool is whole-port only (one cage = one port), so it will
> not draw it. Fix the JSON, or open a non-breakout config.

Below the JSON pane, one red line per offending entry names the port and the field, so it is easy to
tell a deliberate breakout from a typo — `channel: 3 is a breakout channel`, `num_channels 2 is a
breakout setting`, or `front-panel port 1 is already used by "..."`.

Two consequences worth knowing before you sit down with a breakout file:

- **Save is refused while the canvas is locked.** You get *Fix the JSON errors before saving.* The
  page will not quietly hand you the older config it is still drawing, but it also will not write
  your breakout file — so keep the authoritative copy in your editor, not in the page.
- **Do not press Revert JSON to canvas.** That button replaces the pane's contents with the last
  configuration the canvas held, which discards everything you pasted.

You can still use the pane as a read-only checker: paste a file, read the red lines, and if the only
complaints name breakout then the rest of the structure passed the same rules every other config is
held to. That is worth doing, because the ports, profiles and connections are all validated before
the breakout check refuses to draw them.

### A workable split

Author the connections in the visualizer against whole ports, save that file, then edit the
`front_panel_ports` entries into sub-ports by hand. You get canvas checking on the part it
understands and hand-editing only on the Layer 1 section, which is the part with no behaviour in it.

## How a cage is divided

Every sub-port is a normal `front_panel_ports` entry. What makes them sub-ports of one cage is that
they share the same `front_panel_port` number and each claims a different slice of its channels:

| Field | Meaning |
| --- | --- |
| `front_panel_port` | The cage number, 1–32. The same for every sub-port. |
| `channel` | The first channel this sub-port occupies, 1–8. |
| `num_channels` | How many channels it occupies, 1–8. |

The rule to respect: the channel ranges on one cage must not overlap. `num_channels` is normally
optional and defaults to 0, meaning "pick a sensible number for the speed" — but for breakout you
must state it, because that is what makes each slice explicit.

Each sub-port gets its own name, and that name behaves like any other port name from then on.

## 4 × 100G

*Sample: `breakout_4x100g`*

Four 100G sub-ports on cage 1, two channels each: 1–2, 3–4, 5–6 and 7–8. Note the profile is 100G
with FEC off, not the 400G profile the other tutorials use — the profile has to describe the
sub-port's speed, not the cage's.

```json
{
  "profiles": {
    "layer_1_profiles": [
      {
        "name": "manual_100g_none",
        "choice": "manual",
        "link_speed": "speed_100_gbps",
        "manual": { "fec_mode": "none" }
      }
    ]
  },
  "front_panel_ports": [
    {
      "name": "breakout_100g_sub1",
      "choice": "front_panel_port",
      "front_panel_port": { "front_panel_port": 1, "channel": 1, "num_channels": 2, "layer_1_profile_name": "manual_100g_none" }
    },
    {
      "name": "breakout_100g_sub2",
      "choice": "front_panel_port",
      "front_panel_port": { "front_panel_port": 1, "channel": 3, "num_channels": 2, "layer_1_profile_name": "manual_100g_none" }
    },
    {
      "name": "breakout_100g_sub3",
      "choice": "front_panel_port",
      "front_panel_port": { "front_panel_port": 1, "channel": 5, "num_channels": 2, "layer_1_profile_name": "manual_100g_none" }
    },
    {
      "name": "breakout_100g_sub4",
      "choice": "front_panel_port",
      "front_panel_port": { "front_panel_port": 1, "channel": 7, "num_channels": 2, "layer_1_profile_name": "manual_100g_none" }
    }
  ],
  "connections": []
}
```

The `channel` values step by 2 because each sub-port consumes 2. Getting this wrong — four sub-ports
at channels 1, 2, 3, 4 each claiming `num_channels: 2` — overlaps them and is invalid.

## 4 × 25G and 4 × 10G

*Samples: `breakout_4x25g`, `breakout_4x10g`*

Both use one channel per sub-port, so the channels are simply 1, 2, 3 and 4. The two samples are
identical apart from the profile name and `link_speed`.

```json
{
  "profiles": {
    "layer_1_profiles": [
      {
        "name": "manual_25g_none",
        "choice": "manual",
        "link_speed": "speed_25_gbps",
        "manual": { "fec_mode": "none" }
      }
    ]
  },
  "front_panel_ports": [
    {
      "name": "breakout_25g_sub1",
      "choice": "front_panel_port",
      "front_panel_port": { "front_panel_port": 1, "channel": 1, "num_channels": 1, "layer_1_profile_name": "manual_25g_none" }
    },
    {
      "name": "breakout_25g_sub2",
      "choice": "front_panel_port",
      "front_panel_port": { "front_panel_port": 1, "channel": 2, "num_channels": 1, "layer_1_profile_name": "manual_25g_none" }
    },
    {
      "name": "breakout_25g_sub3",
      "choice": "front_panel_port",
      "front_panel_port": { "front_panel_port": 1, "channel": 3, "num_channels": 1, "layer_1_profile_name": "manual_25g_none" }
    },
    {
      "name": "breakout_25g_sub4",
      "choice": "front_panel_port",
      "front_panel_port": { "front_panel_port": 1, "channel": 4, "num_channels": 1, "layer_1_profile_name": "manual_25g_none" }
    }
  ],
  "connections": []
}
```

For 10G, change the profile to `speed_10_gbps` and rename it; the four port entries are otherwise the
same. All three samples use `fec_mode: "none"`.

## Comparing the three

| | Sub-port speed | `num_channels` | Channels used |
| --- | --- | --- | --- |
| `breakout_4x100g` | `speed_100_gbps` | 2 | 1, 3, 5, 7 |
| `breakout_4x25g` | `speed_25_gbps` | 1 | 1, 2, 3, 4 |
| `breakout_4x10g` | `speed_10_gbps` | 1 | 1, 2, 3, 4 |

## Using sub-ports in connections

All three samples stop at `"connections": []`, because breakout is only about declaring ports. A
sub-port name is an ordinary port name, so connections reference it exactly as they would a whole
port, and any scenario from the other tutorials applies unchanged — a sub-port can be one end of a
passthrough, an encap, or a member of a port group.

The catch is purely tooling: once a breakout entry is present the canvas will not draw anything, so
you cannot build those connections by dragging. Copy the function blocks from the relevant tutorial
instead. You still get the structural checks — a connection naming a sub-port that does not exist is
reported in the JSON pane alongside the breakout complaints — but the wires, the inspector and the
tag derivation are all unavailable, so count tags yourself on any stacked function.

## Things that will bite you

**Channel ranges must not overlap on one cage.** This is the constraint the schema calls out
explicitly, and with `num_channels` greater than 1 it is easy to violate while looking correct.

**`num_channels` is required here.** It defaults to 0, which means "use a default for the speed".
That default is fine for a whole port and wrong for a breakout, where each slice must be stated.

**The profile describes the sub-port.** Four 100G sub-ports need a 100G profile. Pointing them at a
400G profile describes something the cage cannot do.

**One profile can serve every sub-port.** All three samples reuse a single profile across all four,
which is the normal case. You only need more than one if the sub-ports differ in speed or FEC.

**Expect the canvas to lock.** A red banner naming breakout is the tool working as intended, not a
problem with your config. Validate it by posting it.
