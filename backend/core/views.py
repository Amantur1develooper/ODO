import html
from datetime import timedelta
import json
import os
import re
import shutil
import urllib.request
import uuid
from functools import wraps
from urllib.parse import quote, urlparse

from django.conf import settings
from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ObjectDoesNotExist, ValidationError
from django.db import connection, transaction
from django.db.models import Count, Q
from django.http import HttpResponse, HttpResponseBase, JsonResponse, StreamingHttpResponse
from django.utils import timezone
from django.utils.http import content_disposition_header
from django.views.decorators.csrf import ensure_csrf_cookie

from .files import category_of, clean_name, item_dir, item_path, mime_of, remove_item_files, split_ext, upload_path
from .models import Activity, Comment, Folder, Item, Upload, User
from .processing import HANDLERS, decode_text


# --- инфраструктура -----------------------------------------------------------

class ApiError(Exception):
    def __init__(self, status, message, **extra):
        super().__init__(message)
        self.status, self.message, self.extra = status, message, extra


def api(methods=('GET',), write_methods=('POST', 'PUT', 'PATCH', 'DELETE'), editor=True, admin=False, auth=True):
    """editor=True — запись разрешена только редакторам; чтение доступно всем вошедшим."""

    def deco(fn):
        @wraps(fn)
        def wrapper(request, *args, **kwargs):
            try:
                if request.method not in methods:
                    raise ApiError(405, 'Метод не поддерживается')
                if auth and not request.user.is_authenticated:
                    raise ApiError(401, 'Требуется вход')
                if admin and request.user.role != User.ADMIN:
                    raise ApiError(403, 'Только для администратора')
                if editor and request.method in write_methods and not request.user.can_edit:
                    raise ApiError(403, 'Недостаточно прав: ваш доступ — просмотр и комментарии')
                result = fn(request, *args, **kwargs)
            except ApiError as e:
                return JsonResponse({'error': e.message, **e.extra}, status=e.status, json_dumps_params={'ensure_ascii': False})
            except ValidationError as e:
                return JsonResponse({'error': ' '.join(e.messages)}, status=400, json_dumps_params={'ensure_ascii': False})
            if isinstance(result, HttpResponseBase):
                return result
            return JsonResponse(result, safe=False, json_dumps_params={'ensure_ascii': False})

        return wrapper

    return deco


def body(request):
    try:
        data = json.loads(request.body or b'{}')
    except ValueError:
        raise ApiError(400, 'Некорректный JSON')
    if not isinstance(data, dict):
        raise ApiError(400, 'Ожидался объект JSON')
    return data


def text(data, key, max_len=1000, required=False, label='Поле'):
    value = data.get(key)
    value = value.strip()[:max_len] if isinstance(value, str) else ''
    if required and not value:
        raise ApiError(400, f'{label}: обязательно для заполнения')
    return value


def get_or_404(source, pk, message='Не найдено'):
    qs = source.objects.all() if isinstance(source, type) else source
    try:
        return qs.get(pk=pk)
    except (ObjectDoesNotExist, ValidationError, ValueError):
        raise ApiError(404, message)


# --- журнал действий -----------------------------------------------------------

def client_ip(request):
    ip = request.META.get('HTTP_X_REAL_IP') or request.META.get('REMOTE_ADDR') or ''
    return ip.strip() or None


def folder_path(folder_id):
    if not folder_id:
        return ''
    with connection.cursor() as cur:
        cur.execute("""
            WITH RECURSIVE up AS (
                SELECT id, parent_id, name, 0 AS depth FROM core_folder WHERE id = %s
                UNION ALL SELECT f.id, f.parent_id, f.name, up.depth + 1 FROM core_folder f JOIN up ON f.id = up.parent_id
            ) SELECT name FROM up ORDER BY depth DESC
        """, [folder_id])
        return ' › '.join(r[0] for r in cur.fetchall())[:1000]


