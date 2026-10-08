import re

from django.db import migrations, models


def fill_usernames(apps, schema_editor):
    User = apps.get_model('core', 'User')
    taken = set()
    for user in User.objects.order_by('date_joined'):
        base = re.sub(r'[^\w.-]', '', (user.email or '').split('@')[0].lower()) or 'user'
        name, n = base, 2
        while name in taken:
            name, n = f'{base}{n}', n + 1
        taken.add(name)
        user.username = name
        user.save(update_fields=['username'])


class Migration(migrations.Migration):
    dependencies = [('core', '0001_initial')]

    operations = [
        migrations.AddField('user', 'username', models.CharField('логин', max_length=150, null=True)),
        migrations.RunPython(fill_usernames, migrations.RunPython.noop),
        migrations.AlterField('user', 'username', models.CharField(
            'логин', max_length=150, unique=True, help_text='Латиница, цифры, точка, дефис или подчёркивание')),
        migrations.AlterField('user', 'email', models.EmailField('email', blank=True, default='', max_length=254)),
    ]
