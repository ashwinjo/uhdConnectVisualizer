#!/usr/bin/env python3
"""Migrate a UHD Connect config from the OLD API schema to the NEW one.

Self-contained: standard library only, Python 3.8+. Copy it anywhere.
The visualizer's Convert panel (`migrate.js`) is the same rules for people who
do not want a Python environment.

    python uhd_migration.py old.json                 # -> old.new.json
    python uhd_migration.py old.http -o new.http     # keeps the HTTP head
    python uhd_migration.py old.json --stdout        # print, write nothing
    python uhd_migration.py old.json --diff          # unified diff only
    python uhd_migration.py --selftest               # no input needed

`.http` in, `.http` out: the request line and headers are kept verbatim and
only the JSON body is rewritten, so the result stays click-to-send.

WHAT CHANGED (schema break of 2026-07-28)

  1. Endpoints are flat. {choice: "front_panel", front_panel: {port_name,
     vlan}} becomes {port_name}; FrontPanelEndpoint and InternalEndpoint are
     gone.

  2. The endpoint's VLAN moves onto the function:
       encap        <connect_vlan_*>.vlan_endpoint_settings.vlan
       passthrough  <connect_*>.vlan_endpoint_settings_port1.vlan  endpoints[0]
                    <connect_*>.vlan_endpoint_settings_port2.vlan  endpoints[1]

  3. The outgoing tunnel header moves to the tunnel side, and the UDP ports
     move inside it:
       vlan_endpoint_settings.outgoing_vxlan_header
         -> vxlan_endpoint_settings.outgoing_vxlan_header
       vxlan_endpoint_settings.udp_src_port / udp_dst_port
         -> outgoing_vxlan_header.udp_src_port / udp_dst_port
     Same for nvgre, which has no UDP ports.

  4. The *_v6 header siblings are gone; outgoing_vxlan_header_v6 folds into
     outgoing_vxlan_header, whose src_ip / dst_ip `choice` already carries the
     IP family.

  5. VlanIdOption lost vlan_double, all_vlans and all_vlans_and_non_vlan. A
     vlan_double endpoint becomes two stacked functions, outer first, each
     with its own single VLAN. all_vlans and all_vlans_and_non_vlan have no
     replacement and are reported rather than guessed at.

  6. Endpoint `tags` are positional against functions[]: tags[i] is that
     endpoint's role for functions[i], so every endpoint carries one tag per
     function. The old function_0 / function_1 markers are gone and a port
     duplicated once per layer collapses to a single endpoint. Getting this
     wrong is silent -- UHD accepts a short tag list with HTTP 200, returns it
     unchanged, and forwards nothing.

  7. `mirror_to` takes the NAME of a declared front-panel port instead of an
     inline {front_panel_port: N}. The target is declared for you, inheriting
     the mirror source's layer_1_profile_name (what the old form did
     implicitly) and appended after the source, because UHD rejects a config
     that lists a mirror target before its source.

  8. `routing_method` / `ip_routing` / `mac_routing` nested inside `protocols`
     are hoisted onto the endpoint settings, the only place they are legal.
     UHD does not reject them where they were -- it returns HTTP 200 and
     silently ignores them, so the config runs on the vni_routing default.

Anything that cannot be mapped faithfully is reported on stderr and, unless
--force is given, exits non-zero rather than writing a quietly wrong config.
"""
from __future__ import annotations

import argparse
import copy
import difflib
import json
import re
import sys
from typing import Any

TUNNEL_FUNCS = {"connect_vlan_vxlan": "vxlan", "connect_vlan_nvgre": "nvgre"}
PASSTHROUGH_FUNCS = {"connect_arp", "connect_ip", "connect_ethernet"}
DROPPED_VLAN_CHOICES = {"all_vlans", "all_vlans_and_non_vlan"}


class MigrationError(Exception):
    pass


class Report:
    """Collects what changed and what could not be mapped."""

    def __init__(self) -> None:
        self.changes: list[str] = []
        self.problems: list[str] = []

    def changed(self, msg: str) -> None:
        self.changes.append(msg)

    def problem(self, msg: str) -> None:
        self.problems.append(msg)

    def render(self) -> str:
        out = []
        if self.changes:
            out.append("changes applied:")
            out += [f"  - {c}" for c in self.changes]
        else:
            out.append("no changes: input already looks like the new schema")
        if self.problems:
            out.append("")
            out.append("COULD NOT MAP:")
            out += [f"  ! {p}" for p in self.problems]
        return "\n".join(out)