def log_activity(request, action, item=None, folder=None, target='', user=None, **details):
    user = user or (request.user if request.user.is_authenticated else None)
    folder_id = item.folder_id if item else (folder.pk if folder else None)
    entry = Activity(
        user=user, user_name=user.name if user else '', action=action,
        item=item if item and item.pk else None, folder_id=folder_id,
        target=(target or (item.title if item else folder.name if folder else ''))[:500],
        path=folder_path(item.folder_id if item else (folder.parent_id if folder else None)),
        details=details, ip=client_ip(request),
    )
    entry.save()
    return entry


# --- сериализация ---------------------------------------------------------------

def user_json(u):
    return {
        'id': str(u.id), 'username': u.username, 'email': u.email, 'name': u.name, 'role': u.role, 'is_active': u.is_active,
        'last_login': u.last_login and u.last_login.isoformat(), 'can_edit': u.can_edit,
    }


def folder_json(f, item_count=None):
    return {
        'id': str(f.id), 'parent_id': f.parent_id and str(f.parent_id), 'kind': f.kind, 'name': f.name,
        'description': f.description, 'created_at': f.created_at.isoformat(), 'updated_at': f.updated_at.isoformat(),
        'item_count': item_count if item_count is not None else getattr(f, 'item_count', 0),
    }


def item_json(i, comment_count=None):
    return {
        'id': str(i.id), 'folder_id': str(i.folder_id), 'type': i.type, 'title': i.title,
        'description': i.description, 'url': i.url, 'original_name': i.original_name, 'ext': i.ext,
        'mime': i.mime, 'size': i.size, 'category': i.category, 'status': i.status, 'error': i.error,
        'meta': i.meta, 'has_thumb': bool(i.thumb_name), 'has_preview': bool(i.preview_name),
        'preview_mime': i.preview_mime,
        'created_at': i.created_at.isoformat(), 'updated_at': i.updated_at.isoformat(),
        'created_by_name': i.created_by.name if i.created_by_id and i.created_by else None,
        'comment_count': comment_count if comment_count is not None else getattr(i, 'comment_count', 0),
    }


def items_qs():
    return Item.objects.select_related('created_by').annotate(comment_count=Count('comments')).defer('content_text', 'search')


def comment_json(c, request):
    return {
        'id': str(c.id), 'body': c.body, 'created_at': c.created_at.isoformat(), 'updated_at': c.updated_at.isoformat(),
        'user_id': c.user_id and str(c.user_id), 'user_name': c.user.name if c.user else 'Удалённый пользователь',
        'can_delete': c.user_id == request.user.id or request.user.can_edit,
        'can_edit': c.user_id == request.user.id,
    }


# --- авторизация ----------------------------------------------------------------

@ensure_csrf_cookie
@api(auth=False)
def me(request):
    return {'user': user_json(request.user) if request.user.is_authenticated else None}


@api(methods=('POST',), auth=False, editor=False)
def login_view(request):
    data = body(request)
    user = authenticate(request, username=text(data, 'username', 150).lower(), password=data.get('password') or '')
    if not user:
        raise ApiError(400, 'Неверный логин или пароль')
    login(request, user)
    log_activity(request, 'login', user=user, target=user.name)
    return {'user': user_json(user)}


@api(methods=('POST',), auth=False, editor=False)
def logout_view(request):
    logout(request)
    return {'ok': True}


@api(methods=('POST',), editor=False)
def change_password(request):
    data = body(request)
    if not request.user.check_password(data.get('old_password') or ''):
        raise ApiError(400, 'Текущий пароль указан неверно')
    new = data.get('new_password') or ''
    validate_password(new, request.user)
    request.user.set_password(new)
    request.user.save()
    update_session_auth_hash(request, request.user)
    return {'ok': True}


# --- пользователи (только админ) --------------------------------------------------

USERNAME_RE = re.compile(r'^[\w.-]{2,150}$')


def validate_username(data, exclude_pk=None):
    username = text(data, 'username', 150, True, 'Логин').lower()
    if not USERNAME_RE.match(username):
        raise ApiError(400, 'Логин: от 2 символов, только буквы, цифры, точка, дефис и подчёркивание')
    if User.objects.filter(username=username).exclude(pk=exclude_pk).exists():
        raise ApiError(400, 'Такой логин уже занят')
    return username


