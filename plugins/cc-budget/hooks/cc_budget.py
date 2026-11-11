#!/usr/bin/env python3
"""cc-budget: weekly token budgets per project and subagent type for Claude Code.

Usage:
  cc_budget.py hook                 read a hook event on stdin, answer on stdout
  cc_budget.py status [folder]      usage against budgets for the project at folder (default: cwd)
  cc_budget.py status --line        one line for a status line; reads its JSON on stdin
  cc_budget.py selfcheck            run the self-check in a temporary folder

Usage is read from Claude Code transcripts (~/.claude/projects) over a rolling 7 days, and
weighted: input + 5 x output + 1.25 x cache writes + 0.1 x cache reads.
"""

import glob
import json
import os
import re
import sys
import tempfile
import time
from datetime import datetime

WEEK = 7 * 24 * 3600
WARN = 0.8
CONFIG = os.path.join(".claude", "cc-budget.json")


def projects_root():
    return os.environ.get("CC_BUDGET_PROJECTS") or os.path.expanduser("~/.claude/projects")


def data_dir():
    path = (os.environ.get("CC_BUDGET_DATA") or os.environ.get("CLAUDE_PLUGIN_DATA")
            or os.path.expanduser("~/.claude/plugins/data/cc-budget"))
    os.makedirs(path, exist_ok=True)
    return path


def encode(path):
    """Claude Code's transcript folder name for a path; '*' is kept for globbing."""
    return re.sub(r"[^A-Za-z0-9*]", "-", path)


# ---------------------------------------------------------------- config

def find_config(start):
    """(project folder, config dict) for the nearest .claude/cc-budget.json above start, or None."""
    folder = os.path.abspath(start or ".")
    while True:
        path = os.path.join(folder, CONFIG)
        if os.path.isfile(path):
            return folder, load_config(path)
        parent = os.path.dirname(folder)
        if parent == folder:
            return None
        folder = parent


def load_config(path):
    with open(path) as handle:
        raw = json.load(handle)
    if not isinstance(raw, dict):
        raise ValueError(f"{path}: expected a JSON object")
    week = raw.get("week")
    include = raw.get("include", [])
    agents = raw.get("agents", {})
    if week is not None and not isinstance(week, (int, float)):
        raise ValueError(f"{path}: 'week' must be a number")
    if not isinstance(include, list) or not all(isinstance(i, str) for i in include):
        raise ValueError(f"{path}: 'include' must be a list of strings")
    if not isinstance(agents, dict) or not all(isinstance(v, (int, float)) for v in agents.values()):
        raise ValueError(f"{path}: 'agents' must map agent types to numbers")
    return {"week": week, "include": include, "agents": agents}


# ---------------------------------------------------------------- tally

def transcript_dirs(project, include):
    root = projects_root()
    patterns = [encode(project)]
    for pattern in include:
        patterns.append(encode(os.path.normpath(os.path.join(project, pattern))))
    dirs = set()
    for pattern in patterns:
        for base in (pattern, pattern + "--claude-worktrees-*"):
            dirs.update(d for d in glob.glob(os.path.join(root, base)) if os.path.isdir(d))
    return sorted(dirs)


def weight(usage):
    num = lambda key: usage.get(key) if isinstance(usage.get(key), (int, float)) else 0
    return (num("input_tokens") + 5 * num("output_tokens")
            + 1.25 * num("cache_creation_input_tokens") + 0.1 * num("cache_read_input_tokens"))


def parse_time(stamp):
    # "2026-11-11T12:02:18.528Z"; Python before 3.11 rejects the trailing Z.
    return datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp()


def read_new(path, entry):
    """Add messages written after entry['offset'] to entry['msgs']; stop at an unfinished line."""
    with open(path, "rb") as handle:
        handle.seek(entry["offset"])
        for line in handle:
            if not line.endswith(b"\n"):
                break
            entry["offset"] += len(line)
            try:
                record = json.loads(line)
            except ValueError:
                continue
            message = record.get("message") if isinstance(record, dict) else None
            if record.get("type") != "assistant" or not isinstance(message, dict):
                continue
            usage, mid, stamp = message.get("usage"), message.get("id"), record.get("timestamp")
            if not isinstance(usage, dict) or not isinstance(mid, str) or not isinstance(stamp, str):
                continue
            if message.get("model") == "<synthetic>":
                continue
            try:
                entry["msgs"][mid] = [parse_time(stamp), weight(usage)]
            except ValueError:
                continue


