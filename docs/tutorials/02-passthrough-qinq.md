# Q-in-Q ARP bypass

Double-tagged traffic through the device, built from two stacked `connect_arp` functions on one
connection. There is no Q-in-Q function type to select: the second function *is* the second tag.

Covers `passthrough_qinq_symmetric`, `passthrough_qinq_asymmetric` and
`passthrough_qinq_partial_strip`.

## How a tag stack maps to functions

One connection, two functions, and the order is the tag order:

| | Carries | Port1 setting | Port2 setting |
| --- | --- | --- | --- |
| `functions[0]` | the outer tag | `vlan_endpoint_settings_port1` | `vlan_endpoint_settings_port2` |
| `functions[1]` | the inner tag | `vlan_endpoint_settings_port1` | `vlan_endpoint_settings_port2` |

Each function still has its own independent port1 and port2 blocks, which is what gives you four
values to play with: outer-on-port1, outer-on-port2, inner-on-port1, inner-on-port2. The three
scenarios below are just three ways of filling that grid.

Both endpoints carry `tags: ["vlan", "vlan"]` — one `vlan` per function, since `connect_arp`
contributes `vlan` at both ends. The visualizer maintains this for you; if you are editing JSON by
hand, a stack of two functions with only one tag per endpoint is accepted by the device with HTTP 200
and then forwards nothing.

## Build it once

