from celery import shared_task


@shared_task
def send_digest_email(notebook_id: int) -> None:
    """Email a digest of new notes for a notebook."""