def validate_email_field(data):
    email = text(data, 'email', 254).lower()
    if email and not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email):
        raise ApiError(400, 'Некорректный email')
    return email


def validate_role(role):
    if role not in dict(User.ROLES):
        raise ApiError(400, 'Неизвестная роль')
    return role


@api(methods=('GET', 'POST'), admin=True)
def users(request):
    if request.method == 'GET':
        return [user_json(u) for u in User.objects.all()]
    data = body(request)
    username = validate_username(data)
    password = data.get('password') or ''
    validate_password(password)
    user = User.objects.create_user(username, password, name=text(data, 'name', 150, True, 'Имя'),
                                    email=validate_email_field(data),
                                    role=validate_role(data.get('role') or User.VIEWER))
    log_activity(request, 'user_create', target=f'{user.name} ({user.username})', role=user.role)
    return user_json(user)


@api(methods=('PATCH', 'DELETE'), admin=True)
def user_detail(request, pk):
    user = get_or_404(User, pk, 'Пользователь не найден')
    if request.method == 'DELETE':
        if user.pk == request.user.pk:
            raise ApiError(400, 'Нельзя удалить самого себя')
        log_activity(request, 'user_delete', target=f'{user.name} ({user.username})')
        user.delete()
        return {'ok': True}
    data = body(request)
    if 'name' in data:
        user.name = text(data, 'name', 150, True, 'Имя')
    if 'username' in data:
        user.username = validate_username(data, exclude_pk=user.pk)
    if 'email' in data:
        user.email = validate_email_field(data)
    if 'role' in data:
        if user.pk == request.user.pk and data['role'] != User.ADMIN:
            raise ApiError(400, 'Нельзя снять с себя роль администратора')
        user.role = validate_role(data['role'])
    if 'is_active' in data:
        if user.pk == request.user.pk and not data['is_active']:
            raise ApiError(400, 'Нельзя заблокировать самого себя')
        user.is_active = bool(data['is_active'])
    if data.get('password'):
        validate_password(data['password'], user)
        user.set_password(data['password'])
    user.save()
    changed = sorted(k for k in data if k in ('name', 'username', 'email', 'role', 'is_active', 'password'))
    log_activity(request, 'user_edit', target=f'{user.name} ({user.username})', fields=changed)
    return user_json(user)


# --- папки: объекты, группы, разделы --------------------------------------------

def validate_kind(kind):
    if kind not in dict(Folder.KINDS):
        raise ApiError(400, 'Неизвестный тип папки')
    return kind


def parse_parent(value):
    if not value:
        return None
    return get_or_404(Folder, value, 'Родительская папка не найдена')


def subtree_ids(folder_id):
    with connection.cursor() as cur:
        cur.execute("""
            WITH RECURSIVE t AS (
                SELECT id FROM core_folder WHERE id = %s
                UNION ALL SELECT f.id FROM core_folder f JOIN t ON f.parent_id = t.id
            ) SELECT id FROM t
        """, [folder_id])
        return [r[0] for r in cur.fetchall()]


@api(methods=('GET', 'POST'))
def folders(request):
    if request.method == 'GET':
        qs = Folder.objects.annotate(item_count=Count('items')).order_by('name')
        return [folder_json(f) for f in qs]
    data = body(request)
    folder = Folder.objects.create(
        parent=parse_parent(data.get('parent_id')),
        kind=validate_kind(data.get('kind') or Folder.SECTION),
        name=text(data, 'name', 255, True, 'Название'),
        description=text(data, 'description', 5000),
        created_by=request.user,
    )
    log_activity(request, 'folder_create', folder=folder, kind=folder.kind)
    return folder_json(folder, 0)


