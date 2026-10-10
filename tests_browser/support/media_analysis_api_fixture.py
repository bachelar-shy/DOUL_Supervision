"""Isolated demo-mode API for the media-analysis browser acceptance test.

The API uses the explicitly selected synthetic FixtureProvider profile only for
this test process. The test sends clearly labelled synthetic worker output; no
uploaded original or model assessment is added to the repository.
"""

import argparse
import os

import uvicorn

from services.api.main import create_app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.getenv("DOUL_MEDIA_FIXTURE_PORT", "8798")))
    parser.add_argument("--database", default=os.getenv("DOUL_MEDIA_FIXTURE_DB", ".local/media-analysis-browser.sqlite3"))
    args = parser.parse_args()
    os.makedirs(os.path.dirname(os.path.abspath(args.database)), exist_ok=True)
    app = create_app(args.database, demo=True, queue_enabled=True)
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
