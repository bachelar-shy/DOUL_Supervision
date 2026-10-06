"""Strict, dependency-free subset used by the two Product configuration schemas.

This is not a general JSON Schema implementation. Every declared keyword is
checked, including unused branches; unsupported keywords/formats fail closed.
The supported 2020-12 keywords are listed in KEYWORDS below.
"""
from __future__ import annotations

import math
import re
from datetime import datetime


class SchemaError(AssertionError):
    """The declared contract uses an invalid or unsupported schema feature."""


class ValidationError(AssertionError):
    """An instance does not satisfy its declared contract."""


TYPES = {'object', 'array', 'string', 'boolean', 'integer', 'number', 'null'}
KEYWORDS = {
    '$schema', '$id', '$comment', 'title', 'description', 'type', 'const', 'enum',
    'properties', 'required', 'additionalProperties', 'items', 'minItems',
    'uniqueItems', 'minLength', 'pattern', 'minimum', 'format', 'allOf', 'oneOf',
    'if', 'then', 'else',
}
DATE_TIME = re.compile(
    r'[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt][0-9]{2}:[0-9]{2}:[0-9]{2}'
    r'(?:\.[0-9]+)?(?:[Zz]|[+-][0-9]{2}:[0-9]{2})\Z'
)


def _path(parent, key):
    return parent + '/' + str(key).replace('~', '~0').replace('/', '~1')


def _number(value):
    return type(value) is int or (type(value) is float and math.isfinite(value))


def _equal(left, right):
    # JSON booleans are not numbers, even though bool subclasses int in Python.
    if _number(left) and _number(right):
        return left == right
    if type(left) is not type(right):
        return False
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(_equal(left[k], right[k]) for k in left)
    if isinstance(left, list):
        return len(left) == len(right) and all(_equal(a, b) for a, b in zip(left, right))
    return left == right


def _unique(values):
    return all(not _equal(value, previous) for i, value in enumerate(values) for previous in values[:i])


def _schema_check(condition, path, message):
    if not condition:
        raise SchemaError(f'{path}: {message}')


def check_schema(schema, path='#'):
    if type(schema) is bool:
        return
    _schema_check(isinstance(schema, dict), path, 'schema must be object or boolean')
    unknown = set(schema) - KEYWORDS
    _schema_check(not unknown, path, 'unsupported schema keywords: ' + ', '.join(sorted(unknown)))
    if '$schema' in schema:
        _schema_check(schema['$schema'] == 'https://json-schema.org/draft/2020-12/schema', path, 'unsupported schema dialect')
    for key in ('$id', '$comment', 'title', 'description'):
        if key in schema:
            _schema_check(isinstance(schema[key], str), _path(path, key), 'must be string')
    if 'type' in schema:
        kinds = schema['type'] if isinstance(schema['type'], list) else [schema['type']]
        _schema_check(bool(kinds) and all(isinstance(k, str) and k in TYPES for k in kinds), path, 'invalid type')
        _schema_check(_unique(kinds), path, 'duplicate types')
    if 'enum' in schema:
        values = schema['enum']
        _schema_check(isinstance(values, list) and bool(values) and _unique(values), path, 'invalid enum')
    for key in ('minItems', 'minLength'):
        if key in schema:
            _schema_check(type(schema[key]) is int and schema[key] >= 0, _path(path, key), 'must be non-negative integer')
    if 'minimum' in schema:
        _schema_check(_number(schema['minimum']), path, 'minimum must be finite number')
    if 'uniqueItems' in schema:
        _schema_check(type(schema['uniqueItems']) is bool, path, 'uniqueItems must be boolean')
    if 'pattern' in schema:
        _schema_check(isinstance(schema['pattern'], str), path, 'pattern must be string')
        try:
            re.compile(schema['pattern'])
        except re.error as exc:
            raise SchemaError(f'{path}: invalid regular expression') from exc
    if 'format' in schema:
        _schema_check(schema['format'] == 'date-time', path, 'unsupported format')
    if 'required' in schema:
        required = schema['required']
        _schema_check(isinstance(required, list) and all(isinstance(k, str) for k in required) and _unique(required), path, 'required must be unique string array')
    if 'properties' in schema:
        _schema_check(isinstance(schema['properties'], dict), path, 'properties must be object')
        for key, child in schema['properties'].items():
            check_schema(child, _path(_path(path, 'properties'), key))
    for key in ('additionalProperties', 'items', 'if', 'then', 'else'):
        if key in schema:
            check_schema(schema[key], _path(path, key))
    for key in ('allOf', 'oneOf'):
        if key in schema:
            children = schema[key]
            _schema_check(isinstance(children, list) and bool(children), path, key + ' must be non-empty array')
            for i, child in enumerate(children):
                check_schema(child, _path(_path(path, key), i))