def agent_type(path):
    try:
        with open(path[: -len(".jsonl")] + ".meta.json") as handle:
            value = json.load(handle).get("agentType")
        return value if isinstance(value, str) else "unknown"
    except (OSError, ValueError, AttributeError):
        return "unknown"


def tally(project, config, now=None):
    """{'total': weighted tokens, 'agents': {type: weighted tokens}} over the last 7 days."""
    now = now or time.time()
    since = now - WEEK
    cache_path = os.path.join(data_dir(), "cache.json")
    try:
        with open(cache_path) as handle:
            cache = json.load(handle)
    except (OSError, ValueError):
        cache = {}

    total, agents, changed = 0.0, {}, False
    for folder in transcript_dirs(project, config["include"]):
        files = glob.glob(os.path.join(folder, "*.jsonl")) + glob.glob(os.path.join(folder, "*", "subagents", "*.jsonl"))
        for path in files:
            try:
                stat = os.stat(path)
            except OSError:
                continue
            if stat.st_mtime < since:
                continue
            entry = cache.get(path)
            if entry is None or entry.get("offset", 0) > stat.st_size:  # new or rewritten file
                entry = {"offset": 0, "msgs": {},
                         "agent": agent_type(path) if os.sep + "subagents" + os.sep in path else None}
                cache[path] = entry
                changed = True
            if stat.st_size > entry["offset"]:
                read_new(path, entry)
                changed = True
            stale = [mid for mid, (stamp, _) in entry["msgs"].items() if stamp < since]
            for mid in stale:
                del entry["msgs"][mid]
            changed = changed or bool(stale)
            used = sum(w for stamp, w in entry["msgs"].values() if stamp <= now)
            total += used
            if entry["agent"]:
                agents[entry["agent"]] = agents.get(entry["agent"], 0.0) + used

    if changed:
        for path in [p for p in cache if not os.path.exists(p)]:
            del cache[path]
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(cache_path), suffix=".tmp")
        with os.fdopen(fd, "w") as handle:
            json.dump(cache, handle)
        os.replace(tmp, cache_path)
    return {"total": total, "agents": agents}


# ---------------------------------------------------------------- budgets

def short(n):
    for size, unit in ((1e6, "M"), (1e3, "k")):
        if n >= size:
            return f"{n / size:.1f}".rstrip("0").rstrip(".") + unit
    return str(int(n))


def budgets(project, config, usage):
    """List of (label, used, budget, ratio), the project first, then agent types."""
    rows = []
    if config["week"]:
        rows.append(("project", usage["total"], config["week"], usage["total"] / config["week"]))
    for name, limit in sorted(config["agents"].items()):
        used = usage["agents"].get(name, 0.0)
        rows.append((f"agent {name}", used, limit, used / limit if limit else 0.0))
    return rows


def describe(label, used, limit, ratio):
    return f"{label} {short(used)}/{short(limit)} ({ratio:.0%})"


def first_notice(session, label, threshold):
    """True once per session per (budget, threshold)."""
    folder = os.path.join(data_dir(), "notified")
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, re.sub(r"[^A-Za-z0-9-]", "_", session or "none"))
    try:
        with open(path) as handle:
            seen = set(json.load(handle))
    except (OSError, ValueError):
        seen = set()
    key = f"{label}@{threshold}"
    if key in seen:
        return False
    seen.add(key)
    with open(path, "w") as handle:
        json.dump(sorted(seen), handle)
    return True


def handle_event(event, now=None):
    """The hook's JSON answer for one event, or None to stay silent."""
    found = find_config(event.get("cwd"))
    if not found:
        return None
    project, config = found
    rows = budgets(project, config, tally(project, config, now))
    name = event.get("hook_event_name")
    override = os.environ.get("CC_BUDGET_OVERRIDE") == "1"
    how = f"Raise the budget in {os.path.join(project, CONFIG)}, or restart Claude Code with CC_BUDGET_OVERRIDE=1."

    if name in ("SessionStart", "UserPromptSubmit"):
        notes = []
        for label, used, limit, ratio in rows:
            threshold = 100 if ratio >= 1 else 80 if ratio >= WARN else None
            if threshold and first_notice(event.get("session_id"), label, threshold):
                state = "used up: tool calls are blocked" if threshold == 100 and not override else f"at {ratio:.0%}"
                notes.append(f"cc-budget: weekly budget {state}, {describe(label, used, limit, ratio)}.")
        if not notes:
            return None
        if any("blocked" in n for n in notes):
            notes.append(how)
        text = " ".join(notes)
        return {"systemMessage": text,
                "hookSpecificOutput": {"hookEventName": name, "additionalContext": text}}

    if name == "PreToolUse" and not override:
        over = {label: (used, limit, ratio) for label, used, limit, ratio in rows if ratio >= 1}
        hit = None
        if "project" in over:
            hit = "project"
        elif event.get("agent_type") and f"agent {event['agent_type']}" in over:
            hit = f"agent {event['agent_type']}"
        elif event.get("tool_name") == "Agent":
            wanted = (event.get("tool_input") or {}).get("subagent_type") or "general-purpose"
            if f"agent {wanted}" in over:
                hit = f"agent {wanted}"
        if hit:
            reason = f"cc-budget: weekly budget used up, {describe(hit, *over[hit])}. {how}"
            return {"hookSpecificOutput": {"hookEventName": "PreToolUse",
                                           "permissionDecision": "deny",
                                           "permissionDecisionReason": reason}}
    return None


