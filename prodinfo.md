# UHD Connect Visualizer — product information for an invention disclosure

This file is **source material for writing an Invention Disclosure Document (IDD)**, not the IDD itself. It describes what the product is, the problem it solves, how it works, and which pieces are most likely to be the inventive subject matter. Legal fields (inventors, conception dates, prior-art search, claim language) are left as TODOs for the inventor and IP counsel.

**Do not treat this as a patent application or as legal advice.** Public disclosure status is called out in §16 because it affects filing deadlines.

---

## 1. How to use this file

Typical IDD forms ask for a title, problem, solution, novelty, drawings, and commercial use. Suggested mapping:


| IDD form section                    | Use this file |
| ----------------------------------- | ------------- |
| Title of invention                  | §3            |
| Abstract / brief description        | §4            |
| Background / problem                | §6            |
| Prior art / existing practice       | §7            |
| Summary of the invention            | §8            |
| Detailed description                | §9–§11        |
| What is new / inventive elements    | §12           |
| Advantages                          | §13           |
| Alternative embodiments             | §14           |
| Drawings / figures                  | §15           |
| Dates, disclosure, related products | §16–§18       |
| Glossary                            | §20           |


Fill the TODOs in §17 before submitting the IDD.

---

## 2. Product identity


| Field                    | Value                                                                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Product name             | UHD Connect Visualizer                                                                                                                                                                                                         |
| Version as shipped in UI | v1.0.0, marked **Beta**                                                                                                                                                                                                        |
| Host product             | Keysight UHD Connect (32-port front-panel appliance)                                                                                                                                                                           |
| What the host product is | A connectivity appliance that joins front-panel ports and transforms traffic (Ethernet/VLAN passthrough, ARP/Q-in-Q bypass, VLAN↔VXLAN, VLAN↔NVGRE, optional breakout). Configuration is a JSON document posted to a REST API. |
| Host API                 | `https://<unit>/connect/api/v1/config` (GET/POST), plus `…/metrics/operations/query` and `…/metrics/operations/clear`                                                                                                          |
| Authoritative schema     | `docs/openapi.json` in this repo; API schema broke on **2026-07-28**                                                                                                                                                           |
| Vendor samples           | Fourteen JSON scenarios under `docs/samples/` (eleven canvas-editable, three breakout)                                                                                                                                         |
| Form factor of this tool | Offline web page: open `index.html` in a browser. No build step, no server, no npm, no Python required to run.                                                                                                                 |
| Deliverable files        | `index.html`, `app.js`, `migrate.js`, `tutorials.js`, `UHDSchematic.png`                                                                                                                                                       |
| Footer / origin          | “Made with love by Keysight”; beta disclaimer to contact a Keysight contact                                                                                                                                                    |
| Code location            | This workspace; remote `https://github.com/ashwinjo/uhdConnectVisualizer.git` (**public GitHub — see §16**)                                                                                                                    |
| UI description meta      | “Chassis visualizer for Keysight UHD Connect 32-port configurations.”                                                                                                                                                          |


**Elevator pitch (authoring + load/troubleshoot):**

> UHD Connect Visualizer draws a Keysight UHD Connect config on the 32-port front panel — open an existing JSON, or build one by dragging between cages. The chassis, the JSON, and the device stay in sync, so you can see which ports are wired, catch configs that post but do not forward, and troubleshoot before you push.

Shorter variant:

> Open a UHD Connect JSON and see it on the chassis — or drag between cages and it writes the file. Either way you get a picture you can troubleshoot against, then save or push to the box.

---

## 3. Suggested invention titles (pick one)

Counsel usually wants a title that names the *method/system*, not the product nickname.

1. **Method and system for bidirectional visual authoring and validation of a network-appliance connectivity configuration over a photorealistic front-panel model**
2. **Visual chassis overlay for JSON-configured multi-port connectivity appliances with derived endpoint-role tags and last-valid-state lock**
3.      **to prevent silent-accept failures**

Working product name for internal use: **UHD Connect Visualizer**.

---

## 4. One-paragraph abstract (drop into the IDD)

A software system authors, visualizes, and troubleshoots the JSON configuration of a multi-port connectivity appliance (exemplified by a 32-cage Keysight UHD Connect) by overlaying a live, clickable port grid on a photograph of the front panel. A user may open an existing configuration file, pull the running configuration from a device, or create a configuration by assigning Layer-1 profiles to cages and dragging between cages to form connections. The parsed JSON object is the single source of truth and is mutated in place so that canvas edits and JSON-text edits stay equivalent without dropping unknown schema fields. Endpoint role tags, which the appliance API requires in positional correspondence with connection functions and which fail **silently** (HTTP 200, no forwarding) if wrong, are derived from function type and never typed by the user. Incomplete encapsulation connections exist only as UI drafts until required fields are filled. Display-only topology labels that the device schema cannot store are kept under a pruned extension key and stripped on device push. A convert path migrates pre-break schema documents, including reconstructing the new positional tag model from legacy markers. Validation distinguishes blocking errors from warnings; invalid JSON locks the canvas while retaining the last valid drawing. Optional live metrics on the same port names let an operator confirm that a posted config actually forwards traffic.

---

## 5. Field of the invention

Network test / visibility / connectivity appliances; graphical configuration of data-plane connection fabrics; JSON schema authoring; overlay of logical configuration onto physical equipment imagery; diagnosis of configurations that are syntactically accepted by a device API but semantically inert.

