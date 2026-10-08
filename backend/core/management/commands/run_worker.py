import signal
import threading
import time

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import DEFAULT_DB_ALIAS, connections
from django.db.migrations.executor import MigrationExecutor

from core.models import Item
from core.processing import cleanup_uploads, release_stale, worker_loop


class Command(BaseCommand):
    help = 'Фоновая обработка загруженных файлов (превью, конвертация, текст для поиска)'

    def wait_for_migrations(self):
        # backend применяет миграции при старте; воркер ждёт, пока схема будет готова.
        while True:
            try:
                connection = connections[DEFAULT_DB_ALIAS]
                executor = MigrationExecutor(connection)
                if not executor.migration_plan(executor.loader.graph.leaf_nodes()):
                    return
            except Exception:  # noqa: BLE001 — база ещё недоступна
                pass
            self.stdout.write('[odo] жду миграции базы…')
            connections.close_all()
            time.sleep(3)

    def handle(self, *args, **opts):
        self.wait_for_migrations()
        # Один контейнер воркера: всё, что было «в работе» до перезапуска, начинаем заново.
        Item.objects.filter(status=Item.PROCESSING).exclude(claimed_at=None).update(claimed_at=None)
        stop = threading.Event()
        signal.signal(signal.SIGTERM, lambda *_: stop.set())
        signal.signal(signal.SIGINT, lambda *_: stop.set())
        threads = [threading.Thread(target=worker_loop, args=(stop,), daemon=True) for _ in range(settings.WORKER_THREADS)]
        for t in threads:
            t.start()
        self.stdout.write(f'[odo] воркер запущен, потоков: {len(threads)}')
        while not stop.wait(600):
            release_stale()
            cleanup_uploads()
