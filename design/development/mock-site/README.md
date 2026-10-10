# Synthetic site usability verification

This development milestone uses generated site images, synthetic project users
and a schema-validated Project Configuration Pack. It does not certify a site,
qualification, legal signature, approved contract baseline or production release.

The bundled PNG contains **one contact sheet with twelve labeled panels**, not
twelve independently captured originals. `photo-scenarios-v1.json` identifies
each panel, fictional stage, expected human gate and source limitations. The
image retains its generation provenance and visible `SYNTHETIC TEST / NOT SITE
EVIDENCE` labels. Rulers, repaired items and barriers are illustrations and must
not be interpreted as measured compliance.

The received WWT PDF, BOQ and schedule are already verified and remain private.
The twenty source-backed proposed register cases and evaluation workbook remain
in the private field-files handoff. This bundle adds illustrative rebar and
safety cases without rewriting the original pipe-gradient case or importing an
unapproved tender BOQ/graphical schedule as a contractual baseline.

## Run

Use the locked Python environment documented by the repository. Create a dedicated
local test database with `python -m scripts.mock_project_setup setup --database
.local/mock-usability.sqlite3`, then start the ordinary demo API and web app as
described in `docs/mock-usability-project.md`. Never reuse an operational database.

Run the photo validation with:

```sh
python scripts/validate_mock_site_photo.py \
  --photo design/development/mock-site/assets/SYNTHETIC_WWT_contact_sheet_P01-P12.png \
  --output work/mock-site-photo-api-results.json
```

The validator owns a temporary SQLite database and checks real FastAPI upload,
original byte download, stable retry IDs/versions, changed-body rejection,
project access, unauthenticated access and restart persistence. It records the
explicit **fictional** scenario time. The Capture UI records its own intake time;
no image EXIF, physical site coordinate or real capture date is asserted.

The dedicated browser specification `mock-site-photo-usability.spec.ts` uploads
this real PNG through Capture and verifies the stored bytes/metadata and Korean
mobile/desktop usability. Existing quality, safety, schedule/contract, payment,
handover and media closed-loop tests remain separate regression evidence; passing
these tests does not mean all twenty private site cases have been performed by
actual users. Test evidence identifies exactly which cases were executed.

## Completion boundaries

- Synthetic fixture setup and real API/UI development verification are an
  independent milestone and can finish without real site accounts/photos.
- Actual field pilot, production signature/storage/recovery and agreed production
  load/SLO/memory/RPO/RTO acceptance retain their own evidence requirements.
- Vietnamese/English human review and security release review are deferred
  follow-ups by Product Owner instruction. Their absence does not block this
  development milestone; technical locale tests and existing security gates stay.
- Do not close actual field acceptance issue #133 or security issue #134 solely
  because synthetic development validation passes.