---

## 6. Background and problem

### 6.1 What the operator must produce

UHD Connect is configured by posting one JSON object with three dependent sections:

1. `**profiles.layer_1_profiles`** — named physical-link settings (speed 10G–400G, autonegotiation or manual, FEC none / Reed Solomon / Firecode).
2. `**front_panel_ports**` — names bound to cage numbers 1–32 (or to a `port_group` of several cages), each referencing a Layer-1 profile.
3. `**connections**` — each joins named ports and lists **functions** that say what to do with traffic (passthrough Ethernet, ARP, VLAN↔VXLAN, VLAN↔NVGRE, etc.).

Ports name a profile; connections name ports. The order is mandatory. A complete valid connection can be as little as two endpoints and one empty Ethernet function (pass all traffic). Real scenarios fill function bodies with VLANs, VNIs/VSIDs, and outer tunnel headers.

### 6.2 Why hand-written JSON fails in this domain

Several properties of the current (post-2026-07-28) schema make hand editing unsafe:

**A. Endpoints hold no settings.** After the schema break, an endpoint is only a `port_name` plus optional `tags`. Every VLAN, VNI, MAC and IP lives on a function. Operators copying old configs still write `endpoints[].front_panel.vlan`; that form is gone.

**B. Two function families attach VLANs in different places.**

- Passthrough (`connect_ethernet`, `connect_arp`) is symmetric: each function has `vlan_endpoint_settings_port1` and `_port2`. Different IDs on the two sides *is* VLAN translation; there is no separate translation function. Endpoint order is therefore permanent for passthrough: `endpoints[0]` is port1.
- Encapsulation (`connect_vlan_vxlan`, `connect_vlan_nvgre`) is asymmetric: settings are by *role* (`vlan_endpoint_settings` vs `vxlan_endpoint_settings`), and which physical port plays which role is decided by **tags**, not by array position.

Putting the VLAN in the wrong family is the most common authoring mistake.

**C. Tags are positional and fail silently — the worst API failure mode.** `tags[i]` is that endpoint’s role for `functions[i]`. Every endpoint must carry exactly one tag per function, in function order. Ethernet contributes no tags (the key is omitted). A tag list shorter than `functions` yields:

- HTTP 200 from the device
- the posted document returned unchanged
- **no frames forwarded**

There is no error to grep. Confirmation requires clearing port counters, sending traffic, and seeing zeros on egress.

**D. Q-in-Q and double encapsulation are not schema types.** Both are “one connection with two functions.” `functions[0]` is the outer layer. Convert expands a legacy `vlan_double` endpoint into that stack. Operators looking for a “Q-in-Q object” will not find one.

**E. Several other silent or misleading accepts** (documented against real samples):


| Mistake                                                                         | Device behaviour                                                      |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Outer tunnel header left under old `vlan_endpoint_settings`                     | Ignored; tunnel not applied                                           |
| `udp_src_port` / `udp_dst_port` on tunnel settings instead of inside the header | Same schema-break class of ignore                                     |
| `routing_method` nested inside `protocols`                                      | HTTP 200, silently ignored; connection stays on `vni_routing` default |
| Incomplete encapsulation function (no VLAN, no VNI/VSID, no header)             | Saves and posts; does nothing                                         |
| Swapped port1/port2 VLAN settings on passthrough                                | Silently swaps the two networks                                       |
| Two connections on one port with the same VLAN/VNI match key                    | Conflict on the device                                                |


**F. The schema has nowhere to record what a cable runs to** (server, NIC, test port). Operators keep that mapping in spreadsheets or tribal knowledge, disconnected from the config file they push.

**G. A 32-cage faceplate is hard to reason about from port numbers.** Cage numbering is column-paired (port 1 top-left, 2 below it, through 31/32). JSON uses names and integers; the physical box is a photograph. Mismatch between “I thought I used cage 25” and “the file names port 26” is a typical troubleshooting loop.

**H. Schema break (2026-07-28).** Old configs will not draw or apply correctly. Fields moved (VLAN off endpoints into functions; tunnel headers hoisted; `vlan_double` split; `function_N` tags removed; `all_vlans` deleted; `internal` endpoints removed).

### 6.3 What existed before this tool

**TODO for inventor:** confirm with product management / applications what customers actually used. From the repo and vendor samples, the documented prior practice is:

- Edit JSON in a text editor.
- Apply with `curl -k -X POST … /connect/api/v1/config`.
- Confirm with `…/metrics/operations/query` and `clear`.
- Consult OpenAPI, Getting Started on the unit, and `Sample_Configs.html` on the appliance.
- After the schema break, a Python migrator (`uhd_migration.py`) existed as a CLI companion; this visualizer embeds the same transform in-browser (`migrate.js`).

There is no indication in this repo of a prior Keysight GUI that drew UHD Connect connections on the faceplate, kept JSON and canvas bidirectional, derived tags, or correlated live counters with the authored canvas.

---

## 7. Prior art to search (for counsel)

These are **search seeds**, not a clearance opinion.