# --------------------------------------------------------------- VLAN helpers
def _range_to_vlan_id_option(rng: dict, where: str, rep: Report) -> dict:
    """VlanIdRange -> VlanIdOption; count 0 or 1 collapses to a scalar vlan."""
    start = rng.get("start")
    count = int(rng.get("count", 0) or 0)
    step = int(rng.get("step", 1) or 1)
    if start is None:
        raise MigrationError(f"{where}: VLAN range has no 'start'")
    if count <= 1:
        return {"choice": "vlan", "vlan": start}
    rep.changed(f"{where}: vlan range start={start} count={count} step={step}")
    return {"choice": "vlan_range",
            "vlan_range": {"start": start, "count": count, "step": step}}


def _split_vlan_double(vlan: dict, where: str, rep: Report) -> list[dict]:
    """vlan_double -> [outer VlanIdOption, inner VlanIdOption]."""
    dbl = vlan.get("vlan_double") or {}
    outer, inner = dbl.get("outer"), dbl.get("inner")
    if outer is None or inner is None:
        raise MigrationError(f"{where}: vlan_double needs both 'outer' and 'inner'")
    return [_range_to_vlan_id_option(outer, f"{where}.outer", rep),
            _range_to_vlan_id_option(inner, f"{where}.inner", rep)]


def _normalise_vlan(vlan: Any, where: str, rep: Report) -> list[dict]:
    """Endpoint VLAN -> per-function VlanIdOptions; 2 means split a double."""
    if vlan is None:
        return []
    if not isinstance(vlan, dict):
        raise MigrationError(f"{where}: VLAN is not an object")
    choice = vlan.get("choice")
    if choice in DROPPED_VLAN_CHOICES:
        rep.problem(
            f"{where}: VLAN choice '{choice}' was DELETED from the schema and has "
            f"no replacement. Decide explicitly what this connection should match "
            f"(a specific vlan, a vlan_range, or non_vlan) and edit it by hand.")
        return [{"choice": "non_vlan", "__UNMAPPED__": choice}]
    if choice == "vlan_double":
        rep.changed(f"{where}: vlan_double -> two stacked functions (outer first)")
        return _split_vlan_double(vlan, where, rep)
    if choice == "vlan_range":
        return [_range_to_vlan_id_option(vlan.get("vlan_range") or {}, where, rep)]
    if choice in ("vlan", "non_vlan"):
        return [copy.deepcopy(vlan)]
    raise MigrationError(f"{where}: unknown VLAN choice {choice!r}")


# ----------------------------------------------------------- endpoint parsing
def _parse_old_endpoint(ep: dict, idx: int, rep: Report) -> dict:
    """Flatten one old endpoint into {port_name, vlan, role, function_index}."""
    where = f"endpoints[{idx}]"
    if "port_name" in ep and "front_panel" not in ep and "choice" not in ep:
        # already new-shape
        return {"port_name": ep["port_name"], "vlan": None,
                "tags": list(ep.get("tags") or []), "already_new": True}

    choice = ep.get("choice")
    if choice == "internal" or "internal" in ep:
        raise MigrationError(
            f"{where}: 'internal' endpoints were removed from the schema and "
            f"have no equivalent; this connection needs redesigning by hand.")
    fp = ep.get("front_panel")
    if not isinstance(fp, dict):
        raise MigrationError(f"{where}: expected a 'front_panel' object")
    port_name = fp.get("port_name")
    if not port_name:
        raise MigrationError(f"{where}: front_panel has no 'port_name'")
    return {"port_name": port_name, "vlan": fp.get("vlan"),
            "tags": list(ep.get("tags") or []), "already_new": False}


_FUNC_TAG = re.compile(r"^function_(\d+)$")


def _split_tags(tags: list[str]) -> tuple[list[str], int | None]:
    """Separate role tags from the old function_N marker."""
    roles, fidx = [], None
    for t in tags:
        m = _FUNC_TAG.match(t)
        if m:
            fidx = int(m.group(1))
        else:
            roles.append(t)
    return roles, fidx


