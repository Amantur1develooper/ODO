import uuid

from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.contrib.postgres.indexes import GinIndex
from django.contrib.postgres.search import SearchVector, SearchVectorField
from django.db import models
from django.utils import timezone


class UserManager(BaseUserManager):
    def create_user(self, username, password=None, **extra):
        user = self.model(username=username.strip().lower(), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, username, password=None, **extra):
        extra.setdefault('role', User.ADMIN)
        extra.setdefault('name', 'Администратор')
        return self.create_user(username, password, **extra)

    def get_by_natural_key(self, username):
        return self.get(username__iexact=username)


class User(AbstractBaseUser, PermissionsMixin):
    ADMIN, EDITOR, VIEWER = 'admin', 'editor', 'viewer'
    ROLES = [
        (ADMIN, 'Администратор'),
        (EDITOR, 'Редактор — добавляет, изменяет, удаляет'),
        (VIEWER, 'Наблюдатель — смотрит и комментирует'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    username = models.CharField('логин', max_length=150, unique=True,
                                help_text='Латиница, цифры, точка, дефис или подчёркивание')
    email = models.EmailField('email', blank=True, default='')
    name = models.CharField('имя', max_length=150)
    role = models.CharField('роль', max_length=10, choices=ROLES, default=VIEWER)
    is_active = models.BooleanField('активен', default=True)
    is_staff = models.BooleanField('доступ в /admin', default=False, editable=False)
    date_joined = models.DateTimeField('создан', default=timezone.now)

    objects = UserManager()
    USERNAME_FIELD = 'username'
    REQUIRED_FIELDS = ['name']

    class Meta:
        verbose_name = 'пользователь'
        verbose_name_plural = 'пользователи'
        ordering = ['name']

    def save(self, *args, **kwargs):
        self.username = self.username.strip().lower()
        self.email = (self.email or '').strip().lower()
        self.is_staff = self.is_superuser = self.role == self.ADMIN
        super().save(*args, **kwargs)

    @property
    def can_edit(self):
        return self.is_active and self.role in (self.ADMIN, self.EDITOR)

    def __str__(self):
        return f'{self.name} ({self.username})'


class Folder(models.Model):
    """Объект, группа или раздел. Вкладываются друг в друга как папки на компьютере."""

    OBJECT, GROUP, SECTION = 'object', 'group', 'section'
    KINDS = [(OBJECT, 'Объект'), (GROUP, 'Группа'), (SECTION, 'Раздел')]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    parent = models.ForeignKey('self', null=True, blank=True, on_delete=models.CASCADE, related_name='children', verbose_name='внутри')
    kind = models.CharField('тип', max_length=10, choices=KINDS, default=SECTION)
    name = models.CharField('название', max_length=255)
    description = models.TextField('описание', blank=True, default='')
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'папка (объект / группа / раздел)'
        verbose_name_plural = 'папки (объекты / группы / разделы)'
        ordering = ['name']
        indexes = [GinIndex(fields=['name'], name='folder_name_trgm', opclasses=['gin_trgm_ops'])]

    def __str__(self):
        return f'{self.get_kind_display()}: {self.name}'


class Item(models.Model):
    """Файл или ссылка внутри папки."""

    FILE, LINK = 'file', 'link'
    PROCESSING, READY, FAILED = 'processing', 'ready', 'failed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    folder = models.ForeignKey(Folder, on_delete=models.CASCADE, related_name='items', verbose_name='папка')
    type = models.CharField('тип', max_length=10, choices=[(FILE, 'Файл'), (LINK, 'Ссылка')])
    title = models.CharField('название', max_length=500)
    description = models.TextField('описание', blank=True, default='')
    url = models.TextField('ссылка', blank=True, default='')
    original_name = models.CharField(max_length=500, blank=True, default='')
    ext = models.CharField(max_length=20, blank=True, default='')
    mime = models.CharField(max_length=200, blank=True, default='')
    size = models.BigIntegerField(null=True, blank=True)
    category = models.CharField(max_length=20, default='other')
    storage_name = models.CharField(max_length=100, blank=True, default='')
    preview_name = models.CharField(max_length=100, blank=True, default='')
    preview_mime = models.CharField(max_length=100, blank=True, default='')
    thumb_name = models.CharField(max_length=100, blank=True, default='')
    status = models.CharField(max_length=12, default=READY,
                              choices=[(PROCESSING, 'Обработка'), (READY, 'Готово'), (FAILED, 'Ошибка')])
    error = models.TextField(blank=True, default='')
    meta = models.JSONField(default=dict, blank=True)
    content_text = models.TextField(blank=True, default='', editable=False)
    claimed_at = models.DateTimeField(null=True, blank=True, editable=False)
    search = SearchVectorField(null=True, editable=False)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'документ'
        verbose_name_plural = 'документы'
        ordering = ['-created_at']
        indexes = [
            GinIndex(fields=['search'], name='item_search_gin'),
            GinIndex(fields=['title'], name='item_title_trgm', opclasses=['gin_trgm_ops']),
            models.Index(fields=['status', 'claimed_at'], name='item_queue_idx'),
        ]

    def __str__(self):
        return self.title

    def refresh_search(self):
        Item.objects.filter(pk=self.pk).update(search=(
            SearchVector('title', weight='A', config='russian')
            + SearchVector('description', 'original_name', 'url', weight='B', config='russian')
            + SearchVector('content_text', weight='C', config='russian')
        ))


class Comment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name='comments')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name='+')
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'комментарий'
        verbose_name_plural = 'комментарии'
        ordering = ['created_at']
        indexes = [GinIndex(fields=['body'], name='comment_body_trgm', opclasses=['gin_trgm_ops'])]


