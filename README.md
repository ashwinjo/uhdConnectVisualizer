# UHD Connect Visualizer

A visual authoring tool for Keysight UHD Connect JSON configurations. It draws a config on the
32-port front panel, lets you build one by dragging between ports, and keeps the JSON and the
canvas in sync both ways.

Authoring is offline: you open a `.json`, edit it, and save a `.json`. The **Device** panel is the
one part that talks to a live UHD, and only when you press a button in it — see
[Talking to a device](#talking-to-a-device).

## Tutorials

The **Tutorials** button in the toolbar opens them next to the canvas: one page per scenario family,
covering what the scenario does, how to build it here, the JSON it produces, and the mistakes that
post successfully and then forward nothing. Every JSON block has a Copy button, and a block that is a
whole config the app accepts also has **Load into canvas**, which puts it on the chassis to build on.

The pages are the markdown in `docs/tutorials/`, readable on their own starting from
[the index](docs/tutorials/README.md). After editing any of it, run
`node tools/build-tutorials.cjs` to refresh the copy the page reads.

## Running it

Open `index.html` in a browser. There is no build step, no server and no dependencies.

The page is four files:

| File | Purpose |
| --- | --- |
| `index.html` | Markup and all styling |
| `app.js` | All behaviour (model, validation, canvas, JSON sync, tutorial reader, device panel) |
| `tutorials.js` | The tutorial pages, generated from `docs/tutorials/` |
| `UHDSchematic.png` | The front-panel photo the canvas is drawn on |

`tutorials.js` is generated rather than fetched at runtime because a page opened over `file://`
cannot fetch a sibling file. If it is missing the panel says how to regenerate it, and nothing else
about the page changes.

`uhd_stats.html` is the older standalone counter tool, kept so it can still be opened on its own. It
is the one file that needs `axios.min.js`; the app itself uses `fetch` and has no dependencies.
Everything it does is in the Device panel now, so use that unless you specifically want the small
single-file version.

**No configuration is ever stored in the browser.** Configs live in files you open and save, so the
same config can be handed to whatever applies it to the box. The Device panel does remember two
things across reloads, because retyping them every time is miserable: the device address and which
ports you were watching.

## The authoring flow

The inspector always shows which of these three steps you are on, and the UI refuses steps taken
out of order.

1. **Create a Layer 1 profile** (left panel). Speed, autonegotiation/manual and FEC. Every sample in
   `docs/samples` uses a single profile named `manual_400g_rs`: 400G, manual, Reed Solomon.
2. **Assign it to front-panel ports.** Click a dark cage on the chassis. In the dialog, assign it as
   a regular port or as a **port group** (then click other empty cages to add members). Ports are
   numbered in column pairs: port 1 is top-left with port 2 below it, through to 31/32 on the far
   right. Each assigned cage prints the name that connections use for it; the **Port names** toggle
   in the toolbar hides the labels, and a name too long for the cage is cut in the middle (the full
   name is in the tooltip and the inspector).
3. **Drag from one assigned cage to another** to create a connection. The cage you start the drag on
   becomes `port1` (`endpoints[0]`); use *Swap ends* in the inspector to reverse it.

On drop you pick a function type:

| Type | Behaviour |
| --- | --- |
| Ethernet | Created immediately with `ethertypes: []` (all traffic) |
| ARP | Created immediately, untagged; add a second ARP function for Q-in-Q |
| VLAN ↔ VXLAN | Opens a **draft** first |
| VLAN ↔ NVGRE | Opens a **draft** first |

A draft is drawn on the chassis in amber but is *not* in the JSON until the fields the API requires
are filled: the VLAN, the VNI/VSID and the four outer-header MAC/IP fields. The inspector lists what
is still missing. Placeholder text shows the values the matching sample uses, as a format hint —
only `udp_dst_port` is prefilled, because 4789 is the API's own default.

Endpoint `tags` are always derived from the functions, never typed: ARP contributes `vlan` to both
ends, VXLAN gives `vlan`/`vxlan`, NVGRE gives `vlan`/`nvgre`, and Ethernet contributes none. This
reproduces the tags in all eleven in-scope samples exactly.

## Port groups

A `port_group` entry gives several front-panel ports one name, and connections reference that name
instead of a single port. The canvas treats the **first port in the group as its main port**: the
wire attaches to that cage, and every other member cage lights up with it when the connection is
selected or hovered. All connections are drawn, whether they land on a plain port or a group.

- Click an empty (unassigned) cage and choose **Port group**, then **Pick members**. Click other
  empty cages to add them; the cage you started on is the main port. **Create group** writes
  `ingress_distribution: copy` (change it to `split` in the inspector if you need to). A cage is a
  regular port or a group member, not both — already assigned cages are refused.
- The main cage is drawn with a red inner edge, later members with a dashed border, and both carry
  the group name.
- A cage that takes part in more than one object (a port can appear in several groups, as `snic1`
  and `snic2` do in `old.new.json`) gets a red corner dot; the tooltip and inspector list them all.
- The inspector edits the group: its name, `ingress_distribution` (`copy` for LAG-style groups,
  `split` otherwise), and the Layer 1 profile of each member port. Deleting a group is blocked while
  a connection still names it.
- The chassis legend marks group main and member cages. The connection sheet Ports column shows the group name next to the cages (`P9+10  snic1_port_group_2`), so two groups that share cages or reverse each other stay distinguishable.
- Dragging from a group cage creates a connection on the group. Dragging between two cages of the
  same group is refused, since a connection needs two different ports.

Group connections are fully editable. The only shapes still JSON-only are more than two endpoints,
a function type with no sample (`connect_ip`), an endpoint naming a port that does not exist, and a
group with no valid front-panel port. The read-only banner names which of these applies.

## What the ports connect to outside

Above the chassis is a rail of boxes, one per `front_panel_ports` entry, each sitting over the
column(s) it owns with a leader line down to every cage it covers. Hover a box to light its cages and
lines; click it to open that port or group in the inspector. **Outside boxes** in the toolbar hides
the rail.

A box starts out labelled with the port name. In the inspector's *Outside* section you can give it a
real-world label (`SNIC_9`), a kind (NIC, server, switch, router, test port, appliance) shown as a
small tag, a note shown in the tooltip, and you can hide individual boxes.

The UHDConnect schema has nowhere to record what a cable runs to, so anything you change here is
saved in the same file under a single top-level key:

```json
"x_visualizer": {
  "_comment": "Display-only metadata from the UHD Connect Visualizer. The UHD ignores it.",
  "outside": { "APS1_1": { "label": "SNIC_9", "kind": "nic" } }
}
```

That key is written **only** when you customise something, and it is removed again when the last
override goes, so a config you merely open and save comes back byte-identical. Renaming a port moves
its box with it; deleting a port removes its box. If the tool that applies your config rejects
unknown top-level keys, hide the labels or strip `x_visualizer` before applying — nothing else in the
file depends on it.

## JSON and canvas

The JSON pane on the right is the same document as the canvas, always visible.

- **Editing the JSON** re-renders the canvas as soon as it parses and validates.
- **Invalid JSON locks the canvas.** The chassis keeps showing the last valid configuration so you
  never lose your place, and canvas editing is disabled until the JSON is valid again.
  *Revert JSON to canvas* throws the broken text away.
- **Canvas edits patch the config in place**, so fields this UI does not author (`mirror_to`, PFC,
  pause, `switchover_port`, `connect_ip`) survive untouched. The port and connection inspectors say
  when an object carries such fields. `x_visualizer` is the one key the tool adds, and only when you
  edit an outside box.
- **Errors block, warnings do not.** Bad enums, out-of-range ports, missing profile/port references
  and dangling endpoints lock the canvas. Overlapping VLANs on a port, unused profiles, assigned
  ports with no connection, and names outside the documented pattern only warn. (One shipped sample,
  `passthrough_single_non_vlan`, has a comma in a connection name, so that pattern is a warning
  rather than a hard error.)

## Talking to a device

**Device** in the toolbar opens the one panel that reaches a live UHD. Type the box's address, press
**Connect**, and it reads the port list off the device.

A UHD serves its API over HTTPS with a self-signed certificate, which a browser refuses until you
accept it by hand. Every failure to reach the box says so and links the URL to open in a new tab;
accept the warning there once and the panel works from then on. This is also why a request can only
fail two ways here — the box answered with an error, which is shown verbatim, or it could not be
reached at all.

**Port counters.** Tick the ports you care about on the left and the table shows link status and the
RX/TX/dropped frame counts for each, ports across the top and metrics down the side. **Refresh**
takes one reading and **Start polling** repeats it every 3 seconds; polling stops when the panel
closes, so nothing keeps running behind your back. **Clear counters** zeroes the counters on the
watched ports only, or on every port if you are watching none, and asks first. A port name the
current canvas config also defines is marked *on canvas*, which is the quickest way to see that the
box and the file agree about what the ports are called.

**Pull and push.** The canvas and the box hold two copies of the same document, and neither moves on
its own:

- **Pull from device** reads the running config and shows it. **Load into canvas** then draws it on
  the chassis, going through the same unsaved-changes prompt as opening a file.
- **Push canvas** applies what you have authored, after a confirmation naming the box. It refuses
  while the JSON has errors, for the same reason Save does. `x_visualizer` is stripped from what is
  sent — it is display-only metadata this tool invented, and the device has no business seeing it.

## Scope

- **No breakout.** One cage is one whole port. A config with `channel != 1`, a non-zero
  `num_channels` (including inside a port group), or two plain entries on one front-panel port is
  refused with an explicit message.
- **Two endpoints per connection.** Connections with more endpoints, or with a `connect_ip`
  function, are drawn and listed but marked read-only; edit those in the JSON pane.
- **`connect_ip` is not offered** in the type picker because no sample uses it. It is preserved if
  it is already in a config you load.

## If the port grid drifts

The 32 cage positions come from `GEOM` in `app.js`, measured from the openings in
`UHDSchematic.png`. If you swap in a different image, tick **Align grid** in the toolbar, nudge the
values until the outlines sit on the cages, press *Copy values* and paste them back into `GEOM`.

## Verification

`tools/` holds optional Node-only checks (no npm, no browser download); see `tools/README.md`.
`node tools/roundtrip-test.cjs` proves every in-scope sample round-trips.
