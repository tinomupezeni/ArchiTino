from django.views import View

from .tasks import send_digest_email


class NoteListView(View):
    def post(self, request):
        send_digest_email.delay(request.data["notebook_id"])


class NoteDetailView(View):
    pass
