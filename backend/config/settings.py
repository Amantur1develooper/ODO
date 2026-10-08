import os
from pathlib import Path
from urllib.parse import urlparse

BASE_DIR = Path(__file__).resolve().parent.parent
env = os.environ.get


def env_bool(name, default=False):
    return env(name, str(default)).lower() in ('1', 'true', 'yes', 'on')


SECRET_KEY = env('SECRET_KEY', 'dev-secret-change-me')
DEBUG = env_bool('DEBUG', False)
ALLOWED_HOSTS = [h.strip() for h in env('ALLOWED_HOSTS', '*').split(',') if h.strip()]
CSRF_TRUSTED_ORIGINS = [o.strip() for o in env('CSRF_TRUSTED_ORIGINS', '').split(',') if o.strip()]

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'django.contrib.postgres',
    'core',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

_db = urlparse(env('DATABASE_URL', 'postgres://odo:odo@localhost:5432/odo'))
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': _db.path.lstrip('/'),
        'USER': _db.username,
        'PASSWORD': _db.password,
        'HOST': _db.hostname,
        'PORT': _db.port or 5432,
        'CONN_MAX_AGE': 60,
    }
}

AUTH_USER_MODEL = 'core.User'
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', 'OPTIONS': {'min_length': 6}},
]

LANGUAGE_CODE = 'ru'
TIME_ZONE = env('TZ', 'Asia/Bishkek')
USE_I18N = True
USE_TZ = True

STATIC_URL = '/django-static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

SESSION_COOKIE_AGE = 30 * 24 * 3600
SESSION_COOKIE_SECURE = env_bool('COOKIE_SECURE', False)
CSRF_COOKIE_SECURE = SESSION_COOKIE_SECURE
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
USE_X_FORWARDED_HOST = True

# Тело запросов с кусками файлов читается потоком, а не через request.body.
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024

# --- ОДО ---
DATA_DIR = Path(env('DATA_DIR', str(BASE_DIR.parent / 'storage'))).resolve()
MAX_UPLOAD_BYTES = int(float(env('MAX_UPLOAD_GB', '5')) * 1024 ** 3)
UPLOAD_CHUNK_BYTES = 16 * 1024 * 1024
GOTENBERG_URL = env('GOTENBERG_URL', '').rstrip('/')
# За nginx файлы отдаются через X-Accel-Redirect (быстро, с поддержкой Range).
USE_X_ACCEL = env_bool('USE_X_ACCEL', False)
X_ACCEL_PREFIX = '/protected/'
WORKER_THREADS = int(env('WORKER_THREADS', '3'))

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {'console': {'class': 'logging.StreamHandler'}},
    'root': {'handlers': ['console'], 'level': 'INFO'},
}
