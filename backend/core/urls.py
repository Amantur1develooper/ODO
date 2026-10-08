from django.urls import path

from . import views

urlpatterns = [
    path('auth/me', views.me),
    path('auth/login', views.login_view),
    path('auth/logout', views.logout_view),
    path('auth/password', views.change_password),
    path('users', views.users),
    path('users/<uuid:pk>', views.user_detail),
    path('folders', views.folders),
    path('folders/<uuid:pk>', views.folder_detail),
    path('folders/<uuid:pk>/items', views.folder_items),
    path('items/recent', views.recent_items),
    path('items/link', views.create_link),
    path('items/bulk', views.items_bulk),
    path('items/<uuid:pk>', views.item_detail),
    path('items/<uuid:pk>/raw', views.item_raw),
    path('items/<uuid:pk>/preview', views.item_preview),
    path('items/<uuid:pk>/thumb', views.item_thumb),
    path('items/<uuid:pk>/text', views.item_text),
    path('items/<uuid:pk>/reprocess', views.item_reprocess),
    path('items/<uuid:pk>/comments', views.item_comments),
    path('items/<uuid:pk>/viewed', views.item_viewed),
    path('comments/<uuid:pk>', views.comment_detail),
    path('uploads', views.uploads),
    path('uploads/<uuid:pk>', views.upload_detail),
    path('search', views.search),
    path('activity', views.activity),
]