class Upload(models.Model):
    """Незавершённая загрузка: файл собирается по кускам и может докачиваться."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    folder = models.ForeignKey(Folder, on_delete=models.CASCADE, related_name='+')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='+')
    filename = models.CharField(max_length=500)
    size = models.BigIntegerField()
    offset = models.BigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class Activity(models.Model):
    """Журнал действий: кто что загрузил, открыл, скачал, изменил или удалил."""

    ACTIONS = [
        ('login', 'Вход в систему'),
        ('upload', 'Загрузил файл'),
        ('view', 'Открыл'),
        ('download', 'Скачал'),
        ('link_create', 'Добавил ссылку'),
        ('item_edit', 'Изменил документ'),
        ('item_move', 'Переместил документ'),
        ('item_delete', 'Удалил документ'),
        ('folder_create', 'Создал папку'),
        ('folder_edit', 'Изменил папку'),
        ('folder_move', 'Переместил папку'),
        ('folder_delete', 'Удалил папку'),
        ('comment', 'Прокомментировал'),
        ('user_create', 'Создал пользователя'),
        ('user_edit', 'Изменил пользователя'),
        ('user_delete', 'Удалил пользователя'),
    ]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name='+')
    user_name = models.CharField('кто', max_length=150, default='')
    action = models.CharField('действие', max_length=20, choices=ACTIONS)
    item = models.ForeignKey(Item, null=True, blank=True, on_delete=models.SET_NULL, related_name='activity')
    folder = models.ForeignKey(Folder, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    # Снимок названия и пути: запись остаётся понятной даже после удаления файла.
    target = models.CharField('объект', max_length=500, blank=True, default='')
    path = models.CharField('где', max_length=1000, blank=True, default='')
    details = models.JSONField(default=dict, blank=True)
    ip = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = 'запись журнала'
        verbose_name_plural = 'журнал действий'
        ordering = ['-id']
        indexes = [
            models.Index(fields=['item', '-id'], name='activity_item_idx'),
            models.Index(fields=['user', '-id'], name='activity_user_idx'),
            models.Index(fields=['action', '-id'], name='activity_action_idx'),
        ]

    def __str__(self):
        return f'{self.user_name}: {self.get_action_display()} {self.target}'