@api(methods=('GET', 'PATCH', 'DELETE'))
def folder_detail(request, pk):
    folder = get_or_404(Folder, pk, 'Папка не найдена')
    if request.method == 'GET':
        return folder_json(folder, folder.items.count())
    if request.method == 'DELETE':
        ids = subtree_ids(folder.pk)
        file_ids = list(Item.objects.filter(folder_id__in=ids, type=Item.FILE).values_list('id', flat=True))
        upload_ids = list(Upload.objects.filter(folder_id__in=ids).values_list('id', flat=True))
        log_activity(request, 'folder_delete', folder=folder, kind=folder.kind, files=len(file_ids))
        folder.delete()
        for fid in file_ids:
            remove_item_files(fid)
        for uid in upload_ids:
            upload_path(uid).unlink(missing_ok=True)
        return {'ok': True, 'deleted_items': len(file_ids)}
    data = body(request)
    old_parent = folder.parent_id
    if 'name' in data:
        folder.name = text(data, 'name', 255, True, 'Название')
    if 'description' in data:
        folder.description = text(data, 'description', 5000)
    if 'kind' in data:
        folder.kind = validate_kind(data['kind'])
    if 'parent_id' in data:
        parent = parse_parent(data['parent_id'])
        if parent and parent.pk in subtree_ids(folder.pk):
            raise ApiError(400, 'Нельзя переместить папку внутрь самой себя')
        folder.parent = parent
    folder.save()
    if folder.parent_id != old_parent:
        log_activity(request, 'folder_move', folder=folder, from_path=folder_path(old_parent))
    else:
        log_activity(request, 'folder_edit', folder=folder)
    return folder_json(folder, folder.items.count())


@api()
def folder_items(request, pk):
    folder = get_or_404(Folder, pk, 'Папка не найдена')
    return [item_json(i) for i in items_qs().filter(folder=folder)]


# --- документы и ссылки ---------------------------------------------------------

@api()
def recent_items(request):
    limit = min(int(request.GET.get('limit') or 24), 100)
    return [item_json(i) for i in items_qs().order_by('-created_at')[:limit]]


def fetch_title(url):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (ODO link preview)'})
        with urllib.request.urlopen(req, timeout=4) as r:
            if 'html' not in (r.headers.get('Content-Type') or ''):
                return ''
            page = r.read(300_000).decode(r.headers.get_content_charset() or 'utf-8', errors='replace')
        m = re.search(r'<title[^>]*>(.*?)</title>', page, re.I | re.S)
        return html.unescape(re.sub(r'\s+', ' ', m.group(1))).strip()[:300] if m else ''
    except Exception:  # noqa: BLE001 — заголовок необязателен
        return ''


def normalize_url(raw):
    url = (raw or '').strip()
    if url and not re.match(r'^[a-z][a-z0-9+.-]*://', url, re.I):
        url = 'https://' + url
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https') or not parsed.netloc:
        raise ApiError(400, 'Укажите корректную ссылку (http/https)')
    return url[:4000]


@api(methods=('POST',))
def create_link(request):
    data = body(request)
    folder = get_or_404(Folder, data.get('folder_id'), 'Папка не найдена')
    url = normalize_url(data.get('url'))
    title = text(data, 'title', 500) or fetch_title(url) or urlparse(url).netloc
    item = Item.objects.create(folder=folder, type=Item.LINK, category='link', title=title, url=url,
                               description=text(data, 'description', 10000), created_by=request.user)
    item.refresh_search()
    log_activity(request, 'link_create', item=item, url=url)
    return item_json(items_qs().get(pk=item.pk))


@api(methods=('GET', 'PATCH', 'DELETE'))
def item_detail(request, pk):
    item = get_or_404(items_qs(), pk, 'Документ не найден')
    if request.method == 'GET':
        return item_json(item)
    if request.method == 'DELETE':
        log_activity(request, 'item_delete', item=item)
        item.delete()
        remove_item_files(item.pk)
        return {'ok': True}
    data = body(request)
    old_folder = item.folder_id
    if 'title' in data:
        item.title = text(data, 'title', 500, True, 'Название')
    if 'description' in data:
        item.description = text(data, 'description', 10000)
    if 'url' in data and item.type == Item.LINK:
        item.url = normalize_url(data['url'])
    if 'folder_id' in data:
        item.folder = get_or_404(Folder, data['folder_id'], 'Папка не найдена')
    item.save()
    item.refresh_search()
    if item.folder_id != old_folder:
        log_activity(request, 'item_move', item=item, from_path=folder_path(old_folder))
    else:
        log_activity(request, 'item_edit', item=item)
    return item_json(item)


