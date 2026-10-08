import os

from django.core.management.base import BaseCommand

from core.models import User


class Command(BaseCommand):
    help = 'Создаёт первого администратора из ADMIN_USERNAME / ADMIN_PASSWORD, если пользователей ещё нет'

    def handle(self, *args, **opts):
        if User.objects.exists():
            return
        username = os.environ.get('ADMIN_USERNAME', 'admin')
        password = os.environ.get('ADMIN_PASSWORD', 'admin12345')
        User.objects.create_user(username, password, name=os.environ.get('ADMIN_NAME', 'Администратор'), role=User.ADMIN)
        self.stdout.write(f'[odo] создан администратор: логин {username}')