Same base as the single-VLAN scenarios: one `manual_400g_rs` profile and two ports on cages 25 and
26. See [Single-VLAN passthrough](01-passthrough-single.md#the-base-every-scenario-shares) for that
block. As there, each sample names its ports differently — `scenario6_*`, `scenario9_*` and
`scenario10_*` below — so adjust the `port_name` values to whatever you declared.

### On the UI

The two-function structure is the same for all three scenarios, so build it once and then only the
four numbers change:

1. Create the profile and name cages 25 and 26, as in the single-VLAN page.
2. Drag from cage 25 to cage 26 and click **ARP** in the type picker. The connection appears
   immediately, with no settings at all.
3. With the connection selected, the single **ARP** card carries a hint: *Add a second ARP function
   for Q-in-Q.* Press **+ ARP** in the **Functions** section below the cards.
4. You now have two cards, both titled **ARP**, and the **Tags** line in **Endpoints** has become
   `[vlan, vlan] / [vlan, vlan]` on its own. You never edit tags directly.

The cards are listed in array order, so **the top card is `functions[0]`, the outer tag** and the
bottom card is the inner one. Each card has its own **VLAN on port1** and **VLAN on port2**, which is
the four-value grid the theory above describes — top-left, top-right, bottom-left, bottom-right.

Each dropdown starts on **Untagged** and needs switching to **Single VLAN** before you can type a
number.

<a id="symmetric"></a>

## Symmetric — both tags unchanged

*Sample: `passthrough_qinq_symmetric`*

Outer 100 and inner 200 arrive on port 25 and leave port 26 unchanged. The transparent Q-in-Q case.

```json
{
  "name": "Q-in-Q ARP Bypass 1",
  "endpoints": [
    { "port_name": "scenario6_ingress", "tags": ["vlan", "vlan"] },
    { "port_name": "scenario6_egress",  "tags": ["vlan", "vlan"] }
  ],
  "functions": [
    {
      "choice": "connect_arp",
      "connect_arp": {
        "vlan_endpoint_settings_port1": { "vlan": { "choice": "vlan", "vlan": 100 } },
        "vlan_endpoint_settings_port2": { "vlan": { "choice": "vlan", "vlan": 100 } }
      }
    },
    {
      "choice": "connect_arp",
      "connect_arp": {
        "vlan_endpoint_settings_port1": { "vlan": { "choice": "vlan", "vlan": 200 } },
        "vlan_endpoint_settings_port2": { "vlan": { "choice": "vlan", "vlan": 200 } }
      }
    }
  ]
}
```

Read it as a grid: outer 100 on both ports, inner 200 on both ports.

### On the UI

Both dropdowns in each card to **Single VLAN**, then:

| Card | VLAN on port1 | VLAN on port2 |
| --- | --- | --- |
| Top (**outer**) | `100` | `100` |
| Bottom (**inner**) | `200` | `200` |

<a id="asymmetric"></a>

## Asymmetric — both tags renumbered

*Sample: `passthrough_qinq_asymmetric`*

Outer 100 / inner 200 on port 25 becomes outer 150 / inner 250 on port 26. Q-in-Q translation, and
like single-tag translation it applies in both directions.

```json
{
  "name": "Q-in-Q ARP Bypass Asymmetric",
  "endpoints": [
    { "port_name": "scenario9_ingress", "tags": ["vlan", "vlan"] },
    { "port_name": "scenario9_egress",  "tags": ["vlan", "vlan"] }
  ],
  "functions": [
    {
      "choice": "connect_arp",
      "connect_arp": {
        "vlan_endpoint_settings_port1": { "vlan": { "choice": "vlan", "vlan": 100 } },
        "vlan_endpoint_settings_port2": { "vlan": { "choice": "vlan", "vlan": 150 } }
      }
    },
    {
      "choice": "connect_arp",
      "connect_arp": {
        "vlan_endpoint_settings_port1": { "vlan": { "choice": "vlan", "vlan": 200 } },
        "vlan_endpoint_settings_port2": { "vlan": { "choice": "vlan", "vlan": 250 } }
      }
    }
  ]
}
```

The two layers are translated independently. Nothing requires the outer and inner offsets to match,
so `100 → 150` alongside `200 → 250` is a convention of the sample rather than a rule.

### On the UI

Same four fields, all **Single VLAN**, with the port2 column renumbered:

| Card | VLAN on port1 | VLAN on port2 |
| --- | --- | --- |
| Top (**outer**) | `100` | `150` |
| Bottom (**inner**) | `200` | `250` |

<a id="partial-strip"></a>

## Partial strip — two tags in, one tag out

*Sample: `passthrough_qinq_partial_strip`*

Outer 100 / inner 200 on port 25 becomes a single tag 150 on port 26. The inner tag is dropped by
setting the inner function's port2 to `non_vlan`:

```json
{
  "name": "Q-in-Q ARP Bypass Partial Strip",
  "endpoints": [
    { "port_name": "scenario10_ingress", "tags": ["vlan", "vlan"] },
    { "port_name": "scenario10_egress",  "tags": ["vlan", "vlan"] }
  ],
  "functions": [
    {
      "choice": "connect_arp",
      "connect_arp": {
        "vlan_endpoint_settings_port1": { "vlan": { "choice": "vlan", "vlan": 100 } },
        "vlan_endpoint_settings_port2": { "vlan": { "choice": "vlan", "vlan": 150 } }
      }
    },
    {
      "choice": "connect_arp",
      "connect_arp": {
        "vlan_endpoint_settings_port1": { "vlan": { "choice": "vlan", "vlan": 200 } },
        "vlan_endpoint_settings_port2": { "vlan": { "choice": "non_vlan" } }
      }
    }
  ]
}
```

The connection still has two functions and both endpoints still carry two tags — the stack depth is
a property of the connection, not of one port. Only the value on port2 of the inner layer says
"nothing here".

Note which layer is stripped. `non_vlan` sits on `functions[1]`, the inner tag, leaving the outer
tag on the wire. Putting `non_vlan` on `functions[0]` instead describes something quite different.

### On the UI

| Card | VLAN on port1 | VLAN on port2 |
| --- | --- | --- |
| Top (**outer**) | **Single VLAN** `100` | **Single VLAN** `150` |
| Bottom (**inner**) | **Single VLAN** `200` | **Untagged** |

The bottom-right cell is the whole scenario. As on the single-VLAN page, a dropdown that already
reads **Untagged** will not write anything when you re-pick it — set it to **Single VLAN** first, then
back to **Untagged**, and `{"choice": "non_vlan"}` appears in the JSON pane. Confirm it landed on the
*bottom* card before you save.

## Things that will bite you

**The top function is the outer tag.** This is worth double-checking rather than assuming, because
the two orderings produce configs that are equally valid and both post successfully. If your capture
shows the tags swapped, reorder the functions rather than the values.

**Count your tags after any JSON edit.** Adding a third function means three tags per endpoint.
Deleting a function means two. The visualizer recalculates on every canvas edit, but a hand edit in
the JSON pane is yours to keep consistent — and a short list is silent.

**One tag per function, not per port.** A connection where port1 is double-tagged and port2 is
single-tagged is still two functions; you express the difference with `non_vlan`, as the partial
strip does. There is no way to give one endpoint more layers than the other.

**Deleting the last function deletes the connection.** The inspector asks first — a connection must
have at least one function.