@api(methods=('POST',))
def items_bulk(request):
    data = body(request)
    ids = [i for i in data.get('ids') or [] if isinstance(i, str)][:1000]
    try:
        qs = Item.objects.filter(pk__in=ids)
        list(qs[:1])
    except ValidationError:
        raise ApiError(400, 'Некорректные идентификаторы')
    action = data.get('action')
    if action == 'delete':
        for item in qs:
            log_activity(request, 'item_delete', item=item)
        file_ids = list(qs.filter(type=Item.FILE).values_list('id', flat=True))
        count = qs.delete()[1].get('core.Item', 0)
        for fid in file_ids:
            remove_item_files(fid)
        return {'ok': True, 'count': count}
    if action == 'move':
        folder = get_or_404(Folder, data.get('folder_id'), 'Папка не найдена')
        moved = list(qs.exclude(folder=folder))
        count = qs.update(folder=folder)
        for item in moved:
            from_path = folder_path(item.folder_id)
            item.folder_id = folder.pk
            log_activity(request, 'item_move', item=item, from_path=from_path)
        return {'ok': True, 'count': count}
    raise ApiError(400, 'Неизвестное действие')


@api(methods=('POST',))
def item_reprocess(request, pk):
    item = get_or_404(Item, pk, 'Документ не найден')
    if item.type != Item.FILE:
        raise ApiError(400, 'Это не файл')
    for name in (item.preview_name, item.thumb_name):
        if name:
            item_path(item.id, name).unlink(missing_ok=True)
    item.preview_name = item.preview_mime = item.thumb_name = item.error = ''
    item.status, item.claimed_at = Item.PROCESSING, None
    item.save()
    return {'ok': True}


# --- отдача файлов --------------------------------------------------------------

UNSAFE_INLINE = ('html', 'xml', 'javascript', 'svg')
RANGE_RE = re.compile(r'bytes=(\d*)-(\d*)$')


def ranged_file_response(request, path, content_type):
    """Отдача с поддержкой Range — для режима без nginx (разработка)."""
    size = path.stat().st_size
    m = RANGE_RE.match(request.headers.get('Range', ''))
    start, end = 0, size - 1
    status = 200
    if m and (m.group(1) or m.group(2)):
        if m.group(1):
            start = int(m.group(1))
            end = min(int(m.group(2)), size - 1) if m.group(2) else size - 1
        else:
            start = max(0, size - int(m.group(2)))
        if start > end or start >= size:
            resp = HttpResponse(status=416)
            resp['Content-Range'] = f'bytes */{size}'
            return resp
        status = 206

    def stream():
        with open(path, 'rb') as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(1 << 20, left))
                if not chunk:
                    break
                left -= len(chunk)
                yield chunk

    resp = StreamingHttpResponse(stream(), status=status, content_type=content_type)
    resp['Content-Length'] = str(end - start + 1)
    resp['Accept-Ranges'] = 'bytes'
    if status == 206:
        resp['Content-Range'] = f'bytes {start}-{end}/{size}'
    return resp