# ------------------------------------------------------------ function moves
def _migrate_tunnel_function(body: dict, kind: str, where: str,
                             rep: Report) -> dict:
    """Move the outgoing header to the tunnel side and fold the UDP ports in."""
    body = copy.deepcopy(body)
    tun_key = f"{kind}_endpoint_settings"
    hdr_key = f"outgoing_{kind}_header"
    tun = body.setdefault(tun_key, {})
    vlan_side = body.setdefault("vlan_endpoint_settings", {})

    header = None
    for src_key in (hdr_key, f"{hdr_key}_v6"):
        if src_key in vlan_side:
            header = vlan_side.pop(src_key)
            if src_key.endswith("_v6"):
                rep.changed(f"{where}: {src_key} -> {tun_key}.{hdr_key} "
                            f"(the _v6 sibling schema is gone; the IP family is "
                            f"already the choice on src_ip/dst_ip)")
            else:
                rep.changed(f"{where}: vlan_endpoint_settings.{src_key} "
                            f"-> {tun_key}.{hdr_key}")
    if hdr_key in tun and header is not None:
        rep.problem(f"{where}: {hdr_key} present on BOTH sides; kept the "
                    f"tunnel-side one and discarded the vlan-side copy")
        header = tun[hdr_key]
    if header is not None:
        tun[hdr_key] = header

    # udp ports move from VxlanSettings into the header (vxlan only)
    for port_key in ("udp_src_port", "udp_dst_port"):
        if port_key in tun:
            value = tun.pop(port_key)
            if tun.get(hdr_key) is None:
                rep.problem(f"{where}: {port_key}={value} has nowhere to go -- it "
                            f"now lives inside {hdr_key}, but this function has "
                            f"no outgoing header. Dropped.")
                continue
            tun[hdr_key][port_key] = value
            rep.changed(f"{where}: {tun_key}.{port_key} -> {hdr_key}.{port_key}")

    if not vlan_side:
        body["vlan_endpoint_settings"] = {}
    return body


def _function_kind(fn: dict, where: str) -> tuple[str, dict]:
    choice = fn.get("choice")
    if not choice:
        # tolerate a missing discriminator when it is unambiguous
        candidates = [k for k in fn if k.startswith("connect_")]
        if len(candidates) != 1:
            raise MigrationError(
                f"{where}: function has no 'choice' discriminator and it cannot "
                f"be inferred (found {candidates or 'no connect_* key'})")
        choice = candidates[0]
    if choice not in fn:
        raise MigrationError(f"{where}: choice={choice!r} but no matching "
                             f"'{choice}' body")
    return choice, fn[choice]


# -------------------------------------------------------------- connections
def _migrate_connection(conn: dict, cidx: int, rep: Report) -> dict:
    where_c = f"connections[{cidx}] ({conn.get('name', 'unnamed')!r})"
    old_eps = conn.get("endpoints") or []
    old_fns = conn.get("functions") or []

    parsed = [_parse_old_endpoint(ep, i, rep) for i, ep in enumerate(old_eps)]
    if parsed and all(p["already_new"] for p in parsed) and not any(
            "function_" in t for p in parsed for t in p["tags"]):
        rep.changed(f"{where_c}: endpoints already flat, left alone")

    # ---- per-endpoint role + function index
    for p in parsed:
        p["roles"], p["function_index"] = _split_tags(p["tags"])

    # ---- how many functions will the new config have?
    vlan_lists: dict[int, list[dict]] = {}
    for i, p in enumerate(parsed):
        vlan_lists[i] = _normalise_vlan(p["vlan"], f"{where_c}.endpoints[{i}]", rep)
    double_width = max((len(v) for v in vlan_lists.values()), default=1)
    if double_width > 1 and len(old_fns) != 1:
        raise MigrationError(
            f"{where_c}: a vlan_double endpoint expands one function into two, "
            f"but this connection has {len(old_fns)} functions. Split it by hand.")
    n_functions = len(old_fns) * (double_width if double_width > 1 else 1)
    if n_functions == 0:
        n_functions = 0  # layer1-only connection, no functions

    # ---- build the new functions
    new_fns: list[dict] = []
    for fi, fn in enumerate(old_fns):
        where_f = f"{where_c}.functions[{fi}]"
        choice, body = _function_kind(fn, where_f)
        reps = double_width if double_width > 1 else 1
        for rep_i in range(reps):
            where_r = where_f if reps == 1 else f"{where_f}#{rep_i}"
            if choice in TUNNEL_FUNCS:
                kind = TUNNEL_FUNCS[choice]
                new_body = _migrate_tunnel_function(body, kind, where_r, rep)
                # the VLAN for this function comes from the vlan-side endpoint
                # that was tagged for it
                vlan = _vlan_for_function(parsed, vlan_lists, fi, rep_i,
                                          double_width, role_wanted="vlan")
                if vlan is not None:
                    new_body.setdefault("vlan_endpoint_settings", {})["vlan"] = vlan
                    rep.changed(f"{where_r}: endpoint VLAN -> "
                                f"vlan_endpoint_settings.vlan")
            elif choice in PASSTHROUGH_FUNCS:
                new_body = copy.deepcopy(body)
                ports = _passthrough_endpoints(parsed)
                for slot, p in enumerate(ports[:2], start=1):
                    idx = parsed.index(p)
                    opts = vlan_lists.get(idx) or []
                    vlan = (opts[rep_i] if rep_i < len(opts)
                            else (opts[0] if opts else None))
                    if vlan is None:
                        continue
                    key = f"vlan_endpoint_settings_port{slot}"
                    new_body.setdefault(key, {})["vlan"] = _clean(vlan)
                    rep.changed(f"{where_r}: endpoints[{idx}] VLAN -> {key}.vlan")
            else:
                raise MigrationError(f"{where_r}: unknown function type {choice!r}")
            new_fns.append({"choice": choice, choice: new_body})

    # ---- collapse endpoints: one per physical port, positional tags
    new_eps = _collapse_endpoints(parsed, new_fns, where_c, rep)

    out = {k: v for k, v in conn.items() if k not in ("endpoints", "functions")}
    out["endpoints"] = new_eps
    out["functions"] = new_fns
    return out