| Class                                               | Examples to search                                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Chassis / faceplate GUIs for network gear           | Switch/router port GUIs (Cisco, Juniper, Arista) that light ports and draw LAGs; patch-panel visualizers; SAN zoning GUIs |
| JSON/YAML visual editors                            | Kubernetes visual editors, OpenAPI visualizers, generic JSON Schema form UIs                                              |
| SDN / NFV connection composers                      | OpenStack Neutron topology view, ONOS, Cisco ACI GUI, VMware NSX canvas                                                   |
| Test-equipment GUIs                                 | Ixia/Keysight IxNetwork, BreakingPoint, Vision/NPB (network packet broker) port maps, CloudLens                           |
| Bidirectional code/diagram sync                     | UML round-trip engineering; “diagram is the config” tools (draw.io + codegen)                                             |
| Overlay of hit-targets on equipment photos          | Rack-elevation tools; DCIM (NetBox, Device42) that bind ports to images                                                   |
| Schema migration of network configs                 | YANG/XML migrators; Ansible filter plugins                                                                                |
| Silent-failure / semantic validation of device APIs | “Config linters” that catch accepted-but-inert configs                                                                    |


**Likely differentiators vs generic prior art** (argue these in the IDD, do not assume they are unique until searched):

- Photorealistic 32-cage overlay whose click targets are a calibrated percentage grid (`GEOM`) with a live Align-grid calibration loop.
- Domain-specific **derived positional tags** tied to function-type metadata, aimed at a documented silent-accept API.
- **Last-valid canvas lock** when the JSON textarea is invalid, without clobbering the working drawing.
- **Draft connections** that render on the chassis but are withheld from the serializable document until API-required tunnel fields exist.
- **In-place object-graph mutation** that preserves unknown keys (`mirror_to`, PFC, pause, `switchover_port`, `connect_ip`) rather than a lossy round-trip serializer.
- `**x_visualizer` extension** written only when customized, pruned when empty (byte-identical open/save), stripped on device push.
- Combined **pull running config → draw on chassis → watch counters on names that match the canvas**.

---

## 8. Summary of the invention

A method and computer system that:

1. **Maps** a structured connectivity configuration onto a visual model of the physical front panel (photograph + calibrated cage grid).
2. **Authors** that configuration through ordered GUI steps (Layer-1 profile → assign cages or port groups → drag to connect → pick function type) and through direct JSON text, keeping both views equivalent.
3. **Loads** an existing file or a device’s running config and **renders** it for inspection (which cages, which wires, which VLAN/tunnel mapping).
4. **Validates** against rules that include both schema correctness and domain pitfalls (overlapping match keys, tag mismatch, unused ports), distinguishing errors that lock the canvas from warnings that do not.
5. **Prevents** the silent-tag failure by computing endpoint tags from functions on every canvas edit.
6. **Withholds** incomplete encapsulation from the posted document via a draft state drawn in amber.
7. **Extends** the file with optional display-only outside-entity labels without breaking the device schema.
8. **Migrates** pre-break documents, including reconstructing the new tag model.
9. **Optionally talks** to a live appliance to push/pull config and to correlate port counters with canvas port names, so “accepted” can be distinguished from “forwarding.”

Reduction to practice: a static five-file web application (`index.html` + `app.js` + `migrate.js` + `tutorials.js` + `UHDSchematic.png`) that runs from `file://`, plus optional Node verification in `tools/`.

---

## 9. Detailed description — user-visible system

### 9.1 Layout of the page


| Region                       | Contents                                                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Toolbar                      | Brand, file name, New / Open / Save / Save As; toggles: Outside boxes, Port names, Align grid; Convert; Tutorials; Device; status pill |
| Left of chassis (picker bar) | Layer-1 profile select + New; connection multi-select/filter; zoom − / 100% / +                                                        |
| Centre                       | Cropped front-panel photograph; 32 cage hit-targets; SVG wires under the faceplate; outside-entity rail above with leader lines        |
| Right, inspector             | Context for selection (overview stepper, profile, port, group, or connection). This is where fields are edited.                        |
| Right, JSON pane             | The same document as text, always visible. Copy / Format. Amber/red messages under the textarea.                                       |
| Empty state                  | Open JSON, Paste JSON, Start from scratch, Convert old schema, Tutorials                                                               |
| Lock banner                  | Shown when JSON is invalid or is a refused breakout config; Convert + Revert JSON to canvas                                            |


Zoom range 0.75×–2.5× (buttons, `+`/`-`, Ctrl+scroll; Ctrl+0 reset).

### 9.2 Authoring flow (enforced order)

The inspector overview is a three-box progress strip. The UI refuses steps taken out of order.

1. **Create a Layer-1 profile.** Dialog defaults match all non-breakout samples: name `manual_400g_rs`, 400G, manual, Reed Solomon.
2. **Assign cages.** Click a dark (unassigned) cage. Assign as a regular port or start a **port group** and pick member cages. Port name defaults to `Port N`; samples use names like `scenario1_ingress`. Assigned cages brighten and show the name (middle-ellipsis if too long; full name in tooltip/inspector).
3. **Drag cage → cage** to create a connection. **The drag origin becomes `endpoints[0]` (port1).** On drop, a type picker offers:


| Type         | On click                                                            |
| ------------ | ------------------------------------------------------------------- |
| Ethernet     | Created immediately; `ethertypes: []` (all traffic)                 |
| ARP          | Created immediately, untagged; add a second ARP function for Q-in-Q |
| VLAN ↔ VXLAN | Opens a **draft** (amber wire; not in JSON until complete)          |
| VLAN ↔ NVGRE | Same draft behaviour                                                |