# ---------------------------------------------------------------- commands

def cmd_hook():
    try:
        answer = handle_event(json.load(sys.stdin))
    except Exception as error:  # fail open: never block work because the mod broke
        print(f"cc-budget: {error}", file=sys.stderr)
        return 0
    if answer:
        print(json.dumps(answer))
    return 0


def cmd_status(args):
    if "--line" in args:
        try:
            found = find_config(json.load(sys.stdin).get("cwd"))
            if found:
                rows = budgets(found[0], found[1], tally(*found))
                if rows:
                    worst = max(rows, key=lambda r: r[3])
                    label = "budget" if worst[0] == "project" else worst[0]
                    print(f"{label} {worst[3]:.0%} ({short(worst[1])}/{short(worst[2])})")
        except Exception:
            pass
        return 0
    folder = next((a for a in args if not a.startswith("-")), os.getcwd())
    found = find_config(folder)
    if not found:
        print(f"No {CONFIG} found at or above {os.path.abspath(folder)}.")
        return 1
    project, config = found
    usage = tally(project, config)
    print(f"{project} (last 7 days, weighted tokens)")
    print(f"  total {short(usage['total'])}")
    for row in budgets(project, config, usage):
        print("  " + describe(*row))
    for name, used in sorted(usage["agents"].items()):
        if name not in config["agents"] and used:
            print(f"  agent {name} {short(used)} (no budget)")
    return 0


# ---------------------------------------------------------------- self-check