def _clean(vlan: dict) -> dict:
    return {k: v for k, v in vlan.items() if k != "__UNMAPPED__"}


def _vlan_for_function(parsed, vlan_lists, fi: int, rep_i: int,
                       double_width: int, role_wanted: str):
    """The VLAN that belongs to function `fi` (repetition `rep_i`)."""
    for idx, p in enumerate(parsed):
        if role_wanted not in p["roles"]:
            continue
        if double_width > 1:
            opts = vlan_lists.get(idx) or []
            if rep_i < len(opts):
                return _clean(opts[rep_i])
            continue
        if p["function_index"] is not None and p["function_index"] != fi:
            continue
        opts = vlan_lists.get(idx) or []
        if opts:
            return _clean(opts[0])
    return None


def _passthrough_endpoints(parsed) -> list[dict]:
    """Distinct ports in first-appearance order (port1/port2 are positional)."""
    seen, out = set(), []
    for p in parsed:
        if p["port_name"] not in seen:
            seen.add(p["port_name"])
            out.append(p)
    return out


def _collapse_endpoints(parsed, new_fns, where_c: str, rep: Report) -> list[dict]:
    """One endpoint per port, carrying one tag per function."""
    n = len(new_fns)
    by_port: dict[str, list[dict]] = {}
    for p in parsed:
        by_port.setdefault(p["port_name"], []).append(p)

    if len(by_port) > 2:
        rep.problem(
            f"{where_c}: {len(by_port)} distinct ports across the endpoints, but a "
            f"connection has exactly two ends. Emitted all of them -- check this "
            f"one by hand.")

    out = []
    for port_name, entries in by_port.items():
        tags: list[str] = []
        for fi in range(n):
            role = None
            for e in entries:
                if e["function_index"] == fi:
                    role = e["roles"][0] if e["roles"] else None
                    break
            if role is None:
                # no per-function marker: the port keeps the same role throughout
                roles = [r for e in entries for r in e["roles"]]
                role = roles[0] if roles else "vlan"
            tags.append(role)
        if n == 0:
            tags = [e["roles"][0] for e in entries if e["roles"]][:1] or ["vlan"]
        out.append({"port_name": port_name, "tags": tags})

    if len(parsed) != len(out):
        rep.changed(f"{where_c}: {len(parsed)} endpoints -> {len(out)} "
                    f"(one per port; function_N marker tags removed)")
    for ep in out:
        rep.changed(f"{where_c}: endpoint {ep['port_name']} tags={ep['tags']} "
                    f"(one per function, positional)")

    # convention: the vlan side comes first when there is a tunnel side
    def _key(ep):
        return 0 if all(t == "vlan" for t in ep["tags"]) else 1
    if any(_key(e) for e in out):
        out.sort(key=_key)
    return out