Ethernet and ARP are safe empty: an empty one is still a valid, meaningful connection. Encapsulation is not: the API needs VLAN, VNI/VSID, and four outer-header MAC/IP fields. The inspector lists **Still needed** and greys **Create connection** until the set is complete. Only `udp_dst_port` is prefilled (4789, the API default). Placeholder text in other fields is the matching sample’s value as a format hint, not a default — empty stays absent from JSON.

**Swap ends** reverses the endpoint pair **and** moves passthrough `vlan_endpoint_settings_port1`↔`port2` (and related routing blocks) with it.

**Second layer:** the type picker is single-layer on purpose. Q-in-Q and double encap are created by adding a second function (`+ Ethernet`, `+ ARP`, `+ VLAN ↔ VXLAN`, `+ VLAN ↔ NVGRE`). The top inspector card is `functions[0]` (outer). Tags are recalculated on add/remove.

Asymmetry: a *first* encap connection is a draft; a *second* function is inserted into JSON immediately, even if empty. Tutorials warn to finish it in the same sitting.

### 9.3 Loading an existing config (visualize + troubleshoot)

This is a first-class use, not an afterthought.

- **Open** a `.json` (or paste). The chassis draws cages, names, wires, badges, outside boxes.
- **Convert** an old-schema file or `.http` export, then **Load onto canvas**.
- **Device → Pull from device → Load into canvas** draws the *running* config.
- Selecting a wire expands the badge to a **VLAN/tunnel mapping** (which VLAN/VNI/VSID sits on which end).
- Inspector shows pipeline summary, endpoints, functions; extra unknown fields get an amber “preserved” banner.
- Warnings (overlap, unused profile, unconnected port, tag mismatch vs derived) appear in the inspector and under the JSON pane, each with a **show** link that selects the object.
- **Device → port counters** on names marked **on canvas** is the check that traffic is moving, not merely that POST returned 200.

Invalid JSON: canvas **locks**, continues to show the **last valid** drawing, editing on the chassis is disabled. Revert throws the broken text away. **Save and Push are refused while invalid**, so the page cannot quietly write the older drawing.

### 9.4 Port groups

A `port_group` gives several cages one name; connections reference the name.

- First array element is the **anchor / main port**: the wire attaches there; other members light with it on select/hover.
- Visual: main = red inner edge; members = dashed border; both carry the group name.
- A cage in more than one object gets a red corner dot.
- `ingress_distribution`: `copy` (LAG-style, default on create) or `split`.
- Dragging from a group cage creates a connection on the group; dragging between two cages of the same group is refused.
- Connection sheet Ports column shows e.g. `P9+10  group_a`.

### 9.5 Outside boxes (topology the schema cannot store)

A rail of boxes sits above the chassis, one per `front_panel_ports` entry, centred over owned columns with leader lines down to every covered cage. The operator can set a real-world label (`SNIC_9`), a kind (NIC, server, switch, router, test port, appliance), a note, or hide a box.

Stored only if customized, under:

```json
"x_visualizer": {
  "_comment": "Display-only metadata from the UHD Connect Visualizer. The UHD ignores it.",
  "outside": { "APS1_1": { "label": "SNIC_9", "kind": "nic" } }
}
```

The key is removed when the last override goes, so open-and-save of an untouched vendor sample is **byte-identical**. Push to the device **deletes** this key from the payload. Rename of a port moves its box; delete removes it.

### 9.6 Device panel

The only network surface. Address + Connect reads the port list. Self-signed HTTPS: the UI explains that the browser treats an untrusted cert like an unreachable host and links `https://<ip>` to accept once.

- Counters: link status, RX/TX/dropped; ports across the top; Refresh or poll every 3 s (stops when the panel closes).
- Clear counters: watched ports, or all if none watched; confirms first.
- Pull shows JSON; Load into canvas uses the same unsaved-changes prompt as Open.
- Push confirms the box name; refused if JSON has errors; `x_visualizer` stripped.
- localStorage remembers **only** device address and watched port names — never the configuration document.

### 9.7 Convert (schema migration)

In-browser (`migrate.js`); optional CLI twin `uhd_migration.py`. Nothing is sent off-box.

Notable transforms (claim-relevant: reconstructing the new model automatically):

- VLAN moved from `endpoints[].front_panel.vlan` into function bodies.
- `vlan_double` → two stacked functions, outer first.
- `all_vlans` / `all_vlans_and_non_vlan` → flagged unmapped (deleted from schema).
- Legacy `function_N` tags removed; tags rebuilt positionally (`collapseEndpoints`).
- Tunnel headers hoisted from `vlan_endpoint_settings.outgoing_*` to the tunnel-side block.
- UDP ports moved inside the header object.
- `routing_method` hoisted out of `protocols` (device silently ignored the nested form).
- `mirror_to` object rewired to a port-name reference.
- `internal` endpoints → hard error (no equivalent).
- `.http` exports: request head/tail kept, JSON body rewritten.

### 9.8 Tutorials inside the tool

Markdown in `docs/tutorials/` is bundled into `tutorials.js` because `file://` cannot fetch sibling files. Each scenario: what it does, how to build it here, the JSON, and the mistakes that post then forward nothing. Complete JSON blocks get **Load into canvas** (only if the block is a whole config with at least one port and validates).

### 9.9 What the canvas will not author (by design)

Still readable in the JSON pane; unknown fields survive canvas edits of *other* fields.

