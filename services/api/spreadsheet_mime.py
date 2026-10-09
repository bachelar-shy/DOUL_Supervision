"""Recognize bounded, non-macro XLSX packages without extracting files."""
from io import BytesIO
from zipfile import BadZipFile, ZipFile
from xml.etree import ElementTree
import zlib

from app.reference.validation import ContractError

XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'


def spreadsheet_mime(data):
    try:
        with ZipFile(BytesIO(data)) as archive:
            entries = archive.infolist()
            names = [entry.filename for entry in entries]
            if (len(entries) > 20000 or len(names) != len(set(names))
                    or sum(entry.file_size for entry in entries) > 128 * 1024 * 1024
                    or any(entry.flag_bits & 1 for entry in entries)
                    or any(name.startswith('/') or '..' in name.split('/') for name in names)
                    or any('vbaproject' in name.lower() for name in names)):
                raise ValueError('Unsupported workbook package')
            if not {'[Content_Types].xml', 'xl/workbook.xml', '_rels/.rels'} <= set(names):
                raise ValueError('Missing workbook parts')
            part = archive.getinfo('[Content_Types].xml')
            if part.file_size > 1024 * 1024:
                raise ValueError('Oversized content types')
            content_types = archive.read(part)
            if b'<!DOCTYPE' in content_types or b'<!ENTITY' in content_types:
                raise ValueError('Unsupported XML declaration')
            root = ElementTree.fromstring(content_types)
            ns = '{http://schemas.openxmlformats.org/package/2006/content-types}'
            if root.tag != ns + 'Types':
                raise ValueError('Invalid content types')
            types = {node.attrib.get('PartName'): node.attrib.get('ContentType')
                     for node in root if node.tag == ns + 'Override'}
            if types.get('/xl/workbook.xml') != 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml':
                raise ValueError('Not a non-macro XLSX workbook')
            if any('macroenabled' in node.attrib.get('ContentType', '').lower()
                   or 'vbaproject' in node.attrib.get('ContentType', '').lower()
                   for node in root):
                raise ValueError('Macro workbook is unsupported')
            if not any(name.startswith('xl/worksheets/') and name.endswith('.xml') for name in names):
                raise ValueError('Missing worksheets')
            return XLSX_MIME
    except (BadZipFile, ValueError, KeyError, RuntimeError, NotImplementedError,
            ElementTree.ParseError, EOFError, OSError, zlib.error):
        raise ContractError('MIME_INVALID', 'Expected a bounded, non-macro XLSX workbook')
