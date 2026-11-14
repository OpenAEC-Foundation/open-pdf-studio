"""Local operator CLI. Passwords are never command-line arguments."""
import argparse
from contextlib import closing
import getpass
import os
from pathlib import Path
import sqlite3
import sys

from botocore.exceptions import BotoCoreError

from .runtime import Settings, run
from .store import Invalid, Store


def password_from_input(use_stdin):
    if use_stdin:
        password = sys.stdin.readline(1026).rstrip("\r\n")
    else:
        if not sys.stdin.isatty():
            raise Invalid("use --password-stdin for noninteractive provisioning")
        password = getpass.getpass("Password: ")
        if password != getpass.getpass("Repeat password: "):
            raise Invalid("passwords do not match")
    return password


def backup(store, destination):
    # Never overwrite an existing backup. SQLite's backup API includes the WAL.
    fd = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    try:
        with store._connection() as source, closing(sqlite3.connect(destination)) as target:
            source.backup(target)
    except BaseException:
        Path(destination).unlink(missing_ok=True)
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description="Open PDF Studio collaboration operator")
    parser.add_argument("--database", default=os.environ.get("OPDS_DATABASE", "review.db"))
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("serve")
    create = sub.add_parser("create-user")
    create.add_argument("name")
    create.add_argument("--password-stdin", action="store_true")
    reset = sub.add_parser("set-password")
    reset.add_argument("user_id")
    reset.add_argument("--password-stdin", action="store_true")
    sub.add_parser("list-users")
    for command in ("disable-user", "enable-user"):
        sub.add_parser(command).add_argument("user_id")
    sub.add_parser("backup").add_argument("destination")
    args = parser.parse_args(argv)
    try:
        if args.command == "serve":
            settings = Settings.from_env({**os.environ, "OPDS_DATABASE": args.database})
            run(settings)
        else:
            if args.command != "create-user" and not Path(args.database).is_file():
                raise Invalid("database does not exist")
            store = Store(args.database)
            if args.command == "create-user":
                print(store.create_user(args.name, password_from_input(args.password_stdin)))
            elif args.command == "set-password":
                store.set_password(args.user_id, password_from_input(args.password_stdin))
            elif args.command in ("disable-user", "enable-user"):
                store.set_disabled(args.user_id, args.command == "disable-user")
            elif args.command == "list-users":
                for user in store.list_users():
                    print(user["id"], "disabled" if user["disabled"] else "enabled", user["name"], sep="\t")
            elif args.command == "backup":
                backup(store, args.destination)
    except Invalid as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except (OSError, sqlite3.Error, BotoCoreError):
        # Avoid leaking provider endpoints, secrets or private paths in errors.
        print("operator command failed; check configuration and storage access", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