- MAC/IP *ranges* (single addresses have fields).
- `protocols`, `protocol_id`, `src_port`, `dst_port`, `routing_method`, `ip_routing` / `mac_routing`.
- `connect_ip` (no sample; connection marked read-only).
- Breakout (`channel != 1`, `num_channels != 0`, two plain entries on one cage): **refused**, canvas locked, explicit message. Workaround documented: author connections on whole ports, then hand-edit Layer-1 into sub-ports.
- More than two endpoints: drawn/listed, read-only.

---

## 10. Detailed description — internal method (for “how it works” in the IDD)

### 10.1 Single source of truth

The parsed JavaScript object `state.config` is mutated in place. Canvas commits call `revalidate()` then `render(true)` which serializes back to the textarea (scroll preserved). JSON typing is debounced (~220 ms): parse + validate; on failure **do not replace** `state.config` (last valid object remains). On success, `state.config = parsed` and the canvas re-renders without rewriting the textarea (so formatting the user typed is kept until they Format).

This is not a CRDT. It is an explicit dual-view with a frozen last-good object when the text stream is illegal.

### 10.2 Tag derivation (silent-failure prevention)

Function-type table `FN` carries `tag1` / `tag2` per choice:


| Function             | port1 tag           | port2 tag |
| -------------------- | ------------------- | --------- |
| `connect_ethernet`   | none                | none      |
| `connect_arp`        | `vlan`              | `vlan`    |
| `connect_vlan_vxlan` | `vlan`              | `vxlan`   |
| `connect_vlan_nvgre` | `vlan`              | `nvgre`   |
| `connect_ip`         | none (not authored) | none      |


`deriveTags(conn)` walks `functions` in order and builds two arrays. `applyTags` writes them onto the two endpoints (or deletes `tags` if empty). Applied on every canvas edit of that connection. Roundtrip tests assert derived tags **equal the tags in the eleven shipped samples**.

Inspector shows tags as read-only: “derived from functions.”

### 10.3 Validation split

**Errors (lock canvas):** malformed top-level types; duplicate names; bad enums; port number out of 1–32; unknown profile/port references; breakout; connection with fewer than two endpoints; unknown function type; missing required encap blocks.

**Warnings (do not lock):** name character pattern; unused profiles; assigned ports with no connection; overlapping VLAN/VNI/VSID match keys on one port (composite `vlanKey` + `tunnelKey`); tag mismatch vs derived; malformed/orphan `x_visualizer`; incomplete VLAN choice object.

Read-only connections: >2 endpoints, unknown `port_name`, invalid group anchor, non-authored function. Banner names the reason; other inspector edits will not rewrite that connection.

### 10.4 Visual mapping

`UHDSchematic.png` is cropped to the faceplate band (`cropTop` / `cropH`). `GEOM` is a percentage rectangle (x, y, w, h) plus per-cell padding, measured from the 32 openings. Align-grid nudges those values live and **Copy values** emits a paste-ready `const GEOM = {…}` for a new photograph.

Cage numbering: 16 columns × 2 rows, column-paired.

Wires exit the bottom of a cage, run in stacked lanes under the faceplate, return up. Same-column pairs jog sideways so the path does not cross the lower cage. ARP/Q-in-Q can draw a double stroke. Badges are painted in a second pass so later wires do not occlude labels. Selected connection can expand the badge to mapping lines (VLAN/tunnel).

Outside boxes: sort by column centre, pack into rows with a maximum drift from home column so labels do not pile up; leaders elbow through column gaps and do not cross cages.

### 10.5 Draft state

`state.draft` holds an in-progress encapsulation connection. Rendered amber on the chassis and listed as “Draft — not in the JSON yet.” `commitDraft` inserts it into `connections` only when `draftMissing` is empty. Discard / Esc throws it away. Group-pick of port members is a similar ephemeral state until Create.

### 10.6 File:// architecture (deployment invention vs software invention)

Tutorials are compiled into `tutorials.js` rather than fetched. No backend. Configurations are files the user owns. This is important commercially (air-gapped labs, no install) and should be described as an embodiment, not necessarily as the core claim.

### 10.7 Verification as reduction-to-practice evidence

`node tools/roundtrip-test.cjs` (no npm): eleven samples validate and stay editable; derived tags match files; serialize/parse lossless; breakout refused; UI code path can reproduce `passthrough_single_symmetric` byte-identically; port-group and `x_visualizer` prune behaviour. `migrate-test.cjs` checks JS/Python parity. `tutorials-test.cjs` checks Load-button placement and HTML escaping.

---

## 11. Worked examples (attach JSON as IDD exhibits)

### 11.1 Symmetric VLAN passthrough (canvas-complete)

Sample `docs/samples/passthrough_single_symmetric/passthrough_single_symmetric.json`: profile `manual_400g_rs`; cages 25 and 26 named `scenario4_ingress` / `scenario4_egress`; one `connect_ethernet` with VLAN 101 on both `vlan_endpoint_settings_port1` and `_port2`; **no `tags` key** (Ethernet contributes none).

### 11.2 VLAN ↔ VXLAN (tags required)

Sample `docs/samples/encap_single_vlan_vxlan/encap_single_vlan_vxlan.json`: same cages; `tags: ["vlan"]` on ingress and `["vxlan"]` on egress; function body has VLAN 101, VNI 7001, and a full `outgoing_vxlan_header`. If those tags were omitted or swapped, the device would accept the POST and forward nothing. The visualizer writes this pair by construction.

