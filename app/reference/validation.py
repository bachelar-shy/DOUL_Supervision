"""Validator for the JSON Schema vocabulary used by the repository contracts.

This intentionally bounded runner supports only the keywords used in our schemas.
Production may use a complete JSON Schema 2020-12 validator. Contract lint rejects
unsupported validation keywords so a new constraint cannot silently go unchecked.
"""
from datetime import datetime, timezone
import re
import math
from uuid import UUID


class ContractError(ValueError):
    def __init__(self, code, message, *, current_version=None):
        super().__init__(message)
        self.code = code
        self.current_version = current_version


def require(condition, code, message):
    if not condition:
        raise ContractError(code, message)


def instant(value):
    require(isinstance(value, str), 'INVALID_DATETIME', 'Timestamp must be a string')
    require(bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})',value)), 'INVALID_DATETIME', 'RFC3339 timestamp with timezone required')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as exc:
        raise ContractError('INVALID_DATETIME', value) from exc
    require(parsed.tzinfo is not None, 'INVALID_DATETIME', 'Timezone offset is required')
    return parsed.astimezone(timezone.utc)


def validate(value, schema, schemas, path='$'):
    if '$ref' in schema:
        validate(value, schemas[schema['$ref'].rsplit('/', 1)[-1]], schemas, path)
    types = schema.get('type', [])
    if isinstance(types, str):
        types = [types]
    checks = {
        'object': lambda x: isinstance(x, dict),
        'array': lambda x: isinstance(x, list),
        'string': lambda x: isinstance(x, str),
        'integer': lambda x: isinstance(x, int) and not isinstance(x, bool),
        'number': lambda x: isinstance(x, (int, float)) and not isinstance(x, bool),
        'boolean': lambda x: isinstance(x, bool),
        'null': lambda x: x is None,
    }
    if types:
        require(any(checks[t](value) for t in types), 'SCHEMA_INVALID', f'{path}: expected {types}')
    if 'enum' in schema:
        require(value in schema['enum'], 'SCHEMA_INVALID', f'{path}: unknown enum')
    if 'const' in schema:
        require(value == schema['const'], 'SCHEMA_INVALID', f'{path}: const mismatch')
    if isinstance(value, str):
        if schema.get('format') == 'uuid':
            try:
                require(str(UUID(value))==value.lower(), 'SCHEMA_INVALID', f'{path}: canonical UUID required')
            except ValueError as exc:
                raise ContractError('SCHEMA_INVALID', f'{path}: invalid UUID') from exc
        elif schema.get('format') == 'date-time':
            instant(value)
        elif schema.get('format') == 'uri':
            require(bool(re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', value)), 'SCHEMA_INVALID', f'{path}: invalid URI')
        if 'pattern' in schema:
            require(bool(re.search(schema['pattern'], value)), 'SCHEMA_INVALID', f'{path}: pattern mismatch')
        if 'minLength' in schema:
            require(len(value) >= schema['minLength'], 'SCHEMA_INVALID', f'{path}: too short')
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        require(math.isfinite(value), 'SCHEMA_INVALID', f'{path}: nonfinite number')
        for key, comparison in [('minimum', lambda a,b:a>=b), ('maximum', lambda a,b:a<=b)]:
            if key in schema:
                require(comparison(value, schema[key]), 'SCHEMA_INVALID', f'{path}: {key}')
    if isinstance(value, dict):
        for key in schema.get('required', []):
            require(key in value, 'SCHEMA_INVALID', f'{path}.{key}: missing')
        props = schema.get('properties', {})
        if schema.get('additionalProperties') is False:
            require(not set(value)-set(props), 'SCHEMA_INVALID', f'{path}: unknown fields {set(value)-set(props)}')
        for key, item in value.items():
            if key in props:
                validate(item, props[key], schemas, f'{path}.{key}')
    if isinstance(value, list):
        if 'minItems' in schema:
            require(len(value) >= schema['minItems'], 'SCHEMA_INVALID', f'{path}: too few items')
        if schema.get('uniqueItems'):
            require(len({repr(x) for x in value}) == len(value), 'SCHEMA_INVALID', f'{path}: duplicate items')
        for i, item in enumerate(value):
            validate(item, schema.get('items', {}), schemas, f'{path}[{i}]')
    for part in schema.get('allOf', []):
        validate(value, part, schemas, path)
    for keyword in ['oneOf', 'anyOf']:
        if keyword in schema:
            count = 0
            for part in schema[keyword]:
                try:
                    validate(value, part, schemas, path)
                    count += 1
                except ContractError:
                    pass
            require(count == 1 if keyword == 'oneOf' else count >= 1, 'SCHEMA_INVALID', f'{path}: {keyword}')
    if 'if' in schema:
        try:
            validate(value, schema['if'], schemas, path)
            matches = True
        except ContractError:
            matches = False
        if matches and 'then' in schema:
            validate(value, schema['then'], schemas, path)
        elif not matches and 'else' in schema:
            validate(value, schema['else'], schemas, path)


def get_path(data, dotted):
    current = data
    for key in dotted.split('.'):
        if not isinstance(current, dict) or key not in current:
            return None
        current = current[key]
    return current