def serve(request, path, mime, filename, download=False):
    if not path.is_file():
        raise ApiError(404, 'Файл не найден на диске')
    unsafe = any(x in mime for x in UNSAFE_INLINE)
    content_type = mime
    if unsafe and not download and 'svg' not in mime:
        content_type = 'text/plain; charset=utf-8'
    if settings.USE_X_ACCEL and not unsafe:
        resp = HttpResponse(content_type=content_type)
        resp['X-Accel-Redirect'] = settings.X_ACCEL_PREFIX + quote(str(path.relative_to(settings.DATA_DIR)))
    else:
        resp = ranged_file_response(request, path, content_type)
    resp['Content-Disposition'] = content_disposition_header(download, filename)
    resp['X-Content-Type-Options'] = 'nosniff'
    resp['Cache-Control'] = 'private, max-age=3600'
    if unsafe:
        resp['Content-Security-Policy'] = 'sandbox'
    return resp


def file_item(pk):
    item = get_or_404(Item, pk, 'Документ не найден')
    if item.type != Item.FILE:
        raise ApiError(400, 'Это не файл')
    return item


@api()
def item_raw(request, pk):
    item = file_item(pk)
    download = request.GET.get('download') == '1'
    # Докачка присылает Range — считаем скачиванием только первый запрос.
    if download and request.headers.get('Range', 'bytes=0-').startswith('bytes=0-'):
        log_activity(request, 'download', item=item, size=item.size)
    return serve(request, item_path(item.id, item.storage_name), item.mime, item.original_name, download=download)


@api(methods=('POST',), editor=False)
def item_viewed(request, pk):
    item = get_or_404(Item, pk, 'Документ не найден')
    recent = Activity.objects.filter(user=request.user, item=item, action='view',
                                     created_at__gte=timezone.now() - timedelta(minutes=10))
    if not recent.exists():
        log_activity(request, 'view', item=item)
    return {'ok': True}


@api()
def item_preview(request, pk):
    item = file_item(pk)
    if not item.preview_name:
        raise ApiError(404, 'Превью ещё не готово')
    stem, _ = split_ext(item.original_name)
    _, ext = split_ext(item.preview_name)
    return serve(request, item_path(item.id, item.preview_name), item.preview_mime, f'{stem}.{ext}')


@api()
def item_thumb(request, pk):
    item = file_item(pk)
    if not item.thumb_name:
        raise ApiError(404, 'Нет миниатюры')
    return serve(request, item_path(item.id, item.thumb_name), 'image/jpeg', 'thumb.jpg')


@api()
def item_text(request, pk):
    item = file_item(pk)
    path = item_path(item.id, item.storage_name)
    limit = 2 * 1024 * 1024
    with open(path, 'rb') as f:
        raw = f.read(limit + 1)
    return {'text': decode_text(raw[:limit]), 'truncated': len(raw) > limit}


# --- комментарии ----------------------------------------------------------------

@api(methods=('GET', 'POST'), editor=False)
def item_comments(request, pk):
    item = get_or_404(Item, pk, 'Документ не найден')
    if request.method == 'GET':
        return [comment_json(c, request) for c in item.comments.select_related('user')]
    data = body(request)
    c = Comment.objects.create(item=item, user=request.user, body=text(data, 'body', 5000, True, 'Комментарий'))
    log_activity(request, 'comment', item=item, text=c.body[:300])
    return comment_json(c, request)


@api(methods=('PATCH', 'DELETE'), editor=False)
def comment_detail(request, pk):
    c = get_or_404(Comment.objects.select_related('user'), pk, 'Комментарий не найден')
    if request.method == 'DELETE':
        if not (c.user_id == request.user.id or request.user.can_edit):
            raise ApiError(403, 'Можно удалять только свои комментарии')
        c.delete()
        return {'ok': True}
    if c.user_id != request.user.id:
        raise ApiError(403, 'Можно изменять только свои комментарии')
    c.body = text(body(request), 'body', 5000, True, 'Комментарий')
    c.save()
    return comment_json(c, request)


# --- загрузка файлов по кускам (с докачкой) -------------------------------------

def upload_json(u):
    return {'id': str(u.id), 'offset': u.offset, 'size': u.size, 'chunk_size': settings.UPLOAD_CHUNK_BYTES}