### 11.3 Scenario families covered


| Intent                          | Sample family                          |
| ------------------------------- | -------------------------------------- |
| One VLAN through, same ID       | `passthrough_single_symmetric`         |
| One VLAN through, renumbered    | `passthrough_single_translation`       |
| VLAN in, untagged out           | `passthrough_single_non_vlan`          |
| Q-in-Q both tags unchanged      | `passthrough_qinq_symmetric`           |
| Q-in-Q both tags renumbered     | `passthrough_qinq_asymmetric`          |
| Q-in-Q in, one tag out          | `passthrough_qinq_partial_strip`       |
| VLAN ↔ VXLAN                    | `encap_single_vlan_vxlan`              |
| VLAN ↔ NVGRE                    | `encap_single_vlan_nvgre`              |
| Two VXLAN layers                | `encap_double_vxlan_vxlan`             |
| Two NVGRE layers                | `encap_double_nvgre_nvgre`             |
| VXLAN over NVGRE                | `encap_double_vxlan_nvgre`             |
| Breakout 4×100G / 4×25G / 4×10G | visualized only as refused (JSON-only) |


---

## 12. Inventive elements (claim seeds)

Use these as “what is new” bullets in the IDD. Counsel will turn a subset into claims. Each seed is a *method/system* statement, not marketing.

1. **Photorealistic bidirectional chassis overlay.** Overlaying a calibrated, numbered cage grid on a front-panel image of a connectivity appliance such that (a) dragging between cages authors the corresponding JSON connection with drag-origin = first endpoint, and (b) loading JSON re-renders the same cages and wires, including port groups whose wire attaches to an anchor cage while sibling cages highlight.
2. **Derived positional endpoint tags.** Automatically computing per-endpoint tag arrays from an ordered list of connection functions using a function-type metadata table, writing those tags into the configuration on each edit, thereby producing documents that satisfy a device API whose incorrect tags are accepted with success status but do not forward traffic.
3. **Last-valid visual lock.** Maintaining a last successfully validated configuration object for rendering while a parallel text buffer is syntactically or semantically invalid; disabling visual mutation and file/device commit until the text validates; offering revert of the text to the last-valid object.
4. **Incomplete-connection draft withheld from the posted document.** Rendering an encapsulation connection on the visual model while omitting it from the serializable configuration until a determined set of API-required fields (VLAN identifier, tunnel identifier, outer-header addresses) is present.
5. **In-place unknown-field preservation.** Mutating a live configuration object graph from GUI controls such that keys and subtrees the GUI does not author remain byte-stable across unrelated edits (lossy form-regeneration avoided).
6. **Pruned display-only schema extension.** Storing operator topology annotations (far-end equipment identity) in a single well-known top-level key that is (a) omitted when empty so vendor samples round-trip identically, (b) ignored by the appliance, and (c) stripped from device-push payloads.
7. **Overlap / silent-pitfall linter bound to the canvas.** Warning on composite match-key collisions (VLAN/VNI/VSID) per port, unused profiles, unconnected assigned cages, and tag arrays that disagree with derivation, each warning selecting the offending visual object.
8. **Live metric correlation with canvas names.** Querying appliance port counters and marking device port names that also exist in the on-canvas configuration, enabling a visualize-then-verify loop for silent-accept failures.
9. **Legacy-to-positional-tag migration.** Transforming a prior schema in which VLANs lived on endpoints and tags included `function_N` markers into the current function-centric model, including splitting `vlan_double` into stacked functions (outer first) and hoisting tunnel headers and `routing_method` out of locations the device ignores.
10. **Uniform stacking model in the GUI.** Representing Q-in-Q and multi-layer encapsulation as an ordered function list on one two-endpoint connection rather than as distinct connection types, with the type picker limited to single-layer types and a second function added in situ.
11. **Operator-calibrated image grid.** Runtime adjustment of overlay geometry against a chassis photograph with export of parameters back into the overlay definition, decoupling the visual asset from the hit-testing code.
12. **Group-aware wire routing and occupancy.** Treating the first member of a port group as the geometric anchor while expanding hover/selection to all members; refusing intra-group connections; signalling cages that participate in multiple named objects.

**Possible independent vs dependent claims:** 1+2+3 is a strong core system. 4, 6, 8, 9 are good dependents or separate filings (migration vs visualizer). 11 is more of an engineering convenience unless counsel sees it as a distinct calibration method.

---

## 13. Advantages

- Operators can **see** which cages a file actually uses instead of decoding integers and names.
- Loading a **running** config onto the same picture is a troubleshooting starting point.
- Tag derivation removes the failure mode that looks like success (HTTP 200, zero forwarding).
- Drafts keep incomplete tunnels out of files that someone might POST.
- Bidirectional JSON pane lets experts patch fields the GUI does not expose without losing the picture.
- Unknown fields survive, so the tool can sit in a workflow that also uses `mirror_to`, PFC, etc.
- Convert recovers pre-July-2026 configs, including ones that would silently do nothing if posted as-is.
- Outside labels travel with the file for human topology without claiming to be device schema.
- `file://`, five files, no install: usable in restricted labs.
- Save/Push refused on invalid JSON: the drawing on screen cannot be mistaken for the file on disk.
- Embedded tutorials teach the schema *and* the silent failures next to the canvas you load them into.
- Counter polling that stops when the panel closes avoids background device load.

---

