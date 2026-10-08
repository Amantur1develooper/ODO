"""Фоновая обработка файлов: превью, конвертация видео/офиса, извлечение текста для поиска."""
import json
import logging
import subprocess
import threading
import time
import urllib.request
import uuid
from datetime import timedelta

from django.conf import settings
from django.db import close_old_connections, connection
from django.utils import timezone

from .files import BROWSER_AUDIO, BROWSER_IMAGE, item_path, upload_path
from .models import Item, Upload

log = logging.getLogger('odo.worker')

MAX_TEXT = 200_000
THUMB_FILTER = "scale='min(480,iw)':-2"


class ToolMissing(Exception):
    pass


def run(cmd, timeout=6 * 3600):
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=timeout)
    except FileNotFoundError as e:
        raise ToolMissing(cmd[0]) from e
    if p.returncode != 0:
        raise RuntimeError(f'{cmd[0]}: {p.stderr.decode(errors="replace")[-800:]}')
    return p.stdout


def decode_text(raw: bytes) -> str:
    try:
        return raw.decode('utf-8')
    except UnicodeDecodeError:
        pass
    # Частый случай для старых документов на русском.
    try:
        return raw.decode('cp1251')
    except UnicodeDecodeError:
        return raw.decode('utf-8', errors='replace')


def set_progress(item, pct):
    Item.objects.filter(pk=item.pk).update(meta={**item.meta, 'progress': pct})


# --- типы файлов --------------------------------------------------------------

def make_thumb(src, item, seek=None):
    out = item_path(item.id, 'thumb.jpg')
    cmd = ['ffmpeg', '-v', 'error', '-y']
    if seek:
        cmd += ['-ss', f'{seek:.2f}']
    cmd += ['-i', str(src), '-frames:v', '1', '-vf', THUMB_FILTER, '-q:v', '4', str(out)]
    run(cmd, timeout=300)
    item.thumb_name = 'thumb.jpg'


def do_image(item, src):
    if item.ext == 'svg':
        return
    if item.ext not in BROWSER_IMAGE:
        out = item_path(item.id, 'preview.jpg')
        run(['ffmpeg', '-v', 'error', '-y', '-i', str(src), '-frames:v', '1',
             '-vf', "scale='min(2560,iw)':-2", '-q:v', '3', str(out)], timeout=600)
        item.preview_name, item.preview_mime = 'preview.jpg', 'image/jpeg'
    make_thumb(src, item)


def probe(src):
    out = run(['ffprobe', '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', str(src)], timeout=300)
    return json.loads(out or b'{}')


def is_faststart(src):
    """moov-атом в начале MP4 = видео начинает играть сразу, не дожидаясь загрузки."""
    with open(src, 'rb') as f:
        f.seek(0, 2)
        total = f.tell()
        pos = 0
        for _ in range(64):
            if pos >= total:
                break
            f.seek(pos)
            head = f.read(16)
            if len(head) < 8:
                break
            size = int.from_bytes(head[:4], 'big')
            kind = head[4:8]
            if size == 1:
                size = int.from_bytes(head[8:16], 'big')
            elif size == 0:
                size = total - pos
            if kind == b'moov':
                return True
            if kind == b'mdat':
                return False
            if size < 8:
                break
            pos += size
    return False


def ffmpeg_with_progress(item, args, duration):
    cmd = ['ffmpeg', '-v', 'error', '-y', '-nostats', '-progress', 'pipe:1'] + args
    try:
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    except FileNotFoundError as e:
        raise ToolMissing('ffmpeg') from e
    errors = []
    threading.Thread(target=lambda: errors.extend(p.stderr), daemon=True).start()
    last = 0
    for line in p.stdout:
        if line.startswith('out_time_us=') and duration:
            try:
                pct = min(99, int(int(line.split('=')[1]) / 1e6 / duration * 100))
            except ValueError:
                continue
            if time.monotonic() - last > 3:
                last = time.monotonic()
                set_progress(item, pct)
    if p.wait() != 0:
        raise RuntimeError('ffmpeg: ' + ''.join(errors)[-800:])


def do_video(item, src):
    info = probe(src)
    streams = info.get('streams', [])
    v = next((s for s in streams if s.get('codec_type') == 'video'), None)
    a = next((s for s in streams if s.get('codec_type') == 'audio'), None)
    duration = float(info.get('format', {}).get('duration') or 0)
    item.meta.update({'duration': duration})
    if v:
        item.meta.update({'width': v.get('width'), 'height': v.get('height'), 'codec': v.get('codec_name')})
        try:
            make_thumb(src, item, seek=min(2.0, duration / 3) if duration else None)
        except RuntimeError:
            make_thumb(src, item)

    vcodec = v and v.get('codec_name')
    acodec = a and a.get('codec_name')
    h264_ok = vcodec == 'h264' and v.get('pix_fmt') in ('yuv420p', 'yuvj420p') and acodec in (None, 'aac', 'mp3')
    web_ok = item.ext in ('webm', 'ogv') and vcodec in ('vp8', 'vp9', 'av1', 'theora') and acodec in (None, 'opus', 'vorbis')

    if web_ok or not v:
        return
    out = item_path(item.id, 'preview.mp4')
    if h264_ok:
        if item.ext in ('mp4', 'm4v') and is_faststart(src):
            return
        # Перепаковка без перекодирования — секунды даже для больших файлов.
        run(['ffmpeg', '-v', 'error', '-y', '-i', str(src), '-map', '0:v:0', '-map', '0:a:0?',
             '-c', 'copy', '-movflags', '+faststart', str(out)])
    else:
        ffmpeg_with_progress(item, [
            '-i', str(src), '-map', '0:v:0', '-map', '0:a:0?',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
            '-vf', "scale='min(1920,iw)':-2",
            '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
            '-movflags', '+faststart', str(out),
        ], duration)
    item.preview_name, item.preview_mime = 'preview.mp4', 'video/mp4'


