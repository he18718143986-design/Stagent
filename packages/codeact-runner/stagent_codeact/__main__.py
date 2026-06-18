"""CLI: python -m stagent_codeact run --bundle ... --workspace ..."""

from __future__ import annotations

import argparse
import sys

from .runner import run_codeact


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="stagent-codeact",
        description="Stagent CodeAct runner (vendored openhands-sdk)",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    run_p = sub.add_parser("run", help="Run CodeAct on a workspace")
    run_p.add_argument(
        "--bundle",
        required=True,
        help="Path to .stagent-bundle directory (contains task.json)",
    )
    run_p.add_argument(
        "--workspace",
        required=True,
        help="Target workspace root for file edits and terminal",
    )
    run_p.add_argument(
        "--fix-prompt",
        default=None,
        help="Optional Gate failure text for retry pass",
    )
    run_p.add_argument(
        "--events",
        default="ndjson",
        choices=["ndjson"],
        help="Event format on stdout (only ndjson supported)",
    )

    args = parser.parse_args(argv)

    if args.command == "run":
        return run_codeact(
            args.bundle,
            args.workspace,
            fix_prompt=args.fix_prompt,
        )

    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
