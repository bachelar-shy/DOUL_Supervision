# Local mock usability project

This fixture provides a stable local project for DOUL API and UI development.
It provisions synthetic `CON`, `SUP`, `OWN`, and `ADM` people, a schema-valid
Project Configuration Pack, and two generated PNG evidence samples. Every login
name and image is marked synthetic. The qualifications are test fixtures, not
real credentials. This data supports development and usability review only; it
does not establish field acceptance.

Use a dedicated local database so the project can be removed without touching
another development database:

```sh
python -m scripts.mock_project_setup setup --database .local/mock-usability.sqlite3
python -m services.api --demo --database .local/mock-usability.sqlite3
# In another terminal, with node dependencies installed:
npm run dev --workspace @doul/web
```

The API listens at `http://127.0.0.1:8791`. Its development login accepts the
four fixture role groups through `POST /dev/sessions`; the returned actor names
include `SYNTHETIC`. The generated photo evidence is in the evidence collection
and has ordinary PNG bytes and SHA-256 metadata, but the pixel art is a labeled
test stand-in rather than a photograph of site conditions.

Running setup again returns the same project and actors without duplicating
records. To remove the fixture, stop the API and run:

```sh
python -m scripts.mock_project_setup cleanup --database .local/mock-usability.sqlite3
```

Cleanup checks the fixture ownership marker and refuses to continue if it finds
unowned records in the fixture project. It removes only the fixture's records,
evidence blobs, audit entries, and idempotency entries, then restores the prior
demo login context. Keep the database file itself if it contains other local
development data.

The existing demo login supports one actor per group, so foreign-project
separation can be exercised by using another project ID with the fixture's
session. The current login surface does not mint secondary underqualified or
read-only identities. Although Qualification and RoleAssignment schemas can
represent those cases, this fixture does not claim to validate those HTTP
negative paths. It also does not model real login, qualification verification,
legal/contract evidence, production persistence, or site acceptance.