def do_audio(item, src):
    try:
        info = probe(src)
        item.meta['duration'] = float(info.get('format', {}).get('duration') or 0)
    except RuntimeError:
        pass
    if item.ext in BROWSER_AUDIO:
        return
    out = item_path(item.id, 'preview.m4a')
    run(['ffmpeg', '-v', 'error', '-y', '-i', str(src), '-vn', '-c:a', 'aac', '-b:a', '160k', str(out)])
    item.preview_name, item.preview_mime = 'preview.m4a', 'audio/mp4'


def pdf_text_and_thumb(item, pdf):
    try:
        item.content_text = decode_text(run(['pdftotext', '-enc', 'UTF-8', str(pdf), '-'], timeout=600))[:MAX_TEXT]
    except RuntimeError as e:
        log.warning('pdftotext %s: %s', item.id, e)
    try:
        info = run(['pdfinfo', str(pdf)], timeout=60).decode(errors='replace')
        for line in info.splitlines():
            if line.startswith('Pages:'):
                item.meta['pages'] = int(line.split(':')[1])
    except (RuntimeError, ValueError):
        pass
    base = item_path(item.id, 'thumb')
    run(['pdftoppm', '-jpeg', '-f', '1', '-l', '1', '-scale-to', '480', '-singlefile', str(pdf), str(base)], timeout=300)
    item.thumb_name = 'thumb.jpg'


def do_pdf(item, src):
    pdf_text_and_thumb(item, src)


def gotenberg_convert(src, ext, out):
    boundary = uuid.uuid4().hex
    with open(src, 'rb') as f:
        data = f.read()
    body = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="document.{ext}"\r\n'
        f'Content-Type: application/octet-stream\r\n\r\n'
    ).encode() + data + f'\r\n--{boundary}--\r\n'.encode()
    req = urllib.request.Request(
        settings.GOTENBERG_URL + '/forms/libreoffice/convert', data=body, method='POST',
        headers={'Content-Type': f'multipart/form-data; boundary={boundary}'},
    )
    with urllib.request.urlopen(req, timeout=600) as resp, open(out, 'wb') as f:
        while chunk := resp.read(1 << 20):
            f.write(chunk)


def do_office(item, src):
    if not settings.GOTENBERG_URL:
        return
    out = item_path(item.id, 'preview.pdf')
    gotenberg_convert(src, item.ext, out)
    item.preview_name, item.preview_mime = 'preview.pdf', 'application/pdf'
    pdf_text_and_thumb(item, out)


def do_text(item, src):
    with open(src, 'rb') as f:
        item.content_text = decode_text(f.read(2 * 1024 * 1024))[:MAX_TEXT]


HANDLERS = {'image': do_image, 'video': do_video, 'audio': do_audio, 'pdf': do_pdf, 'office': do_office, 'text': do_text}


def process_item(item: Item):
    src = item_path(item.id, item.storage_name)
    item.meta.pop('progress', None)
    item.status, item.error = Item.READY, ''
    handler = HANDLERS.get(item.category)
    try:
        if handler:
            handler(item, src)
    except ToolMissing as e:
        log.warning('нет программы %s — превью для %s пропущено', e, item.id)
    except Exception as e:  # noqa: BLE001 — любая ошибка одного файла не должна ронять воркер
        log.exception('ошибка обработки %s', item.id)
        item.error = str(e)[:2000]
        # Без превью видео может не воспроизвестись — помечаем явно; остальные типы просто без превью.
        if item.category == 'video' and not item.preview_name:
            item.status = Item.FAILED
    item.claimed_at = None
    if not Item.objects.filter(pk=item.pk).exists():
        return  # удалили, пока обрабатывали
    item.save(update_fields=['status', 'error', 'meta', 'content_text', 'preview_name', 'preview_mime',
                             'thumb_name', 'claimed_at', 'updated_at'])
    item.refresh_search()


def claim_next():
    with connection.cursor() as cur:
        cur.execute("""
            UPDATE core_item SET claimed_at = now()
            WHERE id = (
                SELECT id FROM core_item
                WHERE type = 'file' AND status = 'processing' AND claimed_at IS NULL
                ORDER BY size NULLS FIRST, created_at
                FOR UPDATE SKIP LOCKED LIMIT 1
            ) RETURNING id
        """)
        row = cur.fetchone()
    return row and row[0]


def worker_loop(stop: threading.Event):
    while not stop.is_set():
        close_old_connections()
        try:
            item_id = claim_next()
        except Exception:  # noqa: BLE001
            log.exception('очередь недоступна')
            stop.wait(5)
            continue
        if not item_id:
            stop.wait(2)
            continue
        item = Item.objects.filter(pk=item_id).first()
        if item:
            log.info('обработка %s (%s, %s)', item.title, item.category, item.id)
            process_item(item)


def release_stale():
    """Задачи, захваченные упавшим воркером, возвращаются в очередь."""
    cutoff = timezone.now() - timedelta(hours=12)
    Item.objects.filter(status=Item.PROCESSING, claimed_at__lt=cutoff).update(claimed_at=None)


def cleanup_uploads(days=7):
    """Брошенные незавершённые загрузки старше недели удаляются вместе с кусками."""
    old = Upload.objects.filter(updated_at__lt=timezone.now() - timedelta(days=days))
    for upload_id in list(old.values_list('id', flat=True)):
        upload_path(upload_id).unlink(missing_ok=True)
    old.delete()