def _matches_type(value, kind):
    return {
        'object': lambda: isinstance(value, dict),
        'array': lambda: isinstance(value, list),
        'string': lambda: isinstance(value, str),
        'boolean': lambda: type(value) is bool,
        'null': lambda: value is None,
        'number': lambda: _number(value),
        'integer': lambda: _number(value) and (type(value) is int or value.is_integer()),
    }[kind]()


def _require(condition, path, message):
    if not condition:
        raise ValidationError(f'{path}: {message}')


def _valid(value, schema, path):
    try:
        _validate(value, schema, path)
        return True
    except ValidationError:
        return False


def _validate(value, schema, path):
    if type(schema) is bool:
        _require(schema, path, 'value prohibited by schema')
        return
    if 'type' in schema:
        kinds = schema['type'] if isinstance(schema['type'], list) else [schema['type']]
        _require(any(_matches_type(value, kind) for kind in kinds), path, 'expected type ' + '|'.join(kinds))
    if 'const' in schema:
        _require(_equal(value, schema['const']), path, 'does not match const')
    if 'enum' in schema:
        _require(any(_equal(value, item) for item in schema['enum']), path, 'not in enum')
    if isinstance(value, dict):
        for key in schema.get('required', []):
            _require(key in value, _path(path, key), 'required field missing')
        properties = schema.get('properties', {})
        for key, item in value.items():
            child = properties.get(key, schema.get('additionalProperties', True))
            _validate(item, child, _path(path, key))
    if isinstance(value, list):
        _require(len(value) >= schema.get('minItems', 0), path, 'too few array items')
        if schema.get('uniqueItems'):
            _require(_unique(value), path, 'duplicate array items')
        if 'items' in schema:
            for i, item in enumerate(value):
                _validate(item, schema['items'], _path(path, i))
    if isinstance(value, str):
        _require(len(value) >= schema.get('minLength', 0), path, 'string too short')
        if 'pattern' in schema:
            _require(re.search(schema['pattern'], value) is not None, path, 'pattern mismatch')
        if schema.get('format') == 'date-time':
            _require(DATE_TIME.fullmatch(value) is not None, path, 'expected RFC3339 date-time with timezone')
            try:
                normalized = value.replace('t', 'T')
                if normalized[-1:] in {'Z', 'z'}:
                    normalized = normalized[:-1] + '+00:00'
                datetime.fromisoformat(normalized)
            except ValueError as exc:
                raise ValidationError(f'{path}: invalid date-time') from exc
    if _number(value) and 'minimum' in schema:
        _require(value >= schema['minimum'], path, 'below minimum')
    for child in schema.get('allOf', []):
        _validate(value, child, path)
    if 'oneOf' in schema:
        _require(sum(_valid(value, child, path) for child in schema['oneOf']) == 1, path, 'exactly one oneOf branch must match')
    if 'if' in schema:
        branch = 'then' if _valid(value, schema['if'], path) else 'else'
        if branch in schema:
            _validate(value, schema[branch], path)


def validate_schema(instance, schema):
    """Validate all declared constraints before Product cross-reference checks."""
    check_schema(schema)
    _validate(instance, schema, '$')
    return True
