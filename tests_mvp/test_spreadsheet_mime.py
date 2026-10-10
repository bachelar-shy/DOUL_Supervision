from io import BytesIO
from zipfile import ZipFile, ZIP_DEFLATED
import unittest
from services.api.main import sniff
from services.api.spreadsheet_mime import XLSX_MIME
from app.reference.validation import ContractError


def workbook(extra=None, content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'):
    stream = BytesIO()
    with ZipFile(stream, 'w', ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="'+content_type+'"/></Types>')
        archive.writestr('_rels/.rels', '<Relationships/>')
        archive.writestr('xl/workbook.xml', '<workbook/>')
        archive.writestr('xl/worksheets/sheet1.xml', '<worksheet/>')
        for name, content in (extra or {}).items():
            archive.writestr(name, content)
    return stream.getvalue()


class SpreadsheetMimeTests(unittest.TestCase):
    def test_non_macro_workbook_is_recognized(self):
        self.assertEqual(sniff(workbook()), XLSX_MIME)

    def test_zip_is_not_accepted_by_extension_or_magic_alone(self):
        for data in (b'PK\x03\x04garbage', workbook()[:50]):
            with self.assertRaises(ContractError) as context:
                sniff(data)
            self.assertEqual(context.exception.code, 'MIME_INVALID')

    def test_macro_and_path_traversal_packages_are_refused(self):
        for data in (workbook({'xl/vbaProject.bin': b'macro'}), workbook({'../escape': b'x'}),
                     workbook(content_type='application/vnd.ms-excel.sheet.macroEnabled.main+xml')):
            with self.assertRaises(ContractError):
                sniff(data)

    def test_oversized_types_and_duplicate_parts_are_refused(self):
        for data in (workbook({'[Content_Types].xml': b'x'*(1024*1024+1)}),
                     workbook({'xl/workbook.xml': '<another/>'})):
            with self.assertRaises(ContractError):
                sniff(data)
