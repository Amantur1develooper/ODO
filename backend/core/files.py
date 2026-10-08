import mimetypes
import re
import shutil
from pathlib import Path

from django.conf import settings

EXT = {
    'image': 'jpg jpeg png gif webp svg bmp tif tiff heic heif avif ico',
    'video': 'mp4 m4v mov webm mkv avi wmv flv mpg mpeg 3gp mts m2ts ts ogv vob',
    'audio': 'mp3 wav ogg oga m4a aac flac wma opus amr aiff',
    'pdf': 'pdf',
    'office': 'doc docx docm xls xlsx xlsm ppt pptx pps ppsx odt ods odp rtf pages numbers key',
    'text': 'txt md csv tsv json xml log yml yaml ini conf html htm css js jsx tsx py java c cpp h cs go rs php rb sh sql kt swift',
    'archive': 'zip rar 7z tar gz tgz bz2 xz',
}
BY_EXT = {e: cat for cat, exts in EXT.items() for e in exts.split()}

BROWSER_IMAGE = set('jpg jpeg png gif webp svg bmp avif ico'.split())
BROWSER_AUDIO = set('mp3 wav ogg oga m4a aac flac opus'.split())

# В slim-образе нет /etc/mime.types, поэтому основные типы задаём явно.
EXTRA_MIME = {
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'odt': 'application/vnd.oasis.opendocument.text',
    'ods': 'application/vnd.oasis.opendocument.spreadsheet',
    'odp': 'application/vnd.oasis.opendocument.presentation',
    'rtf': 'application/rtf',
    'mkv': 'video/x-matroska', 'avi': 'video/x-msvideo', 'wmv': 'video/x-ms-wmv', 'flv': 'video/x-flv',
    'mts': 'video/mp2t', 'm2ts': 'video/mp2t', '3gp': 'video/3gpp', 'webm': 'video/webm', 'm4v': 'video/mp4',
    'm4a': 'audio/mp4', 'flac': 'audio/flac', 'opus': 'audio/ogg', 'wma': 'audio/x-ms-wma', 'amr': 'audio/amr',
    'heic': 'image/heic', 'heif': 'image/heif', 'avif': 'image/avif', 'webp': 'image/webp',
    'md': 'text/markdown', 'csv': 'text/csv', 'log': 'text/plain', 'yml': 'text/plain', 'yaml': 'text/plain',
    'zip': 'application/zip', 'rar': 'application/vnd.rar', '7z': 'application/x-7z-compressed',
}
for _ext, _mime in EXTRA_MIME.items():
    mimetypes.add_type(_mime, '.' + _ext)


def category_of(ext, mime=''):
    if ext in BY_EXT:
        return BY_EXT[ext]
    top = (mime or '').split('/')[0]
    if top in ('image', 'video', 'audio'):
        return top
    if top == 'text':
        return 'text'
    return 'other'


def mime_of(ext):
    return mimetypes.types_map.get('.' + ext) or mimetypes.guess_type('x.' + ext)[0] or 'application/octet-stream'


def clean_name(name):
    name = re.sub(r'[\\/\x00-\x1f]', '_', str(name or '')).strip()
    return name[:255] or 'file'


def split_ext(name):
    stem, dot, ext = name.rpartition('.')
    if not dot or not stem:
        return name, ''
    return stem, ext.lower()[:20]


def item_dir(item_id) -> Path:
    return settings.DATA_DIR / 'files' / str(item_id)


def item_path(item_id, name) -> Path:
    return item_dir(item_id) / name


def remove_item_files(item_id):
    shutil.rmtree(item_dir(item_id), ignore_errors=True)


def upload_path(upload_id) -> Path:
    return settings.DATA_DIR / 'uploads' / f'{upload_id}.part'
