"""Authenticated streaming recovery bundles; never use plaintext before GCM finalization."""
from __future__ import annotations

from contextlib import contextmanager
from hashlib import sha256
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import tarfile
import tempfile

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

MAGIC = b'DOUL-RECOVERY-1\x00'
CHUNK = 1024 * 1024


def private_directory(path):
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.getuid():
        raise ValueError('Recovery directory must be private and owned by the operator')
    return path


def regular_file(path):
    path = Path(path)
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode):
        os.close(fd)
        raise ValueError('Recovery input must be a regular file')
    return os.fdopen(fd, 'rb')


def digest_file(path):
    digest = sha256()
    with regular_file(path) as file:
        while data := file.read(CHUNK): digest.update(data)
    return digest.hexdigest()


def load_key(path):
    with regular_file(path) as file:
        info = os.fstat(file.fileno())
        if info.st_mode & 0o077:
            raise ValueError('Recovery key must be owner-only')
        value = file.read(65)
    if len(value) != 32:
        raise ValueError('Recovery encryption key must contain exactly 32 random bytes')
    return value


def encrypt_directory(source, output, key):
    if len(key) != 32: raise ValueError('AES-256 key required')
    source, output = Path(source), Path(output)
    private_directory(output.parent)
    if output.exists() or output.is_symlink(): raise FileExistsError('Backup output already exists')
    with tempfile.TemporaryDirectory(prefix='.bundle-', dir=output.parent) as temp:
        plain, encrypted = Path(temp) / 'input.tar', Path(temp) / 'output.enc'
        with tarfile.open(plain, mode='w', format=tarfile.PAX_FORMAT) as archive:
            for path in sorted(source.rglob('*')):
                if path.is_dir() and not path.is_symlink(): continue
                with regular_file(path): pass
                if path.is_symlink(): raise ValueError('Archive members cannot be symlinks')
                archive.add(path, arcname=path.relative_to(source).as_posix(), recursive=False)
        nonce = os.urandom(12)
        header = MAGIC + nonce
        cipher = Cipher(algorithms.AES(key), modes.GCM(nonce)).encryptor()
        cipher.authenticate_additional_data(header)
        with plain.open('rb') as reader, encrypted.open('xb') as writer:
            os.chmod(encrypted, 0o600)
            writer.write(header)
            while data := reader.read(CHUNK): writer.write(cipher.update(data))
            writer.write(cipher.finalize())
            writer.write(cipher.tag)
            writer.flush(); os.fsync(writer.fileno())
        # Atomic creation without replacing an existing backup or following a link.
        os.link(encrypted, output)
    return digest_file(output)


@contextmanager
def decrypted_directory(bundle, key, max_bytes=1024**4, max_files=1000000):
    if len(key) != 32: raise ValueError('AES-256 key required')
    with tempfile.TemporaryDirectory(prefix='doul-private-recovery-') as temp:
        plain, root = Path(temp) / 'verified.tar', Path(temp) / 'verified'
        root.mkdir(mode=0o700)
        with regular_file(bundle) as source:
            size = os.fstat(source.fileno()).st_size
            if size < len(MAGIC) + 12 + 16 or size > max_bytes + 1024**3:
                raise ValueError('Invalid recovery bundle size')
            header = source.read(len(MAGIC) + 12)
            if not header.startswith(MAGIC): raise ValueError('Unsupported recovery bundle format')
            source.seek(-16, 2); tag = source.read(16)
            cipher = Cipher(algorithms.AES(key), modes.GCM(header[len(MAGIC):], tag)).decryptor()
            cipher.authenticate_additional_data(header)
            source.seek(len(header))
            remaining = size - len(header) - 16
            with plain.open('xb') as writer:
                os.chmod(plain, 0o600)
                while remaining:
                    data = source.read(min(CHUNK, remaining))
                    if not data: raise ValueError('Truncated recovery bundle')
                    remaining -= len(data)
                    writer.write(cipher.update(data))
                writer.write(cipher.finalize())  # Wrong key/tampering fails HERE, before extraction.
        total = count = 0
        names = set()
        with tarfile.open(plain, mode='r:') as archive:
            for member in archive:
                name = PurePosixPath(member.name)
                if not member.isfile() or name.is_absolute() or '..' in name.parts or '\\' in member.name or name.as_posix() in names:
                    raise ValueError('Unsafe or duplicate recovery archive member')
                count += 1; total += member.size
                if total > max_bytes or count > max_files or member.size < 0:
                    raise ValueError('Recovery archive exceeds configured bounds')
                names.add(name.as_posix())
                destination = root.joinpath(*name.parts)
                destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                with archive.extractfile(member) as reader, destination.open('xb') as writer:
                    os.chmod(destination, 0o600)
                    shutil.copyfileobj(reader, writer, CHUNK)
                if destination.stat().st_size != member.size:
                    raise ValueError('Incomplete archive member')
        yield root