## 14. Alternative embodiments (write these in the IDD; they broaden claims)

- Same method on a **schematic drawing** or SVG faceplate instead of a photograph.
- Same method on **other port counts** or breakout-aware cages (sub-ports as child hit-targets).
- Overlay on a **live camera** of the chassis.
- Headless **linter/CI** using the same `validate` / `deriveTags` / overlap rules without a GUI.
- Server-hosted multi-user session instead of `file://`.
- Generating **IxNetwork / OTG / other** traffic configs from the same canvas.
- Applying the derived-tag + last-valid-lock pattern to other JSON-configured appliances (packet brokers, TAP aggregators, DPU fabrics) whose APIs accept inert configs.
- Three-or-more endpoint connections as first-class visual objects (today read-only).
- Authoring `connect_ip` and breakout in-canvas (today refused or JSON-only).

---

## 15. Figures to attach to the IDD

Capture these from a running `index.html` (screenshots or annotated exports). IDDs are much stronger with figures.


| Fig. | What to show                                                                                    | Why                                |
| ---- | ----------------------------------------------------------------------------------------------- | ---------------------------------- |
| 1    | Empty chassis + three-step inspector                                                            | Overall system                     |
| 2    | Two assigned cages, drag in progress, type picker                                               | Authoring method                   |
| 3    | Amber draft encap wire + “Still needed” inspector                                               | Draft withheld from JSON           |
| 4    | Finished VXLAN connection; JSON pane showing derived tags                                       | Bidirectional sync + tag invention |
| 5    | Same as 4 with JSON deliberately broken; lock banner; last-valid drawing still visible          | Last-valid lock                    |
| 6    | Port group (anchor + dashed members + corner dot) and group connection                          | Group embodiment                   |
| 7    | Outside boxes labelled SNIC/server with leader lines; JSON snippet of `x_visualizer`            | Schema extension                   |
| 8    | Device panel: counters, “on canvas” tags, pull/push                                             | Troubleshoot loop                  |
| 9    | Convert panel: old JSON left, new JSON right, report of tag rebuild                             | Migration                          |
| 10   | Selected-wire mapping badge (VLAN 101 ↔ VNI 7001)                                               | Visual tshoot                      |
| 11   | Warning list: overlapping VLANs; show-link selecting a wire                                     | Linter bound to canvas             |
| 12   | Align-grid overlay on the photograph                                                            | Calibration embodiment             |
| 13   | Block diagram: file / canvas object / JSON textarea / device API / draft state                  | Architecture                       |
| 14   | Flowchart: validate → error lock vs warning; deriveTags on commit; strip `x_visualizer` on push | Method claims                      |


Also attach: one old-schema vs new-schema JSON pair; `passthrough_single_symmetric.json`; `encap_single_vlan_vxlan.json`.

---

## 16. Timeline, public disclosure, related products

**Critical for counsel.** In many jurisdictions, public disclosure before filing can destroy patentability. The United States has a limited grace period; most of the rest of the world does not.


| Event                                 | Date (from git in this workspace)                                 | Notes                                                                                                |
| ------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Initial commit `uhdConnectVisualizer` | 2026-08-20                                                        | First reduction to practice in this repo                                                             |
| Chassis zoom controls                 | 2026-08-20                                                        |                                                                                                      |
| Wire badge VLAN/tunnel mapping        | 2026-08-21                                                        |                                                                                                      |
| Migration added in-product            | 2026-08-21                                                        |                                                                                                      |
| Docs update                           | 2026-08-21                                                        |                                                                                                      |
| Schema change of the *host API*       | 2026-07-28                                                        | Not this invention; it created the need                                                              |
| Remote                                | `origin` = `https://github.com/ashwinjo/uhdConnectVisualizer.git` | **Treat as a public disclosure unless counsel confirms the repo was private at all relevant times.** |


**TODO:** exact date the GitHub repo was set to public; internal demos; customer demos; Keysight contact distribution of the beta; whether `UHDSchematic.png` or samples are under a separate copyright/NDA.

**Related Keysight products (for “related art / will this be productized”):**

- UHD Connect appliance and its OpenAPI / sample configs / on-box Getting Started.
- Other Keysight visualization or NPB/TAPs GUIs (**TODO:** list with PM).
- IxNetwork / related protocol stacks (this tool does not generate IxNetwork configs today).

**Commercial use:** beta tool for Keysight contacts and operators who must produce UHD Connect JSON. Intended to reduce time-to-valid-config and to diagnose “posted but dead” connections. No install tax; copy the folder.

**Open-source vs proprietary:** the GitHub remote is a public-style URL. **TODO:** confirm license, whether Keysight wants this as a product SKU, an entitlement with the box, or an internal/apps tool.

---

## 17. TODOs before you file the IDD

Copy this checklist into the IDD packet and complete it with people, not from this file.

- **Inventor(s):** legal names, employee IDs, sites, citizenship, contribution split. Git authorship is not the inventor list.
- **Conception date:** first notebook / email / slide *before* 2026-08-20 if any.
- **First reduction to practice:** this repo’s initial commit is a candidate; confirm if an earlier prototype existed.
- **First public disclosure:** GitHub public date, customer meeting, conference, blog.
- **Prior-art search** using §7; attach closest three hits and a paragraph on differences.
- **PM statement:** is this planned as a product, a box entitlement, or an apps-only tool?
- **Export / classification:** network-config software; confirm no encryption-controlled issues (standard HTTPS to the box).
- **Third-party content:** `UHDSchematic.png` ownership; IBM Plex font licensing in `index.html`; vendor samples copyright.
- **Co-inventors** on `migrate.js` / `uhd_migration.py` if that person is different from the visualizer author — migration may be a second disclosure or a joint invention.
- **Preferred claims:** confirm with inventors whether the *silent-tag derivation* or the *chassis overlay* is the hill to die on (they can be one filing with independent claims).
- **Witnesses** who saw a working demo.