def selfcheck():
    now = time.time()
    stamp = lambda ago: time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(now - ago))

    def line(mid, ago, inp=0, out=0, cw=0, cr=0, model="claude-test"):
        return json.dumps({"type": "assistant", "timestamp": stamp(ago), "message": {
            "id": mid, "model": model, "usage": {"input_tokens": inp, "output_tokens": out,
                                                 "cache_creation_input_tokens": cw,
                                                 "cache_read_input_tokens": cr}}}) + "\n"

    with tempfile.TemporaryDirectory() as tmp:
        tmp = os.path.realpath(tmp)
        os.environ["CC_BUDGET_PROJECTS"] = root = os.path.join(tmp, "projects")
        os.environ["CC_BUDGET_DATA"] = os.path.join(tmp, "data")
        os.environ.pop("CC_BUDGET_OVERRIDE", None)
        project = os.path.join(tmp, "code", "my.app")
        os.makedirs(os.path.join(project, ".claude"))
        os.makedirs(os.path.join(project, "src"))

        def write(rel, text, mode="w"):
            path = os.path.join(root, rel)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, mode) as handle:
                handle.write(text)

        def config(**values):
            with open(os.path.join(project, CONFIG), "w") as handle:
                json.dump(values, handle)

        def event(name, **extra):
            return handle_event({"hook_event_name": name, "cwd": os.path.join(project, "src"),
                                 "session_id": "s1", **extra}, now)

        main = encode(project)
        assert main.endswith("-code-my-app"), main
        # Main session: one message in two blocks (counted once), a cache-heavy one,
        # one older than 7 days, a synthetic one, a broken line and an unfinished last line.
        write(f"{main}/s1.jsonl",
              line("m1", 60, inp=100, out=10) + line("m1", 60, inp=100, out=10)
              + line("m2", 3600, cw=800, cr=10000)
              + line("old", WEEK + 60, inp=99999)
              + line("syn", 60, inp=99999, model="<synthetic>")
              + "not json\n" + line("m3", 30, inp=5000)[:-20])
        # m1 = 100 + 50 = 150; m2 = 1000 + 1000 = 2000
        write(f"{main}--claude-worktrees-feature/s2.jsonl", line("w1", 60, inp=300))
        write(f"{encode(os.path.join(tmp, 'code', 'my.app-docs'))}/s3.jsonl", line("i1", 60, inp=400))
        write(f"{main}/s1/subagents/agent-a1.jsonl", line("a1", 60, out=200))  # 1000
        write(f"{main}/s1/subagents/agent-a1.meta.json", json.dumps({"agentType": "Explore"}))
        write(f"{encode(os.path.join(tmp, 'code', 'other'))}/x.jsonl", line("x1", 60, inp=7777))

        # AC1.5: no config, no budget.
        assert handle_event({"hook_event_name": "PreToolUse", "cwd": project}, now) is None

        # AC1.2-1.4, AC4.2: tally with worktree, subagent, dedupe, window; include off.
        config(week=10000)
        usage = tally(*find_config(project), now=now)
        assert usage["total"] == 150 + 2000 + 300 + 1000, usage
        assert usage["agents"] == {"Explore": 1000}, usage
        config(week=10000, include=["../my.app-docs"])
        assert tally(*find_config(project), now=now)["total"] == 3850

        # Incremental: finishing the partial line adds m3; a re-run reads nothing new.
        write(f"{main}/s1.jsonl", line("m3", 30, inp=5000)[-20:], mode="a")
        assert tally(*find_config(project), now=now)["total"] == 8850
        assert tally(*find_config(project), now=now)["total"] == 8850

        # AC2.1-2.2: 88% warns once per session.
        answer = event("SessionStart")
        assert answer and "budget at 8" in answer["systemMessage"], answer  # 88.5%
        assert answer["hookSpecificOutput"]["additionalContext"] == answer["systemMessage"]
        assert event("UserPromptSubmit") is None
        assert event("PreToolUse", tool_name="Bash") is None

        # AC3.1-3.3: block at 100%, with a new notice; raising the budget unblocks.
        config(week=8000, include=["../my.app-docs"])
        answer = event("PreToolUse", tool_name="Bash")
        decision = answer["hookSpecificOutput"]
        assert decision["permissionDecision"] == "deny" and "CC_BUDGET_OVERRIDE" in decision["permissionDecisionReason"]
        assert "blocked" in event("UserPromptSubmit")["systemMessage"]
        assert "decision" not in (event("UserPromptSubmit", session_id="s2") or {})  # prompts never blocked
        config(week=20000, include=["../my.app-docs"])
        assert event("PreToolUse", tool_name="Bash") is None

        # AC3.4: override skips the block.
        config(week=1000)
        os.environ["CC_BUDGET_OVERRIDE"] = "1"
        assert event("PreToolUse", tool_name="Bash") is None
        del os.environ["CC_BUDGET_OVERRIDE"]

        # AC4.1, AC4.3: agent budget blocks spawning and calls inside, not the rest.
        config(week=20000, agents={"Explore": 500, "code-reviewer": 500})
        assert event("PreToolUse", tool_name="Agent", tool_input={"subagent_type": "Explore"})
        assert event("PreToolUse", tool_name="Read", agent_type="Explore")
        assert event("PreToolUse", tool_name="Agent", tool_input={"subagent_type": "code-reviewer"}) is None
        assert event("PreToolUse", tool_name="Read") is None

        # NF2: bad config fails open through the hook entry point.
        with open(os.path.join(project, CONFIG), "w") as handle:
            handle.write("{broken")
        stdin, stdout, stderr = sys.stdin, sys.stdout, sys.stderr
        import io
        sys.stdin = io.StringIO(json.dumps({"hook_event_name": "PreToolUse", "cwd": project}))
        sys.stdout, sys.stderr = io.StringIO(), io.StringIO()
        try:
            code = cmd_hook()
            out, err = sys.stdout.getvalue(), sys.stderr.getvalue()
        finally:
            sys.stdin, sys.stdout, sys.stderr = stdin, stdout, stderr
        assert code == 0 and out == "" and err.startswith("cc-budget:"), (code, out, err)

    print("cc-budget self-check passed")
    return 0


def main(argv):
    command = argv[1] if len(argv) > 1 else ""
    if command == "hook":
        return cmd_hook()
    if command == "status":
        return cmd_status(argv[2:])
    if command == "selfcheck":
        return selfcheck()
    print(__doc__.strip())
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
