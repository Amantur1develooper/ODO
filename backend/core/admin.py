from django import forms
from django.contrib import admin

from .models import Activity, Comment, Folder, Item, User


class UserForm(forms.ModelForm):
    password1 = forms.CharField(label='Новый пароль', required=False, widget=forms.PasswordInput,
                                help_text='Оставьте пустым, чтобы не менять')

    class Meta:
        model = User
        fields = ['username', 'name', 'email', 'role', 'is_active']

    def save(self, commit=True):
        user = super().save(commit=False)
        if self.cleaned_data.get('password1'):
            user.set_password(self.cleaned_data['password1'])
        elif not user.pk:
            user.set_unusable_password()
        if commit:
            user.save()
        return user


@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    form = UserForm
    list_display = ['name', 'username', 'email', 'role', 'is_active', 'last_login']
    list_filter = ['role', 'is_active']
    search_fields = ['name', 'username', 'email']


@admin.register(Folder)
class FolderAdmin(admin.ModelAdmin):
    list_display = ['name', 'kind', 'parent', 'created_at']
    list_filter = ['kind']
    search_fields = ['name', 'description']
    raw_id_fields = ['parent']


@admin.register(Item)
class ItemAdmin(admin.ModelAdmin):
    list_display = ['title', 'type', 'category', 'size', 'status', 'folder', 'created_at']
    list_filter = ['type', 'category', 'status']
    search_fields = ['title', 'original_name', 'url']
    raw_id_fields = ['folder']
    readonly_fields = ['original_name', 'ext', 'mime', 'size', 'storage_name', 'preview_name', 'thumb_name', 'error', 'meta']


@admin.register(Comment)
class CommentAdmin(admin.ModelAdmin):
    list_display = ['item', 'user', 'created_at']
    search_fields = ['body']


@admin.register(Activity)
class ActivityAdmin(admin.ModelAdmin):
    list_display = ['created_at', 'user_name', 'action', 'target', 'path', 'ip']
    list_filter = ['action']
    search_fields = ['user_name', 'target', 'path']
    readonly_fields = [f.name for f in Activity._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
