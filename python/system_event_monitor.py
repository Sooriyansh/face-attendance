import argparse
import os
import platform
import socket
import sys
import time
from datetime import timezone

import requests

try:
    import psutil
    import win32evtlog
    import win32evtlogutil
except ImportError as error:
    print(
        "Missing dependency. Run `npm run setup:python` or install pywin32 and psutil first.",
        file=sys.stderr,
    )
    raise SystemExit(str(error))


SYSTEM_EVENT_MAP = {
    6005: {
        "event": "Startup",
        "meaning": "Laptop ON hua",
        "providers": {"EventLog"},
    },
    6006: {
        "event": "Shutdown",
        "meaning": "Laptop OFF hua",
        "providers": {"EventLog"},
    },
    6008: {
        "event": "Unexpected Shutdown",
        "meaning": "Laptop unexpectedly OFF hua",
        "providers": {"EventLog"},
    },
    1074: {
        "event": "Shutdown",
        "meaning": "Shutdown ya restart initiate hua",
        "providers": {"USER32"},
    },
    42: {
        "event": "Sleep",
        "meaning": "Sleep mode",
        "providers": {"Microsoft-Windows-Kernel-Power"},
    },
    1: {
        "event": "Wakeup",
        "meaning": "Sleep se wapas ON",
        "providers": {"Microsoft-Windows-Power-Troubleshooter"},
    },
}

SECURITY_EVENT_MAP = {
    4800: {
        "event": "Lock",
        "meaning": "Screen lock",
        "providers": {"Microsoft-Windows-Security-Auditing"},
    },
    4801: {
        "event": "Unlock",
        "meaning": "Screen unlock",
        "providers": {"Microsoft-Windows-Security-Auditing"},
    },
    4624: {
        "event": "Login",
        "meaning": "User login",
        "providers": {"Microsoft-Windows-Security-Auditing"},
    },
    4634: {
        "event": "Logout",
        "meaning": "User logout",
        "providers": {"Microsoft-Windows-Security-Auditing"},
    },
}

LOG_CONFIG = {
    "System": SYSTEM_EVENT_MAP,
    "Security": SECURITY_EVENT_MAP,
}


def event_id(raw_event_id):
    return int(raw_event_id) & 0xFFFF


def iso_datetime(value):
    if hasattr(value, "astimezone"):
        return value.astimezone(timezone.utc).isoformat()
    return str(value)


def format_message(log_name, event):
    try:
        return win32evtlogutil.SafeFormatMessage(event, log_name).strip()
    except Exception:
        return ""


def rule_matches_provider(rule, provider):
    providers = rule.get("providers")
    return not providers or provider in providers


def classify_event(log_name, current_event_id, message):
    rule = LOG_CONFIG[log_name][current_event_id]
    event_name = rule["event"]
    meaning = rule["meaning"]

    if current_event_id == 1074:
        lowered = message.lower()
        if "restart" in lowered or "reboot" in lowered:
            return "Restart", "Restart hua"
        return "Shutdown", "Laptop OFF hua"

    return event_name, meaning


def read_windows_events(max_records):
    computer_name = socket.gethostname()
    collected = []

    for log_name, event_map in LOG_CONFIG.items():
        try:
            handle = win32evtlog.OpenEventLog(None, log_name)
        except Exception as error:
            print(f"Could not open {log_name} log: {error}", file=sys.stderr)
            continue

        flags = win32evtlog.EVENTLOG_BACKWARDS_READ | win32evtlog.EVENTLOG_SEQUENTIAL_READ
        records_seen = 0

        try:
            while records_seen < max_records:
                events = win32evtlog.ReadEventLog(handle, flags, 0)
                if not events:
                    break

                for event in events:
                    records_seen += 1
                    current_event_id = event_id(event.EventID)

                    provider = str(event.SourceName or "")

                    if current_event_id not in event_map:
                        if records_seen >= max_records:
                            break
                        continue

                    if not rule_matches_provider(event_map[current_event_id], provider):
                        if records_seen >= max_records:
                            break
                        continue

                    message = format_message(log_name, event)
                    event_name, meaning = classify_event(log_name, current_event_id, message)
                    record_number = int(event.RecordNumber)

                    collected.append(
                        {
                            "event": event_name,
                            "meaning": meaning,
                            "occurredAt": iso_datetime(event.TimeGenerated),
                            "eventId": current_event_id,
                            "sourceLog": log_name,
                            "provider": provider,
                            "recordNumber": record_number,
                            "computer": str(event.ComputerName or computer_name),
                            "user": "",
                            "message": message[:2000],
                            "externalId": f"{log_name}:{record_number}:{current_event_id}",
                        }
                    )

                    if records_seen >= max_records:
                        break
        finally:
            win32evtlog.CloseEventLog(handle)

    return collected


def add_boot_event(events):
    boot_time = getattr(psutil, "boot_time", lambda: None)()
    if not boot_time:
        return events

    occurred_at = time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(boot_time))
    events.append(
        {
            "event": "Startup",
            "meaning": "Laptop ON hua",
            "occurredAt": occurred_at,
            "eventId": 0,
            "sourceLog": "psutil",
            "provider": "psutil.boot_time",
            "recordNumber": None,
            "computer": socket.gethostname(),
            "user": os.getenv("USERNAME", ""),
            "message": "Current boot time detected by psutil.",
            "externalId": f"psutil:boot:{int(boot_time)}",
        }
    )
    return events


def post_events(api_url, events):
    if not events:
        return {"received": 0, "inserted": 0}

    response = requests.post(api_url, json={"events": events}, timeout=15)
    response.raise_for_status()
    return response.json()


def run_once(api_url, max_records):
    events = add_boot_event(read_windows_events(max_records))
    result = post_events(api_url, events)
    print(
        f"Sent {result.get('received', 0)} event(s), inserted {result.get('inserted', 0)} new event(s).",
        flush=True,
    )


def main():
    parser = argparse.ArgumentParser(description="Monitor Windows system events and send them to the dashboard API.")
    parser.add_argument(
        "--api-url",
        default="http://localhost:3000/api/system-events/ingest",
        help="Node API endpoint that stores system events.",
    )
    parser.add_argument("--interval", type=int, default=60, help="Polling interval in seconds.")
    parser.add_argument("--max-records", type=int, default=500, help="Recent records to scan per Windows log.")
    parser.add_argument("--once", action="store_true", help="Collect events once and exit.")
    args = parser.parse_args()

    if platform.system() != "Windows":
        raise SystemExit("System event monitoring is available only on Windows.")

    if args.once:
        run_once(args.api_url, args.max_records)
        return

    print("Windows system event monitor started. Press Ctrl+C to stop.", flush=True)
    while True:
        try:
            run_once(args.api_url, args.max_records)
        except KeyboardInterrupt:
            raise
        except Exception as error:
            print(f"Monitor error: {error}", file=sys.stderr, flush=True)
        time.sleep(max(args.interval, 5))


if __name__ == "__main__":
    main()