@api(methods=('POST',))
def uploads(request):
    data = body(request)
    folder = get_or_404(Folder, data.get('folder_id'), 'Папка не найдена')
    try:
        size = int(data.get('size'))
    except (TypeError, ValueError):
        raise ApiError(400, 'Не указан размер файла')
    if size < 0:
        raise ApiError(400, 'Некорректный размер')
    if size > settings.MAX_UPLOAD_BYTES:
        raise ApiError(413, f'Файл больше {settings.MAX_UPLOAD_BYTES // 1024 ** 3} ГБ')
    upload_path('x').parent.mkdir(parents=True, exist_ok=True)
    free = shutil.disk_usage(settings.DATA_DIR).free
    if size > free - 512 * 1024 * 1024:
        raise ApiError(507, 'На сервере недостаточно места')
    upload = Upload.objects.create(folder=folder, user=request.user, size=size,
                                   filename=clean_name(data.get('filename')))
    upload_path(upload.id).touch()
    if size == 0:
        return {**upload_json(upload), 'done': True, 'item': finalize_upload(request, upload)}
    return upload_json(upload)


@api(methods=('GET', 'PUT', 'DELETE'))
def upload_detail(request, pk):
    upload = get_or_404(Upload, pk, 'Загрузка не найдена или устарела')
    if upload.user_id != request.user.id:
        raise ApiError(403, 'Чужая загрузка')
    if request.method == 'GET':
        return upload_json(upload)
    path = upload_path(upload.id)
    if request.method == 'DELETE':
        upload.delete()
        path.unlink(missing_ok=True)
        return {'ok': True}

    try:
        offset = int(request.GET.get('offset', ''))
        length = int(request.headers.get('Content-Length') or 0)
    except ValueError:
        raise ApiError(400, 'Не указан offset')
    if offset != upload.offset:
        raise ApiError(409, 'Смещение не совпадает', offset=upload.offset)
    if length <= 0 or length > settings.UPLOAD_CHUNK_BYTES or offset + length > upload.size:
        raise ApiError(400, 'Некорректный размер куска')

    written = 0
    with open(path, 'r+b') as f:
        f.seek(offset)
        while written < length:
            chunk = request.read(min(1 << 20, length - written))
            if not chunk:
                break
            f.write(chunk)
            written += len(chunk)
        f.truncate(offset + written)
    if written != length:
        raise ApiError(400, 'Соединение прервано, повторите кусок', offset=offset)
    upload.offset = offset + written
    upload.save(update_fields=['offset', 'updated_at'])
    if upload.offset < upload.size:
        return upload_json(upload)
    return {**upload_json(upload), 'done': True, 'item': finalize_upload(request, upload)}


def finalize_upload(request, upload):
    name = upload.filename
    stem, ext = split_ext(name)
    mime = mime_of(ext)
    category = category_of(ext, mime)
    item = Item(folder_id=upload.folder_id, type=Item.FILE, title=stem, original_name=name, ext=ext, mime=mime,
                size=upload.size, category=category, storage_name='original' + (f'.{ext}' if ext else ''),
                status=Item.PROCESSING if category in HANDLERS else Item.READY, created_by_id=upload.user_id)
    target = item_dir(item.id)
    target.mkdir(parents=True, exist_ok=True)
    os.replace(upload_path(upload.id), target / item.storage_name)
    try:
        with transaction.atomic():
            item.save()
            upload.delete()
    except Exception:
        remove_item_files(item.id)
        raise
    item.refresh_search()
    log_activity(request, 'upload', item=item, size=item.size)
    return item_json(items_qs().get(pk=item.pk))


# --- поиск ----------------------------------------------------------------------

CATEGORY_FILTERS = {
    'docs': "AND i.category IN ('pdf', 'office', 'text')",
    'media': "AND i.category IN ('video', 'audio')",
    'images': "AND i.category = 'image'",
    'links': "AND i.type = 'link'",
}


