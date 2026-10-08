from django.contrib import admin
from django.urls import include, path

admin.site.site_header = 'ОДО — администрирование'
admin.site.site_title = 'ОДО'

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('core.urls')),
]
