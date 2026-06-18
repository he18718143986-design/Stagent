"""CLI: python -m stagent_codeact run --bundle ... --workspace ..."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .runner import run_codeact


def _read_fix_prompt(args: argparse.Namespace) -> str | None:
    if args.fix_prompt_file:
        return Path(args.fix_prompt_file).read_text(encoding="utf-8")
    return args.fix_prompt


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
        help="Optional Gate failure text for retry pass (prefer --fix-prompt-file)",
    )
    run_p.add_argument(
        "--fix-prompt-file",
        default=None,
        help="Path to Gate failure text file (safe for long reports)",
    )
    run_p.add_argument(
        "--events",
        default="ndjson",
        choices=["ndjson"],
        help="Event format on stdout (only ndjson supported)",
    )

    args = parser.parse_args(argv)

    if args.command == "run":
        if args.fix_prompt and args.fix_prompt_file:
            print("error: use only one of --fix-prompt or --fix-prompt-file", file=sys.stderr)
            return 2
        return run_codeact(
            args.bundle,
            args.workspace,
            fix_prompt=_read_fix_prompt(args),
        )

    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
