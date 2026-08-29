from django.apps import AppConfig


class ApiConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'api'

    def ready(self):
        # Register signal handlers (auto-create a Profile for every new User).
        from . import signals  # noqa: F401