_ROUTING_KEYS = ("routing_method", "ip_routing", "mac_routing", "vni_routing")


def _hoist_routing_out_of_protocols(out: dict, rep: Report) -> None:
    """Move routing_* keys out of `protocols` onto the endpoint settings."""
    moved = 0
    for ci, conn in enumerate(out.get("connections") or []):
        for fi, fn in enumerate(conn.get("functions") or []):
            for fkey, fval in fn.items():
                if not isinstance(fval, dict):
                    continue
                for skey, settings in fval.items():
                    if not (isinstance(settings, dict)
                            and skey.endswith("_endpoint_settings")):
                        continue
                    pr = settings.get("protocols")
                    if not isinstance(pr, dict):
                        continue
                    for k in _ROUTING_KEYS:
                        if k not in pr:
                            continue
                        if k in settings:
                            rep.problem(
                                f"connections[{ci}].functions[{fi}].{fkey}."
                                f"{skey}: '{k}' present both inside "
                                f"`protocols` and on the parent; left alone")
                            continue
                        settings[k] = pr.pop(k)
                        moved += 1
                    if not pr:
                        settings.pop("protocols")
    if moved:
        rep.changed(f"hoisted {moved} routing key(s) out of `protocols` onto "
                    f"their endpoint settings (UHD silently ignores them where "
                    f"they were)")


def _migrate_mirror_to(out: dict, rep: Report) -> None:
    """Turn `mirror_to: {front_panel_port: N}` into `mirror_to: "<name>"`."""
    fps = out.get("front_panel_ports")
    if not isinstance(fps, list):
        return

    def num_of(entry):
        fp = entry.get("front_panel_port")
        return fp.get("front_panel_port") if isinstance(fp, dict) else None

    by_num = {}
    for e in fps:
        n = num_of(e)
        if isinstance(n, int) and n not in by_num:
            by_num[n] = e.get("name")
    taken = {e.get("name") for e in fps}

    added, rewired = [], 0
    for e in list(fps):
        fp = e.get("front_panel_port")
        if not isinstance(fp, dict):
            continue
        mt = fp.get("mirror_to")
        if not isinstance(mt, dict):
            continue
        n = mt.get("front_panel_port")
        if not isinstance(n, int):
            rep.problem(f"front_panel_ports '{e.get('name')}': mirror_to is an "
                        f"object with no front_panel_port; left alone")
            continue

        if n in by_num:
            fp["mirror_to"] = by_num[n]
            rewired += 1
            continue

        name = f"IxN{n}" if f"IxN{n}" not in taken else f"mirror_target_{n}"
        while name in taken:
            name += "_"
        profile = fp.get("layer_1_profile_name")
        entry = {"name": name, "choice": "front_panel_port",
                 "front_panel_port": {"front_panel_port": n}}
        if profile:
            entry["front_panel_port"]["layer_1_profile_name"] = profile
        for k in ("channel", "num_channels"):
            if k in mt:
                entry["front_panel_port"][k] = mt[k]
        taken.add(name)
        by_num[n] = name
        added.append((name, n, profile))
        fp["mirror_to"] = name
        rewired += 1
        fps.append(entry)      # appended: source stays before target (-349)

    if rewired:
        rep.changed(f"rewrote {rewired} mirror_to object(s) to port-name "
                    f"references")
    for name, n, profile in added:
        rep.changed(f"declared mirror target '{name}' (front panel port {n}, "
                    f"l1 profile '{profile}' inherited from the mirror source)")


def migrate_config(cfg: dict, rep: Report) -> dict:
    if not isinstance(cfg, dict):
        raise MigrationError("top level of the config is not a JSON object")
    out = copy.deepcopy(cfg)
    _migrate_mirror_to(out, rep)
    conns = out.get("connections")
    if conns is None:
        rep.problem("no 'connections' key -- nothing to migrate")
        return out
    out["connections"] = [_migrate_connection(c, i, rep)
                          for i, c in enumerate(conns)]
    _hoist_routing_out_of_protocols(out, rep)
    return out


# ------------------------------------------------------------- .http handling
_HTTP_FIRST_LINE = re.compile(r"^[A-Z]+\s+\S+\s+HTTP/\d", re.M)


