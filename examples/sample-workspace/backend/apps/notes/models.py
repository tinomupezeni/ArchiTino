from django.db import models


class Notebook(models.Model):
    title = models.CharField(max_length=120)


class Note(models.Model):
    notebook = models.ForeignKey(Notebook, on_delete=models.CASCADE, related_name="notes")
    body = models.TextField()
    tags = models.ManyToManyField("notes.Tag")


class Tag(models.Model):
    name = models.CharField(max_length=40)