@api()
def search(request):
    q = (request.GET.get('q') or '').strip()[:200]
    kind = request.GET.get('type') or ''
    limit = min(int(request.GET.get('limit') or 50), 100)
    terms = re.findall(r'[^\W_]+', q.lower())[:10]
    if not terms:
        return {'folders': [], 'items': []}
    tsq = ' & '.join(f'{t}:*' for t in terms)
    like = '%' + re.sub(r'([%_\\])', r'\\\1', q) + '%'

    with connection.cursor() as cur:
        cur.execute(f"""
            SELECT i.id,
                   ts_rank(i.search, query) + CASE WHEN i.title ILIKE %(like)s THEN 1 ELSE 0 END AS rank
            FROM core_item i, to_tsquery('russian', %(tsq)s) query
            WHERE (i.search @@ query OR i.title ILIKE %(like)s OR i.original_name ILIKE %(like)s
                   OR EXISTS (SELECT 1 FROM core_comment c WHERE c.item_id = i.id AND c.body ILIKE %(like)s))
                  {CATEGORY_FILTERS.get(kind, '')}
            ORDER BY rank DESC, i.created_at DESC
            LIMIT %(limit)s
        """, {'tsq': tsq, 'like': like, 'limit': limit})
        ids = [r[0] for r in cur.fetchall()]
        snippets = {}
        if ids:
            cur.execute("""
                SELECT id, ts_headline('russian',
                    CASE WHEN content_text <> '' THEN left(content_text, 60000) ELSE description END,
                    to_tsquery('russian', %s),
                    'StartSel=[[[, StopSel=]]], MaxFragments=2, MaxWords=24, MinWords=10, FragmentDelimiter=" … "')
                FROM core_item WHERE id = ANY(%s)
            """, [tsq, ids])
            snippets = {r[0]: r[1] for r in cur.fetchall()}

    by_id = {i.id: i for i in items_qs().filter(pk__in=ids)}
    items = []
    for pk in ids:
        if pk in by_id:
            items.append({**item_json(by_id[pk]), 'snippet': snippets.get(pk) or ''})

    folders_found = []
    if not kind:
        fq = Folder.objects.filter(Q(name__icontains=q) | Q(description__icontains=q)).annotate(item_count=Count('items'))
        folders_found = [folder_json(f) for f in fq[:20]]
    return {'folders': folders_found, 'items': items}


# --- журнал (только администратор) ----------------------------------------------

ACTION_GROUPS = {
    'downloads': ['download'],
    'views': ['view'],
    'uploads': ['upload', 'link_create'],
    'changes': ['item_edit', 'item_move', 'folder_create', 'folder_edit', 'folder_move', 'comment'],
    'deletes': ['item_delete', 'folder_delete'],
    'logins': ['login'],
    'users': ['user_create', 'user_edit', 'user_delete'],
}


def activity_json(a):
    return {
        'id': a.id, 'action': a.action, 'action_label': a.get_action_display(),
        'user_id': a.user_id and str(a.user_id), 'user_name': a.user_name or 'Система',
        'item_id': a.item_id and str(a.item_id), 'folder_id': a.folder_id and str(a.folder_id),
        'target': a.target, 'path': a.path, 'details': a.details, 'ip': a.ip,
        'created_at': a.created_at.isoformat(),
    }


@api(admin=True)
def activity(request):
    qs = Activity.objects.all()
    g = request.GET
    if g.get('group') in ACTION_GROUPS:
        qs = qs.filter(action__in=ACTION_GROUPS[g['group']])
    for key, field in (('user', 'user_id'), ('item', 'item_id')):
        if g.get(key):
            try:
                qs = qs.filter(**{field: uuid.UUID(g[key])})
            except ValueError:
                raise ApiError(400, 'Некорректный фильтр')
    if g.get('q'):
        q = g['q'].strip()[:200]
        qs = qs.filter(Q(target__icontains=q) | Q(path__icontains=q) | Q(user_name__icontains=q))
    if g.get('before', '').isdigit():
        qs = qs.filter(id__lt=int(g['before']))
    limit = min(int(g.get('limit') or 100), 300)
    rows = list(qs[:limit + 1])
    return {'items': [activity_json(a) for a in rows[:limit]], 'has_more': len(rows) > limit}