def looks_like_http(text: str) -> bool:
    return bool(_HTTP_FIRST_LINE.match(text.lstrip()))


def split_http(text: str) -> tuple[str, str, str]:
    """Split a .http export into (head, JSON body, trailing requests).

    Real exports open with blank lines or a `###` separator, and often hold
    several requests; only the first is the config POST.
    """
    lines = text.splitlines(keepends=True)
    start = 0
    while start < len(lines) and (not lines[start].strip()
                                  or lines[start].lstrip().startswith("###")):
        start += 1
    if start >= len(lines):
        raise MigrationError("`.http` file has no request line")

    body_at = None
    for i in range(start + 1, len(lines)):
        if not lines[i].strip():
            body_at = i + 1
            break
    if body_at is None:
        raise MigrationError("`.http` file has no blank line separating headers "
                             "from the body")

    end = len(lines)
    for i in range(body_at, len(lines)):
        stripped = lines[i].lstrip()
        if stripped.startswith("###") or _HTTP_FIRST_LINE.match(stripped):
            end = i
            break
    return "".join(lines[:body_at]), "".join(lines[body_at:end]), "".join(lines[end:])


# ------------------------------------------------------- compact aligned JSON
_WIDTH = 150        # a one-line form longer than this is expanded instead
_DEPTH = 3          # so is anything nested deeper than this
_SIMILARITY = 0.3   # least key overlap for sibling objects to share columns


def _lit(v) -> str:
    return json.dumps(v, ensure_ascii=False)


def _nesting(v) -> int:
    """How many container levels deep a value goes."""
    if isinstance(v, dict):
        return 1 + max([_nesting(x) for x in v.values()] or [0])
    if isinstance(v, list):
        return 1 + max([_nesting(x) for x in v] or [0])
    return 0


def _flat(v) -> str:
    """One-line form, no padding just inside the brackets."""
    if isinstance(v, dict):
        return "{" + ", ".join(_lit(k) + ": " + _flat(x)
                               for k, x in v.items()) + "}"
    if isinstance(v, list):
        return "[" + ", ".join(_flat(x) for x in v) + "]"
    return _lit(v)


def _table(values, col):
    """Sibling objects as column-aligned rows; cells align by position."""
    if len(values) < 2 or not all(isinstance(v, dict) and v for v in values):
        return None
    keys = [set(v) for v in values]
    union = set().union(*keys)
    if len(set(keys[0]).intersection(*keys)) / len(union) < _SIMILARITY:
        return None

    rows = [[_lit(k) + ": " + _flat(x) for k, x in v.items()] for v in values]
    width = [0] * max(len(r) for r in rows)
    for r in rows:
        for i, cell in enumerate(r):
            width[i] = max(width[i], len(cell))

    out = []
    for r in rows:
        s = ""
        for i, cell in enumerate(r):
            s += cell
            if i != len(r) - 1:                 # comma first, then the padding
                s += "," + " " * (width[i] - len(cell) + 1)
        out.append(s)
    span = max(len(s) for s in out)
    if col + span + 2 > _WIDTH:
        return None
    return ["{" + s.ljust(span) + "}" for s in out]


def _fmt(v, col: int, ind: str) -> str:
    """Render v, expanding only where it will not fit or reads badly inline."""
    rows_of_objects = (isinstance(v, list) and len(v) > 1
                       and all(isinstance(x, dict) for x in v))
    if not rows_of_objects:
        flat = _flat(v)
        if col + len(flat) <= _WIDTH and _nesting(v) <= _DEPTH:
            return flat

    step = ind + "    "
    if isinstance(v, dict):
        pad = max(len(_lit(k)) for k in v)
        cells = _table(list(v.values()), len(step) + pad + 2)
        body = [step + _lit(k).ljust(pad) + ": "
                + (cells[i] if cells else _fmt(x, len(step) + pad + 2, step))
                for i, (k, x) in enumerate(v.items())]
        return "{\n" + ",\n".join(body) + "\n" + ind + "}"
    if isinstance(v, list):
        cells = _table(v, len(step))
        body = [step + (cells[i] if cells else _fmt(x, len(step), step))
                for i, x in enumerate(v)]
        return "[\n" + ",\n".join(body) + "\n" + ind + "]"
    return _flat(v)


