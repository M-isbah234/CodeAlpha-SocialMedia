from django.conf import settings
from django.contrib.auth.models import User
from django.db import models


class Profile(models.Model):
    """Extra user info, one-to-one with the built-in User model."""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    bio = models.TextField(blank=True, default='')
    avatar = models.ImageField(upload_to='avatars/', blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.user.username}'s profile"


class Post(models.Model):
    author = models.ForeignKey(User, on_delete=models.CASCADE, related_name='posts')
    content = models.TextField(blank=True, default='')
    image = models.ImageField(upload_to='post_images/', blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']  # newest first

    def __str__(self):
        return f"Post {self.pk} by {self.author.username}"


class Comment(models.Model):
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name='comments')
    author = models.ForeignKey(User, on_delete=models.CASCADE, related_name='comments')
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']  # oldest first, reads like a thread

    def __str__(self):
        return f"Comment {self.pk} on post {self.post_id}"


class Like(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='likes')
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name='likes')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # A user can like a given post at most once.
        constraints = [
            models.UniqueConstraint(fields=['user', 'post'], name='unique_like_per_user_post'),
        ]

    def __str__(self):
        return f"{self.user.username} likes post {self.post_id}"


class Follow(models.Model):
    follower = models.ForeignKey(User, on_delete=models.CASCADE, related_name='following')
    following = models.ForeignKey(User, on_delete=models.CASCADE, related_name='followers')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            # No duplicate follow relationships.
            models.UniqueConstraint(fields=['follower', 'following'], name='unique_follow'),
            # No following yourself.
            models.CheckConstraint(
                condition=~models.Q(follower=models.F('following')),
                name='prevent_self_follow',
            ),
        ]

    def __str__(self):
        return f"{self.follower.username} -> {self.following.username}"


class Message(models.Model):
    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sent_messages')
    recipient = models.ForeignKey(User, on_delete=models.CASCADE, related_name='received_messages')
    content = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True)
    read_status = models.BooleanField(default=False)

    class Meta:
        ordering = ['timestamp']  # oldest first, reads like a chat log
        indexes = [
            models.Index(fields=['sender', 'recipient']),
        ]

    def __str__(self):
        return f"{self.sender.username} → {self.recipient.username}: {self.content[:20]}"
