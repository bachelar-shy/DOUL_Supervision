# Local mock usability project

This fixture seeds a full synthetic DOUL demo workflow project for API and UI
development. It includes scoped `CON`, `SUP`, `OWN`, `DES`, and `ADM` users,
service actors, requirements, a drawing, measurement evidence, inspections,
observations, an issue and action, an owner report and decision, and an RFI.
Names and project labels say `SYNTHETIC`; qualification numbers are explicitly
not credentials. This data supports development and usability review only. It
does not establish field acceptance.

The setup also stores two real-schema negative assignments for direct engine
authorization checks: a supervisor with a rank 3 qualification against a rank
1 requirement, and a contractor assignment with only `render_document`. The
demo login endpoint still mints sessions only for the primary role in each
group, so these secondary identities are not available as browser logins and
do not create a new auth path.

Use a dedicated local SQLite database so cleanup can preserve any other
development data:

```sh
python -m scripts.mock_project_setup setup --database .local/mock-usability.sqlite3
python -m services.api --demo --database .local/mock-usability.sqlite3
# In another terminal, with node dependencies installed:
npm run dev --workspace @doul/web
```

The API listens at `http://127.0.0.1:8791`; the web app uses its normal HTTP
adapter and Vite `/api` proxy. Development login uses `POST /dev/sessions` with
one of `CON`, `SUP`, `OWN`, `DES`, or `ADM`. The returned actor name is marked
synthetic. For photo upload workflows, use the normal upload API with a
tool-generated, visibly labeled mock image; this fixture does not add a fake
photo blob.

The project configuration pack passes the v1 schema at `baselineVersion 1.1`.
It is a configuration review fixture, not proof that every config section is
currently enforced at runtime. The reference engine continues to enforce its
own authority matrix, role assignment, qualification validity/rank, scope, and
project checks. Deadline, form, required qualification-kind, and project
authority-binding configuration values are not all runtime policy inputs yet.

Setup is idempotent within the database. To remove it, stop the API and run:

```sh
python -m scripts.mock_project_setup cleanup --database .local/mock-usability.sqlite3
```

Cleanup requires the fixture ownership marker and refuses removal if the
project contains an unowned record added after setup. On success it removes
only owned project records, blobs, audit entries, and idempotency entries, then
restores the database's prior demo metadata. The database file itself remains.
