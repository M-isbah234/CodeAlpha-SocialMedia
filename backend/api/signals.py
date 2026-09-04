import re
from django.contrib.auth.models import User
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Profile, Post, Comment, Like, Follow, Hashtag, Notification


@receiver(post_save, sender=User)
def create_user_profile(sender, instance, created, **kwargs):
    """Every new user automatically gets an empty profile."""
    if created:
        Profile.objects.create(user=instance)


def _notify_mentions(content, actor, verb, post=None, comment=None):
    mentions = set(re.findall(r'@(\w+)', content))
    for username in mentions:
        try:
            recipient = User.objects.get(username=username)
            if recipient != actor:
                Notification.objects.create(
                    recipient=recipient,
                    actor=actor,
                    verb=verb,
                    post=post,
                    comment=comment
                )
        except User.DoesNotExist:
            pass


@receiver(post_save, sender=Post)
def handle_post_save(sender, instance, created, **kwargs):
    # Parse Hashtags
    hashtags = set(re.findall(r'#(\w+)', instance.content))
    hashtag_objs = []
    for tag in hashtags:
        obj, _ = Hashtag.objects.get_or_create(name=tag.lower())
        hashtag_objs.append(obj)
    
    # Need to clear and add since ManyToMany doesn't support assignment like list directly
    # Wait, instance.hashtags.set(hashtag_objs) works if it's already saved (which it is here)
    instance.hashtags.set(hashtag_objs)

    if created:
        _notify_mentions(instance.content, instance.author, 'mentioned', post=instance)


@receiver(post_save, sender=Comment)
def handle_comment_save(sender, instance, created, **kwargs):
    if created:
        # Notify Post Author
        if instance.author != instance.post.author:
            Notification.objects.create(
                recipient=instance.post.author,
                actor=instance.author,
                verb='commented',
                post=instance.post,
                comment=instance
            )
        # Parse Mentions
        _notify_mentions(instance.content, instance.author, 'mentioned_comment', post=instance.post, comment=instance)


@receiver(post_save, sender=Like)
def handle_like_save(sender, instance, created, **kwargs):
    if created and instance.user != instance.post.author:
        Notification.objects.create(
            recipient=instance.post.author,
            actor=instance.user,
            verb='liked',
            post=instance.post
        )


@receiver(post_save, sender=Follow)
def handle_follow_save(sender, instance, created, **kwargs):
    if created:
        Notification.objects.create(
            recipient=instance.following,
            actor=instance.follower,
            verb='followed'
        )
