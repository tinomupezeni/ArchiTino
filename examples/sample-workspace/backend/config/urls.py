from django.urls import include, path

urlpatterns = [
    path("api/notes/", include("apps.notes.urls", namespace="notes")),
]