---

## 18. Software inventory (reduction to practice)


| Path                        | Role                                                                                                                                                                                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html`                | Markup, all CSS, chrome (toolbar, chassis, inspector, JSON, tutorials, device, convert, modals). Version string v1.0.0 Beta.                                                                                                                             |
| `app.js`                    | Model tables, validation, tag derivation, render (chassis, wires, outside rail), authoring, drafts, file I/O, tutorials reader, device panel, convert UI. Header comment: parsed JSON is source of truth; mutated in place so unaothored fields survive. |
| `migrate.js`                | Old → new schema; browser + Node; pair of `uhd_migration.py`.                                                                                                                                                                                            |
| `tutorials.js`              | Generated bundle of `docs/tutorials/*.md`.                                                                                                                                                                                                               |
| `UHDSchematic.png`          | Front-panel photograph under the grid.                                                                                                                                                                                                                   |
| `docs/openapi.json`         | Authoritative UHD Connect schema.                                                                                                                                                                                                                        |
| `docs/samples/`**           | Fourteen scenario JSON files + vendor README (`curl` apply/metrics).                                                                                                                                                                                     |
| `docs/tutorials/**`         | Human-readable scenario + silent-failure documentation.                                                                                                                                                                                                  |
| `tools/build-tutorials.cjs` | Markdown → `tutorials.js`.                                                                                                                                                                                                                               |
| `tools/roundtrip-test.cjs`  | Sample round-trip and tag-derivation proofs.                                                                                                                                                                                                             |
| `tools/migrate-test.cjs`    | Migration parity.                                                                                                                                                                                                                                        |
| `tools/tutorials-test.cjs`  | Tutorial panel correctness.                                                                                                                                                                                                                              |
| `README.md`                 | Operator-facing behaviour (authoring, groups, outside, JSON lock, device).                                                                                                                                                                               |


Implementation language: client-side JavaScript (`'use strict'` IIFE / globals), no framework, no `package.json`.

---

## 19. Scope and non-goals (honesty for the IDD)

State these so claims are not over-broad and so examiners are not surprised.

- Whole-port only: one cage = one port in the visualizer.
- Two endpoints per *editable* connection.
- `connect_ip` not offered in the type picker.
- No BGP / service-instance API (`https://<unit>/…` second endpoint in the vendor sample README is out of scope).
- Device communication is opt-in and button-driven; authoring itself is offline.
- Not a general JSON Schema form generator; function types and tag rules are domain-specific.
- Breakout is documented and validated-against, not visualized.

---

## 20. Glossary


| Term            | Meaning                                                                                |
| --------------- | -------------------------------------------------------------------------------------- |
| Cage            | Physical QSFP (or similar) opening on the 32-port faceplate, numbered 1–32.            |
| Layer-1 profile | Named speed / AN-or-manual / FEC block referenced by ports.                            |
| Connection      | JSON object with `endpoints` + `functions` joining two named ports (or groups).        |
| Function        | One layer of behaviour on a connection (Ethernet, ARP, VLAN↔VXLAN, VLAN↔NVGRE, …).     |
| Tags            | Per-endpoint role list, positional with `functions`. Wrong length → silent no-forward. |
| Port1 / port2   | `endpoints[0]` / `endpoints[1]`; drag origin is port1.                                 |
| Draft           | UI-only incomplete encapsulation connection, amber, not in JSON.                       |
| Port group      | Several cages, one name; first member is the wire anchor.                              |
| `x_visualizer`  | Display-only top-level JSON key this tool invented.                                    |
| Silent accept   | Device HTTP 200 on a config that does not implement the intended forwarding.           |
| Convert         | In-app old-schema → new-schema migration.                                              |
| On canvas       | Device port name that also exists in the current visualizer config.                    |


---

## 21. Suggested “problem / solution / novelty” paragraph for the IDD cover

**Problem.** Multi-port connectivity appliances are configured with a dense JSON document whose physical meaning (which cage, which far-end, which VLAN or tunnel role) is not visible in the file. The appliance API can accept a document with HTTP 200 while implementing nothing, especially when positional endpoint tags do not match the function list. Operators troubleshoot this with curl, counters, and tribal knowledge of the faceplate.

**Solution.** A visual system binds that document to a calibrated front-panel image, lets the operator load or draw the configuration, derives the tags and other required structure by construction, keeps a last-valid picture when the text is broken, optionally annotates far-end equipment without contaminating the device schema, migrates broken older documents, and correlates live counters with the same port names.

**Novelty (one sentence).** The combination of photorealistic bidirectional chassis overlay, function-driven tag synthesis aimed at a silent-accept API, last-valid visual lock, and withheld drafts — optionally coupled with live counter correlation and schema migration that rebuilds the positional tag model.

---

*Generated from the UHD Connect Visualizer codebase and docs as of 2026-08-22 for internal IDD drafting. Update §16–§17 with inventor facts before filing.*