def dumps(cfg: dict) -> str:
    """Compact, column-aligned JSON. Formatting only: json.loads round-trips."""
    return _fmt(cfg, 0, "")


# ------------------------------------------------------------------ self-test
def _selftest() -> int:
    old_double = {
        "connections": [{
            "name": "vxlan_over_vxlan",
            "functions": [
                {"choice": "connect_vlan_vxlan", "connect_vlan_vxlan": {
                    "vxlan_endpoint_settings": {
                        "vni": {"choice": "vni", "vni": 100}, "udp_src_port": 1234},
                    "vlan_endpoint_settings": {
                        "outgoing_vxlan_header": {
                            "src_ip": {"choice": "ipv4", "ipv4": "221.1.0.0"}}}}},
                {"choice": "connect_vlan_vxlan", "connect_vlan_vxlan": {
                    "vxlan_endpoint_settings": {
                        "vni": {"choice": "vni", "vni": 200}, "udp_src_port": 1234},
                    "vlan_endpoint_settings": {
                        "outgoing_vxlan_header": {
                            "src_ip": {"choice": "ipv4", "ipv4": "121.1.0.0"}}}}},
            ],
            "endpoints": [
                {"choice": "front_panel", "front_panel": {"port_name": "client1"},
                 "tags": ["vxlan", "function_0"]},
                {"choice": "front_panel", "front_panel": {"port_name": "client1"},
                 "tags": ["vxlan", "function_1"]},
                {"choice": "front_panel",
                 "front_panel": {"port_name": "client5",
                                 "vlan": {"choice": "vlan", "vlan": 100}},
                 "tags": ["vlan", "function_0"]},
                {"choice": "front_panel",
                 "front_panel": {"port_name": "client5",
                                 "vlan": {"choice": "vlan", "vlan": 200}},
                 "tags": ["vlan", "function_1"]},
            ]}]}

    old_qinq = {
        "connections": [{
            "name": "Q-in-Q ARP Bypass",
            "functions": [{"choice": "connect_arp", "connect_arp": {}}],
            "endpoints": [
                {"choice": "front_panel",
                 "front_panel": {"port_name": "cloud_port_1", "vlan": {
                     "choice": "vlan_double", "vlan_double": {
                         "outer": {"start": 100, "count": 1},
                         "inner": {"start": 200, "count": 1}}}},
                 "tags": ["vlan"]},
                {"choice": "front_panel",
                 "front_panel": {"port_name": "dut_port_1", "vlan": {
                     "choice": "vlan_double", "vlan_double": {
                         "outer": {"start": 100, "count": 1},
                         "inner": {"start": 200, "count": 1}}}},
                 "tags": ["vlan"]},
            ]}]}

    failures = []

    def check(label, got, want):
        if got != want:
            failures.append(f"{label}\n     got:  {got}\n     want: {want}")

    rep = Report()
    got = migrate_config(old_double, rep)["connections"][0]
    check("double-encap endpoints", got["endpoints"], [
        {"port_name": "client5", "tags": ["vlan", "vlan"]},
        {"port_name": "client1", "tags": ["vxlan", "vxlan"]}])
    f0 = got["functions"][0]["connect_vlan_vxlan"]
    check("header moved to tunnel side",
          "outgoing_vxlan_header" in f0["vxlan_endpoint_settings"], True)
    check("header gone from vlan side",
          "outgoing_vxlan_header" in f0["vlan_endpoint_settings"], False)
    check("udp_src_port folded into header",
          f0["vxlan_endpoint_settings"]["outgoing_vxlan_header"]["udp_src_port"],
          1234)
    check("udp_src_port off the settings block",
          "udp_src_port" in f0["vxlan_endpoint_settings"], False)
    check("function VLAN", f0["vlan_endpoint_settings"]["vlan"],
          {"choice": "vlan", "vlan": 100})
    check("second function VLAN",
          got["functions"][1]["connect_vlan_vxlan"]["vlan_endpoint_settings"]["vlan"],
          {"choice": "vlan", "vlan": 200})

    rep2 = Report()
    got2 = migrate_config(old_qinq, rep2)["connections"][0]
    check("vlan_double -> 2 functions", len(got2["functions"]), 2)
    check("qinq endpoints", got2["endpoints"], [
        {"port_name": "cloud_port_1", "tags": ["vlan", "vlan"]},
        {"port_name": "dut_port_1", "tags": ["vlan", "vlan"]}])
    check("outer VLAN on functions[0] port1",
          got2["functions"][0]["connect_arp"]["vlan_endpoint_settings_port1"]["vlan"],
          {"choice": "vlan", "vlan": 100})
    check("inner VLAN on functions[1] port2",
          got2["functions"][1]["connect_arp"]["vlan_endpoint_settings_port2"]["vlan"],
          {"choice": "vlan", "vlan": 200})

    rep3 = Report()
    migrate_config({"connections": [{
        "name": "x",
        "functions": [{"choice": "connect_arp", "connect_arp": {}}],
        "endpoints": [{"choice": "front_panel", "front_panel": {
            "port_name": "p1", "vlan": {"choice": "all_vlans"}}, "tags": ["vlan"]}]}]},
        rep3)
    check("all_vlans reported as unmappable",
          any("all_vlans" in p for p in rep3.problems), True)

    rep4 = Report()
    wide = migrate_config({"connections": [{
        "name": "x",
        "functions": [{"choice": "connect_arp", "connect_arp": {}}],
        "endpoints": [{"choice": "front_panel", "front_panel": {
            "port_name": "p1",
            "vlan": {"choice": "vlan_range",
                     "vlan_range": {"start": 10, "count": 5, "step": 2}}},
            "tags": ["vlan"]}]}]}, rep4)
    check("real sweep stays a range",
          wide["connections"][0]["functions"][0]["connect_arp"]
          ["vlan_endpoint_settings_port1"]["vlan"],
          {"choice": "vlan_range",
           "vlan_range": {"start": 10, "count": 5, "step": 2}})

    if failures:
        print("SELFTEST FAILED:", file=sys.stderr)
        for f in failures:
            print("  x " + f, file=sys.stderr)
        return 1
    print("selftest: all checks passed")
    return 0


