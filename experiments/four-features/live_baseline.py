#!/usr/bin/env python3
"""Read-only operational baseline for the four-feature validation.

Reads the deployment's SQLite state and DSH session logs, and writes aggregate metrics only: no message text, no
participant names, no credentials. The numbers describe what this deployment actually did; they are an observational
baseline, not a controlled benchmark.

Usage:
    python3 experiments/four-features/live_baseline.py [--state-dir DIR] [--sessions DIR] [--out FILE]
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sqlite3
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_STATE = Path.home() / '.dsh' / 'state' / 'superagent'
DEFAULT_SESSIONS = Path.home() / '.dsh' / 'sessions'


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None


def seconds_between(start: str | None, end: str | None) -> float | None:
    a, b = parse_time(start), parse_time(end)
    return round((b - a).total_seconds(), 1) if a and b and b >= a else None


def percentile(values: list[float], p: float) -> float | None:
    """Nearest-rank percentile; small samples are reported with n and min/max instead of a confidence claim."""
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, math.ceil(p / 100 * len(ordered)))
    return ordered[rank - 1]


def summary(values: list[float]) -> dict:
    return {'n': len(values), 'min': min(values) if values else None, 'p50': percentile(values, 50),
            'p95': percentile(values, 95), 'max': max(values) if values else None}


def session_dir_name(path: str) -> str:
    return '--' + path.lstrip('/').replace('/', '-') + '--'


def session_usage(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        text = subprocess.run(['zstd', '-dc', str(path)], capture_output=True, text=True, check=True, timeout=120).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    totals = {'input_tokens': 0, 'output_tokens': 0, 'cache_read_tokens': 0, 'cache_write_tokens': 0, 'total_tokens': 0, 'messages': 0}
    turns = set()
    for line in text.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get('type') != 'assistant/message':
            continue
        data = event.get('data') or {}
        usage = data.get('usage') or {}
        if not usage:
            continue
        totals['messages'] += 1
        totals['input_tokens'] += int(usage.get('inputTokens') or 0)
        totals['output_tokens'] += int(usage.get('outputTokens') or 0)
        totals['cache_read_tokens'] += int(usage.get('cacheReadTokens') or 0)
        totals['cache_write_tokens'] += int(usage.get('cacheWriteTokens') or 0)
        totals['total_tokens'] += int(usage.get('totalTokens') or 0)
        if data.get('turn') is not None:
            turns.add(data.get('turn'))
    totals['turns'] = len(turns)
    return totals


def read_store(path: Path) -> tuple[list[dict], list[dict], list[dict], list[dict], dict]:
    db = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    try:
        triggers = [json.loads(row['value']) for row in db.execute('select value from "trigger"')]
        decisions = [json.loads(row['value']) for row in db.execute('select value from decision')]
        tickets = [json.loads(row['value']) for row in db.execute('select value from ticket')]
        dispositions = [json.loads(row['value']) for row in db.execute('select value from disposition')]
        tables = [row[0] for row in db.execute("select name from sqlite_master where type='table'")]
        return triggers, decisions, tickets, dispositions, {'tables': tables}
    finally:
        db.close()


def build(state_dir: Path, sessions_dir: Path) -> dict:
    db_path = state_dir / 'orchestrator.sqlite'
    triggers, decisions, tickets, dispositions, schema = read_store(db_path)
    by_trigger = {}
    by_decision = {}
    for decision in decisions:
        by_decision[decision.get('id')] = decision
        for trigger_id in decision.get('triggerIds') or []:
            by_trigger[trigger_id] = decision

    tickets_with_sources = 0
    ticket_rows = []
    assignment_durations, ticket_durations, completed_ticket_durations = [], [], []
    worker_usage_total = {'input_tokens': 0, 'output_tokens': 0, 'cache_read_tokens': 0, 'cache_write_tokens': 0, 'total_tokens': 0, 'messages': 0}
    recovered = []
    for ticket in tickets:
        execution = ticket.get('execution') or {}
        assignment_rows = []
        for assignment in ticket.get('assignments') or []:
            duration = seconds_between(assignment.get('startedAt'), assignment.get('endedAt'))
            if duration is not None:
                assignment_durations.append(duration)
            assignment_rows.append({'state': assignment.get('state'), 'startedAt': assignment.get('startedAt'),
                                    'endedAt': assignment.get('endedAt'), 'duration_s': duration,
                                    'report': (assignment.get('report') or {}).get('state')})
        duration = seconds_between(ticket.get('createdAt'), (ticket.get('ended') or {}).get('at'))
        if duration is not None:
            ticket_durations.append(duration)
            if (ticket.get('ended') or {}).get('outcome') != 'stopped':
                completed_ticket_durations.append(duration)
        recovery = any(input_item.get('kind') == 'text' and 'host restarted' in (input_item.get('text') or '')
                       for input_item in ticket.get('inputs') or [])
        if recovery:
            recovered.append({'ticket_id': ticket.get('id'), 'assignments': assignment_rows})
        channels = ticket.get('channels') or []
        if len({channel.get('source') for channel in channels if channel.get('source')}) > 1:
            tickets_with_sources += 1
        usage = None
        directory = execution.get('directory')
        if directory:
            worker = sessions_dir / session_dir_name(directory) / f"worker-{ticket.get('id')}" / 'session.v4.jsonl.zstd'
            usage = session_usage(worker)
            if usage:
                for key in worker_usage_total:
                    worker_usage_total[key] += usage[key]
        ticket_rows.append({'ticket_id': ticket.get('id'), 'createdAt': ticket.get('createdAt'),
                            'ended': (ticket.get('ended') or {}).get('outcome'), 'assignments': assignment_rows,
                            'inputs': len(ticket.get('inputs') or []), 'recovery_note': recovery,
                            'worker_usage': usage})

    human_triggers = [trigger for trigger in triggers if trigger.get('human')]
    unaddressed = [trigger for trigger in human_triggers if trigger.get('addressed') is None
                   and (trigger.get('meta') or {}).get('mentioned') is False]
    # A GitHub comment with no mention is also unaddressed; count it separately rather than mixing sources.
    github_unaddressed = [trigger for trigger in human_triggers if trigger.get('source') == 'github' and trigger.get('addressed') is None]
    fanout = [item for item in dispositions if item.get('fanout')]
    decisions_of_unaddressed = [by_trigger.get(trigger.get('id')) for trigger in unaddressed]
    false_tickets = [decision for decision in decisions_of_unaddressed if decision and decision.get('kind') == 'accept']
    no_mention_decisions = [decision for decision in decisions_of_unaddressed if decision and decision.get('kind') == 'ignore'
                            and any(reason.get('code') == 'no_mention' for reason in decision.get('reason') or [])]

    router_usage = {'input_tokens': 0, 'output_tokens': 0, 'cache_read_tokens': 0, 'cache_write_tokens': 0,
                    'total_tokens': 0, 'messages': 0, 'sessions': 0}
    router_root = sessions_dir / session_dir_name(str(state_dir))
    if router_root.exists():
        for session in sorted(router_root.glob('orchestrator-*/session.v4.jsonl.zstd')):
            usage = session_usage(session)
            if usage:
                router_usage['sessions'] += 1
                for key in ('input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'total_tokens', 'messages'):
                    router_usage[key] += usage[key]

    by_kind = {}
    for decision in decisions:
        by_kind[decision.get('kind')] = by_kind.get(decision.get('kind'), 0) + 1
    by_source = {}
    for trigger in triggers:
        by_source[trigger.get('source')] = by_source.get(trigger.get('source'), 0) + 1

    return {
        'generated_at': datetime.now().astimezone().isoformat(timespec='seconds'),
        'read_only': True,
        'state_db': '~/.dsh/state/superagent/orchestrator.sqlite',
        'state_db_mtime': datetime.fromtimestamp(db_path.stat().st_mtime).astimezone().isoformat(timespec='seconds') if db_path.exists() else None,
        'tables': schema['tables'],
        'totals': {'triggers': len(triggers), 'human_triggers': len(human_triggers), 'decisions': len(decisions),
                   'tickets': len(tickets), 'dispositions': len(dispositions), 'tickets_with_several_channel_sources': tickets_with_sources,
                   'decision_kinds': by_kind, 'trigger_sources': by_source},
        'continuity': {
            'thread_followups_fanned_out': len(fanout),
            'triggers_on_several_threads': sum(1 for trigger in triggers if len(trigger.get('threads') or []) > 1),
            'unaddressed_human_triggers': len(unaddressed),
            'unaddressed_with_new_ticket': len(false_tickets),
            'unaddressed_with_no_mention_decision': len(no_mention_decisions),
            'unaddressed_new_ticket_rate': round(len(false_tickets) / len(unaddressed), 4) if unaddressed else None,
        },
        'proactivity': {
            'unaddressed_human_triggers': len(unaddressed),
            'unaddressed_with_new_ticket': len(false_tickets),
            'unaddressed_false_trigger_rate': round(len(false_tickets) / len(unaddressed), 4) if unaddressed else None,
            'github_unaddressed_triggers': len(github_unaddressed),
        },
        'productivity': {
            'task_duration_s': summary(ticket_durations),
            'completed_task_duration_s': summary(completed_ticket_durations),
            'active_assignment_duration_s': summary([value for value in assignment_durations if value <= 7200]),
            'assignment_duration_s': summary(assignment_durations),
            'per_ticket_usage': [{'ticket_id': row['ticket_id'], 'ended': row['ended'], 'usage': row['worker_usage']} for row in ticket_rows],
            'worker_usage': worker_usage_total,
            'router_usage': router_usage,
            'cache_read_share_of_total': round(worker_usage_total['cache_read_tokens'] / worker_usage_total['total_tokens'], 4)
            if worker_usage_total['total_tokens'] else None,
        },
        'persistence': {'recovered_tickets': recovered, 'recovery_events': len(recovered)},
        'tickets': ticket_rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description='Read-only operational baseline for the four-feature validation.')
    parser.add_argument('--state-dir', type=Path, default=DEFAULT_STATE)
    parser.add_argument('--sessions', type=Path, default=DEFAULT_SESSIONS)
    parser.add_argument('--out', type=Path, default=ROOT / 'experiments' / 'four-features' / 'results' / 'live-baseline.json')
    args = parser.parse_args()
    if not (args.state_dir / 'orchestrator.sqlite').exists():
        print(f'No state database at {args.state_dir}/orchestrator.sqlite', file=sys.stderr)
        return 1
    baseline = build(args.state_dir, args.sessions)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(baseline, indent=2) + '\n')
    print(json.dumps({key: baseline[key] for key in ('totals', 'continuity', 'proactivity', 'persistence')}, indent=2))
    print(f"productivity: {json.dumps(baseline['productivity'])}")
    print(f'wrote {args.out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