# ------------------------------------------------------------------------ cli
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Migrate a UHD config from the old API schema to the new one.")
    ap.add_argument("input", nargs="?", help=".json or .http file")
    ap.add_argument("-o", "--output", help="output path (default: <input>.new.<ext>)")
    ap.add_argument("--stdout", action="store_true", help="print, write nothing")
    ap.add_argument("--diff", action="store_true", help="show a unified diff only")
    ap.add_argument("--force", action="store_true",
                    help="exit 0 even if something could not be mapped")
    ap.add_argument("--selftest", action="store_true", help="run built-in checks")
    args = ap.parse_args(argv)

    if args.selftest:
        return _selftest()
    if not args.input:
        ap.error("an input file is required (or use --selftest)")

    try:
        raw = open(args.input, encoding="utf-8-sig").read()
    except OSError as e:
        print(f"cannot read {args.input}: {e}", file=sys.stderr)
        return 2

    rep = Report()
    try:
        is_http = looks_like_http(raw) or args.input.lower().endswith(".http")
        if is_http:
            head, body, tail = split_http(raw)
            cfg = json.loads(body)
            new_text = head + dumps(migrate_config(cfg, rep)) + "\n"
            if tail.strip():
                rep.changed("trailing request(s) after the config POST kept "
                            "verbatim")
                new_text += tail
        else:
            cfg = json.loads(raw)
            new_text = dumps(migrate_config(cfg, rep)) + "\n"
    except json.JSONDecodeError as e:
        print(f"{args.input}: not valid JSON: {e}", file=sys.stderr)
        return 2
    except MigrationError as e:
        print(f"{args.input}: {e}", file=sys.stderr)
        return 2

    print(rep.render(), file=sys.stderr)

    if args.diff:
        for line in difflib.unified_diff(
                raw.splitlines(), new_text.splitlines(),
                fromfile=f"{args.input} (old schema)",
                tofile=f"{args.input} (new schema)", lineterm=""):
            print(line)
    elif args.stdout:
        print(new_text, end="")
    else:
        out = args.output
        if not out:
            base = args.input
            for ext in (".http", ".json"):
                if base.lower().endswith(ext):
                    out = base[: -len(ext)] + ".new" + ext
                    break
            else:
                out = base + ".new"
        with open(out, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(new_text)
        print(f"\nwrote {out}", file=sys.stderr)

    if rep.problems and not args.force:
        print(f"\n{len(rep.problems)} item(s) could not be mapped -- see above. "
              f"Re-run with --force to accept the output anyway.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())